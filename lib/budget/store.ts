/**
 * Server only. Where the relay keeps what it holds for pooled Budgets
 * (audit round 4, R4-M3): one record per Budget it holds a spender key for,
 * the log of every use of that key, the alerts it sent, and the pause switch.
 * Tables: `supabase/migrations/20261125090000_budget_custody.sql`.
 *
 * The spender key itself is only ever here sealed (see `./keys`), and the
 * sealed copy is erased when the Budget is closed.
 */

export type BudgetNetwork = "solana-devnet" | "solana-mainnet-beta";

/**
 * pending: the key exists, the payer has not opened the Budget yet.
 * open: the Budget is open on chain; the key may sign.
 * frozen: something looked wrong; the key signs nothing but the close.
 * closing: the relay closed it (or asked to); the key signs nothing but the close.
 * closed: the Budget is closed on chain and every slice is settled; the key is erased.
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
};

export type SpenderRecord = {
  /** Random id, 32 hex characters. */
  id: string;
  /** The spender's public key (base58). */
  spender: string;
  /** The wallet that opens (and owns) the Budget. */
  payer: string;
  network: BudgetNetwork;
  status: SpenderStatus;
  /** Once opened: the Budget's address and its `created_slot`, as a decimal string. */
  budget?: string;
  createdSlot?: string;
  /** The Budget's mint, absent for SOL. */
  mint?: string;
  /** The sealed secret key (`./keys`); absent once closed. */
  sealed?: string;
  contact: BudgetContact;
  /**
   * Providers (base58 wallets) the payer expects this Budget to pay. When not
   * empty the relay signs no reserve for anyone else, and the watcher tells
   * the operator about a slice for anyone else.
   */
  expectedPayees: string[];
  /** The watcher's last view of the Budget's slices, by reservation address. */
  seen: Record<string, SeenSlice>;
  /** Why it was frozen, when it was. */
  frozenReason?: string;
  version: number;
  createdAt: string;
};

export type SpenderUse = { spenderId: string; purpose: "reserve" | "waive" | "close"; payee?: string; messageSha256: string; at: string };

export type BudgetAlertRow = {
  spenderId?: string;
  audience: "payer" | "operator";
  kind: string;
  detail: Record<string, unknown>;
  delivered: Record<string, string>;
  at: string;
};

export type Write<T> = { ok: true; value: T } | { ok: false; code: "conflict" | "store_unavailable" };

export interface BudgetCustodyStore {
  create(record: SpenderRecord): Promise<{ ok: true } | { ok: false; code: "store_unavailable" }>;
  byId(id: string): Promise<SpenderRecord | undefined>;
  byBudget(budget: string): Promise<SpenderRecord | undefined>;
  /** Records in these statuses, oldest first. */
  withStatus(statuses: SpenderStatus[]): Promise<SpenderRecord[]>;
  /** Writes `next` only if the stored record is still at `next.version - 1`. */
  update(next: SpenderRecord): Promise<Write<SpenderRecord>>;
  /** Appends to the use log. A use that is not logged must not be signed. */
  logUse(use: SpenderUse): Promise<boolean>;
  /** How many uses of this key were logged at or after `since` (ISO time). */
  usesSince(spenderId: string, since: string): Promise<number>;
  logAlert(alert: BudgetAlertRow): Promise<boolean>;
  paused(): Promise<{ paused: boolean; reason?: string }>;
  setPaused(paused: boolean, reason: string): Promise<boolean>;
}

/** For tests and local runs. One process only. */
export class MemoryBudgetCustodyStore implements BudgetCustodyStore {
  readonly records = new Map<string, SpenderRecord>();
  readonly uses: SpenderUse[] = [];
  readonly alerts: BudgetAlertRow[] = [];
  control: { paused: boolean; reason?: string } = { paused: false };
  /** Tests set this to make the log refuse writes. */
  failLogs = false;

  async create(record: SpenderRecord) {
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
    if ((next.status === "closed") !== (next.sealed === undefined)) throw new Error("a closed record holds no key, and only a closed one");
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
  async logAlert(alert: BudgetAlertRow) {
    if (this.failLogs) return false;
    this.alerts.push(structuredClone(alert));
    return true;
  }
  async paused() {
    return { ...this.control };
  }
  async setPaused(paused: boolean, reason: string) {
    this.control = { paused, reason };
    return true;
  }
}

import { supabaseOrigin } from "@/lib/supabase/config";

type StoreResponse = { ok: boolean; status: number; json(): Promise<unknown> };
type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<StoreResponse>;

const HEX32 = /^[0-9a-f]{32}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type Row = { id: string; spender: string; payer: string; budget: string | null; network: BudgetNetwork; status: SpenderStatus; sealed: string | null; key_id: string | null; record: Omit<SpenderRecord, "sealed">; version: number };

function fromRow(row: Row): SpenderRecord {
  const { sealed: _ignored, ...record } = row.record as SpenderRecord;
  void _ignored;
  return { ...record, id: row.id, spender: row.spender, payer: row.payer, network: row.network, status: row.status, version: row.version, ...(row.budget ? { budget: row.budget } : {}), ...(row.sealed ? { sealed: row.sealed } : {}) };
}

function toRow(record: SpenderRecord) {
  const { sealed, ...rest } = record;
  return {
    id: record.id,
    spender: record.spender,
    payer: record.payer,
    budget: record.budget ?? null,
    network: record.network,
    status: record.status,
    sealed: sealed ?? null,
    key_id: sealed ? sealed.split(".")[1] : null,
    record: rest,
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
    const response = await this.fetch(`budget_spenders?${filter}&select=id,spender,payer,budget,network,status,sealed,key_id,record,version`, { method: "GET", headers: this.headers() });
    if (!response.ok) throw new Error(`budget custody store: ${response.status}`);
    return ((await response.json()) as Row[]).map(fromRow);
  }

  async create(record: SpenderRecord) {
    return (await this.insert("budget_spenders", toRow(record))) ? { ok: true as const } : { ok: false as const, code: "store_unavailable" as const };
  }
  async byId(id: string) {
    return HEX32.test(id) ? (await this.rows(`id=eq.${id}&limit=1`))[0] : undefined;
  }
  async byBudget(budget: string) {
    return BASE58.test(budget) ? (await this.rows(`budget=eq.${budget}&limit=1`))[0] : undefined;
  }
  async withStatus(statuses: SpenderStatus[]) {
    return this.rows(`status=in.(${statuses.join(",")})&order=created_at.asc&limit=500`);
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
    return this.insert("budget_spender_uses", { spender_id: use.spenderId, purpose: use.purpose, payee: use.payee ?? null, message_sha256: use.messageSha256, at: use.at });
  }
  async usesSince(spenderId: string, since: string) {
    if (!HEX32.test(spenderId)) return 0;
    // Counted by reading at most 1,000 ids: far above any limit the relay sets.
    const response = await this.fetch(`budget_spender_uses?spender_id=eq.${spenderId}&at=gte.${encodeURIComponent(since)}&select=id&limit=1000`, { method: "GET", headers: this.headers() });
    if (!response.ok) throw new Error(`budget custody store: ${response.status}`);
    return ((await response.json()) as unknown[]).length;
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
