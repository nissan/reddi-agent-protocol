// Vercel Cron calls this every minute (vercel.json) with `Authorization: Bearer <CRON_SECRET>`, and the
// Grokbot runner calls it right after it closes a Budget so the slices are posted at once. Each desk that is set up posts its Budget slices once a
// Budget closes and looks again at settles whose outcome was not known. Names and outcomes only.
import { DESKS } from "../../../lib/desks.ts";
import { authorised } from "../../../lib/cron.ts";
import { desk, log } from "../../../lib/runtime.ts";
import type { Desk } from "../../../lib/studio-upstream.ts";

export const maxDuration = 300;
const noStore = { "cache-control": "no-store" };

async function sweep(request: Request) {
  if (!process.env.CRON_SECRET) return Response.json({ state: "not-configured" }, { status: 503, headers: noStore });
  if (!authorised(request.headers.get("authorization"), process.env.CRON_SECRET)) return new Response(null, { status: 401, headers: noStore });
  const results: Record<string, string> = {};
  await Promise.all(
    (Object.keys(DESKS) as Desk[]).map(async (name) => {
      const loaded = desk(name);
      if (!loaded.ok) {
        results[name] = "not-configured";
        return;
      }
      try {
        await loaded.provider.sweep();
        results[name] = "swept";
      } catch (error) {
        results[name] = "failed";
        log({ event: "sweep_failed", desk: name, error: error instanceof Error ? error.message : String(error) });
      }
    }),
  );
  const failed = Object.values(results).includes("failed");
  return Response.json({ state: failed ? "failed" : "done", results }, { status: failed ? 500 : 200, headers: noStore });
}

export const GET = sweep;
export const POST = sweep;
