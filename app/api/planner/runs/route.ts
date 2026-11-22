import { listPlannerRuns } from "@/lib/onboarding/planner-execution"
import { legacyRouteGate } from "@/lib/http/route-gates";

export const runtime = "nodejs"

export async function GET() {
  const gated = legacyRouteGate();
  if (gated) return gated;
  try {
    return Response.json({ ok: true, result: listPlannerRuns() })
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Planner run listing failed" },
      { status: 400 }
    )
  }
}
