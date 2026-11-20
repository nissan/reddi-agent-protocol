// WEB-59: a send the mail provider refuses leaves one named, greppable line with the operation and the status class
// only. These tests capture console.error around the flow functions and the real ResendMailer with a stub fetch.
import test from "node:test";
import assert from "node:assert/strict";
import { MemoryStore, contactKey } from "../lib/newsletter/store.ts";
import { FakeMailer, ProviderRefusal, ResendMailer, logProviderRefusal, refusalClass } from "../lib/newsletter/mailer.ts";
import { subscribe, confirm, broadcast, type Deps } from "../lib/newsletter/flow.ts";
import { isOutage } from "../lib/newsletter/http.ts";

const SECRET = "0123456789abcdef0123456789abcdef";
const SITE = "https://preview.example";
const NAME = "newsletter-provider-refusal";

function deps(): Deps & { store: MemoryStore; mailer: FakeMailer } {
  const store = new MemoryStore();
  const mailer = new FakeMailer();
  return { store, mailer, siteUrl: SITE, now: () => 1_800_000_000_000, config: { enabled: true, publicCollection: false, allowedRecipients: ["@owner-test.example"], signingSecret: SECRET, from: "BattleBlocks AI <news@example.test>", replyTo: undefined, resendApiKey: "re_test", blobAuth: "token" as const } };
}
const tokenFrom = (m: FakeMailer) => decodeURIComponent(m.sent.at(-1)!.text.match(/\/newsletter\/confirm\?t=([^\s]+)/)![1]);

async function capture<T>(fn: () => Promise<T>): Promise<{ lines: string[]; result: PromiseSettledResult<T> }> {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    const [result] = await Promise.allSettled([fn()]);
    return { lines, result };
  } finally {
    console.error = original;
  }
}

// What a refusal line may never carry (WEB-59 definition of done): an address, a subject, a token, a link or a body.
function assertClean(line: string, forbidden: string[]) {
  assert.ok(!line.includes("@"), `no at-sign: ${line}`);
  assert.ok(!/https?:|\?t=|\/newsletter\//.test(line), `no link or token: ${line}`);
  for (const text of forbidden) assert.ok(!line.includes(text), `does not contain ${JSON.stringify(text)}: ${line}`);
  assert.match(line, /^newsletter-provider-refusal op=(confirmation|welcome|issue) class=(rate-limit|4xx|5xx|other)$/);
}

test("WEB-59: status classes", () => {
  assert.equal(refusalClass(429), "rate-limit");
  assert.equal(refusalClass(400), "4xx");
  assert.equal(refusalClass(422), "4xx");
  assert.equal(refusalClass(503), "5xx");
  assert.equal(refusalClass(302), "other");
});

test("WEB-59-S01: a refused confirmation email leaves one named line; the reservation is released and the error still surfaces", async () => {
  for (const [status, cls] of [[429, "rate-limit"], [400, "4xx"], [503, "5xx"]] as const) {
    const d = deps();
    d.mailer.refuseNext = status;
    const email = `visitor-${status}@owner-test.example`;
    const { lines, result } = await capture(() => subscribe(d, email));
    assert.equal(result.status, "rejected", "the caller sees the same failure as before");
    if (result.status === "rejected") assert.equal((result.reason as Error).message, `resend responded ${status}`);
    assert.deepEqual(lines, [`${NAME} op=confirmation class=${cls}`]);
    assertClean(lines[0], [email, "Confirm", "re_test", SECRET]);
    // unchanged: the reservation is given back, so the address can be sent to straight away
    assert.equal((await d.store.getContact(contactKey(email)))?.value.sendCount ?? 0, 0);
    assert.equal(await subscribe(d, email), "accepted");
  }
});

test("WEB-59-S02: a refused issue send leaves one named line; the ledger and lease behave as before", async () => {
  for (const [status, cls] of [[429, "rate-limit"], [403, "4xx"], [502, "5xx"]] as const) {
    const d = deps();
    for (const e of ["i1@owner-test.example", "i2@owner-test.example", "i3@owner-test.example"]) { await subscribe(d, e); await confirm(d, tokenFrom(d.mailer)); }
    const issue = { slug: `issue-${status}`, title: "Issue subject line", summary: "s", url: `${SITE}/updates/x`, html: "<p>x</p>", text: "x" };
    const realSend = d.mailer.send.bind(d.mailer); let calls = 0;
    d.mailer.send = async (m) => { calls++; if (calls === 2) throw new ProviderRefusal(status); return realSend(m); };
    const { lines, result } = await capture(() => broadcast(d, issue, { approved: true, sentId: `send-${status}` }));
    assert.equal(result.status, "rejected");
    assert.deepEqual(lines, [`${NAME} op=issue class=${cls}`]);
    assertClean(lines[0], ["i1", "i2", "i3", "Issue subject line", issue.slug, "re_test"]);
    const ledger = (await d.store.getBroadcast(issue.slug))!.value;
    assert.equal(ledger.complete, false);
    assert.equal(ledger.delivered.length, 1);
    assert.equal(ledger.runningSince, null, "lease released so the owner can resume at once");
  }
});

test("WEB-59-S03: accepted sends, and failures that are not refusals, write no refusal line", async () => {
  const d = deps();
  const ok = await capture(async () => {
    for (const e of ["a@owner-test.example", "b@owner-test.example"]) { await subscribe(d, e); await confirm(d, tokenFrom(d.mailer)); }
    return broadcast(d, { slug: "fine", title: "t", summary: "s", url: "u", html: "", text: "" }, { approved: true, sentId: "send-fine" });
  });
  assert.equal(ok.result.status, "fulfilled");
  assert.deepEqual(ok.lines, []);
  // a network failure or a bug is not a provider refusal: no line from this feature
  d.mailer.failNext = true;
  const network = await capture(() => subscribe(d, "c@owner-test.example"));
  assert.equal(network.result.status, "rejected");
  assert.deepEqual(network.lines, []);
  const direct = await capture(async () => { logProviderRefusal("issue", new TypeError("x@y.z")); });
  assert.deepEqual(direct.lines, []);
});

test("WEB-59: ResendMailer throws a ProviderRefusal with the status only; message, name and outage classification unchanged", async () => {
  const body = JSON.stringify({ message: "rate limited for someone@example.com", name: "rate_limit_exceeded" });
  for (const status of [429, 422, 500, 503]) {
    const mailer = new ResendMailer("re_key", "a <a@b.co>", undefined, (async () => new Response(body, { status })) as typeof fetch);
    const error = await mailer.send({ to: "someone@example.com", subject: "Subject", text: "t", html: "h" }).catch((e: unknown) => e);
    assert.ok(error instanceof ProviderRefusal);
    assert.equal((error as ProviderRefusal).status, status);
    assert.equal((error as Error).message, `resend responded ${status}`);
    assert.equal((error as Error).name, "Error", "the cron's interrupted line still says Error");
    assert.equal(isOutage(error), isOutage(new Error(`resend responded ${status}`)), "outage classification unchanged");
    const { lines } = await capture(async () => { logProviderRefusal("confirmation", error); });
    assert.equal(lines.length, 1);
    assertClean(lines[0], ["someone", "rate limited", "rate_limit_exceeded", "Subject", "re_key"]);
  }
});
