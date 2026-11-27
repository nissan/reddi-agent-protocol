// Cloudflare Worker: the timer and the outside monitor for the RAP Budget watcher.
//
// Every 5 minutes it (1) calls each watcher pass, the sandbox slice sweep and the Budget job recorder, and (2) reads each
// watcher's public health route and tells the owner when a watcher is behind its alert promise.
// It sits outside every Vercel project, so a fault there stops neither the timer nor the alarm.
//
// Settings on the Worker (Settings > Variables and Secrets):
//   Secret  CRON_SECRET          the app's CRON_SECRET (devnet watcher inside the app, sandbox sweep, Budget jobs)
//   Secret  WATCH_CRON_SECRET    BUDGET_WATCH_CRON_SECRET of the devnet rap-budget-watch project (optional until it is deployed)
//   Secret  WATCH_MAINNET_CRON_SECRET  the same for the mainnet watcher project (optional until mainnet)
//   Text    WATCH_ORIGIN         https origin of the devnet watcher project (optional)
//   Text    DEVNET_APP_ORIGIN    https origin of the separate devnet app (#1203, optional)
//   Secret  DEVNET_APP_CRON_SECRET  that app's CRON_SECRET; with both set the sandbox sweep runs there, not on the main app
//   Text    WATCH_MAINNET_ORIGIN https origin of the mainnet watcher project (optional)
//   Secret  NTFY_TOPIC           the owner's private ntfy.sh topic name: phone push (treat the name as a secret)
//   Secret  RESEND_API_KEY       a send-only Resend key for the monitor's own email
//   Text    MONITOR_EMAIL_TO     the owner's address; MONITOR_EMAIL_FROM a verified sender
// Trigger: cron "*/5 * * * *". It logs status codes and counts only.
const APP_ORIGIN = "https://app.agent-protocol.reddi.tech";
/** A watcher is behind once its last complete pass is older than its promise (the health route answers 503). */
const REPEAT_SECONDS = 3600;
const PERIOD_SECONDS = 300;

function httpsOrigin(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" ? url.origin : "";
  } catch {
    return "";
  }
}

/** The passes to call: [name, url, secret]. A watcher project is called only when both its origin and secret are set. */
function passes(env) {
  const list = [];
  if (env.CRON_SECRET) {
    list.push(["app watcher", `${APP_ORIGIN}/api/cron/budget-watch`, env.CRON_SECRET]);
    list.push(["budget jobs", `${APP_ORIGIN}/api/cron/budget-jobs`, env.CRON_SECRET]);
  }
  // The sandbox sweep settles devnet sandbox slices, so it runs on the devnet app once that app exists (#1203).
  const devnetApp = httpsOrigin(env.DEVNET_APP_ORIGIN);
  if (devnetApp && env.DEVNET_APP_CRON_SECRET) {
    list.push(["sandbox sweep", `${devnetApp}/api/cron/sandbox-budgets`, env.DEVNET_APP_CRON_SECRET]);
  } else if (env.CRON_SECRET) {
    list.push(["sandbox sweep", `${APP_ORIGIN}/api/cron/sandbox-budgets`, env.CRON_SECRET]);
  }
  const devnet = httpsOrigin(env.WATCH_ORIGIN);
  if (devnet && env.WATCH_CRON_SECRET) list.push(["devnet watcher", `${devnet}/api/cron/watch`, env.WATCH_CRON_SECRET]);
  const mainnet = httpsOrigin(env.WATCH_MAINNET_ORIGIN);
  if (mainnet && env.WATCH_MAINNET_CRON_SECRET) list.push(["mainnet watcher", `${mainnet}/api/cron/watch`, env.WATCH_MAINNET_CRON_SECRET]);
  return list;
}

/** The health routes to read: [name, url]. Public, no secret. */
function monitors(env) {
  const list = [["app watcher", `${APP_ORIGIN}/api/cron/budget-watch/health`]];
  const devnet = httpsOrigin(env.WATCH_ORIGIN);
  if (devnet) list.push(["devnet watcher", `${devnet}/api/v1/health`]);
  const mainnet = httpsOrigin(env.WATCH_MAINNET_ORIGIN);
  if (mainnet) list.push(["mainnet watcher", `${mainnet}/api/v1/health`]);
  return list;
}

/**
 * Whether this run tells the owner about a watcher that is not healthy. The Worker keeps no state,
 * so the rule is a function of how late the watcher is and of the clock: once in the first period
 * it is late, then once an hour. A health route that could not be read, or has never had a
 * complete pass, has no age: then once every half hour by the clock.
 */
function shouldPage(health, scheduledMs) {
  if (health.ok) return false;
  if (typeof health.ageSeconds === "number" && typeof health.promiseSeconds === "number") {
    const late = health.ageSeconds - health.promiseSeconds;
    return late >= 0 && late % REPEAT_SECONDS < PERIOD_SECONDS;
  }
  return Math.floor(scheduledMs / (PERIOD_SECONDS * 1000)) % 6 === 0;
}

async function readHealth(url, fetchImpl) {
  try {
    const res = await fetchImpl(url, { headers: { "user-agent": "rap-budget-watch-monitor" }, signal: AbortSignal.timeout(20_000) });
    const body = await res.json().catch(() => ({}));
    const ageSeconds = typeof body.lastCompletePassAgeSeconds === "number" ? body.lastCompletePassAgeSeconds : null;
    // The app's own route has no promise field: it turns red at 15 minutes.
    const promiseSeconds = typeof body.promiseSeconds === "number" ? body.promiseSeconds : 900;
    return { ok: res.status === 200 && body.ok === true, status: res.status, ageSeconds, promiseSeconds, problem: typeof body.problem === "string" ? body.problem.slice(0, 200) : "" };
  } catch (error) {
    return { ok: false, status: 0, ageSeconds: null, promiseSeconds: null, problem: error instanceof Error ? error.name : "error" };
  }
}

/** Tells the owner on every channel that is set up. Returns the channels that took it. */
async function page(env, subject, text, fetchImpl = fetch) {
  const took = [];
  const topic = String(env.NTFY_TOPIC || "").trim();
  if (/^[A-Za-z0-9_-]{16,64}$/.test(topic)) {
    try {
      const res = await fetchImpl(`https://ntfy.sh/${topic}`, { method: "POST", headers: { title: subject, priority: "urgent", tags: "rotating_light" }, body: text, signal: AbortSignal.timeout(10_000) });
      if (res.ok) took.push("push");
    } catch {
      // the other channel still goes
    }
  }
  const to = String(env.MONITOR_EMAIL_TO || "").trim();
  const from = String(env.MONITOR_EMAIL_FROM || "").trim();
  if (env.RESEND_API_KEY && to && from) {
    try {
      const res = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject: `[RAP Budget monitor] ${subject}`, text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) took.push("email");
    } catch {
      // reported below
    }
  }
  return took;
}

async function run(env, scheduledMs, fetchImpl = fetch) {
  const failed = [];
  const called = passes(env);
  if (called.length === 0) failed.push("no pass is configured (CRON_SECRET is not set on the Worker)");
  for (const [name, url, secret] of called) {
    let status = 0;
    let summary = "";
    try {
      const res = await fetchImpl(url, { headers: { authorization: `Bearer ${secret}`, "user-agent": "rap-budget-watch-worker" }, signal: AbortSignal.timeout(310_000) });
      status = res.status;
      const body = await res.json().catch(() => ({}));
      const { ok, complete, budgets, errors, alerts, slices, failed: failedSlices, recorded, unreadable, refused } = body;
      summary = JSON.stringify({ ok, complete, budgets, errors, alerts, slices, failed: failedSlices, recorded, unreadable, refused });
    } catch (error) {
      summary = error instanceof Error ? error.name : "error";
    }
    console.log(`${name}: HTTP ${status} ${summary}`);
    if (status !== 200) failed.push(`${name} ${status}`);
  }
  // The alarm reads health after the passes, so a pass that just succeeded clears it.
  for (const [name, url] of monitors(env)) {
    const health = await readHealth(url, fetchImpl);
    console.log(`${name} health: HTTP ${health.status} ok=${health.ok} age=${health.ageSeconds}`);
    if (health.ok) continue;
    failed.push(`${name} health ${health.status}`);
    if (!shouldPage(health, scheduledMs)) continue;
    const age = health.ageSeconds === null ? "no complete pass on record, or its health route could not be read" : `its last complete pass was ${Math.round(health.ageSeconds / 60)} minutes ago`;
    const took = await page(
      env,
      `The ${name} is behind: payers may be missing alerts`,
      `The RAP Budget ${name} is not healthy: ${age}${health.problem ? ` (${health.problem})` : ""}.\nPayers are not being told about reserves and posts on their Budgets, and their 24 hours to dispute are running.\nCheck ${url} and the project's logs. Runbook: docs/security/INCIDENT-RUNBOOK.md.`,
      fetchImpl,
    );
    console.log(`${name}: owner told on ${took.length ? took.join(", ") : "NO CHANNEL"}`);
    if (took.length === 0) failed.push(`${name} page not delivered`);
  }
  if (failed.length) throw new Error(`Budget watch run failed: ${failed.join(", ")}`);
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env, event.scheduledTime));
  },
  // Opening the Worker's URL shows nothing and runs nothing.
  async fetch() {
    return new Response("not found", { status: 404 });
  },
  // For the repository's tests only; the Workers runtime ignores it.
  internals: { httpsOrigin, passes, monitors, shouldPage, page, run },
};
