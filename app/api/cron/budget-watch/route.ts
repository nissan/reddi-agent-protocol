import { NextResponse } from "next/server";
import { bearerMatchesSecret } from "@/lib/http/cron-auth";
import { BUDGET_NETWORK, BUDGET_PROGRAM_ID, budgetChain, budgetCustodyDeps } from "@/lib/budget/runtime";
import { checkBudgetCluster } from "@/lib/budget/cluster-gate";
import { budgetLinkOrigin, watchBudgets } from "@/lib/budget/watch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Runs the Budget watcher once: alerts each payer about new and raised
 * slices, posts, disputes and payouts on their Budget, and the operator
 * about slices for providers the payer did not name. Meant to run every few
 * minutes (`.github/workflows/budget-watch.yml`). Only with CRON_SECRET.
 * Answers 503 when any Budget could not be watched or the pass ran out of
 * time, so the scheduler's run fails visibly.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  if (!bearerMatchesSecret(req.headers.get("authorization"), secret)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const deps = budgetCustodyDeps();
  if (!deps) return NextResponse.json({ ok: false, error: "budget_custody_not_configured" }, { status: 503 });
  let chain;
  try {
    chain = budgetChain();
  } catch {
    return NextResponse.json({ ok: false, error: "chain_unavailable" }, { status: 503 });
  }
  const cluster = await checkBudgetCluster({ network: BUDGET_NETWORK, genesisHash: () => chain.genesisHash() });
  if (!cluster.ok) return NextResponse.json({ ok: false, error: cluster.code }, { status: 503 });
  const reports = await watchBudgets({ ...deps, chain, programId: BUDGET_PROGRAM_ID, origin: budgetLinkOrigin() });
  const errors = reports.filter((r) => r.error);
  const ok = reports.complete !== false && errors.length === 0 && !reports.operatorAlertsUndelivered;
  return NextResponse.json(
    { ok, complete: reports.complete !== false, operatorAlertsUndelivered: reports.operatorAlertsUndelivered === true, budgets: reports.length, errors: errors.length, alerts: reports.reduce((n, r) => n + r.alerts.length, 0), reports },
    { status: ok ? 200 : 503 },
  );
}
