import { createOrRotateEndpoint, heartbeatEndpoint } from "@/lib/onboarding/endpoint-manager";
import { legacyRouteGate } from "@/lib/http/route-gates";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const gated = legacyRouteGate();
  if (gated) return gated;
  try {
    const body = await req.json();
    const action = body.action === "heartbeat" ? "heartbeat" : "create";

    const result =
      action === "heartbeat"
        ? await heartbeatEndpoint({
            port: Number.isFinite(Number(body.port)) ? Number(body.port) : undefined,
            endpointUrl: typeof body.endpointUrl === "string" ? body.endpointUrl : undefined,
          })
        : await createOrRotateEndpoint({
            consentExposeEndpoint: Boolean(body.consentExposeEndpoint),
            port: Number(body.port),
            endpointUrl: typeof body.endpointUrl === "string" ? body.endpointUrl : undefined,
          });

    return Response.json({ ok: true, result });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Endpoint onboarding action failed",
      },
      { status: 400 }
    );
  }
}
