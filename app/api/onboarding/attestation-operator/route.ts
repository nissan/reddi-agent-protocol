import { checkOperatorKeyStatus } from "@/lib/onboarding/operator-key";
import { getOnchainAttestationOperatorStatus } from "@/lib/onboarding/onchain-attestation";
import { legacyRouteGate } from "@/lib/http/route-gates";

export const runtime = "nodejs";

const ENV_TEMPLATE = 'ONBOARDING_ATTEST_OPERATOR_SECRET_KEY="[12,34,...,64 bytes total]"';

export async function GET() {
  const gated = legacyRouteGate();
  if (gated) return gated;
  const keyStatus = checkOperatorKeyStatus();
  const onchainStatus = getOnchainAttestationOperatorStatus();

  const state = keyStatus.state;
  const nextAction =
    state === "ready"
      ? "Nothing to do. The key is valid, but this server no longer attests on chain: a judge attests a paid, rated job from its own wallet (app rating flow, #842)."
      : "Set ONBOARDING_ATTEST_OPERATOR_SECRET_KEY as a 64-byte JSON array, restart the app, then run this check again.";

  return Response.json({
    ok: true,
    result: {
      ready: state === "ready" && onchainStatus.ready,
      state,
      operatorPubkey: onchainStatus.operatorPubkey,
      note: onchainStatus.note,
      error: keyStatus.error,
      checkedAt: keyStatus.checkedAt,
      envTemplate: ENV_TEMPLATE,
      nextAction,
    },
  });
}
