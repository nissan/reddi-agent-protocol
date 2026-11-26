/**
 * Server only. What the RAP judge reads and writes in the database: the
 * relay's call log (read only), provider receipts (`budget_call_receipts`)
 * and its own log (`budget_judge_log`), both append-only
 * (migration 20261126120000_budget_judge).
 *
 * Holds and releases are Nissan's override. Anyone with the service role can
 * add rows to the log, so a hold or release counts only with the judge's MAC,
 * keyed from `BUDGET_JUDGE_OPS_SECRET` (judge project only), over the row's
 * place in its slice's log: a row the app adds, or one copied to a later
 * place, does not count.
 */

import { createHash, createHmac, timingSafeEqual } from "crypto";
import type { SignedCalls } from "./rule";

export type SliceKey = { budget: string; createdSlot: string; payee: string };

export type JudgeLogKind = "seen" | "hold" | "release" | "ruling" | "alert";
export type JudgeLogRow = SliceKey & { kind: JudgeLogKind; reason: string; detail: Record<string, unknown>; mac?: string; at: string };

export interface JudgeStore {
  /** The calls the relay's spender signed for `payee` on this opening of the Budget. Throws when unreadable. */
  signedCalls(slice: SliceKey): Promise<SignedCalls>;
  /** The newest receipts saved for the slice, newest first, at most `limit`. Throws when unreadable. */
  receipts(slice: SliceKey, limit: number): Promise<string[]>;
  addReceipt(slice: SliceKey, source: "relay" | "provider", receipt: string): Promise<boolean>;
  /** The slice's log, oldest first. Throws when unreadable. */
  log(slice: SliceKey): Promise<JudgeLogRow[]>;
  append(row: Omit<JudgeLogRow, "at">): Promise<boolean>;
  /** Log rows of `kind` since `sinceIso`, newest first, at most 200. */
  recent(kind: JudgeLogKind, sinceIso: string): Promise<JudgeLogRow[]>;
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SLOT = /^[1-9][0-9]{0,19}$/;
const HEX64 = /^[0-9a-f]{64}$/;
/** The most call log rows read for one slice; more and the judge stops and asks Nissan. */
export const MAX_SIGNED_CALLS_READ = 20_000;

export class SignedCallsOverflow extends Error {
  constructor() {
    super(`more than ${MAX_SIGNED_CALLS_READ} signed calls for one slice`);
  }
}

export function validSlice(slice: SliceKey): boolean {
  return BASE58.test(slice.budget) && BASE58.test(slice.payee) && SLOT.test(slice.createdSlot);
}

// ── Override MACs ──────────────────────────────────────────────────────────

function opsKey(env: Record<string, string | undefined>): Buffer | undefined {
  const secret = env.BUDGET_JUDGE_OPS_SECRET?.trim();
  return secret && secret.length >= 32 ? createHash("sha256").update(`rap-judge-ops-key/1\n${secret}`).digest() : undefined;
}

export function overrideMac(key: Buffer, slice: SliceKey, kind: "hold" | "release", place: number, reason: string): string {
  return createHmac("sha256", key).update(`rap-judge-override/1|${slice.budget}|${slice.createdSlot}|${slice.payee}|${kind}|${place}|${reason}`).digest("hex");
}

function macMatches(expected: string, given: string | undefined): boolean {
  if (!given || !HEX64.test(given)) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(given, "hex"));
}

/** Whether Nissan holds this slice now: the last hold or release with a valid MAC decides. Its reason when held. */
export function heldBy(rows: JudgeLogRow[], slice: SliceKey, env: Record<string, string | undefined>): string | undefined {
  const key = opsKey(env);
  if (!key) return undefined;
  let held: string | undefined;
  rows.forEach((row, place) => {
    if (row.kind !== "hold" && row.kind !== "release") return;
    if (!macMatches(overrideMac(key, slice, row.kind, place, row.reason), row.mac)) return;
    held = row.kind === "hold" ? row.reason || "held" : undefined;
  });
  return held;
}

/** Adds a hold or release with its MAC at the next place in the slice's log. False without the ops secret or when the write fails. */
export async function appendOverride(store: JudgeStore, slice: SliceKey, kind: "hold" | "release", reason: string, env: Record<string, string | undefined>): Promise<boolean> {
  const key = opsKey(env);
  if (!key) return false;
  const rows = await store.log(slice);
  const text = reason.slice(0, 500);
  const ok = await store.append({ ...slice, kind, reason: text, detail: {}, mac: overrideMac(key, slice, kind, rows.length, text) });
  if (!ok) return false;
  // Another row may have landed first; then this one sits at another place and does not count.
  return (kind === "hold") === (heldBy(await store.log(slice), slice, env) !== undefined);
}

// ── Memory store (tests) ──────────────────────────────────────────────────

export class MemoryJudgeStore implements JudgeStore {
  calls: (SliceKey & { bodyHash: string })[] = [];
  saved: (SliceKey & { source: string; receipt: string })[] = [];
  rows: JudgeLogRow[] = [];
  fail = false;
  private same(a: SliceKey, b: SliceKey) {
    return a.budget === b.budget && a.createdSlot === b.createdSlot && a.payee === b.payee;
  }
  async signedCalls(slice: SliceKey) {
    if (this.fail) throw new Error("store down");
    const mine = this.calls.filter((c) => this.same(c, slice));
    return { count: mine.length, bodyHashes: new Set(mine.map((c) => c.bodyHash)) };
  }
  async receipts(slice: SliceKey, limit: number) {
    if (this.fail) throw new Error("store down");
    return this.saved.filter((r) => this.same(r, slice)).map((r) => r.receipt).reverse().slice(0, limit);
  }
  async addReceipt(slice: SliceKey, source: "relay" | "provider", receipt: string) {
    if (this.fail) return false;
    this.saved.push({ ...slice, source, receipt });
    return true;
  }
  async log(slice: SliceKey) {
    if (this.fail) throw new Error("store down");
    return this.rows.filter((r) => this.same(r, slice)).map((r) => ({ ...r }));
  }
  async append(row: Omit<JudgeLogRow, "at">) {
    if (this.fail) return false;
    this.rows.push({ ...row, at: new Date().toISOString() });
    return true;
  }
  async recent(kind: JudgeLogKind, sinceIso: string) {
    return this.rows.filter((r) => r.kind === kind && r.at >= sinceIso).reverse().slice(0, 200);
  }
}

// ── Supabase store ────────────────────────────────────────────────────────

type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; headers?: { get(name: string): string | null } }>;
type LogRow = { budget: string; created_slot: string; payee: string; kind: JudgeLogKind; reason: string; detail: Record<string, unknown> | null; mac: string | null; at: string };

const PAGE = 1000;

export class SupabaseJudgeStore implements JudgeStore {
  constructor(private readonly config: { url: string; serviceKey: string; fetchImpl?: FetchLike }) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { apikey: this.config.serviceKey, authorization: `Bearer ${this.config.serviceKey}`, "content-type": "application/json", ...extra };
  }
  private fetch(path: string, init: { method: string; headers: Record<string, string>; body?: string }) {
    return (this.config.fetchImpl ?? (fetch as unknown as FetchLike))(`${this.config.url}/rest/v1/${path}`, init);
  }
  private async get<T>(path: string): Promise<T[]> {
    const response = await this.fetch(path, { method: "GET", headers: this.headers() });
    if (!response.ok) throw new Error(`judge store: ${response.status}`);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error("judge store: unreadable answer");
    return rows as T[];
  }
  private async insert(table: string, body: unknown): Promise<boolean> {
    try {
      return (await this.fetch(table, { method: "POST", headers: this.headers({ prefer: "return=minimal" }), body: JSON.stringify(body) })).ok;
    } catch {
      return false;
    }
  }

  async signedCalls(slice: SliceKey): Promise<SignedCalls> {
    if (!validSlice(slice)) return { count: 0, bodyHashes: new Set() };
    // The relay's record of this Budget; its spender's call log for this provider, this opening only.
    const records = await this.get<{ id: string }>(`budget_spenders?budget=eq.${slice.budget}&select=id&limit=2`);
    if (records.length === 0) return { count: 0, bodyHashes: new Set() };
    if (records.length > 1) throw new Error("judge store: two relay records name one Budget");
    const hashes = new Set<string>();
    let count = 0;
    for (let offset = 0; ; offset += PAGE) {
      const rows = await this.get<{ detail: Record<string, unknown> | null }>(
        `budget_spender_uses?spender_id=eq.${records[0].id}&purpose=eq.call&payee=eq.${slice.payee}&select=detail&order=id.asc&limit=${PAGE}&offset=${offset}`,
      );
      for (const row of rows) {
        const detail = row.detail ?? {};
        if (detail.createdSlot !== slice.createdSlot) continue;
        count += 1;
        if (typeof detail.bodyHash === "string" && HEX64.test(detail.bodyHash)) hashes.add(detail.bodyHash);
      }
      if (offset + PAGE > MAX_SIGNED_CALLS_READ) throw new SignedCallsOverflow();
      if (rows.length < PAGE) break;
    }
    return { count, bodyHashes: hashes };
  }

  async receipts(slice: SliceKey, limit: number): Promise<string[]> {
    if (!validSlice(slice)) return [];
    const rows = await this.get<{ receipt: string }>(
      `budget_call_receipts?budget=eq.${slice.budget}&created_slot=eq.${slice.createdSlot}&payee=eq.${slice.payee}&select=receipt&order=id.desc&limit=${Math.min(Math.max(limit, 1), PAGE)}`,
    );
    return rows.map((r) => r.receipt).filter((r) => typeof r === "string");
  }

  addReceipt(slice: SliceKey, source: "relay" | "provider", receipt: string): Promise<boolean> {
    if (!validSlice(slice) || receipt.length === 0 || receipt.length > 8192) return Promise.resolve(false);
    return this.insert("budget_call_receipts", { budget: slice.budget, created_slot: slice.createdSlot, payee: slice.payee, source, receipt });
  }

  async log(slice: SliceKey): Promise<JudgeLogRow[]> {
    if (!validSlice(slice)) return [];
    const rows = await this.get<LogRow>(
      `budget_judge_log?budget=eq.${slice.budget}&created_slot=eq.${slice.createdSlot}&payee=eq.${slice.payee}&select=budget,created_slot,payee,kind,reason,detail,mac,at&order=id.asc&limit=${PAGE}`,
    );
    // A log too long to read whole could hide a release: refuse, and the caller treats the slice as held.
    if (rows.length >= PAGE) throw new Error("judge store: slice log longer than the judge reads");
    return rows.map(fromLogRow);
  }

  append(row: Omit<JudgeLogRow, "at">): Promise<boolean> {
    if (!validSlice(row)) return Promise.resolve(false);
    return this.insert("budget_judge_log", { budget: row.budget, created_slot: row.createdSlot, payee: row.payee, kind: row.kind, reason: row.reason.slice(0, 500), detail: row.detail, mac: row.mac ?? null });
  }

  async recent(kind: JudgeLogKind, sinceIso: string): Promise<JudgeLogRow[]> {
    const rows = await this.get<LogRow>(`budget_judge_log?kind=eq.${kind}&at=gte.${encodeURIComponent(sinceIso)}&select=budget,created_slot,payee,kind,reason,detail,mac,at&order=id.desc&limit=200`);
    return rows.map(fromLogRow);
  }
}

function fromLogRow(row: LogRow): JudgeLogRow {
  return { budget: row.budget, createdSlot: row.created_slot, payee: row.payee, kind: row.kind, reason: row.reason, detail: row.detail ?? {}, ...(row.mac ? { mac: row.mac } : {}), at: row.at };
}

/** The judge's store from `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, or undefined. */
export function judgeStore(env: Record<string, string | undefined> = process.env): JudgeStore | undefined {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !/^https:\/\//.test(url) || !serviceKey) return undefined;
  return new SupabaseJudgeStore({ url, serviceKey });
}
