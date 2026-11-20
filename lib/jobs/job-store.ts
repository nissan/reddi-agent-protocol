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
}

export type JobRefusal = { ok: false; code: "already_recorded" | "invalid_job" | "store_unavailable" };

type StoreResponse = { ok: boolean; status: number; json(): Promise<unknown> };
type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<StoreResponse>;

export interface JobStoreDeps {
  url?: string;
  serviceKey?: string;
  publicConfig?: SupabasePublicConfig;
  fetchImpl?: FetchLike;
}

const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const HASH = /^[0-9a-f]{64}$/;
const POSITIVE_UNITS = /^[1-9][0-9]{0,17}$/;
const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    (job.status === "delivered" || job.status === "failed")
  );
}

/** Writes one verified job. A second write for the same transaction is refused by the database and reported as such. */
export async function recordVerifiedJob(job: VerifiedJob, deps: JobStoreDeps = {}): Promise<{ ok: true; id: string } | JobRefusal> {
  if (!validJob(job)) return { ok: false, code: "invalid_job" };
  const origin = supabaseOrigin(deps.url ?? process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceKey = (deps.serviceKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!origin || !serviceKey) return { ok: false, code: "store_unavailable" };
  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as FetchLike);
  try {
    const response = await fetchImpl(`${origin}/rest/v1/jobs?select=id`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: serviceKey, authorization: `Bearer ${serviceKey}`, prefer: "return=representation" },
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
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 409) return { ok: false, code: "already_recorded" };
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
      `${config.url}/rest/v1/jobs?select=id,provider_wallet,network,declared_model,amount_base_units,mint,tx_signature,status,created_at&order=created_at.desc&limit=100`,
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
      });
    }
    return { ok: true, jobs };
  } catch {
    return { ok: false, code: "store_unavailable" };
  }
}
