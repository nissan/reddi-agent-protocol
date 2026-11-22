import { seedDogfoodAgents } from "@/lib/dogfood/seed";
import { legacyRouteGate } from "@/lib/http/route-gates";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const gated = legacyRouteGate();
  if (gated) return gated;
  try {
    const origin = new URL(req.url).origin;
    const seeded = seedDogfoodAgents(origin);
    return Response.json({ origin, ...seeded });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "seed failed" },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  const gated = legacyRouteGate();
  if (gated) return gated;
  return POST(req);
}
