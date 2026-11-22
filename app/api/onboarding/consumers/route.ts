import { listConsumers } from "@/lib/onboarding/consumer-registry";
import { legacyRouteGate } from "@/lib/http/route-gates";

export const runtime = "nodejs";

export async function GET() {
  const gated = legacyRouteGate();
  if (gated) return gated;
  try {
    const result = listConsumers();
    return Response.json({ ok: true, result });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Consumer listing failed",
      },
      { status: 400 }
    );
  }
}
