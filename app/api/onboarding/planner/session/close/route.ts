import { authenticateWalletRequest, bearerToken } from "@/lib/auth/wallet-session";
import { closePlannerSession } from "@/lib/onboarding/planner-execution";
import { parsePlannerSessionClose } from "@/lib/onboarding/planner-session";

export const runtime = "nodejs";

/**
 * Settle a planner session now (#863): the browser sends the lock's receipt and
 * its session key's `close` signature; the provider settles the calls it served
 * and the rest of the lock comes back. The session is recorded as one job.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "Request body must be a JSON object." }, { status: 400 });
  }
  if (typeof body.preferredWallet !== "string" || body.preferredWallet.length === 0) {
    return Response.json({ ok: false, error: "preferredWallet is required." }, { status: 400 });
  }
  const close = parsePlannerSessionClose(body.close);
  if ("error" in close) return Response.json({ ok: false, error: close.error }, { status: 400 });
  let buyerSession: { userId: string; wallet: string } | undefined;
  if (bearerToken(req.headers)) {
    const session = await authenticateWalletRequest(req.headers);
    if (session.ok) buyerSession = { userId: session.userId, wallet: session.wallet };
  }
  try {
    const result = await closePlannerSession({ preferredWallet: body.preferredWallet, paymentReceipt: body.paymentReceipt, close, buyerSession });
    return Response.json(result, { status: result.ok ? 200 : result.session.state === "pending" ? 202 : 400 });
  } catch {
    return Response.json({ ok: false, error: "The session could not be settled from here. The provider still settles it once it is idle." }, { status: 500 });
  }
}
