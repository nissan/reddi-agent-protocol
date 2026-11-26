/**
 * Postgres versions of everything a provider remembers, for a host that runs
 * several instances at once (a serverless deployment). Every instance of one
 * provider passes the same `provider` id and the same database, so:
 *
 * - a lock pays for one call across all of them (the replay table);
 * - only one request at a time settles, looks at or collects a lock (leases);
 * - an answer held for its settle can be collected from any instance;
 * - a settle sent but not yet known to land is found by the sweep on any one;
 * - the model's limits count calls on all of them together.
 *
 * Tables are in the `provider_kit` schema (supabase/migrations). The kit does
 * not depend on a driver: pass a `pg` Pool, or anything with the same
 * `query` and `connect` shape. Every failure throws, and the handler treats a
 * store it cannot use as "nothing accepted" (fail closed).
 */
import { PostgresBudgetSliceStore } from "./budgets.js";
import { randomUUID } from "node:crypto";
import type { NonceReplayStore } from "@redditech/x402-solana";
import type { CapacityState, CapacityStore } from "./capacity.js";
import type { PendingCallSettle, PendingSettleStore } from "./pending.js";
import { decodeState, encodeState, type HeldAnswerStore, type HeldCall, type LockLease } from "./state.js";

export interface PgQueryResult {
  rows: Record<string, unknown>[];
  rowCount?: number | null;
}

export interface PgQueryable {
  query(text: string, values?: unknown[]): Promise<PgQueryResult>;
}

/** A client taken from the pool for one transaction. */
export interface PgClient extends PgQueryable {
  release(): void;
}

/** A `pg` Pool, or anything with the same shape. */
export interface PgPool extends PgQueryable {
  connect(): Promise<PgClient>;
}

const PROVIDER_ID = /^[\x21-\x7e]{1,100}$/;
const KEY = /^[\x21-\x7e]{1,200}$/;

function checkProvider(provider: string): string {
  if (!PROVIDER_ID.test(provider)) throw new Error("provider id must be 1-100 printable characters without spaces");
  return provider;
}

async function inTransaction<T>(pool: PgPool, work: (client: PgClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    try {
      const result = await work(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
  } finally {
    client.release();
  }
}

const isUniqueViolation = (error: unknown) => (error as { code?: unknown } | null)?.code === "23505";

/** One lock, one call, across every instance of the provider. */
export class PostgresReplayStore implements NonceReplayStore {
  private readonly provider: string;
  constructor(private readonly pool: PgPool, provider: string) {
    this.provider = checkProvider(provider);
  }

  async checkAndStore(key: string): Promise<boolean> {
    if (!KEY.test(key)) throw new Error("replay key must be 1-200 printable characters without spaces");
    const result = await this.pool.query("insert into provider_kit.replay (provider, key) values ($1, $2) on conflict do nothing returning key", [this.provider, key]);
    return result.rows.length === 1;
  }

  async checkAndStoreAll(keys: string[]): Promise<boolean> {
    if (keys.length === 0 || new Set(keys).size !== keys.length || !keys.every((key) => KEY.test(key))) throw new Error("replay keys must be distinct printable strings");
    // Every key or none: a key already there rolls the whole insert back.
    try {
      await inTransaction(this.pool, (client) => client.query("insert into provider_kit.replay (provider, key) select $1, unnest($2::text[])", [this.provider, keys]));
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }
}

/**
 * A lease per lock. A lease is the holder's until it expires or the holder
 * releases it; a release only ever ends the claim whose token it carries.
 */
export class PostgresLockLease implements LockLease {
  private readonly provider: string;
  constructor(private readonly pool: PgPool, provider: string) {
    this.provider = checkProvider(provider);
  }

  async claim(escrow: string, ttlMs: number, nowMs: number): Promise<string | false> {
    const token = randomUUID();
    const result = await this.pool.query(
      `insert into provider_kit.leases (provider, escrow, token, until_ms) values ($1, $2, $3, $4)
       on conflict (provider, escrow) do update set token = excluded.token, until_ms = excluded.until_ms
       where provider_kit.leases.until_ms <= $5
       returning token`,
      [this.provider, escrow, token, nowMs + ttlMs, nowMs],
    );
    return result.rows.length === 1 && result.rows[0]!.token === token ? token : false;
  }

  async release(escrow: string, token: string): Promise<void> {
    await this.pool.query("delete from provider_kit.leases where provider = $1 and escrow = $2 and token = $3", [this.provider, escrow, token]);
  }

  async held(escrow: string, nowMs: number): Promise<boolean> {
    const result = await this.pool.query("select 1 from provider_kit.leases where provider = $1 and escrow = $2 and until_ms > $3", [this.provider, escrow, nowMs]);
    return result.rows.length > 0;
  }
}

/** Answers waiting for their settle, collectable from any instance. */
export class PostgresHeldAnswerStore implements HeldAnswerStore {
  private readonly provider: string;
  constructor(private readonly pool: PgPool, provider: string) {
    this.provider = checkProvider(provider);
  }

  async hold(call: HeldCall): Promise<void> {
    await this.pool.query(
      `insert into provider_kit.held_answers (provider, escrow, call, created_ms) values ($1, $2, $3, $4)
       on conflict (provider, escrow) do update set call = excluded.call, created_ms = excluded.created_ms`,
      [this.provider, call.escrow, encodeState(call), call.createdMs],
    );
  }

  async get(escrow: string): Promise<HeldCall | undefined> {
    const result = await this.pool.query("select call from provider_kit.held_answers where provider = $1 and escrow = $2", [this.provider, escrow]);
    const text = result.rows[0]?.call;
    return typeof text === "string" ? decodeState<HeldCall>(text) : undefined;
  }

  async drop(escrow: string): Promise<void> {
    await this.pool.query("delete from provider_kit.held_answers where provider = $1 and escrow = $2", [this.provider, escrow]);
  }

  async expire(beforeMs: number): Promise<void> {
    await this.pool.query("delete from provider_kit.held_answers where provider = $1 and created_ms < $2", [this.provider, beforeMs]);
  }
}

/** Settles sent but not yet known to land. The last record for an escrow wins. */
export class PostgresPendingSettleStore implements PendingSettleStore {
  private readonly provider: string;
  constructor(private readonly pool: PgPool, provider: string) {
    this.provider = checkProvider(provider);
  }

  /** The records still `pending`: the only ones the handler acts on. */
  async load(): Promise<PendingCallSettle[]> {
    const result = await this.pool.query("select record from provider_kit.pending_settles where provider = $1 and status = 'pending' order by updated_at", [this.provider]);
    return result.rows.map((row) => decodeState<PendingCallSettle>(String(row.record)));
  }

  async save(record: PendingCallSettle): Promise<void> {
    await this.pool.query(
      `insert into provider_kit.pending_settles (provider, escrow, status, record, updated_at) values ($1, $2, $3, $4, now())
       on conflict (provider, escrow) do update set status = excluded.status, record = excluded.record, updated_at = now()`,
      [this.provider, record.escrow, record.status, encodeState(record)],
    );
  }

  async findPending(escrow: string): Promise<PendingCallSettle | undefined> {
    const result = await this.pool.query("select record from provider_kit.pending_settles where provider = $1 and escrow = $2 and status = 'pending'", [this.provider, escrow]);
    const text = result.rows[0]?.record;
    return typeof text === "string" ? decodeState<PendingCallSettle>(text) : undefined;
  }
}

/** The model's limits, counted across every instance. One row per provider, updated under a row lock. */
export class PostgresCapacityStore implements CapacityStore {
  private readonly provider: string;
  constructor(private readonly pool: PgPool, provider: string) {
    this.provider = checkProvider(provider);
  }

  async update<T>(update: (state: CapacityState) => { state: CapacityState; result: T }): Promise<T> {
    return inTransaction(this.pool, async (client) => {
      const empty: CapacityState = { recent: [], day: "", today: 0, coolingUntil: 0 };
      await client.query("insert into provider_kit.capacity (provider, state) values ($1, $2) on conflict do nothing", [this.provider, JSON.stringify(empty)]);
      const read = await client.query("select state from provider_kit.capacity where provider = $1 for update", [this.provider]);
      const raw = read.rows[0]?.state;
      const current = (typeof raw === "string" ? JSON.parse(raw) : raw) as CapacityState;
      const { state, result } = update(current);
      await client.query("update provider_kit.capacity set state = $2 where provider = $1", [this.provider, JSON.stringify(state)]);
      return result;
    });
  }
}

/** All the stores for one provider on one database. */
export function postgresProviderStores(pool: PgPool, provider: string) {
  return {
    replayStore: new PostgresReplayStore(pool, provider),
    lease: new PostgresLockLease(pool, provider),
    heldAnswers: new PostgresHeldAnswerStore(pool, provider),
    pendingSettles: new PostgresPendingSettleStore(pool, provider),
    capacityStore: new PostgresCapacityStore(pool, provider),
    budgetSlices: new PostgresBudgetSliceStore(pool, checkProvider(provider)),
  };
}
