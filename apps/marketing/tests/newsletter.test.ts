import test from "node:test";
import assert from "node:assert/strict";
import { issueToken, verifyToken, CONFIRM_TTL_MS } from "../lib/newsletter/tokens.ts";
import { BlobStore, ConflictError, MemoryStore, contactKey, type BlobSdk, type Contact } from "../lib/newsletter/store.ts";
import { FakeMailer } from "../lib/newsletter/mailer.ts";
import { readConfig, recipientAllowed } from "../lib/newsletter/config.ts";
import { subscribe, confirm, unsubscribe, deleteContact, broadcast, prunePending, lastConfirmationSendAt, BROADCAST_LEASE_MS, MAX_CONFIRM_SENDS_PER_DAY, PENDING_RETENTION_DAYS, type Deps } from "../lib/newsletter/flow.ts";
import { DurableLimiter, isOutage, readSmallJson, readToken, retryLater, sameOrigin } from "../lib/newsletter/http.ts";

const SECRET = "0123456789abcdef0123456789abcdef";
const SITE = "https://preview.example";
const K = (e: string) => contactKey(e);

function deps(opts: { publicCollection?: boolean } = {}): Deps & { store: MemoryStore; mailer: FakeMailer; clock: { t: number } } {
  const clock = { t: Date.UTC(2026, 9, 3, 12) };
  const store = new MemoryStore();
  const mailer = new FakeMailer();
  return { store, mailer, clock, siteUrl: SITE, now: () => clock.t, config: { enabled: true, publicCollection: opts.publicCollection ?? false, allowedRecipients: ["@owner-test.example", "tester@other.example"], signingSecret: SECRET, from: "BattleBlocks AI <news@example.test>", replyTo: undefined, resendApiKey: "re_test", blobAuth: "token" as const } };
}
const tokenFrom = (m: FakeMailer, purpose = "confirm") => decodeURIComponent(m.sent.at(-1)!.text.match(new RegExp(`/newsletter/${purpose}\\?t=([^\\s]+)`))![1]);
const status = async (d: Deps, e: string) => (await d.store.getContact(K(e)))?.value.status ?? null;

test("tokens: carry a contact key, never an address; sign, verify, tamper, expiry and purpose", () => {
  const now = 1_000_000;
  const t = issueToken(SECRET, "confirm", K("a@owner-test.example"), now);
  assert.ok(!Buffer.from(t.split(".")[0], "base64url").toString().includes("@"));
  const ok = verifyToken(SECRET, t, "confirm", now + 10);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.payload.k, K("a@owner-test.example"));
  assert.equal(verifyToken(SECRET, t, "confirm", now + CONFIRM_TTL_MS + 1).ok, false);
  assert.deepEqual(verifyToken(SECRET, t, "unsubscribe", now), { ok: false, reason: "purpose" });
  assert.deepEqual(verifyToken(SECRET, t.slice(0, -2) + "zz", "confirm", now), { ok: false, reason: "signature" });
  assert.deepEqual(verifyToken("x".repeat(32), t, "confirm", now), { ok: false, reason: "signature" });
  assert.equal(verifyToken(SECRET, "nonsense", "confirm", now).ok, false);
  assert.throws(() => issueToken("short", "confirm", K("a@b.co"), now));
  assert.throws(() => issueToken(SECRET, "confirm", "a@owner-test.example", now), /contact key/);
});

test("config: disabled by default, partial-start needs an allowlist, public needs none", () => {
  assert.deepEqual(readConfig({}), { ok: false, reason: "disabled" });
  const base = { NEWSLETTER_ENABLED: "1", NEWSLETTER_SIGNING_SECRET: SECRET, NEWSLETTER_FROM: "a <a@b.co>", RESEND_API_KEY: "re_x", BLOB_READ_WRITE_TOKEN: "vercel_blob_x" };
  assert.equal(readConfig(base).ok, false);
  const partial = readConfig({ ...base, NEWSLETTER_ALLOWED_RECIPIENTS: "@owner-test.example, Tester@Other.example" });
  assert.equal(partial.ok, true);
  if (partial.ok) {
    assert.equal(recipientAllowed(partial.config, "anyone@owner-test.example"), true);
    assert.equal(recipientAllowed(partial.config, "tester@other.example"), true);
    assert.equal(recipientAllowed(partial.config, "stranger@gmail.example"), false);
  }
  const pub = readConfig({ ...base, NEWSLETTER_PUBLIC: "1" });
  assert.equal(pub.ok && recipientAllowed(pub.config, "stranger@gmail.example"), true);
});

test("S01 confirmed opt-in: one link, used once, rate limited, unconfirmed never broadcast", async () => {
  const d = deps();
  assert.equal(await subscribe(d, "Alice@Owner-Test.example"), "accepted");
  assert.equal(d.mailer.sent.length, 1);
  assert.equal(await status(d, "alice@owner-test.example"), "pending");
  const none = await broadcast(d, { slug: "s", title: "t", summary: "s", url: "u", html: "", text: "" }, { approved: true, sentId: "x" });
  assert.equal(none.outcome, "no-recipients");
  const token = tokenFrom(d.mailer);
  assert.equal(await confirm(d, token), "confirmed");
  assert.equal(await confirm(d, token), "already-confirmed");
  assert.equal(await status(d, "alice@owner-test.example"), "confirmed");
  assert.equal(await subscribe(d, "alice@owner-test.example"), "already-confirmed");
  assert.equal(d.mailer.sent.length, 1);
  for (let i = 0; i < MAX_CONFIRM_SENDS_PER_DAY; i++) assert.equal(await subscribe(d, "bob@owner-test.example"), "accepted");
  assert.equal(await subscribe(d, "bob@owner-test.example"), "rate-limited");
  assert.equal(d.mailer.sent.length, 1 + MAX_CONFIRM_SENDS_PER_DAY);
  d.clock.t += 24 * 60 * 60 * 1000;
  assert.equal(await subscribe(d, "bob@owner-test.example"), "accepted");
  d.clock.t += CONFIRM_TTL_MS + 1;
  assert.equal(await confirm(d, tokenFrom(d.mailer)), "expired");
});

test("S02 unsubscribe: sends stop, old confirmation link cannot resubscribe, deletion removes the contact", async () => {
  const d = deps();
  await subscribe(d, "carol@owner-test.example");
  const oldConfirm = tokenFrom(d.mailer);
  await confirm(d, oldConfirm);
  const issue = { slug: "issue-1", title: "Issue 1", summary: "s", url: `${SITE}/updates/issue-1`, html: "<p>hi</p>", text: "hi" };
  assert.equal((await broadcast(d, issue, { approved: true, sentId: "send-1" })).outcome, "sent");
  const unsubToken = tokenFrom(d.mailer, "unsubscribe");
  d.clock.t += 1000;
  assert.equal(await unsubscribe(d, unsubToken), "unsubscribed");
  assert.equal(await unsubscribe(d, unsubToken), "already-unsubscribed");
  assert.equal((await broadcast(d, { ...issue, slug: "issue-2" }, { approved: true, sentId: "send-2" })).outcome, "no-recipients");
  assert.equal(await confirm(d, oldConfirm), "superseded");
  assert.equal(await status(d, "carol@owner-test.example"), "unsubscribed");
  assert.equal(await subscribe(d, "carol@owner-test.example"), "unsubscribed-resubscribe-sent");
  d.clock.t += 1000;
  assert.equal(await confirm(d, tokenFrom(d.mailer)), "confirmed");
  assert.equal(await deleteContact(d, "carol@owner-test.example"), "deleted");
  assert.equal(await status(d, "carol@owner-test.example"), null);
  assert.equal(await confirm(d, oldConfirm), "invalid");
});

test("S03 approved broadcast only: exactly once, duplicates do not resend, no approval sends nothing", async () => {
  const d = deps();
  for (const e of ["d1@owner-test.example", "d2@owner-test.example", "tester@other.example"]) { await subscribe(d, e); await confirm(d, tokenFrom(d.mailer)); }
  await subscribe(d, "pending@owner-test.example");
  d.mailer.sent = [];
  const issue = { slug: "first-foundations", title: "Before the first duel", summary: "s", url: `${SITE}/updates/first-foundations`, html: "<p>x</p>", text: "x" };
  assert.deepEqual(await broadcast(d, issue, { approved: false, sentId: "nope" }), { outcome: "not-approved" });
  assert.equal(d.mailer.sent.length, 0);
  const first = await broadcast(d, issue, { approved: true, sentId: "send-abc" });
  assert.equal(first.outcome, "sent");
  if (first.outcome === "sent") { assert.equal(first.recipients, 3); assert.equal(first.delivered, 3); assert.equal(first.resumed, false); assert.equal(first.sentId, "send-abc"); assert.match(first.sentAt, /^2026-10-03T/); }
  assert.equal(d.mailer.sent.length, 3);
  assert.ok(d.mailer.sent.every((m) => m.headers?.["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click" && m.headers?.["List-Unsubscribe"]?.includes("/api/newsletter/unsubscribe?t=") && m.text.includes("/newsletter/unsubscribe?t=")));
  assert.ok(!d.mailer.sent.some((m) => m.to === "pending@owner-test.example"));
  const again = await broadcast(d, issue, { approved: true, sentId: "send-def" });
  assert.equal(again.outcome, "already-sent");
  assert.equal(d.mailer.sent.length, 3);
  assert.equal((await d.store.getBroadcast("first-foundations"))!.value.complete, true);
});

test("S03 partial failure: the ledger records progress, a rerun resumes, recipients count equals delivered", async () => {
  const d = deps();
  for (const e of ["p1@owner-test.example", "p2@owner-test.example", "p3@owner-test.example"]) { await subscribe(d, e); await confirm(d, tokenFrom(d.mailer)); }
  d.mailer.sent = [];
  const issue = { slug: "issue-x", title: "X", summary: "s", url: "u", html: "<p>x</p>", text: "x" };
  const realSend = d.mailer.send.bind(d.mailer); let calls = 0;
  d.mailer.send = async (m) => { calls++; if (calls === 2) throw new Error("provider down"); return realSend(m); };
  await assert.rejects(broadcast(d, issue, { approved: true, sentId: "send-p" }), /provider down/);
  const ledger = (await d.store.getBroadcast("issue-x"))!.value;
  assert.equal(ledger.complete, false); assert.equal(ledger.delivered.length, 1);
  // a contact confirms between the failed run and the rerun
  await subscribe(d, "p4@owner-test.example"); await confirm(d, tokenFrom(d.mailer)); d.mailer.sent = d.mailer.sent.slice(0, 1);
  assert.deepEqual(await broadcast(d, issue, { approved: false, sentId: "ignored" }), { outcome: "not-approved" });
  const resumed = await broadcast(d, issue, { approved: true, sentId: "send-q" });
  assert.equal(resumed.outcome, "sent");
  if (resumed.outcome === "sent") { assert.equal(resumed.sentId, "send-p"); assert.equal(resumed.delivered, 4); assert.equal(resumed.recipients, 4); assert.equal(resumed.resumed, true); }
  assert.equal(d.mailer.sent.length, 4);
  assert.equal(new Set(d.mailer.sent.map((m) => m.to)).size, 4);
  assert.equal((await broadcast(d, issue, { approved: true, sentId: "send-r" })).outcome, "already-sent");
});

test("S03 overlapping runs: only one run can claim a slug", async () => {
  const d = deps();
  await subscribe(d, "o1@owner-test.example"); await confirm(d, tokenFrom(d.mailer)); d.mailer.sent = [];
  const issue = { slug: "race", title: "R", summary: "s", url: "u", html: "", text: "" };
  // simulate a second run claiming the ledger between this run's read and its create-only write
  const realPut = d.store.putBroadcast.bind(d.store); let first = true;
  d.store.putBroadcast = async (b, c) => { if (first) { first = false; await realPut({ ...b, sentId: "other-run" }, { version: null }); } return realPut(b, c); };
  assert.deepEqual(await broadcast(d, issue, { approved: true, sentId: "mine" }), { outcome: "in-progress-elsewhere" });
  assert.equal(d.mailer.sent.length, 0);
});

test("WEB-25-S03 concurrency: a prefetched confirm racing an unsubscribe leaves the contact unsubscribed; concurrent subscribes count every send", async () => {
  const d = deps();
  await subscribe(d, "race@owner-test.example");
  const confirmToken = tokenFrom(d.mailer); // the contact is pending; this is the link a scanner or client might prefetch
  const unsubToken = issueToken(SECRET, "unsubscribe", K("race@owner-test.example"), d.clock.t);
  // interleave: confirm reads the pending contact, then a one-click unsubscribe lands, then confirm tries to write with the stale version
  const realGet = d.store.getContact.bind(d.store); let interleaved = false;
  d.store.getContact = async (k) => { const r = await realGet(k); if (!interleaved) { interleaved = true; d.clock.t += 5; await unsubscribe(d, unsubToken); } return r; };
  // the stale write conflicts and the retry reads the unsubscribed record; the token predates unsubscribedAt, so it is superseded
  assert.equal(await confirm(d, confirmToken), "superseded");
  assert.equal(await status(d, "race@owner-test.example"), "unsubscribed");
  d.store.getContact = realGet;
  // concurrent subscribes for a fresh address: every send is counted
  const results = await Promise.all([1, 2, 3, 4].map(() => subscribe(d, "many@owner-test.example")));
  const sends = d.mailer.sent.filter((m) => m.to === "many@owner-test.example").length;
  assert.equal((await d.store.getContact(K("many@owner-test.example")))!.value.sendCount, sends);
  assert.equal(results.filter((r) => r === "accepted").length, sends);
  assert.ok(sends <= MAX_CONFIRM_SENDS_PER_DAY);
});

test("S04 abuse and validation: no write and no send for malformed, disallowed, oversized, cross-origin or burst requests", async () => {
  const d = deps();
  for (const bad of ["", "not-an-email", "a@b", "x".repeat(300) + "@owner-test.example", 42, null, { email: "a@owner-test.example" }]) assert.equal(await subscribe(d, bad), "invalid");
  assert.equal(await subscribe(d, "stranger@gmail.example"), "not-allowed");
  assert.equal(d.mailer.sent.length, 0);
  assert.equal((await d.store.listContacts()).length, 0);
  const mk = (headers: Record<string, string>, body = '{"email":"a@owner-test.example"}') => new Request(`${SITE}/api/subscribe`, { method: "POST", headers, body });
  assert.equal(sameOrigin(mk({ origin: "https://evil.example" }), SITE), false);
  assert.equal(sameOrigin(mk({ "sec-fetch-site": "cross-site" }), SITE), false);
  assert.equal(sameOrigin(mk({ origin: SITE, "sec-fetch-site": "same-origin" }), SITE), true);
  assert.deepEqual(await readSmallJson(mk({ "content-type": "text/plain" })), { ok: false });
  assert.deepEqual(await readSmallJson(mk({ "content-type": "application/json" }, JSON.stringify({ email: "a".repeat(2000) }))), { ok: false });
  // byte-accurate: 600 three-byte characters are 1800 bytes even though they are only ~610 characters
  assert.deepEqual(await readSmallJson(mk({ "content-type": "application/json" }, JSON.stringify({ email: "€".repeat(600) }))), { ok: false });
  assert.deepEqual(await readSmallJson(mk({ "content-type": "application/json" }, "{not json")), { ok: false });
  assert.deepEqual(await readToken(new Request(`${SITE}/api/newsletter/confirm?t=abc`, { method: "POST", body: "List-Unsubscribe=One-Click", headers: { "content-type": "application/x-www-form-urlencoded" } })), "abc");
  assert.deepEqual(await readToken(new Request(`${SITE}/api/newsletter/confirm`, { method: "POST", body: JSON.stringify({ t: "def" }), headers: { "content-type": "application/json" } })), "def");
  // the limiter counts in the shared store, so two instances over the same store share one count; buckets hold no address
  const limiter = new DurableLimiter(d.store, SECRET, 3, 1000);
  const other = new DurableLimiter(d.store, SECRET, 3, 1000);
  const seq: boolean[] = [];
  for (const l of [limiter, other, limiter, other]) seq.push(await l.allow("203.0.113.9", 0));
  assert.deepEqual(seq, [true, true, true, false]);
  assert.equal(await limiter.allow("203.0.113.9", 1001), true); // next window
  assert.equal(await limiter.allow("203.0.113.10", 0), true);   // another client
  assert.ok([...d.store.limits.keys()].every((b) => /^[0-9a-f]{64}$/.test(b)));
  assert.notEqual(limiter.bucket("203.0.113.9"), new DurableLimiter(d.store, "y".repeat(32), 3, 1000).bucket("203.0.113.9")); // keyed hash
  assert.equal(d.store.limits.size, 2, "one document per client, reused across windows (WEB-28-S02)");
  // concurrent requests from one client: the conditional writes serialise them and the limit still holds
  const burst = await Promise.all([1, 2, 3, 4, 5, 6].map(() => limiter.allow("203.0.113.11", 5000)));
  assert.equal(burst.filter(Boolean).length, 3);
  // a store outage fails open (the per-address daily limit in flow.ts remains)
  const broken = new DurableLimiter({ ...d.store, getLimit: async () => { throw new Error("store down"); } } as never, SECRET, 3, 1000);
  assert.equal(await broken.allow("203.0.113.12", 0), true);
  // mailer failure rolls the send-count reservation back and leaves no pending record behind for a new address
  d.mailer.failNext = true;
  await assert.rejects(subscribe(d, "e@owner-test.example"));
  assert.equal(await status(d, "e@owner-test.example"), null);
});

test("WEB-27-S01 rollback is conditional: a provider failure never strands a concurrent subscriber's link", async () => {
  const d = deps();
  // Request A reserves a send for a brand-new address and its email fails; before A rolls back, request B for the same
  // address reserves and sends successfully. A's rollback must decrement B's count, not delete B's record.
  const realSend = d.mailer.send.bind(d.mailer); let first = true;
  d.mailer.send = async (m) => {
    if (first) { first = false; assert.equal(await subscribe(d, "shared@owner-test.example"), "accepted"); throw new Error("provider down for A"); }
    return realSend(m);
  };
  await assert.rejects(subscribe(d, "shared@owner-test.example"), /provider down for A/);
  const stored = (await d.store.getContact(K("shared@owner-test.example")))!.value;
  assert.equal(stored.status, "pending");
  assert.equal(stored.sendCount, 1, "two reservations, one given back: the count reflects both attempts");
  assert.equal(d.mailer.sent.length, 1);
  assert.equal(await confirm(d, tokenFrom(d.mailer)), "confirmed"); // B's link works
  // a rollback for an existing record decrements rather than rewriting the record it read
  d.mailer.send = realSend;
  await subscribe(d, "pend@owner-test.example");
  const realGet = d.store.getContact.bind(d.store); let once = true;
  d.mailer.failNext = true;
  d.store.getContact = async (k) => { const r = await realGet(k); if (once && r && r.value.sendCount === 2) { once = false; await unsubscribe(d, issueToken(SECRET, "unsubscribe", k, d.clock.t)); } return r; };
  await assert.rejects(subscribe(d, "pend@owner-test.example"));
  d.store.getContact = realGet;
  const pend = (await d.store.getContact(K("pend@owner-test.example")))!.value;
  assert.equal(pend.status, "unsubscribed", "the concurrent unsubscribe survives the rollback");
  assert.equal(pend.sendCount, 1);
});

test("WEB-27 resume claim: two concurrent resumes of an interrupted broadcast cannot both send; the lease clears on failure and expires", async () => {
  const d = deps();
  for (const e of ["c1@owner-test.example", "c2@owner-test.example", "c3@owner-test.example"]) { await subscribe(d, e); await confirm(d, tokenFrom(d.mailer)); }
  d.mailer.sent = [];
  const issue = { slug: "lease", title: "L", summary: "s", url: "u", html: "", text: "" };
  const realSend = d.mailer.send.bind(d.mailer); let calls = 0;
  d.mailer.send = async (m) => { calls++; if (calls === 2) throw new Error("provider down"); return realSend(m); };
  await assert.rejects(broadcast(d, issue, { approved: true, sentId: "s1" }), /provider down/);
  let ledger = (await d.store.getBroadcast("lease"))!;
  assert.equal(ledger.value.runningSince, null, "a failed run releases its lease");
  // a resume that is already running holds the lease: a second resume is refused without sending
  d.mailer.send = realSend;
  const realGetB = d.store.getBroadcast.bind(d.store); let interleave = true;
  d.store.getBroadcast = async (slug) => { const r = await realGetB(slug); if (interleave) { interleave = false; const other = await broadcast(d, issue, { approved: true, sentId: "s-other" }); assert.equal(other.outcome, "sent"); } return r; };
  // this run read the ledger before the other finished, so its conditional claim loses and it sends nothing
  assert.deepEqual(await broadcast(d, issue, { approved: true, sentId: "s2" }), { outcome: "in-progress-elsewhere" });
  d.store.getBroadcast = realGetB;
  assert.equal(d.mailer.sent.length, 3, "every recipient exactly once across the interrupted run and the resume");
  assert.deepEqual(await broadcast(d, issue, { approved: true, sentId: "s3" }), { outcome: "already-sent", sentId: "s1", sentAt: (await realGetB("lease"))!.value.sentAt, recipients: 3 });
  // a lease left by a crashed run blocks resumes until it expires
  const crashed = { slug: "crashed", sentId: "c", sentAt: "2026-10-03T00:00:00.000Z", recipients: 3, delivered: [] as string[], complete: false, runningSince: d.clock.t };
  await d.store.putBroadcast(crashed, { version: null });
  assert.deepEqual(await broadcast(d, { ...issue, slug: "crashed" }, { approved: true, sentId: "c2" }), { outcome: "in-progress-elsewhere" });
  d.clock.t += BROADCAST_LEASE_MS;
  const after = await broadcast(d, { ...issue, slug: "crashed" }, { approved: true, sentId: "c3" });
  assert.equal(after.outcome, "sent");
  if (after.outcome === "sent") assert.equal(after.sentId, "c");
  // a long run renews its lease on every progress write, so it is never mistaken for a crashed one
  const slow = deps();
  for (const e of ["s1@owner-test.example", "s2@owner-test.example"]) { await subscribe(slow, e); await confirm(slow, tokenFrom(slow.mailer)); }
  const start = slow.clock.t;
  const sendAndAge = slow.mailer.send.bind(slow.mailer);
  slow.mailer.send = async (m) => { slow.clock.t += BROADCAST_LEASE_MS; return sendAndAge(m); };
  const realPutB = slow.store.putBroadcast.bind(slow.store); const leases: (number | null | undefined)[] = [];
  slow.store.putBroadcast = async (b, c) => { leases.push(b.runningSince); return realPutB(b, c); };
  assert.equal((await broadcast(slow, { ...issue, slug: "long" }, { approved: true, sentId: "long" })).outcome, "sent");
  assert.ok(leases.slice(1, -1).every((l) => typeof l === "number" && l > start), `progress writes renew the lease: ${leases.join(",")}`);
  // a ledger written before WEB-27 (no runningSince) resumes normally
  const legacy = { slug: "legacy", sentId: "l", sentAt: "2026-10-03T00:00:00.000Z", recipients: 3, delivered: [K("c1@owner-test.example")], complete: false };
  await d.store.putBroadcast(legacy, { version: null });
  const legacyRun = await broadcast(d, { ...issue, slug: "legacy" }, { approved: true, sentId: "l2" });
  assert.equal(legacyRun.outcome, "sent");
  if (legacyRun.outcome === "sent") assert.equal(legacyRun.delivered, 3);
  assert.equal((await d.store.getBroadcast("legacy"))!.value.runningSince, null);
});

test("WEB-31-S01 retention purge: only pending records older than the period go; a dry run removes nothing; a record changed mid-run is kept", async () => {
  const d = deps();
  const DAY = 24 * 3600 * 1000;
  const put = (email: string, c: Partial<Contact>) => d.store.putContact(K(email), { email, status: "pending", createdAt: d.clock.t, confirmedAt: null, unsubscribedAt: null, sendWindowStart: d.clock.t, sendCount: 1, lastSentAt: d.clock.t, ...c }, { version: null });
  // a real subscribe stamps lastSentAt
  assert.equal(await subscribe(d, "fresh@owner-test.example"), "accepted");
  assert.equal((await d.store.getContact(K("fresh@owner-test.example")))!.value.lastSentAt, d.clock.t);
  await put("stale@owner-test.example", { lastSentAt: d.clock.t - 8 * DAY, sendWindowStart: d.clock.t - 8 * DAY });
  await put("edge@owner-test.example", { lastSentAt: d.clock.t - 7 * DAY + 1 });                 // inside the period by one millisecond
  await put("resent@owner-test.example", { createdAt: d.clock.t - 20 * DAY, sendWindowStart: d.clock.t - 20 * DAY, lastSentAt: d.clock.t - 2 * DAY }); // old record, recent resend
  await put("legacy@owner-test.example", { lastSentAt: undefined, sendWindowStart: d.clock.t - 9 * DAY }); // pre-WEB-31 record: the end of its send window stands in (t - 8 days)
  await put("legacy-edge@owner-test.example", { lastSentAt: undefined, sendWindowStart: d.clock.t - 8 * DAY + 1 }); // window ended 7 days ago less 1 ms: kept, never deleted early
  await put("old-confirmed@owner-test.example", { status: "confirmed", confirmedAt: d.clock.t - 30 * DAY, lastSentAt: d.clock.t - 31 * DAY });
  await put("old-unsub@owner-test.example", { status: "unsubscribed", unsubscribedAt: d.clock.t - 40 * DAY, lastSentAt: d.clock.t - 41 * DAY });
  assert.equal(lastConfirmationSendAt((await d.store.getContact(K("legacy@owner-test.example")))!.value), d.clock.t - 8 * DAY);
  const dry = await prunePending(d, { dryRun: true });
  assert.deepEqual(dry, { examined: 8, pending: 6, stale: 2, removed: 0, skipped: 0, dryRun: true, days: PENDING_RETENTION_DAYS });
  assert.equal((await d.store.listContacts()).length, 8, "a dry run removes nothing");
  // a visitor who asks for a new link while the purge runs keeps their record: the conditional delete loses and is skipped
  const realDelete = d.store.deleteContact.bind(d.store);
  d.store.deleteContact = async (key, condition) => { if (key === K("legacy@owner-test.example")) throw new ConflictError("changed"); return realDelete(key, condition); };
  const run = await prunePending(d);
  d.store.deleteContact = realDelete;
  assert.deepEqual(run, { examined: 8, pending: 6, stale: 2, removed: 1, skipped: 1, dryRun: false, days: 7 });
  assert.deepEqual((await d.store.listContacts()).map((c) => c.value.email).sort(), ["edge@owner-test.example", "fresh@owner-test.example", "legacy-edge@owner-test.example", "legacy@owner-test.example", "old-confirmed@owner-test.example", "old-unsub@owner-test.example", "resent@owner-test.example"]);
  // an explicit shorter period, and invalid periods are refused before anything is read
  assert.equal((await prunePending(d, { days: 1 })).removed, 4, "edge, legacy, legacy-edge and resent go with a one-day period; fresh stays");
  assert.equal(await status(d, "old-unsub@owner-test.example"), "unsubscribed", "unsubscribed records are never touched");
  await assert.rejects(prunePending(d, { days: 0 }), RangeError);
  await assert.rejects(prunePending(d, { days: Number.NaN }), RangeError);
});

test("WEB-31-S03 scheduled purge route: refused without the cron secret or with a wrong one, harmless where the newsletter is closed, and its response and log carry counts only", async () => {
  const route = await import("../app/api/newsletter/prune/route.ts");
  const { testDoubles } = await import("../lib/newsletter/runtime.ts");
  const saved = { ...process.env };
  const logged: string[] = [];
  const realLog = console.log; console.log = (...a: unknown[]) => { logged.push(a.map(String).join(" ")); };
  try {
    delete process.env.CRON_SECRET;
    for (const k of ["NEWSLETTER_ENABLED", "NEWSLETTER_SIGNING_SECRET", "NEWSLETTER_FROM", "RESEND_API_KEY", "BLOB_READ_WRITE_TOKEN", "NEWSLETTER_ALLOWED_RECIPIENTS", "NEWSLETTER_TEST_DOUBLES", "NEWSLETTER_PUBLIC"]) delete process.env[k];
    const call = (auth?: string) => route.GET(new Request(`${SITE}/api/newsletter/prune`, { headers: auth ? { authorization: auth } : {} }));
    assert.equal((await call("Bearer anything")).status, 503, "no CRON_SECRET: never runs");
    process.env.CRON_SECRET = "cron-secret-under-test";
    assert.equal((await call()).status, 401);
    assert.equal((await call("Bearer cron-secret-under-tesT")).status, 401);
    let res = await call("Bearer cron-secret-under-test");
    assert.equal(res.status, 200); assert.deepEqual(await res.json(), { state: "closed" }); // production today: nothing configured, nothing to do
    Object.assign(process.env, { NEWSLETTER_ENABLED: "1", NEWSLETTER_SIGNING_SECRET: SECRET, NEWSLETTER_FROM: "a <a@b.co>", RESEND_API_KEY: "re_x", BLOB_READ_WRITE_TOKEN: "vercel_blob_x", NEWSLETTER_ALLOWED_RECIPIENTS: "@owner-test.example", NEWSLETTER_TEST_DOUBLES: "1" });
    const stale = "stale-cron@owner-test.example"; const old = Date.now() - 10 * 24 * 3600 * 1000;
    await testDoubles.store.putContact(K(stale), { email: stale, status: "pending", createdAt: old, confirmedAt: null, unsubscribedAt: null, sendWindowStart: old, sendCount: 1, lastSentAt: old }, { version: null });
    const before = (await testDoubles.store.listContacts()).length;
    res = await call("Bearer cron-secret-under-test");
    assert.equal(res.status, 200); assert.equal(res.headers.get("cache-control"), "no-store");
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body.state, "pruned"); assert.equal(body.removed, 1); assert.equal(body.days, PENDING_RETENTION_DAYS);
    for (const [k, v] of Object.entries(body)) assert.ok(k === "state" ? v === "pruned" : typeof v === "number" || typeof v === "boolean", `${k} is a count or flag`);
    assert.equal((await testDoubles.store.listContacts()).length, before - 1);
    assert.equal(await testDoubles.store.getContact(K(stale)), null);
    assert.equal(logged.length, 1); assert.match(logged[0], /^newsletter: prune-pending \{"examined":\d+/);
    for (const forbidden of [stale, "owner-test", K(stale), K(stale).slice(0, 12), SECRET, "cron-secret"]) assert.ok(!logged[0].includes(forbidden), `log never contains ${forbidden.slice(0, 8)}`);
    // an outage is the usual retryable 503
    const realList = testDoubles.store.listContacts.bind(testDoubles.store);
    testDoubles.store.listContacts = async () => { throw Object.assign(new Error("Vercel Blob: Service unavailable"), { name: "BlobServiceNotAvailable" }); };
    try { res = await call("Bearer cron-secret-under-test"); assert.equal(res.status, 503); assert.equal(res.headers.get("retry-after"), "30"); } finally { testDoubles.store.listContacts = realList; }
  } finally {
    console.log = realLog;
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test("BlobStore: cache-bypassing private reads, strict not-found handling, versioned and create-only writes", async () => {
  const calls: unknown[] = [];
  const docs = new Map<string, { body: string; etag: string }>();
  const uploadedAt = new Map<string, Date>();
  let failNextRead: number | null = null; let n = 0;
  class Pre extends Error { constructor() { super("precondition"); this.name = "BlobPreconditionFailedError"; } }
  const sdk: BlobSdk = {
    BlobPreconditionFailedError: Pre as never,
    async get(pathname: string, options: unknown) {
      calls.push(["get", pathname, options]);
      if (failNextRead !== null) { const code = failNextRead; failNextRead = null; return { statusCode: code, stream: null } as never; }
      const doc = docs.get(pathname);
      if (!doc) return null;
      return { statusCode: 200, stream: new Response(doc.body).body, headers: new Headers(), blob: { etag: doc.etag } } as never;
    },
    async put(pathname: string, body: unknown, options: { ifMatch?: string; allowOverwrite?: boolean }) {
      calls.push(["put", pathname, options]);
      const current = docs.get(pathname);
      if (options.ifMatch !== undefined) { if (!current || current.etag !== options.ifMatch) throw new Pre(); }
      else if (options.allowOverwrite === false && current) throw new Error(`blob already exists`);
      const etag = `"v${++n}"`; docs.set(pathname, { body: String(body), etag }); uploadedAt.set(pathname, new Date(1_000 * n)); return { etag } as never;
    },
    async del(pathname: string | string[], options?: { ifMatch?: string }) {
      calls.push(["del", pathname, options]);
      for (const p of [pathname].flat()) { if (options?.ifMatch !== undefined && docs.get(p)?.etag !== options.ifMatch) throw new Pre(); docs.delete(p); }
    },
    async list(options?: { prefix?: string }) { return { blobs: [...docs.keys()].filter((k) => k.startsWith(options?.prefix ?? "")).map((pathname) => ({ pathname, uploadedAt: uploadedAt.get(pathname) ?? new Date(0) })), hasMore: false } as never; },
  };
  const store = new BlobStore("nl", async () => sdk);
  const key = K("a@owner-test.example");
  assert.equal(await store.getContact(key), null);
  const contact: Contact = { email: "a@owner-test.example", status: "confirmed", createdAt: 1, confirmedAt: 2, unsubscribedAt: null, sendWindowStart: 1, sendCount: 1 };
  const v1 = await store.putContact(key, contact, { version: null });
  await assert.rejects(store.putContact(key, contact, { version: null }), ConflictError); // create-only refuses an existing key
  const read = await store.getContact(key);
  assert.deepEqual(read, { value: contact, version: v1 });
  await assert.rejects(store.putContact(key, { ...contact, sendCount: 9 }, { version: '"stale"' }), ConflictError);
  const v2 = await store.putContact(key, { ...contact, sendCount: 2 }, { version: v1 });
  assert.notEqual(v2, v1);
  assert.equal((await store.listContacts())[0].value.sendCount, 2);
  const put = calls.find((c) => (c as unknown[])[0] === "put") as unknown[];
  assert.equal(put[1], `nl/contacts/${key}.json`);
  assert.deepEqual(put[2], { access: "private", addRandomSuffix: false, contentType: "application/json", allowOverwrite: false });
  const get = calls.find((c) => (c as unknown[])[0] === "get") as unknown[];
  assert.deepEqual(get[2], { access: "private", useCache: false });
  failNextRead = 500;
  await assert.rejects(store.getContact(key), /returned 500/);
  // conditional delete (WEB-27 rollback) refuses a stale version and passes the ETag as ifMatch
  await assert.rejects(store.deleteContact(key, { version: v1 }), ConflictError);
  assert.equal((await store.getContact(key))!.value.sendCount, 2);
  await store.deleteContact(key, { version: v2 });
  assert.deepEqual(calls.at(-1), ["del", `nl/contacts/${key}.json`, { ifMatch: v2 }]);
  assert.equal(await store.getContact(key), null);
  await store.deleteContact(key); // unconditional delete of a missing key is a no-op
  // limiter counters live under their own prefix with the same conditional semantics
  const lv = await store.putLimit("bucket1", { count: 1, windowStart: 5 }, { version: null });
  assert.deepEqual(await store.getLimit("bucket1"), { value: { count: 1, windowStart: 5 }, version: lv });
  await assert.rejects(store.putLimit("bucket1", { count: 2, windowStart: 5 }, { version: null }), ConflictError);
  assert.equal((calls.findLast((c) => (c as unknown[])[0] === "put") as unknown[])[1], "nl/limits/bucket1.json");
  // WEB-28-S02: pruning removes only limiter documents older than the cut-off, by prefix, never contacts
  await store.putLimit("bucket2", { count: 1, windowStart: 5 }, { version: null });
  await store.putContact(key, contact, { version: null });
  const cutoff = uploadedAt.get("nl/limits/bucket2.json")!.getTime(); // bucket1 is older, bucket2 is not
  assert.equal(await store.pruneLimits(cutoff), 1);
  assert.equal(await store.getLimit("bucket1"), null);
  assert.notEqual(await store.getLimit("bucket2"), null);
  assert.notEqual(await store.getContact(key), null);
  assert.equal(await store.pruneLimits(cutoff), 0);
});

test("WEB-28-S02 counters stay bounded: the limiter sweeps stale documents on its own and the manual prune agrees", async () => {
  const d = deps();
  let t = 1_000_000; d.store.clock = () => t;
  const scheduled: (() => Promise<unknown>)[] = [];
  const limiter = new DurableLimiter(d.store, SECRET, 100, 1000, 5); // sweep every five admitted requests
  for (let i = 0; i < 4; i++) await limiter.allow(`198.51.100.${i}`, t, (w) => { scheduled.push(w); });
  assert.equal(scheduled.length, 0);
  t += 2 * 24 * 60 * 60 * 1000; // two days later a new client arrives; the four old documents are stale
  await limiter.allow("198.51.100.99", t, (w) => { scheduled.push(w); });
  assert.equal(scheduled.length, 1, "the fifth admitted request schedules a sweep");
  assert.equal(d.store.limits.size, 5);
  await scheduled[0]();
  assert.equal(d.store.limits.size, 1, "only the fresh document remains");
  assert.ok(d.store.limits.has(limiter.bucket("198.51.100.99")));
  // a returning client within the window keeps its single document and its count
  assert.equal(await limiter.allow("198.51.100.99", t + 10), true);
  assert.equal(d.store.limits.get(limiter.bucket("198.51.100.99"))!.value.count, 2);
  assert.equal(d.store.limits.size, 1);
  // the manual prune uses the same rule
  assert.equal(await d.store.pruneLimits(t + 1), 1);
  assert.equal(d.store.limits.size, 0);
  // a quiet instance sweeps by time as well: one request an hour later is enough
  const quiet = new DurableLimiter(d.store, SECRET, 100, 1000, 1_000_000);
  const quietSweeps: unknown[] = [];
  await quiet.allow("198.51.100.50", t, (w) => { quietSweeps.push(w); });
  await quiet.allow("198.51.100.50", t + 30 * 60 * 1000, (w) => { quietSweeps.push(w); });
  assert.equal(quietSweeps.length, 0);
  await quiet.allow("198.51.100.50", t + 61 * 60 * 1000, (w) => { quietSweeps.push(w); });
  assert.equal(quietSweeps.length, 1, "an hour without a sweep triggers one regardless of request count");
});

test("routes: fail-closed without configuration; with test doubles the full confirm and unsubscribe paths run over HTTP and GET never changes state", async () => {
  const sub = await import("../app/api/subscribe/route.ts");
  const conf = await import("../app/api/newsletter/confirm/route.ts");
  const unsub = await import("../app/api/newsletter/unsubscribe/route.ts");
  const { testDoubles } = await import("../lib/newsletter/runtime.ts");
  // unconfigured
  let res = await sub.POST(new Request(`${SITE}/api/subscribe`, { method: "POST", body: "{}" }));
  assert.equal(res.status, 503); assert.equal(res.headers.get("cache-control"), "no-store");
  res = await conf.GET(new Request(`${SITE}/api/newsletter/confirm?t=x`));
  assert.equal(res.status, 303); assert.ok(res.headers.get("location")!.endsWith("/newsletter/closed"));
  // configured with doubles
  const env = { NEWSLETTER_ENABLED: "1", NEWSLETTER_SIGNING_SECRET: SECRET, NEWSLETTER_FROM: "a <a@b.co>", RESEND_API_KEY: "re_x", BLOB_READ_WRITE_TOKEN: "vercel_blob_x", NEWSLETTER_ALLOWED_RECIPIENTS: "@owner-test.example", NEWSLETTER_TEST_DOUBLES: "1" };
  const saved = { ...process.env }; Object.assign(process.env, env);
  try {
    const origin = (await import("../lib/site.ts")).siteUrl;
    const json = (path: string, body: unknown) => new Request(`${origin}${path}`, { method: "POST", headers: { "content-type": "application/json", origin, "sec-fetch-site": "same-origin" }, body: JSON.stringify(body) });
    const t0 = Date.now();
    res = await sub.POST(json("/api/subscribe", { email: "r@owner-test.example" }));
    assert.equal(res.status, 202); assert.ok(Date.now() - t0 >= 380, "constant latency floor applied");
    const t1 = Date.now();
    const r2 = await sub.POST(json("/api/subscribe", { email: "stranger@gmail.example" }));
    assert.equal(r2.status, 202); assert.deepEqual(await r2.json(), await res.json()); assert.ok(Date.now() - t1 >= 380); // not-allowed reads the same
    await new Promise((r) => setTimeout(r, 20)); // the store write and the send run off the response path
    assert.equal(testDoubles.mailer.sent.length, 1);
    const token = tokenFrom(testDoubles.mailer);
    // GET renders the page (redirect to it) and changes nothing
    res = await conf.GET(new Request(`${origin}/api/newsletter/confirm?t=${encodeURIComponent(token)}`));
    assert.equal(res.status, 303); assert.ok(res.headers.get("location")!.includes("/newsletter/confirm?t="));
    assert.equal((await testDoubles.store.getContact(K("r@owner-test.example")))!.value.status, "pending");
    // POST confirms
    res = await conf.POST(json("/api/newsletter/confirm", { t: token }));
    assert.deepEqual(await res.json(), { state: "confirmed" });
    assert.equal((await testDoubles.store.getContact(K("r@owner-test.example")))!.value.status, "confirmed");
    // one-click unsubscribe POST with the token in the query, as mail clients send it
    const unsubToken = issueToken(SECRET, "unsubscribe", K("r@owner-test.example"), Date.now());
    res = await unsub.GET(new Request(`${origin}/api/newsletter/unsubscribe?t=${encodeURIComponent(unsubToken)}`));
    assert.equal(res.status, 303);
    assert.equal((await testDoubles.store.getContact(K("r@owner-test.example")))!.value.status, "confirmed");
    res = await unsub.POST(new Request(`${origin}/api/newsletter/unsubscribe?t=${encodeURIComponent(unsubToken)}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" }));
    assert.deepEqual(await res.json(), { state: "unsubscribed" });
    assert.equal((await testDoubles.store.getContact(K("r@owner-test.example")))!.value.status, "unsubscribed");
    // cross-origin and oversized
    assert.equal((await sub.POST(new Request(`${origin}/api/subscribe`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" }))).status, 403);
    assert.equal((await sub.POST(json("/api/subscribe", { email: "x".repeat(1100) }))).status, 400);
    // durable burst limit across requests on the same client key (the store is shared, not the handler instance)
    const fromClient = (ip: string, email: string) => new Request(`${origin}/api/subscribe`, { method: "POST", headers: { "content-type": "application/json", origin, "sec-fetch-site": "same-origin", "x-forwarded-for": ip }, body: JSON.stringify({ email }) });
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await sub.POST(fromClient("198.51.100.7", "b@owner-test.example"))).status);
    assert.deepEqual(codes, [202, 202, 202, 202, 202, 429, 429]);
    assert.equal((await sub.POST(fromClient("198.51.100.8", "b@owner-test.example"))).status, 202);
    // WEB-27-S03: a store outage on the POST endpoints is a retryable 503 with Retry-After, for the page and for one-click clients alike
    const realGet = testDoubles.store.getContact.bind(testDoubles.store);
    testDoubles.store.getContact = async () => { throw Object.assign(new Error("Vercel Blob: Service unavailable"), { name: "BlobServiceNotAvailable" }); };
    try {
      for (const r of [await conf.POST(json("/api/newsletter/confirm", { t: token })), await unsub.POST(new Request(`${origin}/api/newsletter/unsubscribe?t=${encodeURIComponent(unsubToken)}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" }))]) {
        assert.equal(r.status, 503); assert.equal(r.headers.get("retry-after"), "30"); assert.equal(r.headers.get("cache-control"), "no-store");
        assert.equal(((await r.json()) as { state: string }).state, "retry");
      }
      const shape = await retryLater().json() as { state: string; message: string };
      assert.equal(shape.state, "retry"); assert.ok(shape.message.length > 0);
    } finally { testDoubles.store.getContact = realGet; }
    assert.equal((await testDoubles.store.getContact(K("r@owner-test.example")))!.value.status, "unsubscribed", "an outage changes nothing");
  } finally {
    for (const k of Object.keys(env)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test("WEB-27-S02 timing-safe public replies: new, pending, confirmed and unknown addresses, and a provider outage, are indistinguishable at the route", async () => {
  const sub = await import("../app/api/subscribe/route.ts");
  const { testDoubles } = await import("../lib/newsletter/runtime.ts");
  const env = { NEWSLETTER_ENABLED: "1", NEWSLETTER_PUBLIC: "1", NEWSLETTER_SIGNING_SECRET: SECRET, NEWSLETTER_FROM: "a <a@b.co>", RESEND_API_KEY: "re_x", BLOB_READ_WRITE_TOKEN: "vercel_blob_x", NEWSLETTER_TEST_DOUBLES: "1" };
  const saved = { ...process.env }; Object.assign(process.env, env);
  const slowSend = testDoubles.mailer.send.bind(testDoubles.mailer);
  try {
    const origin = (await import("../lib/site.ts")).siteUrl;
    const post = (email: string, ip: string) => new Request(`${origin}/api/subscribe`, { method: "POST", headers: { "content-type": "application/json", origin, "sec-fetch-site": "same-origin", "x-forwarded-for": ip }, body: JSON.stringify({ email }) });
    // a slow provider (120 ms) must not show in the reply; neither must its outage
    testDoubles.mailer.send = async (m) => { await new Promise((r) => setTimeout(r, 120)); if (m.to.startsWith("outage")) throw new Error("provider down"); return slowSend(m); };
    const seeded = await sub.POST(post("confirmed@public.example", "192.0.2.1")); assert.equal(seeded.status, 202);
    await new Promise((r) => setTimeout(r, 200));
    await (await import("../lib/newsletter/flow.ts")).confirm({ store: testDoubles.store, mailer: testDoubles.mailer, config: { enabled: true, publicCollection: true, allowedRecipients: [], signingSecret: SECRET, from: "a <a@b.co>", replyTo: undefined, resendApiKey: "re_x", blobAuth: "token" as const }, siteUrl: origin, now: () => Date.now() }, tokenFrom(testDoubles.mailer));
    await sub.POST(post("pending@public.example", "192.0.2.2"));
    const cases = { newAddress: "fresh@public.example", pending: "pending@public.example", confirmed: "confirmed@public.example", outage: "outage@public.example" };
    const samples: Record<string, { status: number; body: string; ms: number }[]> = {};
    for (let round = 0; round < 4; round++) {
      for (const [name, email] of Object.entries(cases)) {
        const t = performance.now();
        const res = await sub.POST(post(email, `192.0.2.${10 + round}`)); // a fresh client key per round keeps the burst limiter out of the measurement
        (samples[name] ??= []).push({ status: res.status, body: await res.text(), ms: performance.now() - t });
      }
    }
    const all = Object.values(samples).flat();
    assert.ok(all.every((s) => s.status === 202 && s.body === all[0].body), "same status and body for every case");
    // medians rather than means, and a 100 ms tolerance, so a busy CI runner cannot fail this on scheduler noise (WEB-28)
    const median = (name: string) => { const v = samples[name].map((s) => s.ms).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
    const medians = Object.keys(cases).map(median);
    assert.ok(all.every((s) => s.ms >= 390), "every reply waits for the floor");
    assert.ok(Math.max(...medians) - Math.min(...medians) < 100, `medians within 100 ms of each other: ${medians.map((m) => m.toFixed(0)).join(", ")}`);
    await new Promise((r) => setTimeout(r, 300)); // let the deferred work settle before the next test
  } finally {
    testDoubles.mailer.send = slowSend;
    for (const k of Object.keys(env)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test("WEB-28-S03 bugs are not disguised as outages: the classifier and the POST wrappers", async () => {
  class BlobServiceNotAvailable extends Error { constructor() { super("Vercel Blob: Service unavailable"); this.name = "BlobServiceNotAvailable"; } }
  assert.equal(isOutage(new BlobServiceNotAvailable()), true);
  assert.equal(isOutage(new ConflictError("x")), true);
  assert.equal(isOutage(new TypeError("fetch failed")), true);
  assert.equal(isOutage(Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) })), true);
  assert.equal(isOutage(new Error("blob read of nl/contacts/x.json returned 503")), true);
  assert.equal(isOutage(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })), true);
  assert.equal(isOutage(new TypeError("terminated")), true);
  assert.equal(isOutage(new TypeError("Cannot read properties of undefined (reading 'status')")), false);
  assert.equal(isOutage(new RangeError("Invalid array length")), false);
  assert.equal(isOutage("string"), false);
  const conf = await import("../app/api/newsletter/confirm/route.ts");
  const unsub = await import("../app/api/newsletter/unsubscribe/route.ts");
  const { testDoubles } = await import("../lib/newsletter/runtime.ts");
  const env = { NEWSLETTER_ENABLED: "1", NEWSLETTER_SIGNING_SECRET: SECRET, NEWSLETTER_FROM: "a <a@b.co>", RESEND_API_KEY: "re_x", BLOB_READ_WRITE_TOKEN: "vercel_blob_x", NEWSLETTER_ALLOWED_RECIPIENTS: "@owner-test.example", NEWSLETTER_TEST_DOUBLES: "1" };
  const saved = { ...process.env }; Object.assign(process.env, env);
  const realGet = testDoubles.store.getContact.bind(testDoubles.store);
  const realError = console.error; const logged: string[] = []; console.error = (m: unknown) => { logged.push(String(m)); };
  try {
    const origin = (await import("../lib/site.ts")).siteUrl;
    const token = issueToken(SECRET, "confirm", K("bug@owner-test.example"), Date.now());
    const unsubToken = issueToken(SECRET, "unsubscribe", K("bug@owner-test.example"), Date.now());
    const post = (path: string, t: string) => new Request(`${origin}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t }) });
    // an outage answers 503 retry on both endpoints
    testDoubles.store.getContact = async () => { throw new BlobServiceNotAvailable(); };
    assert.equal((await conf.POST(post("/api/newsletter/confirm", token))).status, 503);
    assert.equal((await unsub.POST(post("/api/newsletter/unsubscribe", unsubToken))).status, 503);
    // a programming error surfaces as a failure, not a 503
    testDoubles.store.getContact = async () => { throw new TypeError("Cannot read properties of undefined (reading 'status')"); };
    await assert.rejects(conf.POST(post("/api/newsletter/confirm", token)), TypeError);
    await assert.rejects(unsub.POST(post("/api/newsletter/unsubscribe", unsubToken)), TypeError);
    // every failure is logged by error name only: no address, no token
    assert.equal(logged.length, 4);
    assert.ok(logged.every((l) => /^newsletter-store-failure op=(confirm|unsubscribe) class=(BlobServiceNotAvailable|TypeError) kind=(outage|bug)$/.test(l)), logged.join("|"));
    assert.ok(logged.every((l) => !l.includes("@") && !l.includes(token)));
  } finally {
    console.error = realError;
    testDoubles.store.getContact = realGet;
    for (const k of Object.keys(env)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test("WEB-28-S01 deferral is proven: a provider slower than the floor does not delay the reply, and the email is still sent", async () => {
  const sub = await import("../app/api/subscribe/route.ts");
  const { testDoubles } = await import("../lib/newsletter/runtime.ts");
  const env = { NEWSLETTER_ENABLED: "1", NEWSLETTER_SIGNING_SECRET: SECRET, NEWSLETTER_FROM: "a <a@b.co>", RESEND_API_KEY: "re_x", BLOB_READ_WRITE_TOKEN: "vercel_blob_x", NEWSLETTER_ALLOWED_RECIPIENTS: "@owner-test.example", NEWSLETTER_TEST_DOUBLES: "1" };
  const saved = { ...process.env }; Object.assign(process.env, env);
  const realSend = testDoubles.mailer.send.bind(testDoubles.mailer);
  try {
    const origin = (await import("../lib/site.ts")).siteUrl;
    testDoubles.mailer.send = async (m) => { await new Promise((r) => setTimeout(r, 1500)); return realSend(m); }; // far slower than MIN_RESPONSE_MS
    const before = testDoubles.mailer.sent.length;
    const t = performance.now();
    const res = await sub.POST(new Request(`${origin}/api/subscribe`, { method: "POST", headers: { "content-type": "application/json", origin, "sec-fetch-site": "same-origin", "x-forwarded-for": "203.0.113.200" }, body: JSON.stringify({ email: "slow@owner-test.example" }) }));
    const ms = performance.now() - t;
    assert.equal(res.status, 202);
    assert.ok(ms >= 390 && ms < 1100, `reply at the floor, not after the provider: ${ms.toFixed(0)} ms`);
    assert.equal(testDoubles.mailer.sent.length, before, "nothing sent yet when the reply left");
    await new Promise((r) => setTimeout(r, 1800));
    assert.equal(testDoubles.mailer.sent.length, before + 1, "the email went out after the reply");
    assert.equal((await testDoubles.store.getContact(K("slow@owner-test.example")))!.value.status, "pending");
  } finally {
    testDoubles.mailer.send = realSend;
    for (const k of Object.keys(env)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
