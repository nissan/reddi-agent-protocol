import { NextResponse } from "next/server";
import { defaultAlertSender, sendBudgetAlert } from "@/lib/budget/alerts";
import { budgetCustodyStore } from "@/lib/budget/store";
import { createSweepAlertGate, failedSlices, sweepFailureAlert } from "@/lib/budget/sweep-alert";
import { bearerMatchesSecret } from "@/lib/http/cron-auth";
import { settleDueSandboxBudgets } from "@/lib/sandbox/budget-desk";
import { sandboxBudgetDeps } from "@/lib/sandbox/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const alertGate = createSweepAlertGate();

/**
 * The devnet sandbox providers' Budget sweep: posts each slice's total once
 * its Budget is closed or about to end, closes a Budget whose open period
 * ended, and pays out each slice that is due. Runs with the Budget watcher
 * (`.github/workflows/budget-watch.yml`). Only with CRON_SECRET. Answers 503
 * when any slice could not be settled, so the scheduler's run fails visibly,
 * and tells the operator which slices (at most hourly for the same ones).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  if (!bearerMatchesSecret(req.headers.get("authorization"), secret)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const deps = sandboxBudgetDeps();
  if (!deps) return NextResponse.json({ ok: true, configured: false, slices: 0 });
  const results = await settleDueSandboxBudgets(deps);
  const failed = failedSlices(results).length;
  let alerted: boolean | undefined;
  const alert = sweepFailureAlert(results);
  if (alert && alertGate.due(results)) {
    const store = budgetCustodyStore();
    // Without the custody store there is nowhere to log or queue the alert: send it directly.
    alerted = store
      ? await sendBudgetAlert(alert, undefined, { store, sender: defaultAlertSender() }).catch(() => false)
      : await operatorEmail(alert.subject, alert.text);
    console.error(JSON.stringify({ source: "sandbox-budgets", event: "payout_sweep_failed", alerted, ...alert.detail }));
  }
  return NextResponse.json({ ok: failed === 0, configured: true, slices: results.length, failed, ...(alerted === undefined ? {} : { alerted }), results }, { status: failed === 0 ? 200 : 503 });
}

async function operatorEmail(subject: string, text: string): Promise<boolean> {
  const to = process.env.BUDGET_OPS_EMAIL?.trim();
  if (!to) return false;
  return (await defaultAlertSender().email(to, `[RAP Budget ops] ${subject}`, text).catch(() => "failed")) === "sent";
}
