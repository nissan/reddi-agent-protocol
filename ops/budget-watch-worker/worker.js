// Cloudflare Worker: calls the RAP Budget watcher and the sandbox slice sweep on a cron trigger.
// Settings on the Worker:
//   Secret   CRON_SECRET  the app's CRON_SECRET (Settings > Variables and Secrets > type Secret)
//   Trigger  cron "*/5 * * * *" (Settings > Triggers > Cron Triggers)
// It logs status codes and counts only. A failed pass throws, so it shows as an error in the Worker's metrics.
const ORIGIN = "https://app.agent-protocol.reddi.tech";
const PATHS = ["/api/cron/budget-watch", "/api/cron/sandbox-budgets"];

async function pass(env) {
  if (!env.CRON_SECRET) throw new Error("CRON_SECRET is not set on the Worker");
  const failed = [];
  for (const path of PATHS) {
    let status = 0;
    let summary = "";
    try {
      const res = await fetch(ORIGIN + path, {
        headers: { authorization: `Bearer ${env.CRON_SECRET}`, "user-agent": "rap-budget-watch-worker" },
        signal: AbortSignal.timeout(310_000),
      });
      status = res.status;
      const body = await res.json().catch(() => ({}));
      const { ok, complete, budgets, errors, alerts, slices, failed: failedSlices } = body;
      summary = JSON.stringify({ ok, complete, budgets, errors, alerts, slices, failed: failedSlices });
    } catch (error) {
      summary = error instanceof Error ? error.name : "error";
    }
    console.log(`${path}: HTTP ${status} ${summary}`);
    if (status !== 200) failed.push(`${path} ${status}`);
  }
  if (failed.length) throw new Error(`Budget watch pass failed: ${failed.join(", ")}`);
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(pass(env));
  },
  // Opening the Worker's URL shows nothing and runs nothing.
  async fetch() {
    return new Response("not found", { status: 404 });
  },
};
