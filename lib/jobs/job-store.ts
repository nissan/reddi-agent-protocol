import "server-only";

/**
 * Job records in the database (#740). A job row says a call was paid for, so
 * only the server writes one, and only after it has checked the payment on
 * chain itself (see `paid-call.ts`). One transaction is one job: the database
 * refuses a second row for the same network and signature.
 */

import { supabaseOrigin, supabasePublicConfig, type SupabasePublicConfig } from "@/lib/supabase/config";
import type { ListingNetwork } from "@/lib/listings/listing-store";

export interface VerifiedJob {
  buyerWallet: string;
  /** Set only when the signed-in wallet is the wallet that paid. */
  buyerUserId?: string;
  providerWallet: string;
  network: ListingNetwork;
  declaredModel: string;
  requestHash: string;
  responseHash?: string;
  /** Whole base units, as a decimal string. */
  amountBaseUnits: string;
  /** A mint address, or "SOL". */
  mint: string;
  txSignature: string;
  status: "delivered" | "failed";
  /** Set for a slice paid from a pooled Budget (#1145): the Budget's address and opening. */
  budget?: { address: string; createdSlot: string };
}

export interface JobSummary {
  id: string;
  providerWallet: string;
  network: string;
  declaredModel: string;
  amountBaseUnits: string;
  mint: string;
  txSignature: string;
  status: string;
  createdAt: string;
  /** The Budget that paid this job, if one did. */
  budget?: string;
}

export type JobRefusal = { ok: false; code: "already_recorded" | "provider_not_listed" | "invalid_job" | "store_unavailable" };

type StoreResponse = { ok: boolean; status: number; json(): Promise<unknown> };
type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<StoreResponse>;

export interface JobStoreDeps {
  url?: string;
  serviceKey?: string;
  /**
   * The mainnet app's database role token (`BUDGET_CUSTODY_ROLE_TOKEN`, role
   * `budget_mainnet_app`), sent with the anon key in place of the service role
   * key, which the mainnet app does not hold. The role may only record and look
   * up mainnet Budget jobs (migration 20261127110000).
   */
  roleToken?: string;
  anonKey?: string;
  publicConfig?: SupabasePublicConfig;
  fetchImpl?: FetchLike;
}

const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const HASH = /^[0-9a-f]{64}$/;
const POSITIVE_UNITS = /^[1-9][0-9]{0,17}$/;
const SLOT = /^[1-9][0-9]{0,18}$/;
const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where and as whom the server writes jobs: a role token with the anon key when given, else the service role key. */
function serverAuth(deps: JobStoreDeps): { origin: string; headers: Record<string, string> } | undefined {
  const origin = supabaseOrigin(deps.url ?? process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (!origin) return undefined;
  const roleToken = deps.roleToken?.trim();
  if (roleToken) {
    const anonKey = deps.anonKey?.trim();
    return anonKey ? { origin, headers: { apikey: anonKey, authorization: `Bearer ${roleToken}` } } : undefined;
  }
  const serviceKey = (deps.serviceKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  return serviceKey ? { origin, headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } } : undefined;
}

function validJob(job: VerifiedJob): boolean {
  return (
    WALLET.test(job.buyerWallet) &&
    WALLET.test(job.providerWallet) &&
    (job.buyerUserId === undefined || USER_ID.test(job.buyerUserId)) &&
    (job.network === "solana-devnet" || job.network === "solana-mainnet") &&
    job.declaredModel.length > 0 && job.declaredModel.length <= 120 &&
    HASH.test(job.requestHash) &&
    (job.responseHash === undefined || HASH.test(job.responseHash)) &&
    POSITIVE_UNITS.test(job.amountBaseUnits) &&
    (job.mint === "SOL" || WALLET.test(job.mint)) &&
    SIGNATURE.test(job.txSignature) &&
    (job.status === "delivered" || job.status === "failed") &&
    (job.budget === undefined || (WALLET.test(job.budget.address) && SLOT.test(job.budget.createdSlot)))
  );
}

/** Writes one verified job. A second write for the same transaction is refused by the database and reported as such. */
export async function recordVerifiedJob(job: VerifiedJob, deps: JobStoreDeps = {}): Promise<{ ok: true; id: string } | JobRefusal> {
  if (!validJob(job)) return { ok: false, code: "invalid_job" };
  const auth = serverAuth(deps);
  if (!auth) return { ok: false, code: "store_unavailable" };
  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as FetchLike);
  try {
    const response = await fetchImpl(`${auth.origin}/rest/v1/jobs?select=id`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth.headers, prefer: "return=representation" },
      body: JSON.stringify({
        buyer_wallet: job.buyerWallet,
        buyer_user_id: job.buyerUserId ?? null,
        provider_wallet: job.providerWallet,
        network: job.network,
        declared_model: job.declaredModel,
        request_hash: job.requestHash,
        response_hash: job.responseHash ?? null,
        amount_base_units: job.amountBaseUnits,
        mint: job.mint,
        tx_signature: job.txSignature,
        status: job.status,
        completed_at: new Date().toISOString(),
        ...(job.budget ? { budget: job.budget.address, budget_created_slot: job.budget.createdSlot } : {}),
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 409) {
      // PostgREST answers 409 for a unique violation (the transaction is recorded) and for a foreign
      // key violation (the provider has no listing). Tell them apart by the Postgres code.
      const body = (await response.json().catch(() => null)) as { code?: unknown } | null;
      return { ok: false, code: body?.code === "23503" ? "provider_not_listed" : "already_recorded" };
    }
    if (!response.ok) return { ok: false, code: "store_unavailable" };
    const rows = await response.json();
    const id = Array.isArray(rows) ? (rows[0] as { id?: unknown } | undefined)?.id : undefined;
    return typeof id === "string" ? { ok: true, id } : { ok: false, code: "store_unavailable" };
  } catch {
    return { ok: false, code: "store_unavailable" };
  }
}

/**
 * The signed-in user's own jobs, as buyer or as the provider's owner. Read with
 * the user's own session, so the database's access rules pick the rows.
 */
export async function readOwnJobs(accessToken: string, deps: JobStoreDeps = {}): Promise<{ ok: true; jobs: JobSummary[] } | JobRefusal> {
  const config = deps.publicConfig ?? supabasePublicConfig();
  if (!config) return { ok: false, code: "store_unavailable" };
  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as FetchLike);
  try {
    const response = await fetchImpl(
      `${config.url}/rest/v1/jobs?select=id,provider_wallet,network,declared_model,amount_base_units,mint,tx_signature,status,created_at,budget&order=created_at.desc&limit=100`,
      { method: "GET", headers: { apikey: config.anonKey, authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(5000) },
    );
    if (!response.ok) return { ok: false, code: "store_unavailable" };
    const rows = await response.json();
    if (!Array.isArray(rows)) return { ok: false, code: "store_unavailable" };
    const jobs: JobSummary[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      if (typeof r.id !== "string" || typeof r.tx_signature !== "string") continue;
      jobs.push({
        id: r.id,
        providerWallet: String(r.provider_wallet ?? ""),
        network: String(r.network ?? ""),
        declaredModel: String(r.declared_model ?? ""),
        amountBaseUnits: String(r.amount_base_units ?? ""),
        mint: String(r.mint ?? ""),
        txSignature: r.tx_signature,
        status: String(r.status ?? ""),
        createdAt: String(r.created_at ?? ""),
        ...(typeof r.budget === "string" && WALLET.test(r.budget) ? { budget: r.budget } : {}),
      });
    }
    return { ok: true, jobs };
  } catch {
    return { ok: false, code: "store_unavailable" };
  }
}

/**
 * Which of these payment transactions already have a job on `network`. Server only, with the
 * service role (or, for mainnet Budget jobs, the mainnet app's role token). Throws when the store cannot be read, so a caller never takes "unreadable" for "none".
 */
export async function recordedSignatures(network: ListingNetwork, signatures: string[], deps: JobStoreDeps = {}): Promise<Set<string>> {
  const wanted = signatures.filter((s) => SIGNATURE.test(s));
  if (wanted.length === 0) return new Set();
  const auth = serverAuth(deps);
  if (!auth) throw new Error("job store not configured");
  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as FetchLike);
  const response = await fetchImpl(
    `${auth.origin}/rest/v1/jobs?select=tx_signature&network=eq.${network}&tx_signature=in.(${wanted.join(",")})`,
    { method: "GET", headers: auth.headers, signal: AbortSignal.timeout(5000) },
  );
  if (!response.ok) throw new Error(`job store answered ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error("job store answered an unexpected body");
  return new Set(rows.map((r) => (r as { tx_signature?: unknown }).tx_signature).filter((s): s is string => typeof s === "string"));
}
