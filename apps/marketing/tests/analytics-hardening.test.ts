// WEB-46: analytics fails safe at the signup and consent edges. A throwing or rejecting analytics path never
// reaches the signup request, and nothing held on our side is sent after a withdrawal.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createController, type PostHogLike } from "../lib/analytics/controller.ts";
import { capture, captureSignupSubmitted, setController } from "../lib/analytics/capture.ts";
import { oncePerPageView, signupSubmitted } from "../lib/analytics/funnel.ts";

const config = { key: "phc_testkey000000", host: "http://127.0.0.1:3093" };
const productOnly = { product: true, acquisition: false };
const off = { product: false, acquisition: false };
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const tick = () => new Promise((r) => setTimeout(r, 5));

function fake(throwOnCapture = false) {
  const sent: string[] = [];
  const ph: PostHogLike = {
    init() {},
    capture(event) { if (throwOnCapture) throw new Error("library exploded"); sent.push(event); },
    reset() {}, set_config() {},
  };
  return { ph, sent };
}
const make = (load: () => Promise<PostHogLike>) => createController({ config, load, clearStorage: () => {}, origin: "https://agent-protocol.reddi.tech", ownHost: "agent-protocol.reddi.tech" });

// The form's submit logic in miniature: exactly the order Signup.tsx uses (analytics call, then the request).
async function submitLike(fetcher: () => Promise<string>) {
  try { signupSubmitted(); } catch { /* as in the component */ }
  return fetcher();
}

test("WEB-46-S01 a throwing controller, library or capture never interrupts the signup request", async () => {
  let requests = 0;
  const request = async () => { requests++; return "done"; };

  // 1. the controller itself throws from track()
  setController({ track() { throw new Error("controller exploded"); } } as never);
  assert.equal(captureSignupSubmitted(), false);
  assert.equal(await submitLike(request), "done");

  // 2. the library throws inside capture() under live product consent
  const f = fake(true);
  const c = make(async () => f.ph);
  setController(c);
  c.navigate("/", "", "");
  await c.apply(productOnly);
  assert.equal(signupSubmitted(), false);
  assert.equal(await submitLike(request), "done");

  // 3. the library cannot be loaded at all (blocked script): apply() resolves and later events are refused
  const blocked = make(async () => { throw new Error("blocked"); });
  setController(blocked);
  blocked.navigate("/", "", "");
  await assert.doesNotReject(blocked.apply(productOnly));
  assert.doesNotThrow(() => signupSubmitted());
  assert.equal(await submitLike(request), "done");

  // 4. no controller at all
  setController(null);
  assert.equal(await submitLike(request), "done");
  assert.equal(requests, 4, "the request was sent once per attempt, unchanged");
  assert.equal(capture("outbound_link", { host: "example.org" }), false);
});

test("WEB-46-S01 the signup component calls analytics before and independent of the request, guarded and never awaited", () => {
  const src = read("../components/Signup.tsx");
  const call = src.indexOf("signupSubmitted()");
  const request = src.indexOf('fetch("/api/subscribe"');
  assert.ok(call > 0 && request > call, "analytics call precedes the request");
  assert.match(src, /try \{ signupSubmitted\(\); \} catch/);
  assert.ok(!/await\s+signupSubmitted/.test(src));
  const analytics = read("../components/Analytics.tsx");
  assert.ok(!/void instance\.apply/.test(analytics), "apply() rejections are caught, not left unhandled");
});

test("WEB-46-S03 a withdrawal while the library is loading drops the queued event", async () => {
  const f = fake();
  let release: (p: PostHogLike) => void = () => {};
  const c = make(() => new Promise<PostHogLike>((r) => { release = r; }));
  c.navigate("/", "", "");
  const accepting = c.apply(productOnly);
  assert.equal(c.track("outbound_link", { host: "example.org" }), true, "queued under live consent");
  await c.apply(off);
  release(f.ph);
  await accepting;
  assert.deepEqual(f.sent, []);
  await c.apply(productOnly); // re-accepting later does not resurrect the dropped event
  assert.equal(f.sent.filter((e) => e === "outbound_link").length, 0);
});

test("WEB-46-S03 (A8) a moment before acceptance is not remembered: accepting, withdrawing and accepting again sends nothing for it", async () => {
  const f = fake();
  const c = make(async () => f.ph);
  setController(c);
  c.navigate("/", "", "");
  try {
    const once = oncePerPageView(() => captureSignupSubmitted());
    assert.equal(once.happened(), false, "no consent yet: refused, nothing held");
    assert.equal(once.isDone(), false);
    const accepting = c.apply(productOnly);
    const withdrawing = c.apply(off);
    await Promise.all([accepting, withdrawing]);
    await tick();
    assert.deepEqual(f.sent, [], "nothing is sent after the withdrawal");
    await c.apply(productOnly); // accepting again must not send the moment from before any choice
    await tick();
    assert.equal(f.sent.filter((e) => e === "signup_submitted").length, 0, "the earlier moment is not resurrected");
  } finally {
    setController(null);
  }
});

test("WEB-46-S03 consent is re-checked at the moment of sending: an event after withdrawal is refused", async () => {
  const f = fake();
  const c = make(async () => f.ph);
  c.navigate("/", "", "");
  await c.apply(productOnly);
  f.sent.length = 0;
  const withdrawing = c.apply(off); // not awaited: the gate is already shut
  assert.equal(c.track("outbound_link", { host: "example.org" }), false);
  await withdrawing;
  assert.deepEqual(f.sent, []);
});
