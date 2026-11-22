import { listReputationCommits, revealReputationRating } from "@/lib/onboarding/reputation-signal";
import { legacyRouteGate } from "@/lib/http/route-gates";

export const runtime = "nodejs";

/** GET — list stored commits with revealed status */
export async function GET() {
  const gated = legacyRouteGate();
  if (gated) return gated;
  try {
    const result = listReputationCommits();
    return Response.json({ ok: true, result });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Listing commits failed" },
      { status: 400 }
    );
  }
}

/** POST { runId } — reveal a previously committed reputation rating */
export async function POST(req: Request) {
  const gated = legacyRouteGate();
  if (gated) return gated;
  try {
    const body = await req.json();
    const runId = String(body.runId || "").trim();
    if (!runId) {
      return Response.json({ ok: false, error: "runId is required" }, { status: 400 });
    }
    const result = await revealReputationRating(runId);
    return Response.json({ ok: result.ok, result }, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Reveal failed" },
      { status: 400 }
    );
  }
}
