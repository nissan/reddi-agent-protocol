/**
 * POST /api/planner/tools/register-consumer
 *
 * MCP tool: register_consumer
 * Register or update a consumer wallet profile for planner marketplace usage.
 */
import { listConsumers, registerConsumer } from "@/lib/onboarding/consumer-registry";
import { legacyRouteGate } from "@/lib/http/route-gates";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const gated = legacyRouteGate();
  if (gated) return gated;
  try {
    const body = await req.json();
    const result = registerConsumer({
      walletAddress: body.walletAddress,
      preferredIntegration: body.preferredIntegration,
      metadata: body.metadata,
    });

    return Response.json({
      ok: true,
      alreadyRegistered: result.alreadyRegistered,
      profile: result.profile,
      next: {
        registerOnchain: "Connect wallet and submit free consumer registration tx",
        selectIntegration: "Choose MCP, tools, or skills ingestion path",
      },
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "register_consumer failed",
      },
      { status: 400 }
    );
  }
}

export async function GET() {
  const gated = legacyRouteGate();
  if (gated) return gated;
  return Response.json({
    tool: "register_consumer",
    description: "Register or update a consumer wallet profile for orchestrator usage.",
    registry: listConsumers(),
    schema: {
      input: {
        walletAddress: "string",
        preferredIntegration: "mcp | tools | skills",
        metadata: "{ agentName?: string, framework?: string }",
      },
    },
  });
}
