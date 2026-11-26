import { judgeContext } from "@/lib/budget/judge/runtime";
import { handleCron } from "@/lib/budget/judge/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** One pass over every disputed Budget slice that names this judge (`BUDGET_JUDGE_CRON_SECRET`). See lib/budget/judge/pass.ts. */
export function GET(req: Request) {
  return handleCron(req, judgeContext());
}
