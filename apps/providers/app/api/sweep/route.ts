// Vercel Cron calls this every minute (vercel.json) with
// `Authorization: Bearer <CRON_SECRET>`; any other caller is refused. Each
// provider that is set up looks again at settles whose outcome was not known.
// The response carries names and outcomes only.
import { PROVIDERS, type ProviderName } from "../../../lib/providers.ts";
import { authorised } from "../../../lib/cron.ts";
import { log, provider } from "../../../lib/runtime.ts";

export const maxDuration = 300;
const noStore = { "cache-control": "no-store" };

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) return Response.json({ state: "not-configured" }, { status: 503, headers: noStore });
  if (!authorised(request.headers.get("authorization"), process.env.CRON_SECRET)) return new Response(null, { status: 401, headers: noStore });
  const results: Record<string, string> = {};
  await Promise.all(
    (Object.keys(PROVIDERS) as ProviderName[]).map(async (name) => {
      const loaded = provider(name);
      if (!loaded.ok) {
        results[name] = "not-configured";
        return;
      }
      try {
        await loaded.provider.sweep();
        results[name] = "swept";
      } catch (error) {
        results[name] = "failed";
        log({ event: "sweep_failed", provider: name, error: error instanceof Error ? error.message : String(error), alert: true });
      }
    }),
  );
  const failed = Object.values(results).includes("failed");
  return Response.json({ state: failed ? "failed" : "done", results }, { status: failed ? 500 : 200, headers: noStore });
}
