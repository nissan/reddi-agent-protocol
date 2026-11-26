import { budgetAgentKey, startBudget } from "@/lib/budget/page";
import { openBudgetRoom } from "@/lib/budget/open-limits";
import { BUDGET_NETWORK, BUDGET_PROGRAM_ID, budgetChain, budgetCustodyDeps, budgetGate, budgetJudgeNotReady, chainUnavailableMessage } from "@/lib/budget/runtime";
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
  const payer = payerOf(body.terms);
  try {
    const chain = budgetChain();
    const gated = await budgetGate(request, "start", { chain, payer });
    if (gated) return gated;
    if (payer) {
      const full = await openBudgetRoom({ store: deps.store, network: BUDGET_NETWORK, payer });
      if (full) return tryError(full.status, full.code, full.message);
    }
    const judgeNotReady = await budgetJudgeNotReady(chain, deps);
    if (judgeNotReady) return judgeNotReady;
    const started = await startBudget({ terms: body.terms, signature: body.signature, programId: BUDGET_PROGRAM_ID, blockhash: () => chain.latestBlockhash() }, deps);
    if (!started.ok) return tryError(started.status, started.code, started.message);
    return tryJson({ id: started.id, budget: started.budget, key: budgetAgentKey(started.id, started.agentSecret), transaction: started.transaction });
  } catch {
    return tryError(503, "chain_unavailable", chainUnavailableMessage());
  }
}

/** The payer the terms name, when it is a plausible address; `startBudget` checks it properly. */
function payerOf(terms: unknown): string | undefined {
  const payer = terms && typeof terms === "object" ? (terms as { payer?: unknown }).payer : undefined;
  return typeof payer === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(payer) ? payer : undefined;
}
