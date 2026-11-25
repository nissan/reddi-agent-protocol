import { NextResponse } from "next/server";
import { bearerMatchesSecret } from "@/lib/http/cron-auth";
import { settleDueSandboxBudgets } from "@/lib/sandbox/budget-desk";
import { sandboxBudgetDeps } from "@/lib/sandbox/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The devnet sandbox providers' Budget sweep: posts each slice's total once
 * its Budget is closed or about to end, closes a Budget whose open period
 * ended, and pays out each slice that is due. Runs with the Budget watcher
 * (`.github/workflows/budget-watch.yml`). Only with CRON_SECRET. Answers 503
 * when any slice could not be settled, so the scheduler's run fails visibly.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  if (!bearerMatchesSecret(req.headers.get("authorization"), secret)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const deps = sandboxBudgetDeps();
  if (!deps) return NextResponse.json({ ok: true, configured: false, slices: 0 });
  const results = await settleDueSandboxBudgets(deps);
  const failed = results.filter((r) => r.status === "failed" || r.status === "unreadable").length;
  return NextResponse.json({ ok: failed === 0, configured: true, slices: results.length, failed, results }, { status: failed === 0 ? 200 : 503 });
}
