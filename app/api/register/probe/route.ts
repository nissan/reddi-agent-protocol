import { NextResponse } from "next/server";
import { checkOutboundUrl, fetchOutbound, outboundAllowsHttp } from "@/lib/http/outbound";
import { validateOpenOnionSpecialistProfile } from "@/lib/integrations/openonion/specialist/adapter";
import { validateSourceAdapterManifest } from "@/lib/integrations/source-adapter/schema";

export const runtime = "nodejs";

function normalizeEndpoint(endpoint: string) {
  const raw = endpoint.trim();
  if (!raw) throw new Error("Endpoint URL is required.");
  try {
    return raw.startsWith("http://") || raw.startsWith("https://")
      ? new URL(raw)
      : new URL(`https://${raw}`);
  } catch {
    throw new Error("Invalid endpoint URL.");
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const endpoint = body?.endpoint;
  const sourceAdapter = body?.sourceAdapter;
  const integration = body?.integration ?? sourceAdapter?.source;
  // Strict x402 enforcement is always required for registration probes.

  if (!endpoint || typeof endpoint !== "string") {
    return NextResponse.json({ ok: false, status: "invalid_url" }, { status: 400 });
  }

  try {
    const url = normalizeEndpoint(endpoint);

    if (sourceAdapter !== undefined) {
      const sourceValidation = validateSourceAdapterManifest(sourceAdapter);
      if (!sourceValidation.ok) {
        return NextResponse.json(
          {
            ok: false,
            status: "invalid_source_adapter",
            error: `sourceAdapter manifest mismatch: ${sourceValidation.issues.join(" ")}`,
          },
          { status: 400 }
        );
      }
    }

    // Public addresses only, resolved before any request; redirects are never followed (audit S2-claude-02).
    const allowHttp = outboundAllowsHttp();
    const checked = await checkOutboundUrl(url, { allowHttp });
    const outbound = (target: string, init: RequestInit) => fetchOutbound(target, init, { allowHttp });
    if (!checked.ok) {
      return NextResponse.json(
        {
          ok: false,
          status: "invalid_url",
          error: "Localhost and private-network targets are blocked, and the endpoint must be a public https URL. Use a public tunnel URL (ngrok recommended, localtunnel fallback)."
        },
        { status: 400 }
      );
    }

    if (integration === "openonion") {
      const contractRes = await outbound(`${url.origin}/.well-known/reddi-adapter.json`, {
        signal: AbortSignal.timeout(5000),
      }).catch(() => null);

      if (!contractRes?.ok) {
        return NextResponse.json(
          {
            ok: false,
            status: "invalid_contract",
            error: "OpenOnion adapter contract not found. Expose /.well-known/reddi-adapter.json with specialist adapter metadata.",
          },
          { status: 400 }
        );
      }

      const contract = await contractRes.json().catch(() => null);
      const validation = validateOpenOnionSpecialistProfile(contract);
      if (!validation.ok) {
        return NextResponse.json(
          {
            ok: false,
            status: "invalid_contract",
            error: `OpenOnion specialist adapter contract mismatch: ${validation.issues.join(" ")}`,
          },
          { status: 400 }
        );
      }
    }

    const tagsRes = await outbound(`${url.origin}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });

    let securityStatus: "unknown" | "x402_challenge_detected" | "insecure_open_completion" = "unknown";
    let warning: string | undefined;

    try {
      const challengeProbe = await outbound(`${url.origin}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "probe",
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(5000),
      });

      const x402Header =
        challengeProbe.headers?.get("x402-request") || challengeProbe.headers?.get("X-402-Request");

      if (challengeProbe.status === 402 && x402Header) {
        securityStatus = "x402_challenge_detected";
      } else if (challengeProbe.ok) {
        securityStatus = "insecure_open_completion";
        warning =
          "Endpoint served completion without x402 challenge. Put a payment-enforcing gateway/proxy in front before registration.";
      }
    } catch {
      securityStatus = "unknown";
    }

    if (securityStatus !== "x402_challenge_detected") {
      return NextResponse.json(
        {
          ok: false,
          status: "insecure_endpoint",
          models: [],
          integration,
          securityStatus,
          error:
            securityStatus === "insecure_open_completion"
              ? "Endpoint served a completion without an x402 challenge. Put a payment-enforcing gateway/proxy in front before registration."
              : "Endpoint did not return the required 402 + x402-request challenge on /v1/chat/completions. Registration is blocked until x402 enforcement is visible.",
          warning,
        },
        { status: 400 }
      );
    }

    if (tagsRes.ok) {
      const body = await tagsRes.json().catch(() => null);
      const hasModels = body?.models && Array.isArray(body.models);

      return NextResponse.json({
        ok: true,
        status: hasModels ? "ollama_detected" : "reachable",
        models: hasModels ? body.models.map((m: { name?: string }) => m.name).filter(Boolean) : [],
        integration,
        securityStatus,
        warning,
      });
    }

    const healthRes = await outbound(`${url.origin}/healthz`, {
      signal: AbortSignal.timeout(5000),
    });

    return NextResponse.json({
      ok: healthRes.ok,
      status: healthRes.ok ? "reachable" : "unhealthy",
      models: [],
      securityStatus,
      warning,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        status: "unreachable",
        error: "The endpoint could not be reached.",
      },
      { status: 200 }
    );
  }
}
