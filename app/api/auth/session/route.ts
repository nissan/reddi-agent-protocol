import { authenticateWalletRequest } from "@/lib/auth/wallet-session";
import { recordProfile } from "@/lib/auth/profile-store";

export const runtime = "nodejs";

/**
 * POST /api/auth/session
 * Called by the browser right after a wallet sign-in. Confirms the session with
 * the auth service, records the wallet against the user, and returns the wallet
 * the server will treat this session as. Takes no body.
 */
export async function POST(req: Request) {
  const session = await authenticateWalletRequest(req.headers);
  if (!session.ok) {
    return Response.json({ ok: false, error: { code: session.code, message: session.message } }, { status: session.status });
  }
  const written = await recordProfile(session.userId, session.wallet);
  if (!written.ok) {
    const message = written.code === "wallet_taken" ? "This wallet is already linked to another account." : "Your account could not be saved right now. Try again.";
    return Response.json({ ok: false, error: { code: written.code, message } }, { status: written.status });
  }
  return Response.json({ ok: true, wallet: session.wallet });
}
