import { budgetStatus } from "@/lib/budget/page";
import { BUDGET_PROGRAM_ID, budgetChain, budgetGate, chainUnavailableMessage } from "@/lib/budget/runtime";
import { rateLimited, tryError, tryJson } from "@/lib/try/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A Budget and its providers' shares, read on chain, with what can be done with each now. */
export async function GET(request: Request) {
  const limited = rateLimited(request, "call");
  if (limited) return limited;
  const address = new URL(request.url).searchParams.get("budget") ?? "";
  try {
    const chain = budgetChain();
    const gated = await budgetGate(request, "read", { chain });
    if (gated) return gated;
    const view = await budgetStatus(address, BUDGET_PROGRAM_ID, chain);
    if (!view) return tryError(404, "budget_not_found", "No Budget is open at that address. A Budget that has paid out every share is closed and gone.");
    return tryJson({ budget: view });
  } catch {
    return tryError(503, "chain_unavailable", chainUnavailableMessage(false));
  }
}
