import { buildDiscoveryCandidateDetail } from "@/lib/discovery/candidate-detail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/discovery/candidates/[id] (#382)
 *
 * Read-only, fixture-backed candidate detail for the #381 marketplace
 * discovery cards (hosted RAP catalog, ARD / AI Catalog static imports,
 * Circle x402 / Pay.sh externally listed snapshots). Unknown, malformed, or
 * unavailable-source ids return an honest fail-closed availability payload —
 * never an invented candidate. No network call, payment, endpoint invocation,
 * wallet/RPC action, publication, or trust/reputation mutation happens here.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await ctx.params;
    let id = rawId;
    try {
      id = decodeURIComponent(rawId);
    } catch {
      // keep the raw segment; the builder fails closed on malformed ids
    }
    const result = buildDiscoveryCandidateDetail(id);
    const status =
      result.availability === "found" || result.availability === "source_unavailable"
        ? 200
        : result.availability === "not_found"
          ? 404
          : 400;
    return Response.json({ ok: result.availability === "found", result }, { status });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Discovery candidate detail build failed" },
      { status: 500 },
    );
  }
}
