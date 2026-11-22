import { fetchSpecialistListings } from "@/lib/registry/bridge";
import { DOGFOOD_TAG } from "@/lib/dogfood/constants";
import { legacyRouteGate } from "@/lib/http/route-gates";

export const runtime = "nodejs";

export async function GET() {
  const gated = legacyRouteGate();
  if (gated) return gated;
  try {
    const data = await fetchSpecialistListings();
    const listings = data.listings
      .filter((l) => l.capabilities?.tags?.includes(DOGFOOD_TAG))
      .map((l) => ({
        walletAddress: l.walletAddress,
        endpointUrl: l.health.endpointUrl,
        attested: l.attestation.attested,
        health: l.health.status,
        tags: l.capabilities?.tags ?? [],
        taskTypes: l.capabilities?.taskTypes ?? [],
        perCallUsd: l.capabilities?.perCallUsd ?? 0,
      }));

    return Response.json({
      ok: true,
      tag: DOGFOOD_TAG,
      total: listings.length,
      listings,
      hint: "Seed first via /api/dogfood/seed if list is empty.",
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "search failed" },
      { status: 500 }
    );
  }
}
