import "server-only";

/**
 * Server-observed health for database listings (#740). The server calls each
 * listed endpoint's `/healthz` and records what it saw. Owners cannot write
 * these fields, so a listing is only ever "pass" because the server reached it.
 */

import { resolveNetworkProfileName } from "@/lib/config/network";
import { supabasePublicConfig } from "@/lib/supabase/config";
import { listingNetworkForProfile, readPublicListings, recordListingHealth, type ListingStoreDeps } from "@/lib/listings/listing-store";

type ProbeFetch = (input: string, init: { method: string; redirect: "manual"; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

export type HealthSweep =
  | { source: "files" }
  | { source: "database"; available: boolean; checked: number; passed: number; failed: number; unrecorded: number };

const BATCH = 10;

/** True only for a direct 2xx answer. A redirect is not followed, so a listing cannot point the server somewhere else. */
export async function probeEndpoint(endpointUrl: string, probe: ProbeFetch = fetch as unknown as ProbeFetch): Promise<boolean> {
  try {
    const response = await probe(`${endpointUrl.replace(/\/+$/, "")}/healthz`, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(5000) });
    return response.ok;
  } catch {
    return false;
  }
}

export async function observeListedHealth(deps: ListingStoreDeps & { probe?: ProbeFetch; now?: () => Date } = {}): Promise<HealthSweep> {
  if (!(deps.publicConfig ?? supabasePublicConfig())) return { source: "files" };
  const network = listingNetworkForProfile(resolveNetworkProfileName());
  if (!network) return { source: "files" };
  const listed = await readPublicListings(network, deps);
  if (!listed.ok) return { source: "database", available: false, checked: 0, passed: 0, failed: 0, unrecorded: 0 };

  let passed = 0;
  let failed = 0;
  let unrecorded = 0;
  for (let i = 0; i < listed.listings.length; i += BATCH) {
    await Promise.all(
      listed.listings.slice(i, i + BATCH).map(async (listing) => {
        const healthy = await probeEndpoint(listing.endpointUrl, deps.probe);
        const written = await recordListingHealth(listing.wallet, healthy ? "pass" : "fail", deps);
        if (!written.ok) unrecorded += 1;
        else if (healthy) passed += 1;
        else failed += 1;
      }),
    );
  }
  return { source: "database", available: unrecorded === 0, checked: listed.listings.length, passed, failed, unrecorded };
}
