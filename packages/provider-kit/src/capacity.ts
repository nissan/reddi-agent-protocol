/**
 * How many calls the model behind this provider can take, so the provider
 * says it is busy before a buyer locks anything, rather than taking a lock it
 * then has to give back. Built for free or rate-limited models (a busy answer
 * is the normal case there), and for a daily cap on a paid model's bill.
 *
 * The default store is in memory, per process. A host that runs several
 * instances passes a shared one.
 */

export interface CapacityLimits {
  /** Calls the model takes in any 60 seconds. */
  requestsPerMinute?: number;
  /** Calls the model takes in a UTC day. Past it the provider is offline until midnight UTC. */
  requestsPerDay?: number;
  /** How long to stay busy after the model answers 429 (too many requests). */
  cooldownSeconds: number;
}

export type CapacityCheck = { ok: true } | { ok: false; reason: "cooling_down" | "minute_limit" | "day_limit"; retryAfterSeconds: number };

export interface CapacityState {
  /** Start times (ms) of calls in the last minute. */
  recent: number[];
  /** The UTC day (YYYY-MM-DD) `today` counts. */
  day: string;
  today: number;
  /** Busy until this time (ms) after a 429. */
  coolingUntil: number;
}

export interface CapacityStore {
  /** Runs `update` on the current state and saves what it returns, as one step. */
  update<T>(update: (state: CapacityState) => { state: CapacityState; result: T }): Promise<T>;
}

export class MemoryCapacityStore implements CapacityStore {
  private state: CapacityState = { recent: [], day: "", today: 0, coolingUntil: 0 };
  async update<T>(update: (state: CapacityState) => { state: CapacityState; result: T }): Promise<T> {
    const { state, result } = update(structuredClone(this.state));
    this.state = state;
    return result;
  }
}

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const secondsUntilNextUtcDay = (ms: number) => Math.max(1, Math.ceil((Date.UTC(new Date(ms).getUTCFullYear(), new Date(ms).getUTCMonth(), new Date(ms).getUTCDate() + 1) - ms) / 1000));

function current(state: CapacityState, nowMs: number): CapacityState {
  const day = utcDay(nowMs);
  return { recent: state.recent.filter((t) => t > nowMs - 60_000), day, today: state.day === day ? state.today : 0, coolingUntil: state.coolingUntil };
}

function verdict(state: CapacityState, limits: CapacityLimits, nowMs: number): CapacityCheck {
  if (state.coolingUntil > nowMs) return { ok: false, reason: "cooling_down", retryAfterSeconds: Math.ceil((state.coolingUntil - nowMs) / 1000) };
  if (limits.requestsPerDay !== undefined && state.today >= limits.requestsPerDay) return { ok: false, reason: "day_limit", retryAfterSeconds: secondsUntilNextUtcDay(nowMs) };
  if (limits.requestsPerMinute !== undefined && state.recent.length >= limits.requestsPerMinute) {
    return { ok: false, reason: "minute_limit", retryAfterSeconds: Math.max(1, Math.ceil((state.recent[0] + 60_000 - nowMs) / 1000)) };
  }
  return { ok: true };
}

export class Capacity {
  constructor(private readonly limits: CapacityLimits, private readonly store: CapacityStore = new MemoryCapacityStore()) {}

  /** Whether a call could start now. Takes nothing. */
  check(nowMs: number): Promise<CapacityCheck> {
    return this.store.update<CapacityCheck>((state) => {
      const s = current(state, nowMs);
      return { state: s, result: verdict(s, this.limits, nowMs) };
    });
  }

  /** Counts a call against the limits if there is room for it. */
  take(nowMs: number): Promise<CapacityCheck> {
    return this.store.update<CapacityCheck>((state) => {
      const s = current(state, nowMs);
      const v = verdict(s, this.limits, nowMs);
      if (!v.ok) return { state: s, result: v };
      return { state: { ...s, recent: [...s.recent, nowMs], today: s.today + 1 }, result: v };
    });
  }

  /** The model said it is overloaded: stay busy for the cooldown. */
  coolDown(nowMs: number): Promise<void> {
    return this.store.update((state) => ({ state: { ...current(state, nowMs), coolingUntil: Math.max(state.coolingUntil, nowMs + this.limits.cooldownSeconds * 1000) }, result: undefined }));
  }
}

export const BUSY_MESSAGES: Record<Exclude<CapacityCheck, { ok: true }>["reason"], string> = {
  cooling_down: "The model behind this provider is cooling down after a rate limit.",
  minute_limit: "This provider has taken all the calls its model allows this minute.",
  day_limit: "This provider has taken all the calls its model allows today and is offline until midnight UTC.",
};
