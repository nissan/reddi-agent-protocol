import { checkAdlConformance, formatAdlDocument } from "@redditech/agent-protocol/adl";
import { resolveNetworkProfileName } from "@/lib/config/network";
import { listingNetworkForProfile, readPublicListing } from "@/lib/listings/listing-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function refusal(status: number, code: string, message: string) {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

/**
 * GET /api/listings/{wallet}/adl: a listed provider's ADL v0.3 document, as
 * YAML (default) or, with ?format=json, as JSON with its Level 3 report and
 * whether the provider sent it or the app made it from the listing. Public.
 */
export async function GET(req: Request, ctx: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await ctx.params;
  const network = listingNetworkForProfile(resolveNetworkProfileName());
  if (!network) return refusal(503, "network_not_supported", "Listings are not available on this network profile.");
  const result = await readPublicListing(network, wallet);
  if (!result.ok) return refusal(result.status, result.code, result.message);
  if (!result.listing?.adl) return refusal(404, "adl_not_found", "This provider has no listed ADL document.");
  const { adl, adlSource } = result.listing;
  if (new URL(req.url).searchParams.get("format") === "json") {
    const report = checkAdlConformance(adl, { requestedLevel: 3 });
    return Response.json({ ok: true, wallet, network, source: adlSource, level: report.achievedLevel, status: report.status, adl });
  }
  return new Response(formatAdlDocument(adl), {
    status: 200,
    headers: { "content-type": "application/yaml; charset=utf-8", "content-disposition": `inline; filename="${wallet}.adl.yaml"`, "cache-control": "public, max-age=60" },
  });
}
