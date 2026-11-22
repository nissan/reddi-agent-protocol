/**
 * POST /api/planner/tools/release
 *
 * MCP tool: decide_settlement
 * Record consumer settlement decision after evaluating specialist output.
 */
import { decidePlannerSettlement } from "@/lib/onboarding/planner-settlement";
import { legacyRouteGate } from "@/lib/http/route-gates";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const gated = legacyRouteGate();
  if (gated) return gated;
  try {
    const body = await req.json();

    if (!body.runId?.trim()) {
      return Response.json({ ok: false, error: "runId is required" }, { status: 400 });
    }
    if (body.decision !== "release" && body.decision !== "dispute") {
      return Response.json({ ok: false, error: "decision must be release or dispute" }, { status: 400 });
    }

    const result = decidePlannerSettlement({
      runId: body.runId,
      decision: body.decision,
      notes: body.notes,
      consumerWallet: body.consumerWallet,
    });

    return Response.json({
      ok: true,
      run: result.run,
      settlementState: result.run.settlementState,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "decide_settlement failed",
      },
      { status: 400 }
    );
  }
}

export async function GET() {
  const gated = legacyRouteGate();
  if (gated) return gated;
  return Response.json({
    tool: "decide_settlement",
    description: "Record release/dispute decision for a paid planner run.",
    schema: {
      input: {
        runId: "string",
        decision: "release | dispute",
        notes: "string?",
        consumerWallet: "string?",
      },
    },
  });
}
