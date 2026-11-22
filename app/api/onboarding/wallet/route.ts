import { createLocalWallet, prepareSponsorship } from "@/lib/onboarding/wallet-sponsorship";
import { legacyRouteGate } from "@/lib/http/route-gates";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const gated = legacyRouteGate();
  if (gated) return gated;
  try {
    const body = await req.json();
    const action = body.action === "sponsorship" ? "sponsorship" : "create";

    const result =
      action === "sponsorship"
        ? prepareSponsorship(String(body.walletAddress || ""))
        : createLocalWallet({
            backupConfirmed: Boolean(body.backupConfirmed),
            passphrase: typeof body.passphrase === "string" ? body.passphrase : "",
          });

    return Response.json({ ok: true, result });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Wallet onboarding action failed",
      },
      { status: 400 }
    );
  }
}
