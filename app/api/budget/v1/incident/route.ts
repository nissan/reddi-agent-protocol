import { NextResponse } from "next/server";
import { bearerMatchesSecret } from "@/lib/http/cron-auth";
import { closeAllBudgets, pauseBudgets, readOpsFeePayer } from "@/lib/budget/incident";
import { resealAll } from "@/lib/budget/reseal";
import { BUDGET_PROGRAM_ID, budgetChain, budgetCustodyDeps } from "@/lib/budget/runtime";
import { readJsonBody } from "@/lib/try/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The Budget incident step, for the operator only (BUDGET_INCIDENT_SECRET):
 * `{ "action": "pause", "reason": "..." }` stops every spender signature but
 * the close; `{ "action": "close-all", "reason": "..." }` pauses, then closes
 * every open Budget on chain with its own spender key and tells each payer
 * (Budgets it did not reach in time are listed under `unreached`: run it
 * again); `{ "action": "reseal", "reason": "...", "apply": true }` reseals
 * every key under the current KEK (without `apply` it only counts keys per
 * KEK). See docs/BUDGET-RELAY-CUSTODY.md.
 */
export async function POST(req: Request) {
  const secret = process.env.BUDGET_INCIDENT_SECRET?.trim();
  if (!secret) return NextResponse.json({ ok: false, error: "BUDGET_INCIDENT_SECRET is not configured" }, { status: 503 });
  if (!bearerMatchesSecret(req.headers.get("authorization"), secret)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = await readJsonBody(req);
  const action = body?.action;
  const reason = typeof body?.reason === "string" ? body.reason.slice(0, 300).trim() : "";
  if ((action !== "pause" && action !== "close-all" && action !== "reseal") || !reason) {
    return NextResponse.json({ ok: false, error: 'Send { "action": "pause" | "close-all" | "reseal", "reason": "..." }.' }, { status: 400 });
  }
  const deps = budgetCustodyDeps();
  if (!deps) return NextResponse.json({ ok: false, error: "budget_custody_not_configured" }, { status: 503 });
  if (action === "pause") return NextResponse.json({ ok: await pauseBudgets(reason, deps) });
  if (action === "reseal") {
    if (!deps.keks) return NextResponse.json({ ok: false, error: "BUDGET_SPENDER_KEKS is not set" }, { status: 503 });
    const report = await resealAll(deps.store, deps.keks, body?.apply === true);
    return NextResponse.json({ ok: report.failed.length === 0, ...report });
  }
  const result = await closeAllBudgets({ reason, feePayer: readOpsFeePayer(), programId: BUDGET_PROGRAM_ID, chain: budgetChain() }, deps);
  const ok = result.paused && result.unreached.length === 0 && result.results.every((r) => r.ok);
  return NextResponse.json({ ok, ...result }, { status: ok ? 200 : 207 });
}
