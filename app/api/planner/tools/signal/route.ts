/**
 * POST /api/planner/tools/signal
 *
 * MCP tool: submit_quality_signal
 * Submit quality feedback for a completed run.
 * Scores ≥3 on completed runs trigger on-chain blind reputation commit.
 */
import { recordPlannerFeedback } from "@/lib/onboarding/planner-feedback";
import { validateOpenOnionAttestorPayload } from "@/lib/integrations/openonion/attestor/schema";
import type { QualitySignalInput, QualitySignalOutput } from "@/lib/mcp/tools";
import { legacyRouteGate } from "@/lib/http/route-gates";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const gated = legacyRouteGate();
  if (gated) return gated;
  try {
    const body: QualitySignalInput = await req.json();

    if (!body.runId?.trim()) {
      return Response.json({ ok: false, error: "runId is required" }, { status: 400 });
    }
    if (!Number.isFinite(body.score) || body.score < 1 || body.score > 10) {
      return Response.json({ ok: false, error: "score must be between 1 and 10" }, { status: 400 });
    }

    if (body.attestorPayload) {
      const validation = validateOpenOnionAttestorPayload(body.attestorPayload);
      if (!validation.ok) {
        return Response.json(
          {
            ok: false,
            error: `Invalid attestor payload: ${validation.issues.join(" ")}`,
          },
          { status: 400 }
        );
      }
    }

    const result = await recordPlannerFeedback({
      runId: body.runId,
      score: body.score,
      notes: body.notes,
      agreesWithAttestation: body.agreesWithAttestation,
    });

    const output: QualitySignalOutput = {
      ok: true,
      reputationCommitted: result.reputationCommit?.ok === true,
      reputationTxSignature: result.reputationCommit?.txSignature,
    };

    return Response.json(output);
  } catch (error) {
    const output: QualitySignalOutput = {
      ok: false,
      reputationCommitted: false,
      error: error instanceof Error ? error.message : "Signal submission failed",
    };
    return Response.json(output, { status: 400 });
  }
}

export async function GET() {
  const gated = legacyRouteGate();
  if (gated) return gated;
  return Response.json({
    tool: "submit_quality_signal",
    description: "Rate a completed specialist call. Triggers on-chain reputation commit for scores ≥3.",
    schema: {
      input: { runId: "string", score: "number (1-10)", consumerWallet: "string?", notes: "string?", agreesWithAttestation: "boolean?" },
      output: { ok: "boolean", reputationCommitted: "boolean", reputationTxSignature: "string?" },
    },
  });
}
