/**
 * What a provider remembers between requests about single calls, behind
 * interfaces, so it can live in this process (the `rap-provider start`
 * server) or in a database shared by every instance of a serverless
 * deployment (`./postgres`).
 *
 * - A lease on a lock: only one request at a time sends, looks at or collects
 *   the settle of one escrow. It expires, so a crashed instance cannot hold a
 *   lock for ever.
 * - Held answers: the answer of a call whose settle was sent but not yet known
 *   to land, kept for the buyer to collect with the same request.
 */
import { randomUUID } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import type { TokenCounts, VerifiedLock } from "@redditech/x402-solana";

export type HeldLock = Extract<VerifiedLock, { ok: true }>;

/** A served single call whose answer waits for its settle. */
export interface HeldCall {
  escrow: string;
  lock: HeldLock;
  requestId: string;
  /** SHA-256 of the request body: only the same request may collect the answer. */
  requestHash: string;
  upstream: Record<string, unknown>;
  usage: TokenCounts;
  createdMs: number;
}

export interface LockLease {
  /**
   * A token when this caller now holds the lease on `escrow` for `ttlMs`; false when another holds it.
   * The token names this one claim: only it releases the lease.
   */
  claim(escrow: string, ttlMs: number, nowMs: number): Promise<string | false>;
  /**
   * Ends the lease that `token` claimed. A token whose lease has expired and been claimed again
   * ends nothing, so a slow holder never ends the next holder's lease.
   */
  release(escrow: string, token: string): Promise<void>;
  /** True while someone holds an unexpired lease on `escrow`. */
  held(escrow: string, nowMs: number): Promise<boolean>;
}

export interface HeldAnswerStore {
  hold(call: HeldCall): Promise<void>;
  get(escrow: string): Promise<HeldCall | undefined>;
  drop(escrow: string): Promise<void>;
  /** Forgets answers held since before `beforeMs`. */
  expire(beforeMs: number): Promise<void>;
}

export class MemoryLockLease implements LockLease {
  private readonly leases = new Map<string, { token: string; until: number }>();
  async claim(escrow: string, ttlMs: number, nowMs: number): Promise<string | false> {
    const current = this.leases.get(escrow);
    if (current !== undefined && current.until > nowMs) return false;
    const token = randomUUID();
    this.leases.set(escrow, { token, until: nowMs + ttlMs });
    return token;
  }
  async release(escrow: string, token: string): Promise<void> {
    if (this.leases.get(escrow)?.token === token) this.leases.delete(escrow);
  }
  async held(escrow: string, nowMs: number): Promise<boolean> {
    const current = this.leases.get(escrow);
    return current !== undefined && current.until > nowMs;
  }
}

export class MemoryHeldAnswerStore implements HeldAnswerStore {
  private readonly calls = new Map<string, HeldCall>();
  async hold(call: HeldCall): Promise<void> {
    this.calls.set(call.escrow, call);
  }
  async get(escrow: string): Promise<HeldCall | undefined> {
    return this.calls.get(escrow);
  }
  async drop(escrow: string): Promise<void> {
    this.calls.delete(escrow);
  }
  async expire(beforeMs: number): Promise<void> {
    for (const [escrow, call] of this.calls) if (call.createdMs < beforeMs) this.calls.delete(escrow);
  }
}

/**
 * JSON that keeps public keys, big integers and byte arrays, so a held call
 * (its verified lock included) can be stored as text and read back the same.
 */
export function encodeState(value: unknown): string {
  return JSON.stringify(toPlain(value));
}

export function decodeState<T>(text: string): T {
  return fromPlain(JSON.parse(text)) as T;
}

/** A public key from any copy of @solana/web3.js (the kit and the SDK may each load their own). */
const isPublicKey = (value: unknown): value is PublicKey =>
  value instanceof PublicKey || (typeof value === "object" && value !== null && typeof (value as PublicKey).toBase58 === "function" && typeof (value as PublicKey).toBytes === "function" && typeof (value as PublicKey).equals === "function");

function toPlain(value: unknown): unknown {
  if (isPublicKey(value)) return { $pk: value.toBase58() };
  if (typeof value === "bigint") return { $bi: value.toString() };
  if (value instanceof Uint8Array) return { $u8: Buffer.from(value).toString("hex") };
  if (Array.isArray(value)) return value.map(toPlain);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) if (item !== undefined) out[key] = toPlain(item);
    return out;
  }
  return value;
}

function fromPlain(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(fromPlain);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 1) {
      if (typeof record.$pk === "string") return new PublicKey(record.$pk);
      if (typeof record.$bi === "string") return BigInt(record.$bi);
      if (typeof record.$u8 === "string") return Uint8Array.from(Buffer.from(record.$u8, "hex"));
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) out[key] = fromPlain(item);
    return out;
  }
  return value;
}
