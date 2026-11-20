import "server-only";

/**
 * Per-provider counts in `provider_stats` (#740).
 *
 * The counts are recounted from the `jobs` and `attestations` tables each time
 * and written as a whole row, never incremented. Two calls finishing together
 * can therefore not lose an update: whichever writes last has counted at least
 * as many rows. Only the server writes this table.
 *
 * These are counts of recorded jobs, not a quality score. A provider who pays
 * their own listing adds to their own count, at the cost of the payment's fee.
 */

import { supabaseOrigin } from "@/lib/supabase/config";

export interface ProviderStats {
  jobsDelivered: number;
  jobsFailed: number;
  attestationsPass: number;
  attestationsFail: number;
}

export type ProviderStatsOutcome =
  | { updated: true; stats: ProviderStats }
  | { updated: false; reason: "invalid_provider" | "store_unavailable" | "count_unreadable" };

type StatsResponse = { ok: boolean; status: number; headers: { get(name: string): string | null } };
type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<StatsResponse>;

export interface ProviderStatsDeps {
  url?: string;
  serviceKey?: string;
  fetchImpl?: FetchLike;
}

const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** PostgREST reports an exact count as the total in Content-Range: "0-0/42", or "*\/0" when there are no rows. */
const CONTENT_RANGE_TOTAL = /^(?:\d+-\d+|\*)\/(\d{1,15})$/;

export function totalFromContentRange(value: string | null): number | undefined {
  const match = value ? CONTENT_RANGE_TOTAL.exec(value.trim()) : null;
  return match ? Number(match[1]) : undefined;
}

/** Recounts one provider's jobs and attestations and writes the row. */
export async function refreshProviderStats(providerWallet: string, deps: ProviderStatsDeps = {}): Promise<ProviderStatsOutcome> {
  if (!WALLET.test(providerWallet)) return { updated: false, reason: "invalid_provider" };
  const origin = supabaseOrigin(deps.url ?? process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceKey = (deps.serviceKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!origin || !serviceKey) return { updated: false, reason: "store_unavailable" };
  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as FetchLike);
  const auth = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };

  const count = async (table: "jobs" | "attestations", column: "status" | "outcome", value: string): Promise<number | "unavailable" | "unreadable"> => {
    const response = await fetchImpl(`${origin}/rest/v1/${table}?select=id&provider_wallet=eq.${providerWallet}&${column}=eq.${value}`, {
      method: "HEAD",
      headers: { ...auth, prefer: "count=exact" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return "unavailable";
    return totalFromContentRange(response.headers.get("content-range")) ?? "unreadable";
  };

  try {
    const counts = await Promise.all([
      count("jobs", "status", "delivered"),
      count("jobs", "status", "failed"),
      count("attestations", "outcome", "pass"),
      count("attestations", "outcome", "fail"),
    ]);
    // A partial row would publish a wrong number, so one unreadable count stops the write.
    if (counts.includes("unavailable")) return { updated: false, reason: "store_unavailable" };
    if (counts.includes("unreadable")) return { updated: false, reason: "count_unreadable" };
    const [jobsDelivered, jobsFailed, attestationsPass, attestationsFail] = counts as number[];
    const stats: ProviderStats = { jobsDelivered, jobsFailed, attestationsPass, attestationsFail };

    const written = await fetchImpl(`${origin}/rest/v1/provider_stats?on_conflict=provider_wallet`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json", prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        provider_wallet: providerWallet,
        jobs_delivered: jobsDelivered,
        jobs_failed: jobsFailed,
        attestations_pass: attestationsPass,
        attestations_fail: attestationsFail,
      }),
      signal: AbortSignal.timeout(5000),
    });
    return written.ok ? { updated: true, stats } : { updated: false, reason: "store_unavailable" };
  } catch {
    return { updated: false, reason: "store_unavailable" };
  }
}
