// WEB-31 scheduled retention purge. Vercel cron calls GET daily (vercel.json) with `Authorization: Bearer <CRON_SECRET>`,
// which Vercel adds from the project's CRON_SECRET variable; any other caller is refused. The run reads the same
// sensitive variables as the rest of the newsletter code and writes nothing but the store deletes. The response and
// the single log line carry counts only: never an address, a key or a token. Where the newsletter is not configured
// (production until WEB-29) the run answers "closed" and does nothing, so a daily cron there is harmless.
import { timingSafeEqual } from "node:crypto";
import { prunePending } from "../../../../lib/newsletter/flow.ts";
import { outageOrThrow } from "../../../../lib/newsletter/http.ts";
import { runtimeDeps } from "../../../../lib/newsletter/runtime.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // one listing plus one conditional delete per stale record
const noStore = { "Cache-Control": "no-store" };

function authorised(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) return Response.json({ state: "not-configured" }, { status: 503, headers: noStore });
  if (!authorised(req, process.env.CRON_SECRET)) return new Response(null, { status: 401, headers: noStore });
  const rt = runtimeDeps();
  if (!rt.ok) return Response.json({ state: "closed" }, { status: 200, headers: noStore });
  try {
    const report = await prunePending(rt.deps);
    console.log(`newsletter: prune-pending ${JSON.stringify(report)}`);
    return Response.json({ state: "pruned", ...report }, { status: 200, headers: noStore });
  } catch (error) { return outageOrThrow("prune-pending", error); }
}
