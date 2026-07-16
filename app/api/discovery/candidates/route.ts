import { buildMarketplaceCandidateCards } from "@/lib/discovery/marketplace-candidate-cards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/discovery/candidates (#381)
 *
 * Read-only, fixture-backed marketplace candidate cards for the /agents
 * discovery source facets: hosted RAP registry catalog, ARD / AI Catalog
 * static-stack imports, and Circle x402 / Pay.sh externally listed snapshots.
 * No network call, payment, endpoint invocation, wallet/RPC action, or
 * registry/trust/reputation mutation happens here.
 */
export async function GET() {
  try {
    return Response.json({ ok: true, result: buildMarketplaceCandidateCards() });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Discovery candidate build failed" },
      { status: 500 },
    );
  }
}
