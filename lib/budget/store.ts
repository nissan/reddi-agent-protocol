/**
 * Server only. Where the relay keeps what it holds for pooled Budgets
 * (audit round 4, R4-M3): one record per Budget it spends from,
 * the log of every approval, the alerts it sent, and the pause switch.
 * Tables: `supabase/migrations/20261125090000_budget_custody.sql`, changed by
 * `20261125110000_budget_custody_kms.sql`, `20261125120000_budget_custody_round5.sql` and
 * `20261125130000_budget_custody_round5b.sql`.
 *
 * No key material is stored: the spender key is in Vercel KMS (`./kms`), and
 * a record holds only its public key.
 */

export type BudgetNetwork = "solana-devnet" | "solana-mainnet-beta";

/** The genesis hash of each network, to tell an RPC on the wrong cluster (audit round 5, S6-claude-06). */
export const GENESIS_HASH: Record<BudgetNetwork, string> = {
  "solana-devnet": "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  "solana-mainnet-beta": "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
};

/**
 * pending: the record exists and names its Budget, which the payer has not opened yet.
 * open: the Budget is open on chain; the relay may approve reserves.
 * frozen: something looked wrong; the relay approves nothing but the close.
 * closing: the relay closed it (or asked to); it approves nothing but the close.
 * closed: the Budget is closed on chain and every slice is settled.
 */
export type SpenderStatus = "pending" | "open" | "frozen" | "closing" | "closed";

/** What the watcher last saw of one slice, to tell a new reserve or post from an old one. */
export type SeenSlice = {
  payee: string;
  reserved: string;
  state: "open" | "posted" | "disputed" | "paid";
  finalAmount: string;
  postedSlot: string;
};

export type BudgetContact = {
  /** Where the payer wants alerts by email. */
  email?: string;
  /** An https URL that gets each alert as JSON. */
  webhook?: string;
  /**
   * The secret each webhook alert is signed with (HMAC-SHA256, header
   * `x-rap-signature: t=<unix seconds>,v1=<hex>` over `<t>.<body>`). Made when
   * the key is, and given to the payer once.
   */
  webhookSecret?: string;
};

export type SpenderRecord = {
  /** Random id, 32 hex characters. */
  id: string;
  /** The Budget's spender (base58): the SHA-256 of `spenderKey`, the same for every Budget opened under one KMS key. */
  spender: string;
  /** The KMS public key the Budget was opened with: 33-byte compressed P-256, hex. */
  spenderKey: string;
  /** The wallet that opens (and owns) the Budget. */
  payer: string;
  network: BudgetNetwork;
  status: SpenderStatus;
  /**
   * The Budget's address, named by the payer's signed authorization when the
   * record is made (audit round 5, R5-M1): one record per Budget. Absent only
   * on records made before round 5.
   */
  budget?: string;
  /** Once opened: the Budget's `created_slot`, as a decimal string. */
  createdSlot?: string;
  /** The Budget's mint, absent for SOL. */
  mint?: string;
  contact: BudgetContact;
  /**
   * Providers (base58 wallets) the payer expects this Budget to pay. Never
   * empty on a record made since round 5, and equal to the Budget's on-chain
   * allowlist: the relay signs no reserve for anyone else, the program refuses
   * anyone else, and the watcher tells the operator about a slice for anyone
   * else.
   */
  expectedPayees: string[];
  /** The most one reserve approval may name, in base units, as the payer signed it. */
  maxReserve?: string;
  /** The Budget's terms as the payer signed them (amounts and slots as decimal strings); activation holds the Budget on chain to them. */
  terms?: { site: string; programId: string; mint: string | null; tokenName: string; total: string; judge: string | null; openSlots: string; disputeSlots: string; judgeSlots: string; spenderMayWaive: boolean };
  /**
   * The payer's proof (audit round 5, R5-M1): an Ed25519 signature by the
   * payer's wallet over `relayAuthorizationMessage` of this record's network,
   * budget, providers, maximum and contact, made at `issuedAt` (unix seconds).
   */
  authorization?: { issuedAt: number; signature: string };
  /**
   * SHA-256 (hex) of the agent secret handed out once when the record was
   * made. Every reserve or waive approval must present the secret.
   */
  agentSecretSha256?: string;
  /**
   * The signer's call counter per provider (by payee wallet): the last call
   * number it signed for that provider. Each number is signed once.
   */
  calls?: Record<string, number>;
  /**
   * The relay's reserve bookkeeping per provider (by payee wallet): when it
   * last had a reserve approved, the slice on chain at that time, and how many
   * approvals in a row the provider left unused.
   */
  reserves?: Record<string, { approvedAt: number; reservedBefore: string; unlanded: number }>;
  /** When the operator was last told this record names a key KMS no longer signs with. */
  keyRotatedAlertAt?: string;
  /** The watcher's last view of the Budget's slices, by reservation address. */
  seen: Record<string, SeenSlice>;
  /** Why it was frozen, when it was. */
  frozenReason?: string;
  /** When the watcher last finished this record: the least recently watched go first. */
  watchedAt?: string;
  /** Payer alerts the watcher could not deliver: they are sent again every pass until one channel takes them. */
  undelivered?: { since: string; passes: number; operatorTold?: boolean };
  /** When the watcher first found the Budget account missing at the finalized commitment. */
  goneSince?: string;
  /** The last incident close tried on this Budget. */
  incident?: { reason: string; ok: boolean; at: string; signature?: string; error?: string };
  version: number;
  createdAt: string;
};

/**
 * One logged approval. `detail` says what it allowed (audit round 5,
 * S6-claude-05): the approval message itself (hex, public data), the amount
 * and payout account of a reserve or waive, its expiry and who asked.
 */
export type SpenderUse = {
  spenderId: string;
  /** `call`: one paid call's signature, counted apart from the approvals. */
  purpose: "reserve" | "waive" | "close" | "call";
  payee?: string;
  messageSha256: string;
  at: string;
  detail?: Record<string, string>;
  /** A close the incident step asked for: the only approval not counted, limited or paused (round 5b). */
  byOperator?: boolean;
};

/** An operator alert no channel took, kept to be sent again (round 5b). */
export type PendingOperatorAlert = { kind: string; subject: string; text: string; detail: Record<string, unknown>; spenderId?: string; firstAt: string; tries: number };

export type BudgetAlertRow = {
  spenderId?: string;
  audience: "payer" | "operator";
  kind: string;
  detail: Record<string, unknown>;
  delivered: Record<string, string>;
  at: string;
};

/** What `claimUse` decided. Only `ok` means the use was logged and may be signed. */
export type ClaimResult = "ok" | "unknown" | "closed" | "paused" | "not_open" | "overuse" | "payer_overuse" | "global_overuse" | "global_overuse_new" | "store_unavailable";

/**
 * How many approvals a claim may make in ten minutes: for one Budget, for all
 * of one payer's Budgets, and for every relay Budget on the network. Closes
 * the agent asks for count; the incident step's do not.
 */
export type UseLimits = { perBudget: number; perPayer: number; global: number };

export type Write<T> = { ok: true; value: T } | { ok: false; code: "conflict" | "store_unavailable" };

export interface BudgetCustodyStore {
  /** Refuses (`budget_taken`) a record for a Budget another record already names. */
  create(record: SpenderRecord): Promise<{ ok: true } | { ok: false; code: "store_unavailable" | "budget_taken" }>;
  byId(id: string): Promise<SpenderRecord | undefined>;
  byBudget(budget: string): Promise<SpenderRecord | undefined>;
  /** Every record in these statuses (no cap), oldest first. */
  withStatus(statuses: SpenderStatus[]): Promise<SpenderRecord[]>;
  /** Writes `next` only if the stored record is still at `next.version - 1`. */
  update(next: SpenderRecord): Promise<Write<SpenderRecord>>;
  /** Appends to the use log. A use that is not logged must not be signed. */
  logUse(use: SpenderUse): Promise<boolean>;
  /** How many uses of this key were logged at or after `since` (ISO time). */
  usesSince(spenderId: string, since: string): Promise<number>;
  /**
   * In one atomic step: checks the record exists and, unless the incident
   * step asks for a close, that nothing is paused, that a reserve or waive is
   * for an open record, and that the limits hold; then logs the use.
   */
  claimUse(use: SpenderUse, limits: UseLimits): Promise<ClaimResult>;
  /** Keeps an operator alert no channel took (the newest 50). */
  queueOperatorAlert(alert: PendingOperatorAlert): Promise<boolean>;
  /** Hands over every kept operator alert and empties the queue, in one step. */
  takeOperatorAlerts(): Promise<PendingOperatorAlert[]>;
  /** When the watcher last finished a whole pass. */
  watchedAt(): Promise<string | undefined>;
  markWatched(at: string): Promise<boolean>;
  logAlert(alert: BudgetAlertRow): Promise<boolean>;
  paused(): Promise<{ paused: boolean; reason?: string }>;
  setPaused(paused: boolean, reason: string): Promise<boolean>;
}

/** For tests and local runs. One process only. */
export class MemoryBudgetCustodyStore implements BudgetCustodyStore {
  readonly records = new Map<string, SpenderRecord>();
  readonly uses: SpenderUse[] = [];
  readonly alerts: BudgetAlertRow[] = [];
  control: { paused: boolean; reason?: string; watchedAt?: string; ceilingAlertedAt?: string; callCeilingAlertedAt?: string } = { paused: false };
  operatorPending: PendingOperatorAlert[] = [];
  /** Tests set this to make the log refuse writes. */
  failLogs = false;

  async create(record: SpenderRecord) {
    if (this.failLogs) return { ok: false as const, code: "store_unavailable" as const };
    if (record.budget && [...this.records.values()].some((r) => r.budget === record.budget)) return { ok: false as const, code: "budget_taken" as const };
    this.records.set(record.id, structuredClone(record));
    return { ok: true as const };
  }
  async byId(id: string) {
    const r = this.records.get(id);
    return r ? structuredClone(r) : undefined;
  }
  async byBudget(budget: string) {
    for (const r of this.records.values()) if (r.budget === budget) return structuredClone(r);
    return undefined;
  }
  async withStatus(statuses: SpenderStatus[]) {
    return [...this.records.values()].filter((r) => statuses.includes(r.status)).map((r) => structuredClone(r));
  }
  async update(next: SpenderRecord): Promise<Write<SpenderRecord>> {
    const current = this.records.get(next.id);
    if (!current || current.version !== next.version - 1) return { ok: false, code: "conflict" };
    if (!/^0[23][0-9a-f]{64}$/.test(next.spenderKey)) throw new Error("a record names its compressed P-256 public key");
    this.records.set(next.id, structuredClone(next));
    return { ok: true, value: structuredClone(next) };
  }
  async logUse(use: SpenderUse) {
    if (this.failLogs) return false;
    this.uses.push({ ...use });
    return true;
  }
  async usesSince(spenderId: string, since: string) {
    return this.uses.filter((u) => u.spenderId === spenderId && u.at >= since).length;
  }
  /** Synchronous body, so atomic within the one process this store serves. `use.at` is the clock. */
  async claimUse(use: SpenderUse, limits: UseLimits): Promise<ClaimResult> {
    if (this.failLogs) return "store_unavailable";
    const record = this.records.get(use.spenderId);
    if (!record) return "unknown";
    if (use.byOperator && use.purpose !== "close") throw new Error("the operator path approves only a close");
    if (use.purpose === "close" && record.status === "closed") return "closed";
    if (!use.byOperator) {
      if (this.control.paused) return "paused";
      if (use.purpose !== "close" && record.status !== "open") return "not_open";
      const since = new Date(Date.parse(use.at) - 10 * 60 * 1000).toISOString();
      // Calls and approvals are counted apart, each against the limits passed with it.
      const isCall = use.purpose === "call";
      const counted = this.uses.filter((u) => !u.byOperator && u.at >= since && (u.purpose === "call") === isCall).map((u) => ({ u, r: this.records.get(u.spenderId) }));
      if (counted.filter(({ u }) => u.spenderId === use.spenderId).length >= limits.perBudget) return "overuse";
      if (counted.filter(({ r }) => r?.payer === record.payer && r?.network === record.network).length >= limits.perPayer) return "payer_overuse";
      if (counted.filter(({ r }) => r?.network === record.network).length >= limits.global) {
        // Calls and approvals each have their own alert marker, so one ceiling never silences the other.
        const marker = isCall ? "callCeilingAlertedAt" : "ceilingAlertedAt";
        const alerted = this.control[marker];
        if (!alerted || alerted < since) {
          this.control = { ...this.control, [marker]: use.at };
          return "global_overuse_new";
        }
        return "global_overuse";
      }
    }
    this.uses.push({ ...use });
    return "ok";
  }
  async watchedAt() {
    return this.control.watchedAt;
  }
  async markWatched(at: string) {
    this.control = { ...this.control, watchedAt: at };
    return true;
  }
  async logAlert(alert: BudgetAlertRow) {
    if (this.failLogs) return false;
    this.alerts.push(structuredClone(alert));
    return true;
  }
  async paused() {
    return { paused: this.control.paused, ...(this.control.reason ? { reason: this.control.reason } : {}) };
  }
  async setPaused(paused: boolean, reason: string) {
    this.control = { ...this.control, paused, reason };
    return true;
  }
  async queueOperatorAlert(alert: PendingOperatorAlert) {
    if (this.failLogs) return false;
    // One of each: the same alert queued again (the watcher repeats some every pass) is not kept twice.
    if (this.operatorPending.some((a) => a.kind === alert.kind && a.subject === alert.subject && (a.spenderId ?? "") === (alert.spenderId ?? ""))) return true;
    this.operatorPending = [...this.operatorPending, structuredClone(alert)].slice(-50);
    return true;
  }
  async takeOperatorAlerts() {
    const taken = this.operatorPending;
    this.operatorPending = [];
    return taken;
  }
}

import { supabaseOrigin } from "@/lib/supabase/config";

type StoreResponse = { ok: boolean; status: number; json(): Promise<unknown> };
type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<StoreResponse>;

const HEX32 = /^[0-9a-f]{32}$/;
const PAGE = 500;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type Row = { id: string; spender: string; spender_key: string; payer: string; budget: string | null; network: BudgetNetwork; status: SpenderStatus; record: SpenderRecord; version: number };

function fromRow(row: Row): SpenderRecord {
  return { ...row.record, id: row.id, spender: row.spender, spenderKey: row.spender_key, payer: row.payer, network: row.network, status: row.status, version: row.version, ...(row.budget ? { budget: row.budget } : {}) };
}

function toRow(record: SpenderRecord) {
  return {
    id: record.id,
    spender: record.spender,
    spender_key: record.spenderKey,
    payer: record.payer,
    budget: record.budget ?? null,
    network: record.network,
    status: record.status,
    record,
    version: record.version,
    updated_at: new Date().toISOString(),
  };
}

/** The custody tables through Supabase's REST API with the service key. */
export class SupabaseBudgetCustodyStore implements BudgetCustodyStore {
  constructor(private readonly config: { url: string; serviceKey: string; fetchImpl?: FetchLike }) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { apikey: this.config.serviceKey, authorization: `Bearer ${this.config.serviceKey}`, "content-type": "application/json", ...extra };
  }
  private fetch(path: string, init: { method: string; headers: Record<string, string>; body?: string }) {
    return (this.config.fetchImpl ?? (fetch as unknown as FetchLike))(`${this.config.url}/rest/v1/${path}`, init);
  }
  private async insert(table: string, body: unknown): Promise<boolean> {
    try {
      const response = await this.fetch(table, { method: "POST", headers: this.headers({ prefer: "return=minimal" }), body: JSON.stringify(body) });
      return response.ok;
    } catch {
      return false;
    }
  }
  private async rows(filter: string): Promise<SpenderRecord[]> {
    const response = await this.fetch(`budget_spenders?${filter}&select=id,spender,spender_key,payer,budget,network,status,record,version`, { method: "GET", headers: this.headers() });
    if (!response.ok) throw new Error(`budget custody store: ${response.status}`);
    return ((await response.json()) as Row[]).map(fromRow);
  }

  async create(record: SpenderRecord) {
    try {
      const response = await this.fetch("budget_spenders", { method: "POST", headers: this.headers({ prefer: "return=minimal" }), body: JSON.stringify(toRow(record)) });
      if (response.ok) return { ok: true as const };
      // 409: the unique `budget` column already names this Budget.
      return { ok: false as const, code: response.status === 409 ? ("budget_taken" as const) : ("store_unavailable" as const) };
    } catch {
      return { ok: false as const, code: "store_unavailable" as const };
    }
  }
  async byId(id: string) {
    return HEX32.test(id) ? (await this.rows(`id=eq.${id}&limit=1`))[0] : undefined;
  }
  async byBudget(budget: string) {
    return BASE58.test(budget) ? (await this.rows(`budget=eq.${budget}&limit=1`))[0] : undefined;
  }
  async withStatus(statuses: SpenderStatus[]) {
    const all: SpenderRecord[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await this.rows(`status=in.(${statuses.join(",")})&order=created_at.asc,id.asc&limit=${PAGE}&offset=${offset}`);
      all.push(...page);
      if (page.length < PAGE) return all;
    }
  }
  async update(next: SpenderRecord): Promise<Write<SpenderRecord>> {
    if (!HEX32.test(next.id)) return { ok: false, code: "conflict" };
    try {
      const response = await this.fetch(`budget_spenders?id=eq.${next.id}&version=eq.${next.version - 1}`, {
        method: "PATCH",
        headers: this.headers({ prefer: "return=representation" }),
        body: JSON.stringify(toRow(next)),
      });
      if (!response.ok) return { ok: false, code: "store_unavailable" };
      const rows = (await response.json()) as Row[];
      return rows.length === 1 ? { ok: true, value: next } : { ok: false, code: "conflict" };
    } catch {
      return { ok: false, code: "store_unavailable" };
    }
  }
  async logUse(use: SpenderUse) {
    return this.insert("budget_spender_uses", { spender_id: use.spenderId, purpose: use.purpose, payee: use.payee ?? null, message_sha256: use.messageSha256, detail: use.detail ?? {}, by_operator: use.byOperator === true, at: use.at });
  }
  async usesSince(spenderId: string, since: string) {
    if (!HEX32.test(spenderId)) return 0;
    // Counted by reading at most 1,000 ids: far above any limit the relay sets.
    const response = await this.fetch(`budget_spender_uses?spender_id=eq.${spenderId}&at=gte.${encodeURIComponent(since)}&select=id&limit=1000`, { method: "GET", headers: this.headers() });
    if (!response.ok) throw new Error(`budget custody store: ${response.status}`);
    return ((await response.json()) as unknown[]).length;
  }
  async claimUse(use: SpenderUse, limits: UseLimits): Promise<ClaimResult> {
    if (!HEX32.test(use.spenderId)) return "unknown";
    try {
      const response = await this.fetch("rpc/budget_spender_use", {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          p_spender_id: use.spenderId,
          p_purpose: use.purpose,
          p_payee: use.payee ?? null,
          p_message_sha256: use.messageSha256,
          p_detail: use.detail ?? {},
          p_by_operator: use.byOperator === true,
          p_max_uses: limits.perBudget,
          p_max_payer: limits.perPayer,
          p_max_global: limits.global,
        }),
      });
      if (!response.ok) return "store_unavailable";
      const answer = await response.json();
      return (["ok", "unknown", "closed", "paused", "not_open", "overuse", "payer_overuse", "global_overuse", "global_overuse_new"] as const).find((v) => v === answer) ?? "store_unavailable";
    } catch {
      return "store_unavailable";
    }
  }
  async watchedAt() {
    const response = await this.fetch("budget_controls?id=eq.1&select=watched_at", { method: "GET", headers: this.headers() });
    if (!response.ok) throw new Error(`budget custody store: ${response.status}`);
    return ((await response.json()) as { watched_at: string | null }[])[0]?.watched_at ?? undefined;
  }
  async markWatched(at: string) {
    try {
      const response = await this.fetch("budget_controls?id=eq.1", { method: "PATCH", headers: this.headers({ prefer: "return=minimal" }), body: JSON.stringify({ watched_at: at }) });
      return response.ok;
    } catch {
      return false;
    }
  }
  async logAlert(alert: BudgetAlertRow) {
    return this.insert("budget_alerts", { spender_id: alert.spenderId ?? null, audience: alert.audience, kind: alert.kind, detail: alert.detail, delivered: alert.delivered, at: alert.at });
  }
  async paused() {
    const response = await this.fetch("budget_controls?id=eq.1&select=paused,reason", { method: "GET", headers: this.headers() });
    if (!response.ok) throw new Error(`budget custody store: ${response.status}`);
    const row = ((await response.json()) as { paused: boolean; reason: string | null }[])[0];
    // No row means the table is missing or emptied: treat that as paused.
    if (!row) return { paused: true, reason: "budget_controls has no row" };
    return { paused: row.paused, ...(row.reason ? { reason: row.reason } : {}) };
  }
  async setPaused(paused: boolean, reason: string) {
    try {
      const response = await this.fetch("budget_controls?id=eq.1", { method: "PATCH", headers: this.headers({ prefer: "return=minimal" }), body: JSON.stringify({ paused, reason, at: new Date().toISOString() }) });
      return response.ok;
    } catch {
      return false;
    }
  }
  async queueOperatorAlert(alert: PendingOperatorAlert) {
    try {
      const response = await this.fetch("rpc/budget_operator_alert_queue", { method: "POST", headers: this.headers(), body: JSON.stringify({ p_alert: alert }) });
      return response.ok && (await response.json()) === true;
    } catch {
      return false;
    }
  }
  async takeOperatorAlerts() {
    const response = await this.fetch("rpc/budget_operator_alert_take", { method: "POST", headers: this.headers(), body: "{}" });
    if (!response.ok) throw new Error(`budget custody store: ${response.status}`);
    const taken = await response.json();
    return Array.isArray(taken) ? (taken as PendingOperatorAlert[]) : [];
  }
}

let configured: BudgetCustodyStore | undefined;

/** The server's store: Supabase when its URL and service key are set, otherwise undefined (Budget relay routes refuse). */
export function budgetCustodyStore(env: Record<string, string | undefined> = process.env): BudgetCustodyStore | undefined {
  if (configured) return configured;
  const url = supabaseOrigin(env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) return undefined;
  configured = new SupabaseBudgetCustodyStore({ url, serviceKey });
  return configured;
}
