import { emailConfirmRequired } from "@/lib/budget/email-confirm";
import { BUDGET_NETWORK, budgetProviders, budgetProviderView, BUDGET_TOKENS, defaultBudgetJudge, prepareBudget } from "@/lib/budget/page";
import { BUDGET_PROGRAM_ID, budgetChain, budgetCustodyDeps, budgetJudgeNotReady } from "@/lib/budget/runtime";
import { rateLimited, readJsonBody, tryError, tryJson } from "@/lib/try/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The providers a Budget can name, the tokens it can hold and their default totals, and whether the RAP judge is set. */
export async function GET(request: Request) {
  const limited = rateLimited(request, "call");
  if (limited) return limited;
  return tryJson({
    network: "solana-devnet",
    providers: budgetProviders().map(budgetProviderView),
    tokens: Object.fromEntries(Object.entries(BUDGET_TOKENS).map(([name, t]) => [name, { decimals: t.decimals, max: t.max.toString(), defaultTotal: t.defaultTotal.toString(), mint: t.mint?.toBase58() ?? null }])),
    judge: defaultBudgetJudge()?.toBase58() ?? null,
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
  const prepared = prepareBudget(body, BUDGET_PROGRAM_ID);
  if (!prepared.ok) return tryError(prepared.status, prepared.code, prepared.message);
  // Before the payer signs anything: a judge with no registry record makes every open fail on chain (#1210).
  const judgeNotReady = await budgetJudgeNotReady(budgetChain(), budgetCustodyDeps());
  if (judgeNotReady) return judgeNotReady;
  return tryJson({ terms: prepared.terms, budget: prepared.budget, message: prepared.message });
}
