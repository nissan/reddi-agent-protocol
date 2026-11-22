import "server-only";

/**
 * Server-observed health for database listings (#740). The server calls each
 * listed endpoint's `/healthz` and records what it saw. Owners cannot write
 * these fields, so a listing is only ever "pass" because the server reached it.
 *
 * A provider that answers but reports `acceptingPayments: false` (the provider
 * kit's per-currency pause) is recorded as "fail" too: it refuses paid calls,
 * so the planner, which routes only to listings that passed, does not offer it
 * (#852). The next sweep after the pause is lifted records "pass" again. A
 * provider that does not report the field is judged on reachability alone.
 */

import { resolveNetworkProfileName } from "@/lib/config/network";
import { supabasePublicConfig } from "@/lib/supabase/config";
import { listingNetworkForProfile, readPublicListings, recordListingHealth, type ListingStoreDeps } from "@/lib/listings/listing-store";
import { checkOutboundUrl } from "@/lib/http/outbound";

type ProbeResponse = { ok: boolean; status: number; text?: () => Promise<string> };
type ProbeFetch = (input: string, init: { method: string; redirect: "manual"; signal?: AbortSignal }) => Promise<ProbeResponse>;

/** A health body larger than this is not read for the pause flag. */
const MAX_HEALTH_BODY_CHARS = 16_384;

export type HealthSweep =
  | { source: "files" }
  | { source: "database"; available: boolean; checked: number; passed: number; failed: number; unrecorded: number };

const BATCH = 10;

/** False only when the health body is JSON with `acceptingPayments: false`; anything else (no body, other JSON, not JSON) is undefined. */
async function reportedAcceptingPayments(response: ProbeResponse): Promise<boolean | undefined> {
  if (typeof response.text !== "function") return undefined;
  try {
    const body = await response.text();
    if (body.length > MAX_HEALTH_BODY_CHARS) return undefined;
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object" && (parsed as { acceptingPayments?: unknown }).acceptingPayments === false) return false;
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * True only for a direct 2xx answer that does not report a payment pause. A
 * redirect is not followed, so a listing cannot point the server somewhere else.
 */
export async function probeEndpoint(endpointUrl: string, probe?: ProbeFetch): Promise<boolean> {
  try {
    const target = `${endpointUrl.replace(/\/+$/, "")}/healthz`;
    if (!probe) {
      // The real probe reaches public addresses only (audit S2-claude-02).
      const checked = await checkOutboundUrl(target);
      if (!checked.ok) return false;
    }
    const response = await (probe ?? (fetch as unknown as ProbeFetch))(target, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(5000) });
    if (!response.ok) return false;
    return (await reportedAcceptingPayments(response)) !== false;
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
