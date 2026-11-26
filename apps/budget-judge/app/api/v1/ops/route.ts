import { judgeContext } from "@/lib/budget/judge/runtime";
import { handleOps } from "@/lib/budget/judge/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Nissan's override (`BUDGET_JUDGE_OPS_SECRET`): `{ "action": "hold" | "release", "budget", "payee", "reason" }`
 * or `{ "action": "rule", "budget", "payee", "payout", "reason" }`. See docs/BUDGET-JUDGE.md.
 */
export function POST(req: Request) {
  return handleOps(req, judgeContext());
}
