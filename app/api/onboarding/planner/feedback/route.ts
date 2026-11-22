import { listPlannerFeedback, recordPlannerFeedback } from "@/lib/onboarding/planner-feedback";
import { legacyRouteGate } from "@/lib/http/route-gates";

export const runtime = "nodejs";

export async function GET() {
  const gated = legacyRouteGate();
  if (gated) return gated;
  try {
    const result = listPlannerFeedback();
    return Response.json({ ok: true, result });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Planner feedback listing failed",
      },
      { status: 400 }
    );
  }
}

export async function POST(req: Request) {
  const gated = legacyRouteGate();
  if (gated) return gated;
  try {
    const body = await req.json();
    const result = await recordPlannerFeedback({
      runId: String(body.runId || ""),
      score: Number(body.score),
      agreesWithAttestation:
        body.agreesWithAttestation === undefined
          ? undefined
          : Boolean(body.agreesWithAttestation),
      notes: typeof body.notes === "string" ? body.notes : undefined,
    });

    return Response.json({ ok: true, result });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Planner feedback save failed",
      },
      { status: 400 }
    );
  }
}
