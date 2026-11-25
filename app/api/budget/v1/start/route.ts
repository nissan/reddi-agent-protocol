import { budgetAgentKey, startBudget } from "@/lib/budget/page";
import { BUDGET_PROGRAM_ID, budgetChain, budgetCustodyDeps, budgetNotDevnet } from "@/lib/budget/runtime";
import { rateLimited, readJsonBody, tryError, tryJson } from "@/lib/try/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Step 2 of opening a Budget: makes the relay's record from the payer's
 * signed authorization and answers with the `open_budget` transaction for the
 * payer's wallet, and the agent's key, shown this once.
 */
export async function POST(request: Request) {
  const limited = rateLimited(request, "start");
  if (limited) return limited;
  const body = await readJsonBody(request);
  if (!body) return tryError(400, "invalid_request", "Send JSON with terms and signature.");
  const deps = budgetCustodyDeps();
  if (!deps) return tryError(503, "custody_not_configured", "Budgets are not switched on for this server yet.");
  try {
    const chain = budgetChain();
    const notDevnet = await budgetNotDevnet(chain);
    if (notDevnet) return notDevnet;
    const started = await startBudget({ terms: body.terms, signature: body.signature, programId: BUDGET_PROGRAM_ID, blockhash: () => chain.latestBlockhash() }, deps);
    if (!started.ok) return tryError(started.status, started.code, started.message);
    return tryJson({ id: started.id, budget: started.budget, key: budgetAgentKey(started.id, started.agentSecret), transaction: started.transaction });
  } catch {
    return tryError(503, "chain_unavailable", "Devnet could not be reached. Nothing was signed; try again in a moment.");
  }
}
