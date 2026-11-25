import { buildBudgetAction } from "@/lib/budget/page";
import { BUDGET_PROGRAM_ID, budgetChain } from "@/lib/budget/runtime";
import { rateLimited, readJsonBody, tryError, tryJson } from "@/lib/try/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One transaction for the connected wallet to sign: approve a posted share
 * (paid at once), dispute it, close the Budget early, or pay out a share whose
 * window has ended. Approve, dispute and close are refused to anyone but the
 * payer; nothing is signed here.
 */
export async function POST(request: Request) {
  const limited = rateLimited(request, "call");
  if (limited) return limited;
  const body = await readJsonBody(request);
  if (!body) return tryError(400, "invalid_request", "Send JSON with budget, action, account and (for a share) payee.");
  try {
    const built = await buildBudgetAction({ budget: body.budget, payee: body.payee, action: body.action, account: body.account, programId: BUDGET_PROGRAM_ID, chain: budgetChain() });
    if (!built.ok) return tryError(built.status, built.code, built.message);
    return tryJson({ transaction: built.transaction });
  } catch {
    return tryError(503, "chain_unavailable", "Devnet could not be reached. Nothing was signed; try again in a moment.");
  }
}
