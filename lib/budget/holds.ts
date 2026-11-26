/**
 * Server only. The Budget signer's holds (audit 2026-11-25, RT-M2): a pause
 * of every relay Budget, or a freeze of one record, that the main app can
 * ask for but cannot lift.
 *
 * Holds live in an append-only log (`budget_signer_holds`: insert and select
 * only, no update or delete, ids and times set by the database). Anyone with
 * the store may add a `hold`. A `release` counts only with the signer's MAC,
 * keyed from `BUDGET_INCIDENT_SECRET`, which only the signer project holds,
 * over the release's place in its log (how many rows of its scope come
 * before it). So a release copied and added again later lands at another
 * place and does not count.
 */

import { createHash, createHmac, timingSafeEqual } from "crypto";
import { HoldLogOverflow, type BudgetCustodyStore, type SignerHold } from "./store";

function holdKey(env: Record<string, string | undefined>): Buffer | undefined {
  const secret = env.BUDGET_INCIDENT_SECRET?.trim();
  return secret ? createHash("sha256").update(`rap-budget-hold-key/1\n${secret}`).digest() : undefined;
}

function releaseMac(key: Buffer, scope: SignerHold["scope"], spenderId: string | undefined, place: number, reason: string): string {
  return createHmac("sha256", key).update(`rap-budget-hold/1|${scope}|${spenderId ?? "-"}|release|${place}|${reason}`).digest("hex");
}

function macMatches(expected: string, given: string | undefined): boolean {
  if (!given || !/^[0-9a-f]{64}$/.test(given)) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(given, "hex"));
}

/** The hold in force for one log (all Budgets, or one record), if any: its reason. */
function inForce(rows: SignerHold[], key: Buffer | undefined, scope: SignerHold["scope"], spenderId?: string): string | undefined {
  let held: string | undefined;
  rows.forEach((row, place) => {
    if (row.kind === "hold") held = row.reason || "held";
    else if (key && macMatches(releaseMac(key, scope, spenderId, place, row.reason), row.mac)) held = undefined;
  });
  return held;
}

/** The reason given when the log is too long to read whole. */
export const HOLD_LOG_FULL = "the hold log is longer than the signer reads";

/**
 * What holds this record now: `{ all }` for a pause of every Budget,
 * `{ spender }` for a freeze of this one. Undefined when nothing does.
 * Throws when the log cannot be read: the caller refuses then. When the log
 * holds more rows than the signer reads (anyone may add rows, releases with
 * a bad MAC included), it cannot know it saw every hold, so everything is
 * held until the operator deals with the log (fail closed).
 */
export async function signerHold(store: BudgetCustodyStore, spenderId: string, env: Record<string, string | undefined>): Promise<{ scope: "all" | "spender"; reason: string } | undefined> {
  let rows: SignerHold[];
  try {
    rows = await store.holds(spenderId);
  } catch (error) {
    if (error instanceof HoldLogOverflow) return { scope: "all", reason: HOLD_LOG_FULL };
    throw error;
  }
  const key = holdKey(env);
  const all = inForce(rows.filter((r) => r.scope === "all"), key, "all");
  if (all !== undefined) return { scope: "all", reason: all };
  const own = inForce(rows.filter((r) => r.scope === "spender" && r.spenderId === spenderId), key, "spender", spenderId);
  return own !== undefined ? { scope: "spender", reason: own } : undefined;
}

/**
 * Whether a freeze of this one record is in force, whatever holds all
 * Budgets: for a caller about to freeze it, so a record already frozen gets
 * no second row. Throws when the log cannot be read whole.
 */
export async function recordFrozen(store: BudgetCustodyStore, spenderId: string, env: Record<string, string | undefined>): Promise<boolean> {
  const rows = await store.holds(spenderId);
  return inForce(rows.filter((r) => r.scope === "spender" && r.spenderId === spenderId), holdKey(env), "spender", spenderId) !== undefined;
}

/** Adds a hold. Any side may. */
export function addHold(store: BudgetCustodyStore, hold: { scope: "all" } | { scope: "spender"; spenderId: string }, reason: string, nowMs = Date.now()): Promise<boolean> {
  return store.addHold({ ...hold, kind: "hold", reason: reason.slice(0, 300), at: new Date(nowMs).toISOString() });
}

/**
 * Lifts the hold of one log, as the signer: a release with its MAC at the
 * next place in that log. False without `BUDGET_INCIDENT_SECRET`, or when the
 * write fails. If another row lands first, the release does not count and
 * the hold stays: run it again.
 */
export async function releaseHold(store: BudgetCustodyStore, hold: { scope: "all" } | { scope: "spender"; spenderId: string }, reason: string, env: Record<string, string | undefined>, nowMs = Date.now()): Promise<boolean> {
  const key = holdKey(env);
  if (!key) return false;
  const spenderId = hold.scope === "spender" ? hold.spenderId : undefined;
  const rows = (await store.holds(spenderId ?? "-")).filter((r) => r.scope === hold.scope && (hold.scope === "all" || r.spenderId === spenderId));
  const text = reason.slice(0, 300);
  return store.addHold({ ...hold, kind: "release", reason: text, at: new Date(nowMs).toISOString(), mac: releaseMac(key, hold.scope, spenderId, rows.length, text) });
}
