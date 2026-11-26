import { handleWatchHealth, watcherContext } from "@/lib/budget/watch-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How old this network's last complete watcher pass is, against the alert promise. Public; no secret. */
export function GET() {
  return handleWatchHealth(watcherContext());
}
