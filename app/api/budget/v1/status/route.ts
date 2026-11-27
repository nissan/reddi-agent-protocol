import { budgetEvidence, type SliceEvidence } from "@/lib/budget/evidence";
import { judgeStore } from "@/lib/budget/judge/store";
import { budgetStatus, defaultBudgetJudge } from "@/lib/budget/page";
import { BUDGET_NETWORK, BUDGET_PROGRAM_ID, budgetChain, budgetGate, chainUnavailableMessage } from "@/lib/budget/runtime";
import { rateLimited, tryError, tryJson } from "@/lib/try/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A Budget and its providers' shares, read on chain, with what can be done with each now. */
export async function GET(request: Request) {
  const limited = rateLimited(request, "call");
  if (limited) return limited;
  const params = new URL(request.url).searchParams;
  const address = params.get("budget") ?? "";
  try {
    const chain = budgetChain();
    const gated = await budgetGate(request, "read", { chain });
    if (gated) return gated;
    const view = await budgetStatus(address, BUDGET_PROGRAM_ID, chain);
    if (!view) return tryError(404, "budget_not_found", "No Budget is open at that address. A Budget that has paid out every share is closed and gone.");
    // Beside each posted share: the calls the Budget signed and the provider's latest receipt (#1157).
    // Only when asked (`evidence=1`, about once a minute from the page): it reads the call log. Best effort.
    // Devnet only: on mainnet the app's role may add receipts but not read them (#1210), so there is none to show.
    const store = params.get("evidence") === "1" && BUDGET_NETWORK === "solana-devnet" ? judgeStore(process.env, BUDGET_NETWORK) : undefined;
    if (store) {
      const evidence = await budgetEvidence(view, { store, programId: BUDGET_PROGRAM_ID, network: BUDGET_NETWORK, rapJudge: defaultBudgetJudge()?.toBase58() ?? null }).catch((): Record<string, SliceEvidence> => ({}));
      view.slices = view.slices.map((s) => (evidence[s.payee] ? { ...s, evidence: evidence[s.payee] } : s));
    }
    return tryJson({ budget: view });
  } catch {
    return tryError(503, "chain_unavailable", chainUnavailableMessage(false));
  }
}
