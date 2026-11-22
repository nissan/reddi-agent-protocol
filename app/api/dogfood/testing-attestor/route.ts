import { isHaiku } from "@/lib/dogfood/haiku";
import { legacyRouteGate } from "@/lib/http/route-gates";

export const runtime = "nodejs";

type SpecialistPayload = {
  reply?: string;
  haiku?: string[];
  text?: string;
};

function extractLines(payload: SpecialistPayload) {
  if (Array.isArray(payload.haiku) && payload.haiku.length > 0) {
    return payload.haiku.map((l) => String(l));
  }
  const text = String(payload.text ?? "").trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 4 && lines[0].toLowerCase() === "pong") return lines.slice(1, 4);
  return lines.slice(0, 3);
}

function includesPong(payload: SpecialistPayload) {
  const reply = String(payload.reply ?? "").toLowerCase();
  const text = String(payload.text ?? "").toLowerCase();
  return reply.includes("pong") || text.includes("pong");
}

export async function POST(req: Request) {
  const gated = legacyRouteGate();
  if (gated) return gated;
  try {
    const body = await req.json().catch(() => ({}));
    const payload = (body.payload ?? {}) as SpecialistPayload;

    const pong = includesPong(payload);
    const lines = extractLines(payload);
    const haiku = isHaiku(lines);
    const pass = pong && haiku.ok;

    return Response.json({
      ok: true,
      runId: body.runId ?? null,
      attestor: "testing-attestor",
      verdict: {
        pass,
        pong,
        haiku: haiku.ok,
        syllables: haiku.syllables,
        reasons: [
          pong ? null : 'Missing required "pong" token.',
          haiku.ok ? null : haiku.reason,
        ].filter(Boolean),
      },
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "attestation failed" },
      { status: 500 }
    );
  }
}

export async function GET() {
  const gated = legacyRouteGate();
  if (gated) return gated;
  return Response.json({
    endpoint: "/api/dogfood/testing-attestor",
    method: "POST",
    contract: {
      input: { payload: "specialist payload", runId: "string?" },
      output: { verdict: { pass: "boolean", pong: "boolean", haiku: "boolean", syllables: "number[]" } },
    },
    checks: ['contains "pong"', "haiku 3 lines with 5/7/5 syllables"],
  });
}

