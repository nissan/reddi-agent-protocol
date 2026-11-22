import { upsertCapabilities } from "@/lib/onboarding/capabilities";
import { listSpecialistIndex, upsertSpecialistIndex } from "@/lib/onboarding/specialist-index";
import { legacyRouteGate } from "@/lib/http/route-gates";

export const runtime = "nodejs";

export async function GET() {
  const gated = legacyRouteGate();
  if (gated) return gated;
  try {
    const result = listSpecialistIndex();
    return Response.json({ ok: true, result });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Specialist index read failed",
      },
      { status: 400 }
    );
  }
}

export async function POST(req: Request) {
  const gated = legacyRouteGate();
  if (gated) return gated;
  try {
    const body = await req.json();
    const walletAddress = String(body.walletAddress || "");
    const result = upsertCapabilities(String(body.walletAddress || ""), {
      taskTypes: Array.isArray(body.taskTypes) ? body.taskTypes.map(String) : [],
      inputModes: Array.isArray(body.inputModes) ? body.inputModes.map(String) : [],
      outputModes: Array.isArray(body.outputModes) ? body.outputModes.map(String) : [],
      pricing: {
        baseUsd: Number(body.pricing?.baseUsd),
        perCallUsd:
          body.pricing?.perCallUsd === undefined ? undefined : Number(body.pricing.perCallUsd),
        inputPerMillionUsd:
          body.pricing?.inputPerMillionUsd === undefined ? undefined : Number(body.pricing.inputPerMillionUsd),
        outputPerMillionUsd:
          body.pricing?.outputPerMillionUsd === undefined ? undefined : Number(body.pricing.outputPerMillionUsd),
      },
      privacyModes: Array.isArray(body.privacyModes)
        ? body.privacyModes.map(String) as Array<"public" | "per" | "vanish">
        : [],
      tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
      context_requirements: Array.isArray(body.context_requirements)
        ? body.context_requirements.map((req: { key?: unknown; type?: unknown; required?: unknown; description?: unknown; default?: unknown }) => ({
            key: String(req.key || ""),
            type: String(req.type || "text") as "text" | "url" | "file_ref" | "number" | "boolean" | "json",
            required: Boolean(req.required),
            description: typeof req.description === "string" ? req.description : undefined,
            default: req.default as string | number | boolean | undefined,
          }))
        : [],
      runtime_capabilities: Array.isArray(body.runtime_capabilities)
        ? body.runtime_capabilities.map(String) as Array<"code_execution" | "file_read" | "file_write" | "web_search" | "stateful" | "long_running" | "multimodal" | "streaming">
        : [],
      agent_composition: body.agent_composition && typeof body.agent_composition === "object"
        ? {
            llm: typeof body.agent_composition.llm === "string" ? body.agent_composition.llm : undefined,
            control_loop:
              typeof body.agent_composition.control_loop === "string"
                ? body.agent_composition.control_loop
                : undefined,
            tools: Array.isArray(body.agent_composition.tools) ? body.agent_composition.tools.map(String) : [],
            memory: Array.isArray(body.agent_composition.memory) ? body.agent_composition.memory.map(String) : [],
            goals: Array.isArray(body.agent_composition.goals) ? body.agent_composition.goals.map(String) : [],
          }
        : undefined,
      quality_claims: Array.isArray(body.quality_claims) ? body.quality_claims.map(String) : [],
      attestor_checkpoints: Array.isArray(body.attestor_checkpoints)
        ? body.attestor_checkpoints.map(String)
        : [],
    });

    upsertSpecialistIndex(walletAddress, result.record.capabilities, {
      endpointUrl: typeof body.endpointUrl === "string" ? body.endpointUrl : undefined,
      healthcheckStatus:
        body.healthcheckStatus === "pass" ||
        body.healthcheckStatus === "fail" ||
        body.healthcheckStatus === "pending"
          ? body.healthcheckStatus
          : undefined,
      attested: typeof body.attested === "boolean" ? body.attested : undefined,
    });

    return Response.json({ ok: true, result });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Capability validation failed",
      },
      { status: 400 }
    );
  }
}
