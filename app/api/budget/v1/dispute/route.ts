import { buildDisputeTransaction } from "@/lib/budget/dispute";
import { BUDGET_PROGRAM_ID, budgetChain } from "@/lib/budget/runtime";
import { rateLimited, readJsonBody, SOLANA_PAY_CORS, tryError, tryJson } from "@/lib/try/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Solana Pay transaction request behind the dispute link in a Budget alert.
 * GET names the merchant; POST with `{ account }` returns the `dispute` of
 * the provider's posted slice, for the Budget's payer to sign. Anyone else's
 * wallet is refused.
 */
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  return tryJson({ label: "Reddi Agent Protocol", icon: `${origin}/branding/reddiagent-x-profile-180.png` }, 200, SOLANA_PAY_CORS);
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: SOLANA_PAY_CORS });
}

export async function POST(request: Request) {
  const limited = rateLimited(request, "call", SOLANA_PAY_CORS);
  if (limited) return limited;
  const body = await readJsonBody(request);
  if (!body) return tryError(400, "invalid_request", "Send JSON with the wallet's account.", SOLANA_PAY_CORS);
  const params = new URL(request.url).searchParams;
  try {
    const built = await buildDisputeTransaction({ budget: params.get("budget"), payee: params.get("payee"), account: body.account, programId: BUDGET_PROGRAM_ID, chain: budgetChain() });
    if (!built.ok) return tryError(built.status, built.code, built.message, SOLANA_PAY_CORS);
    return tryJson({ transaction: built.transaction, message: built.message }, 200, SOLANA_PAY_CORS);
  } catch {
    return tryError(503, "chain_unavailable", "Devnet could not be reached. Nothing was signed; try again in a moment.", SOLANA_PAY_CORS);
  }
}
