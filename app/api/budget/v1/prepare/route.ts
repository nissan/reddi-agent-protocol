import { emailConfirmRequired } from "@/lib/budget/email-confirm";
import { budgetProviders, budgetProviderView, BUDGET_TOKENS, defaultBudgetJudge, prepareBudget } from "@/lib/budget/page";
import { BUDGET_NETWORK_LABEL } from "@/lib/budget/network";
import { budgetOpenProblem } from "@/lib/budget/cluster-gate";
import { openBudgetRoom } from "@/lib/budget/open-limits";
import { BUDGET_NETWORK, BUDGET_PROGRAM_ID, budgetChain, budgetCustodyDeps, budgetGate, budgetJudgeNotReady, budgetStore } from "@/lib/budget/runtime";
import { readSignerConfig } from "@/lib/budget/signer-client";
import { rateLimited, readJsonBody, tryError, tryJson } from "@/lib/try/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The providers a Budget can name, the tokens it can hold and their default totals, and whether the RAP judge is set. */
export async function GET(request: Request) {
  const limited = rateLimited(request, "call");
  if (limited) return limited;
  return tryJson({
    network: BUDGET_NETWORK,
    networkLabel: BUDGET_NETWORK_LABEL[BUDGET_NETWORK],
    open: budgetOpenProblem(BUDGET_NETWORK) === undefined,
    // Only providers paid in a token this network offers: on mainnet, no sandbox (SOL) desks.
    providers: budgetProviders().filter((p) => BUDGET_TOKENS[p.token].offered).map(budgetProviderView),
    tokens: Object.fromEntries(
      Object.entries(BUDGET_TOKENS)
        .filter(([, t]) => t.offered)
        .map(([name, t]) => [name, { decimals: t.decimals, min: t.min.toString(), max: t.max.toString(), defaultTotal: t.defaultTotal.toString(), mint: t.mint?.toBase58() ?? null }]),
    ),
    judge: defaultBudgetJudge()?.toBase58() ?? null,
    // Not secret: the payer's freeze command names it (docs/BUDGET-PAYER-RECOVERY.md).
    signerOrigin: readSignerConfig()?.origin ?? null,
    // True when the alert email must be confirmed by a link before a Budget opens.
    emailConfirm: emailConfirmRequired(BUDGET_NETWORK),
  });
}

/** Step 1 of opening a Budget: checks the terms, picks the nonce and answers with the text the payer's wallet signs. */
export async function POST(request: Request) {
  const limited = rateLimited(request, "start");
  if (limited) return limited;
  const body = await readJsonBody(request);
  if (!body) return tryError(400, "invalid_request", "Send JSON with payer, token, total, providerIds and email.");
  const payer = typeof body.payer === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(body.payer) ? body.payer : undefined;
  const gated = await budgetGate(request, "prepare", { payer });
  if (gated) return gated;
  const store = budgetStore();
  if (!store) return tryError(503, "custody_not_configured", "Budgets are not switched on for this server yet.");
  if (payer) {
    const full = await openBudgetRoom({ store, network: BUDGET_NETWORK, payer });
    if (full) return tryError(full.status, full.code, full.message);
  }
  const prepared = prepareBudget(body, BUDGET_PROGRAM_ID);
  if (!prepared.ok) return tryError(prepared.status, prepared.code, prepared.message);
  // Before the payer signs anything: a judge with no registry record makes every open fail on chain (#1210).
  // Only a Budget that names the judge needs it registered: one without a judge is released on completion.
  const judgeNotReady = prepared.terms.judged ? await budgetJudgeNotReady(budgetChain(), budgetCustodyDeps()) : undefined;
  if (judgeNotReady) return judgeNotReady;
  return tryJson({ terms: prepared.terms, budget: prepared.budget, message: prepared.message });
}
