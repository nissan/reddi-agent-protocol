import { runSpecialistHealthcheck } from "@/lib/onboarding/healthcheck";
import { updateSpecialistHealthcheck } from "@/lib/onboarding/specialist-index";
import { legacyRouteGate } from "@/lib/http/route-gates";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const gated = legacyRouteGate();
  if (gated) return gated;
  try {
    const body = await req.json();
    const walletAddress = String(body.walletAddress || "");
    const endpointUrl = String(body.endpointUrl || "");
    const result = await runSpecialistHealthcheck({
      endpointUrl,
      walletAddress,
    });

    updateSpecialistHealthcheck(walletAddress, {
      endpointUrl,
      healthcheckStatus: result.status === "pass" ? "pass" : "fail",
    });

    return Response.json({ ok: true, result });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Healthcheck failed",
      },
      { status: 400 }
    );
  }
}
