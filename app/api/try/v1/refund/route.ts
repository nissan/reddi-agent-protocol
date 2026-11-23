import { buildTryRefundTransaction } from "@/lib/try/refund";
import { devnetOrResponse, rateLimited, readJsonBody, SOLANA_PAY_CORS, tryError, tryJson } from "@/lib/try/http";
import { sandboxDevnetConnection } from "@/lib/sandbox/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Solana Pay transaction request for a try's refund. GET names the merchant;
 * POST with `{ account }` returns the refund of `?escrow=` for that wallet to
 * sign. Only the wallet that locked the escrow can sign it, and only after the
 * escrow's refund window, which the program checks again.
 */
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  return tryJson({ label: "Reddi Agent Protocol refund", icon: `${origin}/branding/reddiagent-x-profile-180.png` }, 200, SOLANA_PAY_CORS);
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: SOLANA_PAY_CORS });
}

export async function POST(request: Request) {
  const limited = rateLimited(request, "call", SOLANA_PAY_CORS);
  if (limited) return limited;
  const body = await readJsonBody(request);
  if (!body || typeof body.account !== "string") return tryError(400, "invalid_request", "Send JSON with the wallet's account.", SOLANA_PAY_CORS);
  try {
    const connection = sandboxDevnetConnection();
    const notDevnet = await devnetOrResponse(connection, SOLANA_PAY_CORS);
    if (notDevnet) return notDevnet;
    const built = await buildTryRefundTransaction({ escrow: new URL(request.url).searchParams.get("escrow"), account: body.account, connection });
    if (!built.ok) return tryError(built.status, built.code, built.message, SOLANA_PAY_CORS);
    return tryJson({ transaction: built.transaction, message: built.message }, 200, SOLANA_PAY_CORS);
  } catch {
    return tryError(503, "chain_unavailable", "Devnet could not be reached. Nothing was signed; try again in a moment.", SOLANA_PAY_CORS);
  }
}
