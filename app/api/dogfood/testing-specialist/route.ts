import { randomInt } from "crypto";
import { legacyRouteGate } from "@/lib/http/route-gates";

export const runtime = "nodejs";

const GOOD_HAIKU = [
  "Agents wake at dawn",
  "Tools braid trust through noisy wires",
  "Proof settles by noon",
];

function failPayload(mode: number) {
  if (mode === 0) {
    return { reply: "ping", haiku: GOOD_HAIKU, text: `ping\n${GOOD_HAIKU.join("\n")}` };
  }
  if (mode === 1) {
    return {
      reply: "pong",
      haiku: ["Agents run quickly", "Many tools join and make results", "Trust grows"],
      text: "pong\nAgents run quickly\nMany tools join and make results\nTrust grows",
    };
  }
  return { reply: "pong", text: "pong" };
}

export async function POST(req: Request) {
  const gated = legacyRouteGate();
  if (gated) return gated;
  try {
    const body = await req.json().catch(() => ({}));
    const message = String(body.message ?? "").trim().toLowerCase();
    if (message !== "ping") {
      return Response.json({ ok: false, error: 'Only "ping" is supported in this test specialist.' }, { status: 400 });
    }

    const forced = body.force as "pass" | "fail" | undefined;
    const shouldFail = forced ? forced === "fail" : randomInt(4) === 0; // 25% failure path

    const payload = shouldFail
      ? failPayload(randomInt(3))
      : {
          reply: "pong",
          haiku: GOOD_HAIKU,
          text: `pong\n${GOOD_HAIKU.join("\n")}`,
        };

    return Response.json({
      ok: true,
      runId: body.runId ?? null,
      specialist: "testing-specialist",
      failureInjected: shouldFail,
      payload,
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "specialist failed" },
      { status: 500 }
    );
  }
}

export async function GET() {
  const gated = legacyRouteGate();
  if (gated) return gated;
  return Response.json({
    endpoint: "/api/dogfood/testing-specialist",
    method: "POST",
    contract: {
      input: { message: "ping", runId: "string?", force: "pass|fail?" },
      output: { payload: { reply: "string", haiku: "string[]?", text: "string" }, failureInjected: "boolean" },
    },
    notes: "Injects failure 1 in 4 times by design for attestor/consumer rejection testing.",
  });
}

