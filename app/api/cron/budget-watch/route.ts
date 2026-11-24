import { NextResponse } from "next/server";
import { bearerMatchesSecret } from "@/lib/http/cron-auth";
import { BUDGET_PROGRAM_ID, budgetChain, budgetCustodyDeps } from "@/lib/budget/runtime";
import { watchBudgets } from "@/lib/budget/watch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Runs the Budget watcher once: alerts each payer about new and raised
 * slices, posts, disputes and payouts on their Budget, and the operator
 * about slices for providers the payer did not name. Meant to run every few
 * minutes (`.github/workflows/budget-watch.yml`). Only with CRON_SECRET.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  if (!bearerMatchesSecret(req.headers.get("authorization"), secret)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const deps = budgetCustodyDeps();
  if (!deps) return NextResponse.json({ ok: false, error: "budget_custody_not_configured" }, { status: 503 });
  const reports = await watchBudgets({ ...deps, chain: budgetChain(), programId: BUDGET_PROGRAM_ID, origin: new URL(req.url).origin });
  return NextResponse.json({ ok: reports.every((r) => !r.error), budgets: reports });
}
