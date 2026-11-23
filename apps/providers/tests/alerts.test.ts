import assert from "node:assert/strict";
import test from "node:test";
import { ALERT_WINDOW_MS, alertEmail, alertSettings, createAlerter } from "../lib/alerts.ts";

const ENV = {
  PROVIDER_ALERT_RESEND_API_KEY: "re_test_key",
  PROVIDER_ALERT_EMAIL_TO: "ops@example.com",
  PROVIDER_ALERT_EMAIL_FROM: "alerts@example.com",
};

function harness(env: Record<string, string | undefined> = ENV, status = 200) {
  const sent: { url: string; init: RequestInit }[] = [];
  const lines: Record<string, unknown>[] = [];
  const tasks: Promise<void>[] = [];
  let clock = 1_000_000;
  const alerter = createAlerter({
    env,
    now: () => clock,
    fetchImpl: (async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      return new Response("{}", { status });
    }) as typeof fetch,
    schedule: (task) => void tasks.push(task()),
    write: (line) => lines.push(line),
  });
  return {
    alerter, sent, lines,
    advance: (ms: number) => { clock += ms; },
    settled: () => Promise.all(tasks),
    body: (i: number) => JSON.parse(String(sent[i].init.body)) as { from: string; to: string[]; subject: string; text: string },
  };
}

test("off with no settings: nothing is sent or logged", async () => {
  assert.equal(alertSettings({}), null);
  const h = harness({});
  h.alerter.notify({ event: "sweep_failed", alert: true });
  await h.settled();
  assert.equal(h.alerter.enabled, false);
  assert.equal(h.sent.length, 0);
  assert.equal(h.lines.length, 0);
});

test("partly set up: names the missing settings, never a value, and sends nothing", async () => {
  const h = harness({ PROVIDER_ALERT_RESEND_API_KEY: "re_secret_value" });
  h.alerter.notify({ event: "sweep_failed", alert: true });
  await h.settled();
  assert.equal(h.sent.length, 0);
  assert.deepEqual(h.lines, [{ source: "rap-provider", event: "alert_email_not_configured", missing: ["PROVIDER_ALERT_EMAIL_TO", "PROVIDER_ALERT_EMAIL_FROM"] }]);
  assert.doesNotMatch(JSON.stringify(h.lines), /re_secret_value/);
});

test("an alert event is emailed through Resend; other events are not", async () => {
  const h = harness();
  h.alerter.notify({ event: "settle_recorded", escrow: "E" });
  h.alerter.notify({ event: "sweep_failed", provider: "humaniser", error: "boom", alert: true });
  await h.settled();
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].url, "https://api.resend.com/emails");
  assert.equal((h.sent[0].init.headers as Record<string, string>).authorization, "Bearer re_test_key");
  const body = h.body(0);
  assert.deepEqual(body.to, ["ops@example.com"]);
  assert.equal(body.from, "alerts@example.com");
  assert.equal(body.subject, "[RAP provider alert] sweep_failed (humaniser)");
  assert.match(body.text, /"error": "boom"/);
});

test("one email per event name per window; held alerts are counted in the next one", async () => {
  const h = harness();
  h.alerter.notify({ event: "settle_pending", alert: true });
  h.alerter.notify({ event: "settle_pending", alert: true });
  h.alerter.notify({ event: "settle_pending", alert: true });
  h.alerter.notify({ event: "sweep_failed", alert: true });
  h.advance(ALERT_WINDOW_MS);
  h.alerter.notify({ event: "settle_pending", alert: true });
  await h.settled();
  assert.deepEqual(h.sent.map((_, i) => h.body(i).subject), [
    "[RAP provider alert] settle_pending",
    "[RAP provider alert] sweep_failed",
    "[RAP provider alert] settle_pending",
  ]);
  assert.match(h.body(2).text, /2 more "settle_pending" alert\(s\)/);
  assert.doesNotMatch(h.body(0).text, /more "settle_pending"/);
});

test("a refused or failed send is logged with the status only and never throws", async () => {
  const refused = harness(ENV, 422);
  refused.alerter.notify({ event: "paid_answer_lost", alert: true });
  await refused.settled();
  assert.deepEqual(refused.lines, [{ source: "rap-provider", event: "alert_email_failed", status: 422 }]);

  const lines: Record<string, unknown>[] = [];
  const tasks: Promise<void>[] = [];
  const broken = createAlerter({
    env: ENV,
    fetchImpl: (async () => { throw new Error("ops@example.com unreachable"); }) as typeof fetch,
    schedule: (task) => void tasks.push(task()),
    write: (line) => lines.push(line),
  });
  broken.notify({ event: "paid_answer_lost", alert: true });
  await Promise.all(tasks);
  assert.deepEqual(lines, [{ source: "rap-provider", event: "alert_email_failed", status: "network" }]);
});

test("outside a request scope (schedule throws) the email is still sent", async () => {
  const sent: string[] = [];
  const alerter = createAlerter({
    env: ENV,
    fetchImpl: (async (url: string) => { sent.push(url); return new Response("{}"); }) as typeof fetch,
    schedule: () => { throw new Error("after() called outside a request scope"); },
    write: () => undefined,
  });
  alerter.notify({ event: "provider_not_configured", alert: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent.length, 1);
});

test("the email carries the event as logged (already redacted) plus where to look", () => {
  const { subject, text } = alertEmail({ event: "cluster_check_failed", reason: "https://[redacted]", alert: true }, 0);
  assert.equal(subject, "[RAP provider alert] cluster_check_failed");
  assert.match(text, /https:\/\/\[redacted\]/);
  assert.match(text, /INCIDENT-RUNBOOK/);
});
