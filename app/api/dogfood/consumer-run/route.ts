import { randomUUID } from "crypto";
import { createHash } from "crypto";
import { createEscrow, settleEscrow } from "@/lib/dogfood/escrow";
import {
  DOGFOOD_ATTESTOR_WALLET,
  DOGFOOD_SPECIALIST_WALLET,
  DOGFOOD_TAG,
} from "@/lib/dogfood/constants";
import { seedDogfoodAgents } from "@/lib/dogfood/seed";
import { fetchSpecialistListings } from "@/lib/registry/bridge";
import { legacyRouteGate } from "@/lib/http/route-gates";

export const runtime = "nodejs";

function sha(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function POST(req: Request) {
  const gated = legacyRouteGate();
  if (gated) return gated;
  try {
    const body = await req.json().catch(() => ({}));
    const origin = new URL(req.url).origin;

    seedDogfoodAgents(origin);

    const message = String(body.message ?? "ping").trim().toLowerCase();
    const consumerWallet = String(body.consumerWallet ?? "dogfoodConsumer1111111111111111111111111111");
    const force = body.force as "pass" | "fail" | undefined;
    const amountUsd = Number(body.amountUsd ?? 0.01);

    const registry = await fetchSpecialistListings();
    const specialist = registry.listings.find(
      (l) => l.walletAddress === DOGFOOD_SPECIALIST_WALLET || l.capabilities?.tags?.includes(DOGFOOD_TAG)
    );
    const attestor = registry.listings.find(
      (l) => l.walletAddress === DOGFOOD_ATTESTOR_WALLET || l.capabilities?.tags?.includes("attestor")
    );

    if (!specialist?.health.endpointUrl || !attestor?.health.endpointUrl) {
      return Response.json(
        { ok: false, error: "Specialist or attestor endpoint missing. Run /api/dogfood/seed first." },
        { status: 400 }
      );
    }

    const runId = `dogfood_${randomUUID()}`;
    const escrow = createEscrow({
      runId,
      consumerWallet,
      specialistWallet: specialist.walletAddress,
      amountUsd,
    });

    const specialistRes = await fetch(specialist.health.endpointUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, runId, force }),
      signal: AbortSignal.timeout(8000),
    });
    const specialistJson = await specialistRes.json();

    const attestorRes = await fetch(attestor.health.endpointUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId, payload: specialistJson?.payload }),
      signal: AbortSignal.timeout(8000),
    });
    const attestorJson = await attestorRes.json();

    const attestationPass = attestorJson?.verdict?.pass === true;
    const decision = attestationPass ? "release" : "refund";
    const settled = settleEscrow({
      escrowId: escrow.escrowId,
      decision,
      reason: attestationPass
        ? "Attestor confirmed pong + haiku format."
        : "Attestor failed payload validation.",
      attestationPass,
    });

    return Response.json({
      ok: true,
      runId,
      flow: {
        search: {
          specialistWallet: specialist.walletAddress,
          attestorWallet: attestor.walletAddress,
        },
        request: { message, consumerWallet, amountUsd },
        specialist: specialistJson,
        attestation: attestorJson,
        escrow: settled,
      },
      antiFraud: {
        promptHash: sha({ message }),
        outputHash: sha(specialistJson?.payload ?? null),
        attestationHash: sha(attestorJson?.verdict ?? null),
      },
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "consumer-run failed" },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  const gated = legacyRouteGate();
  if (gated) return gated;
  return POST(req);
}

