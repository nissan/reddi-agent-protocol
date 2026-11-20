import { authenticateWalletRequest, bearerToken } from "@/lib/auth/wallet-session";
import { executePlannerSpecialistCall, listPlannerRuns } from "@/lib/onboarding/planner-execution";

export const runtime = "nodejs";

export async function GET() {
  try {
    const result = listPlannerRuns();
    return Response.json({ ok: true, result });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Planner run listing failed",
      },
      { status: 400 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    // Optional: a signed-in buyer gets the job linked to their account. The wallet comes from the
    // checked session only. A missing or invalid session never blocks the call.
    let buyerSession: { userId: string; wallet: string } | undefined;
    if (bearerToken(req.headers)) {
      const session = await authenticateWalletRequest(req.headers);
      if (session.ok) buyerSession = { userId: session.userId, wallet: session.wallet };
    }
    const result = await executePlannerSpecialistCall({
      buyerSession,
      prompt: String(body.prompt || ""),
      consumerWallet: typeof body.consumerWallet === "string" ? body.consumerWallet : undefined,
      preferredWallet: typeof body.preferredWallet === "string" ? body.preferredWallet : undefined,
      paymentMode: body.paymentMode === "wallet" ? "wallet" : undefined,
      paymentReceipt: body.paymentMode === "wallet" ? body.paymentReceipt : undefined,
      policy: {
        requiredPrivacyMode:
          body.policy?.requiredPrivacyMode === "public" ||
          body.policy?.requiredPrivacyMode === "per" ||
          body.policy?.requiredPrivacyMode === "vanish"
            ? body.policy.requiredPrivacyMode
            : undefined,
        requiresAttested:
          body.policy?.requiresAttested === undefined
            ? undefined
            : Boolean(body.policy.requiresAttested),
        requiresHealthPass:
          body.policy?.requiresHealthPass === undefined
            ? undefined
            : Boolean(body.policy.requiresHealthPass),
        maxPerCallUsd:
          body.policy?.maxPerCallUsd === undefined
            ? undefined
            : Number(body.policy.maxPerCallUsd),
        preferredWallet: typeof body.policy?.preferredWallet === "string" ? body.policy.preferredWallet : undefined,
      },
    });

    if ("paymentRequired" in result && result.paymentRequired) {
      // Not an error: the buyer's wallet has to pay before the provider answers.
      return Response.json({ ok: false, paymentRequired: result.paymentRequired, result }, { status: 402 });
    }
    return Response.json({ ok: result.ok, result }, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Planner execution failed",
      },
      { status: 400 }
    );
  }
}
