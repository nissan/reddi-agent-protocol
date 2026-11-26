import { judgeContext } from "@/lib/budget/judge/runtime";
import { handleEvidence } from "@/lib/budget/judge/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * A provider's signed receipt for one of its disputed Budget slices:
 * `{ "budget", "payee", "receipt" }`, the receipt as its header value. Kept
 * only when it verifies for that slice. See docs/BUDGET-JUDGE.md.
 */
export function POST(req: Request) {
  return handleEvidence(req, judgeContext());
}
