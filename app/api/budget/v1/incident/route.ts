import { NextResponse } from "next/server";
import { bearerMatchesSecret } from "@/lib/http/cron-auth";
import { closeAllBudgets, pauseBudgets, readOpsFeePayer } from "@/lib/budget/incident";
import { BUDGET_PROGRAM_ID, budgetChain, budgetCustodyDeps } from "@/lib/budget/runtime";
import { readJsonBody } from "@/lib/try/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The Budget incident step, for the operator only (BUDGET_INCIDENT_SECRET):
 * `{ "action": "pause", "reason": "..." }` stops every spender approval but
 * the close; `{ "action": "close-all", "reason": "..." }` pauses, then closes
 * every open Budget on chain with a KMS approval and tells each payer
 * (Budgets it did not reach in time are listed under `unreached`: run it
 * again). See docs/BUDGET-RELAY-CUSTODY.md.
 */
export async function POST(req: Request) {
  const secret = process.env.BUDGET_INCIDENT_SECRET?.trim();
  if (!secret) return NextResponse.json({ ok: false, error: "BUDGET_INCIDENT_SECRET is not configured" }, { status: 503 });
  if (!bearerMatchesSecret(req.headers.get("authorization"), secret)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = await readJsonBody(req);
  const action = body?.action;
  const reason = typeof body?.reason === "string" ? body.reason.slice(0, 300).trim() : "";
  if ((action !== "pause" && action !== "close-all") || !reason) {
    return NextResponse.json({ ok: false, error: 'Send { "action": "pause" | "close-all", "reason": "..." }.' }, { status: 400 });
  }
  const deps = budgetCustodyDeps();
  if (!deps) return NextResponse.json({ ok: false, error: "budget_custody_not_configured" }, { status: 503 });
  if (action === "pause") return NextResponse.json({ ok: await pauseBudgets(reason, deps) });
  const result = await closeAllBudgets({ reason, feePayer: readOpsFeePayer(), programId: BUDGET_PROGRAM_ID, chain: budgetChain() }, deps);
  const ok = result.paused && result.unreached.length === 0 && result.results.every((r) => r.ok);
  return NextResponse.json({ ok, ...result }, { status: ok ? 200 : 207 });
}
