import { handleWatchCron, watcherContext } from "@/lib/budget/watch-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** One watcher pass over this deployment's network (`BUDGET_WATCH_CRON_SECRET`). See lib/budget/watch.ts. */
export function GET(req: Request) {
  return handleWatchCron(req, watcherContext());
}
