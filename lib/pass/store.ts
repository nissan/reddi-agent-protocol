/**
 * Server only. Where agent passes live (#1048).
 *
 * A pass is a budget a person locked for their agent with one Solana Pay
 * signature: one metered session escrow per provider, each delegated to the
 * pass's relay key by a memo in the lock transaction. The pass row holds what
 * the relay needs between the agent's calls: the hash of the agent's key, the
 * locks, and each session's sequence and last receipt. It holds no key and no
 * funds.
 *
 * Every write is conditional on the version the writer read, so two calls
 * racing on one pass cannot both advance a session: the loser is told to retry.
 */

export type PassSession = {
  providerId: string;
  /** The escrow nonce (32 hex characters). */
  nonce: string;
  /** The most this provider's lock holds, in lamports, as a decimal string. */
  maxLamports: string;
  /** The escrow address, once the lock is found on chain. */
  escrow?: string;
  /** Calls served so far in this session. */
  sequence: number;
  /** The provider's signed receipt for the last call, header-encoded. */
  lastReceipt?: string;
  /** Lamports owed so far, as the last receipt states. */
  cumulativeLamports: string;
  /** Set once the session closed and the provider settled. */
  closed?: { settleSignature?: string; amountLamports: string; refundedLamports: string; /** The settle was sent but not seen confirmed. */ pending?: true };
};

export type AgentPass = {
  /** Random id, 32 hex characters. Names the relay key. */
  id: string;
  /** SHA-256 hex of the agent's API key. */
  keyHash: string;
  network: "solana-devnet";
  /** Base58 Solana Pay reference key, added read-only to the first lock. */
  reference: string;
  /** Whole seconds since the epoch: the delegations in the locks end here. */
  expiresAt: number;
  /** The most one call may cost, in lamports, as the person set it. Undefined: each provider's own maximum. */
  perCallMaxLamports?: string;
  status: "waiting" | "active" | "closed";
  /** The wallet that signed the locks, once found. */
  payer?: string;
  /** The lock transaction, once found. */
  lockSignature?: string;
  sessions: PassSession[];
  /** Bumped by every write. */
  version: number;
  createdAt: string;
};

export type PassWrite = { ok: true; pass: AgentPass } | { ok: false; code: "conflict" | "store_unavailable" };

export interface AgentPassStore {
  create(pass: AgentPass): Promise<{ ok: true } | { ok: false; code: "store_unavailable" }>;
  byId(id: string): Promise<AgentPass | undefined>;
  byKeyHash(keyHash: string): Promise<AgentPass | undefined>;
  /** Writes `next` only if the stored pass is still at `next.version - 1`. */
  update(next: AgentPass): Promise<PassWrite>;
}

/** For tests and local runs. One process only. */
export class MemoryAgentPassStore implements AgentPassStore {
  private readonly passes = new Map<string, AgentPass>();

  async create(pass: AgentPass) {
    this.passes.set(pass.id, structuredClone(pass));
    return { ok: true as const };
  }

  async byId(id: string) {
    const pass = this.passes.get(id);
    return pass ? structuredClone(pass) : undefined;
  }

  async byKeyHash(keyHash: string) {
    for (const pass of this.passes.values()) if (pass.keyHash === keyHash) return structuredClone(pass);
    return undefined;
  }

  async update(next: AgentPass): Promise<PassWrite> {
    const current = this.passes.get(next.id);
    if (!current || current.version !== next.version - 1) return { ok: false, code: "conflict" };
    this.passes.set(next.id, structuredClone(next));
    return { ok: true, pass: structuredClone(next) };
  }
}

import { supabaseOrigin } from "@/lib/supabase/config";

type StoreResponse = { ok: boolean; status: number; json(): Promise<unknown> };
type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<StoreResponse>;

const HEX32 = /^[0-9a-f]{32}$/;
const HEX64 = /^[0-9a-f]{64}$/;

type Row = { id: string; key_hash: string; version: number; pass: AgentPass };

/**
 * The pass table through Supabase's REST API with the service key
 * (`supabase/migrations/20261124120000_agent_passes.sql`). Only the server
 * reads or writes it; anon and signed-in roles have no grant.
 */
export class SupabaseAgentPassStore implements AgentPassStore {
  constructor(private readonly config: { url: string; serviceKey: string; fetchImpl?: FetchLike }) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { apikey: this.config.serviceKey, authorization: `Bearer ${this.config.serviceKey}`, "content-type": "application/json", ...extra };
  }

  private fetch(path: string, init: { method: string; headers: Record<string, string>; body?: string }) {
    return (this.config.fetchImpl ?? (fetch as unknown as FetchLike))(`${this.config.url}/rest/v1/${path}`, init);
  }

  async create(pass: AgentPass) {
    try {
      const response = await this.fetch("agent_passes", {
        method: "POST",
        headers: this.headers({ prefer: "return=minimal" }),
        body: JSON.stringify({ id: pass.id, key_hash: pass.keyHash, version: pass.version, expires_at: new Date(pass.expiresAt * 1000).toISOString(), pass }),
      });
      return response.ok ? { ok: true as const } : { ok: false as const, code: "store_unavailable" as const };
    } catch {
      return { ok: false as const, code: "store_unavailable" as const };
    }
  }

  private async one(filter: string): Promise<AgentPass | undefined> {
    const response = await this.fetch(`agent_passes?${filter}&select=id,key_hash,version,pass&limit=1`, { method: "GET", headers: this.headers() });
    if (!response.ok) throw new Error(`agent pass store: ${response.status}`);
    const rows = (await response.json()) as Row[];
    const row = rows[0];
    if (!row) return undefined;
    return { ...row.pass, id: row.id, keyHash: row.key_hash, version: row.version };
  }

  async byId(id: string) {
    return HEX32.test(id) ? this.one(`id=eq.${id}`) : undefined;
  }

  async byKeyHash(keyHash: string) {
    return HEX64.test(keyHash) ? this.one(`key_hash=eq.${keyHash}`) : undefined;
  }

  async update(next: AgentPass): Promise<PassWrite> {
    if (!HEX32.test(next.id)) return { ok: false, code: "conflict" };
    try {
      const response = await this.fetch(`agent_passes?id=eq.${next.id}&version=eq.${next.version - 1}`, {
        method: "PATCH",
        headers: this.headers({ prefer: "return=representation" }),
        body: JSON.stringify({ version: next.version, pass: next }),
      });
      if (!response.ok) return { ok: false, code: "store_unavailable" };
      const rows = (await response.json()) as Row[];
      return rows.length === 1 ? { ok: true, pass: next } : { ok: false, code: "conflict" };
    } catch {
      return { ok: false, code: "store_unavailable" };
    }
  }
}

let configured: AgentPassStore | undefined;

/** The server's store: Supabase when its URL and service key are set, otherwise undefined (the pass routes refuse). */
export function agentPassStore(env: Record<string, string | undefined> = process.env): AgentPassStore | undefined {
  if (configured) return configured;
  const url = supabaseOrigin(env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) return undefined;
  configured = new SupabaseAgentPassStore({ url, serviceKey });
  return configured;
}
