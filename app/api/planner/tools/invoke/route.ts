/**
 * POST /api/planner/tools/invoke
 *
 * MCP tool: invoke_specialist
 * Execute a paid specialist call with automatic x402 negotiation.
 * Returns response + run receipt.
 */
import { executePlannerSpecialistCall } from "@/lib/onboarding/planner-execution";
import { runOpenOnionConsumerFlow } from "@/lib/integrations/openonion/consumer/orchestrator";
import { readPolicy } from "@/lib/orchestrator/policy";
import { recordSpend } from "@/lib/orchestrator/policy";
import { getJupiterClient, getJupiterSlippageBps } from "@/lib/jupiter-client";
import type { InvokeInput, InvokeOutput } from "@/lib/mcp/tools";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const startMs = Date.now();

  try {
    const body: InvokeInput = await req.json();
    if (!body.prompt?.trim()) {
      return Response.json({ ok: false, error: "prompt is required" }, { status: 400 });
    }

    const savedPolicy = readPolicy();
    if (!savedPolicy.enabled) {
      return Response.json(
        {
          ok: false,
          error: "Specialist directory policy is disabled. Enable it in /orchestrator settings.",
        },
        { status: 403 }
      );
    }

    // Check daily budget
    const { readTodaySpend } = await import("@/lib/orchestrator/policy");
    const today = readTodaySpend();
    if (savedPolicy.dailyBudgetUsd > 0 && today.totalUsd >= savedPolicy.dailyBudgetUsd) {
      return Response.json(
        {
          ok: false,
          error: `Daily budget of $${savedPolicy.dailyBudgetUsd} exceeded ($${today.totalUsd.toFixed(4)} spent today).`,
        },
        { status: 429 }
      );
    }

    const policyOverride = body.policy ?? {};
    const jupiterClient = getJupiterClient();
    const executionInput = {
      prompt: body.prompt,
      consumerWallet: body.consumerWallet,
      preferredWallet: body.targetWallet,
      swapClient: jupiterClient ?? undefined,
      slippageBps: getJupiterSlippageBps(),
      policy: {
        requiredPrivacyMode:
          (policyOverride.preferredPrivacyMode ?? savedPolicy.preferredPrivacyMode) as "public" | "per" | "vanish" | undefined,
        requiresAttested: policyOverride.requireAttestation ?? savedPolicy.requireAttestation,
        requiresHealthPass: true,
        maxPerCallUsd:
          policyOverride.maxPerCallUsd ??
          (savedPolicy.maxPerTaskUsd > 0 ? savedPolicy.maxPerTaskUsd : undefined),
      },
    };

    const result = body.integrationMode === "openonion"
      ? await runOpenOnionConsumerFlow({
          ...executionInput,
          retryBudget: body.retryBudget,
        })
      : await executePlannerSpecialistCall(executionInput);

    // Record spend if payment was made
    if (result.ok && result.result.paymentSatisfied) {
      const estimatedUsd = result.result.endpointUrl ? 0.001 : 0; // stub until real price lookup
      recordSpend(estimatedUsd);
    }

    const durationMs = Date.now() - startMs;

    const output: InvokeOutput = {
      ok: result.ok,
      runId: result.result.runId,
      response: result.result.responsePreview,
      specialistWallet: result.result.selectedWallet,
      x402TxSignature: result.result.x402TxSignature,
      paymentSatisfied: result.result.paymentSatisfied,
      durationMs,
      error: result.ok ? undefined : (result.result.error ?? "Specialist call failed"),
    };

    return Response.json(output, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        durationMs: Date.now() - startMs,
        error: error instanceof Error ? error.message : "Invoke failed",
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return Response.json({
    tool: "invoke_specialist",
    description: "Execute a paid specialist call with automatic x402 payment negotiation.",
    schema: {
      input: { prompt: "string", targetWallet: "string?", consumerWallet: "string?", policy: "PolicyOverride?" },
      output: { ok: "boolean", runId: "string", response: "string", x402TxSignature: "string", durationMs: "number" },
    },
  });
}
