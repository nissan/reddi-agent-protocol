// Build updates and the newsletter issues made from them: record validity, draft visibility, which updates fall due,
// what the email contains, the one-issue-per-run send and the fail-closed HTTP handler.
import test from "node:test";
import assert from "node:assert/strict";
import { UPDATES, findUpdate, validateUpdates, visibleUpdates, type Update } from "../lib/updates.ts";
import { buildIssue, dueIssues, planIssues, runIssues, sydneyDay } from "../lib/newsletter/issues.ts";
import { autosendHandler } from "../lib/newsletter/autosend.ts";
import { updateLink } from "../lib/newsletter/links.ts";
import { confirm, subscribe, unsubscribe, type Deps } from "../lib/newsletter/flow.ts";
import { FakeMailer } from "../lib/newsletter/mailer.ts";
import { MemoryStore } from "../lib/newsletter/store.ts";
import { testDoubles } from "../lib/newsletter/runtime.ts";

const SECRET = "0123456789abcdef0123456789abcdef";
const SITE = "https://preview.example";
const NOW = Date.UTC(2026, 11, 4, 23, 10); // 23:10 UTC on 4 December is 10:10 on 5 December in Sydney

function deps(): Deps & { store: MemoryStore; mailer: FakeMailer; clock: { t: number } } {
  const clock = { t: NOW };
  const store = new MemoryStore();
  const mailer = new FakeMailer();
  return { store, mailer, clock, siteUrl: SITE, now: () => clock.t, config: { enabled: true, publicCollection: false, allowedRecipients: ["@owner-test.example"], signingSecret: SECRET, from: "RAP <news@example.test>", replyTo: undefined, resendApiKey: "re_x", blobAuth: "token" } as Deps["config"] };
}
const tokenFrom = (m: FakeMailer, purpose = "confirm") => decodeURIComponent(m.sent.at(-1)!.text.match(new RegExp(`/newsletter/${purpose}\\?t=([^\\s]+)`))![1]);
async function join(d: ReturnType<typeof deps>, email: string) { await subscribe(d, email); await confirm(d, tokenFrom(d.mailer)); }

const base: Update = { slug: "a-first-note", date: "2026-12-05", title: "A first note for tests", summary: "A summary long enough to pass the length rule in the validator.", body: ["One paragraph."], links: [{ label: "Check", href: "https://example.com/x" }], status: "published", newsletterSend: true };

test("the committed updates are valid, and the validator catches each kind of mistake", () => {
  assert.deepEqual(validateUpdates(), []);
  assert.deepEqual(validateUpdates([base]), []);
  const bad = (patch: Partial<Update>) => validateUpdates([{ ...base, ...patch }]).length > 0;
  assert.ok(bad({ slug: "Has Spaces" }));
  assert.ok(bad({ date: "5 December" }));
  assert.ok(bad({ title: "short" }));
  assert.ok(bad({ summary: "too short" }));
  assert.ok(bad({ body: [] }));
  assert.ok(bad({ links: [] }));
  assert.ok(bad({ links: [{ label: "x", href: "http://insecure.example" }] }));
  assert.ok(validateUpdates([base, base]).some((p) => /twice/.test(p)));
});

test("no committed update is flagged for email while it is a draft", () => {
  for (const u of UPDATES) assert.ok(!(u.status === "draft" && u.newsletterSend), u.slug);
});

test("drafts are shown only where drafts are shown; published updates everywhere, newest first", () => {
  const set: Update[] = [{ ...base, slug: "older", date: "2026-11-01" }, { ...base, slug: "draft-one", status: "draft" }, { ...base, slug: "newer", date: "2026-12-01" }];
  assert.deepEqual(visibleUpdates(false, set).map((u) => u.slug), ["newer", "older"]);
  assert.deepEqual(visibleUpdates(true, set).map((u) => u.slug), ["draft-one", "newer", "older"]);
  assert.equal(findUpdate("draft-one", false, set), null);
  assert.equal(findUpdate("draft-one", true, set)!.slug, "draft-one");
});

test("due issues: flagged, published and dated today in Sydney or earlier; oldest first", () => {
  assert.equal(sydneyDay(NOW), "2026-12-05");
  const set: Update[] = [
    { ...base, slug: "today" },
    { ...base, slug: "tomorrow", date: "2026-12-06" },
    { ...base, slug: "draft", status: "draft", date: "2026-12-01" },
    { ...base, slug: "not-flagged", newsletterSend: false, date: "2026-12-01" },
    { ...base, slug: "earlier", date: "2026-12-02" },
  ];
  assert.deepEqual(dueIssues(set, NOW).map((u) => u.slug), ["earlier", "today"]);
  // one day earlier in Sydney, the update dated the 5th is not due yet
  assert.deepEqual(dueIssues(set, NOW - 24 * 60 * 60 * 1000).map((u) => u.slug), ["earlier"]);
});

test("the issue email: escaped title and summary, a link to the update, and a refused link sends nothing", () => {
  const issue = buildIssue(SITE, { slug: "a-first-note", title: "Fees & <receipts>", summary: "Say \"hello\"" });
  assert.equal(issue.url, `${SITE}/updates/a-first-note`);
  assert.equal(issue.catchUpUrl, `${SITE}/status`);
  assert.ok(issue.html.includes("Fees &amp; &lt;receipts&gt;") && issue.html.includes("&quot;hello&quot;"));
  assert.throws(() => updateLink(SITE, "../evil?x=1"), /refused/);
});

test("a run sends one issue, oldest first, to confirmed contacts only, with a working unsubscribe link; a rerun sends nothing twice", async () => {
  const d = deps();
  await join(d, "a@owner-test.example"); await join(d, "b@owner-test.example");
  await subscribe(d, "pending@owner-test.example");
  await join(d, "gone@owner-test.example"); await unsubscribe(d, tokenFrom(d.mailer, "unsubscribe"));
  d.mailer.sent = [];
  const set: Update[] = [{ ...base, slug: "second", date: "2026-12-04" }, { ...base, slug: "first", date: "2026-12-03" }];
  assert.deepEqual((await planIssues(d, set)).map((e) => `${e.slug}:${e.state}`), ["first:unsent", "second:unsent"]);
  const one = await runIssues(d, set);
  assert.deepEqual(one, { outcome: "sent", slug: "first", due: 2, recipients: 2, delivered: 2, resumed: false });
  assert.deepEqual(d.mailer.sent.map((m) => m.to).sort(), ["a@owner-test.example", "b@owner-test.example"]);
  const mail = d.mailer.sent[0];
  assert.equal(mail.subject, base.title);
  assert.ok(mail.text.includes(`${SITE}/updates/first`) && mail.html.includes("Reddi Agent Protocol") && !/battleblocks/i.test(mail.html + mail.text));
  assert.equal(mail.headers!["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  const two = await runIssues(d, set);
  assert.equal(two.outcome === "sent" && two.slug, "second");
  assert.equal(d.mailer.sent.length, 4);
  assert.deepEqual(await runIssues(d, set), { outcome: "none-due", due: 2 });
  assert.equal(d.mailer.sent.length, 4);
  // the link in an issue unsubscribes
  assert.equal(await unsubscribe(d, tokenFrom(d.mailer, "unsubscribe")), "unsubscribed");
});

test("an interrupted run resumes with the remaining recipients; an issue with nobody to send to is closed for good", async () => {
  const d = deps();
  await join(d, "p1@owner-test.example"); await join(d, "p2@owner-test.example"); await join(d, "p3@owner-test.example");
  d.mailer.sent = [];
  const set: Update[] = [{ ...base, slug: "resumed" }];
  const realSend = d.mailer.send.bind(d.mailer);
  let calls = 0;
  d.mailer.send = async (m) => { if (++calls === 2) throw new Error("mailer failure (test)"); return realSend(m); };
  await assert.rejects(runIssues(d, set));
  assert.equal(d.mailer.sent.length, 1);
  assert.equal((await planIssues(d, set))[0].state, "partial");
  d.mailer.send = realSend;
  const resumed = await runIssues(d, set);
  assert.ok(resumed.outcome === "sent" && resumed.resumed && resumed.delivered === 3);
  assert.equal(new Set(d.mailer.sent.map((m) => m.to)).size, 3);
  assert.equal(d.mailer.sent.length, 3);

  const empty = deps();
  assert.deepEqual(await runIssues(empty, set), { outcome: "no-recipients", slug: "resumed", due: 1 });
  await join(empty, "late@owner-test.example"); empty.mailer.sent = [];
  assert.deepEqual(await runIssues(empty, set), { outcome: "none-due", due: 1 });
  assert.equal(empty.mailer.sent.length, 0);
});

test("the HTTP handler is fail-closed: no secret, wrong bearer, newsletter closed, switch off; a dry run sends nothing", async () => {
  const KEYS = ["CRON_SECRET", "NEWSLETTER_AUTOSEND", "NEWSLETTER_ENABLED", "NEWSLETTER_SIGNING_SECRET", "NEWSLETTER_FROM", "RESEND_API_KEY", "BLOB_READ_WRITE_TOKEN", "NEWSLETTER_ALLOWED_RECIPIENTS", "NEWSLETTER_TEST_DOUBLES", "NEWSLETTER_PUBLIC"];
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const call = async (auth?: string, query = "") => { const r = await autosendHandler(new Request(`https://x.example/api/newsletter/issues${query}`, { headers: auth ? { authorization: auth } : {} }), set); return { status: r.status, body: r.status === 401 ? null : await r.json() }; };
  const set: Update[] = [{ ...base, slug: "handler-issue", date: "2020-01-01" }];
  try {
    for (const k of KEYS) delete process.env[k];
    assert.equal((await call("Bearer anything")).status, 503);
    process.env.CRON_SECRET = "cron-secret-for-tests";
    assert.equal((await call()).status, 401);
    assert.equal((await call("Bearer wrong")).status, 401);
    assert.deepEqual((await call("Bearer cron-secret-for-tests")).body, { state: "closed" });
    Object.assign(process.env, { NEWSLETTER_ENABLED: "1", NEWSLETTER_SIGNING_SECRET: SECRET, NEWSLETTER_FROM: "a <a@b.co>", RESEND_API_KEY: "re_x", BLOB_READ_WRITE_TOKEN: "vercel_blob_x", NEWSLETTER_ALLOWED_RECIPIENTS: "@owner-test.example", NEWSLETTER_TEST_DOUBLES: "1" });
    testDoubles.store = new MemoryStore(); testDoubles.mailer = new FakeMailer();
    assert.deepEqual((await call("Bearer cron-secret-for-tests")).body, { state: "autosend-off" });
    const dry = (await call("Bearer cron-secret-for-tests", "?dry-run=1")).body;
    assert.deepEqual(dry, { state: "dry-run", autosend: false, wouldReach: 0, issues: [{ slug: "handler-issue", date: "2020-01-01", state: "unsent" }] });
    assert.equal(testDoubles.mailer.sent.length, 0);
    process.env.NEWSLETTER_AUTOSEND = "1";
    assert.equal((await call("Bearer cron-secret-for-tests", "?dry-run=1")).body.state, "dry-run");
    assert.equal((await testDoubles.store.getBroadcast("handler-issue")), null);
    const run = (await call("Bearer cron-secret-for-tests")).body;
    assert.equal(run.state, "no-recipients");
    assert.ok(!JSON.stringify(run).includes("@"));
  } finally {
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
});
