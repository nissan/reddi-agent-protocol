import { readPolicy, updatePolicy } from "@/lib/orchestrator/policy";
import { TASK_TYPE_IDS, PRIVACY_MODE_IDS } from "@/lib/capabilities/taxonomy";
import { legacyRouteGate } from "@/lib/http/route-gates";

export const runtime = "nodejs";

export async function GET() {
  const gated = legacyRouteGate();
  if (gated) return gated;
  return Response.json({ ok: true, policy: readPolicy() });
}

export async function POST(req: Request) {
  const gated = legacyRouteGate();
  if (gated) return gated;
  try {
    const body = await req.json();

    const patch: Parameters<typeof updatePolicy>[0] = {};

    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (typeof body.maxPerTaskUsd === "number" && body.maxPerTaskUsd >= 0) patch.maxPerTaskUsd = body.maxPerTaskUsd;
    if (typeof body.dailyBudgetUsd === "number" && body.dailyBudgetUsd >= 0) patch.dailyBudgetUsd = body.dailyBudgetUsd;
    if (typeof body.minReputation === "number" && body.minReputation >= 0) patch.minReputation = body.minReputation;
    if (typeof body.requireAttestation === "boolean") patch.requireAttestation = body.requireAttestation;
    if (typeof body.fallbackMode === "string" && ["skip", "error", "local"].includes(body.fallbackMode)) {
      patch.fallbackMode = body.fallbackMode as "skip" | "error" | "local";
    }
    if (typeof body.preferredPrivacyMode === "string" && PRIVACY_MODE_IDS.includes(body.preferredPrivacyMode)) {
      patch.preferredPrivacyMode = body.preferredPrivacyMode as typeof patch.preferredPrivacyMode;
    }
    if (Array.isArray(body.allowedTaskTypes)) {
      const valid = body.allowedTaskTypes.filter((t: string) => TASK_TYPE_IDS.includes(t as never));
      patch.allowedTaskTypes = valid;
    }

    const updated = updatePolicy(patch);
    return Response.json({ ok: true, policy: updated });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Policy update failed" },
      { status: 400 }
    );
  }
}
