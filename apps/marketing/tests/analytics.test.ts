// WEB-17: consent mapping, the campaign allowlist, the taxonomy guard, the init options and withdrawal, against a
// fake PostHog. Nothing here touches the network. The browser-level proof is tests/analytics-gate.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { parseCampaign, allowedContent, safePath, referrerHost, isTokenRoute } from "../lib/analytics/campaign.ts";
import { EVENTS, PAGE_VIEW_EVENT, prepare, isEventName, ALL_PROPERTY_NAMES } from "../lib/analytics/taxonomy.ts";
import { readAnalyticsConfig, initOptions, persistenceFor } from "../lib/analytics/config.ts";
import { clearKeyedStorage, clearCookies, isAnalyticsKey } from "../lib/analytics/storage.ts";
import { createController, type PostHogLike } from "../lib/analytics/controller.ts";
import { capture, captureOutboundLink, setController } from "../lib/analytics/capture.ts";

const KEY = "phc_testkey000000";
const config = { key: KEY, host: "http://127.0.0.1:3093" };
const both = { product: true, acquisition: true };
const productOnly = { product: true, acquisition: false };
const acquisitionOnly = { product: false, acquisition: true };

// ------------------------------------------------------------------ S03: the allowlist
test("WEB-17-S03 allowlisted campaign values are kept", () => {
  assert.deepEqual(parseCampaign("?utm_source=x&utm_medium=organic_social&utm_campaign=launch_2026&utm_content=post_042"),
    { utm_source: "x", utm_medium: "organic_social", utm_campaign: "launch_2026", utm_content: "post_042" });
  for (const source of ["x", "linkedin", "youtube", "github", "newsletter", "superteam", "solana"]) assert.equal(parseCampaign(`?utm_source=${source}`).utm_source, source);
  assert.deepEqual(parseCampaign("?utm_source=newsletter&utm_medium=email&utm_campaign=sandbox_2026&utm_content=update_001"),
    { utm_source: "newsletter", utm_medium: "email", utm_campaign: "sandbox_2026", utm_content: "update_001" });
});

test("WEB-17-S03 unknown, personal-looking or over-long values are discarded, never trimmed into shape", () => {
  const cases = [
    "?utm_source=facebook", "?utm_source=X", "?utm_source=x%40example.com", "?utm_source=",
    "?utm_medium=cpc", "?utm_campaign=summer_sale", "?utm_campaign=launch_2026%20",
    "?utm_content=jane%40example.com", "?utm_content=post_jane@example.com", "?utm_content=other_001", "?utm_content=post_",
    "?utm_content=post_12345678901", "?utm_content=msg_0412345678", `?utm_content=post_${"a".repeat(40)}`, "?utm_content=POST_1", "?utm_content=post-1",
    "?utm_term=secret&gclid=abc&fbclid=def&ref=me",
  ];
  for (const query of cases) assert.deepEqual(parseCampaign(query), {}, query);
  // one bad value does not poison the good ones
  assert.deepEqual(parseCampaign("?utm_source=x&utm_content=jane@example.com"), { utm_source: "x" });
});

test("WEB-17-S03 a medium outside its source's row is discarded (only allowlisted combinations)", () => {
  assert.deepEqual(parseCampaign("?utm_source=x&utm_medium=email"), { utm_source: "x" });
  assert.deepEqual(parseCampaign("?utm_source=superteam&utm_medium=community"), { utm_source: "superteam", utm_medium: "community" });
  assert.deepEqual(parseCampaign("?utm_source=newsletter&utm_medium=organic_social"), { utm_source: "newsletter" });
});

test("content tokens: bounded pattern, bounded prefixes, short numeric tails allowed", () => {
  for (const ok of ["post_1", "video_a", "update_001", "msg_launch", `video_${"a".repeat(34)}`, "post_123456"]) assert.equal(allowedContent(ok), ok, ok);
  for (const bad of ["", "post", "post_", "x_post_1", "post_1234567", "msg_12_34_56_78", "video_a b", `video_${"a".repeat(35)}`]) assert.equal(allowedContent(bad), null, bad);
});

test("recorded URL is a plain path; referrer is a host only; token routes are recognised", () => {
  assert.equal(safePath("/updates/first-foundations"), "/updates/first-foundations");
  assert.equal(safePath("/newsletter/confirm?token=abc#x"), "/newsletter/confirm");
  assert.equal(safePath("/a/jane@example.com"), "/unknown");
  assert.equal(safePath("/" + "a".repeat(200)), "/unknown");
  assert.equal(referrerHost("https://t.co/abc?q=1#frag", "agent-protocol.reddi.tech"), "t.co");
  assert.equal(referrerHost("https://agent-protocol.reddi.tech/updates", "agent-protocol.reddi.tech"), undefined);
  assert.equal(referrerHost("not a url", "agent-protocol.reddi.tech"), undefined);
  assert.equal(referrerHost("", "agent-protocol.reddi.tech"), undefined);
  for (const route of ["/newsletter/confirm", "/newsletter/unsubscribe", "/newsletter/confirmed", "/newsletter"]) assert.ok(isTokenRoute(route), route);
  assert.ok(!isTokenRoute("/updates") && !isTokenRoute("/newsletters"));
});

// ------------------------------------------------------------------ taxonomy guard
test("the taxonomy lists the agreed events and every one is wired", () => {
  assert.deepEqual(Object.keys(EVENTS).sort(), ["outbound_link", "page_view", "signup_confirm_opened", "signup_confirmed", "signup_section_seen", "signup_submitted", "update_opened"]);
  assert.deepEqual(Object.entries(EVENTS).filter(([, e]) => e.wired).map(([n]) => n).sort(), ["outbound_link", "page_view", "signup_confirm_opened", "signup_confirmed", "signup_section_seen", "signup_submitted", "update_opened"]);
});

test("an event or property that is not in the taxonomy cannot be sent", () => {
  assert.equal(prepare("$autocapture", { path: "/" }, both, true), null);
  assert.equal(prepare("newsletter_request", { path: "/" }, both, true), null);
  assert.equal(prepare("constructor", {}, both, true), null);
  assert.equal(prepare("__proto__", {}, both, true), null);
  assert.ok(!isEventName("toString"));
  const sent = prepare("signup_submitted", { path: "/", outcome: "ok", email: "a@b.c", token: "t", text: "hello", url: "https://x.y/?q=1" }, both, false);
  assert.deepEqual(sent?.properties, { path: "/" }, "WEB-40: the server's answer has no property to travel in");
  // values are validated too: an address or free text in an allowed property is dropped
  assert.deepEqual(prepare("signup_submitted", { path: "jane@example.com" }, productOnly, false)?.properties, {});
  assert.deepEqual(prepare("outbound_link", { path: "/", host: "https://evil.example/?a=1" }, productOnly, false)?.properties, { path: "/" });
  assert.deepEqual(prepare("outbound_link", { path: "/?utm_source=x", host: "colosseum.com" }, productOnly, false)?.properties, { host: "colosseum.com" });
  // every property of every event is a declared one
  for (const event of Object.values(EVENTS)) for (const p of event.properties) assert.ok(ALL_PROPERTY_NAMES.includes(p));
  for (const forbidden of ["email", "token", "contact", "text", "url", "address", "query"]) assert.ok(!ALL_PROPERTY_NAMES.includes(forbidden), forbidden);
});

test("typed capture helpers do nothing without a controller", () => {
  setController(null);
  assert.equal(capture("page_view", { path: "/" }), false);
  assert.equal(captureOutboundLink({ host: "colosseum.com" }), false);
});

// ------------------------------------------------------------------ consent mapping
test("consent mapping: product only sends path-only page views and interactions, no campaign fields", () => {
  const props = { path: "/updates", utm_source: "x", utm_campaign: "launch_2026", referrer_host: "t.co" };
  assert.deepEqual(prepare("page_view", props, productOnly, true)?.properties, { path: "/updates" });
  assert.deepEqual(prepare("page_view", props, productOnly, false)?.properties, { path: "/updates" });
  assert.deepEqual(prepare("outbound_link", { path: "/", host: "colosseum.com" }, productOnly, false)?.properties, { path: "/", host: "colosseum.com" });
});

test("consent mapping: acquisition only sends the landing page view with campaign fields and nothing else", () => {
  const props = { path: "/", utm_source: "x", utm_campaign: "launch_2026", referrer_host: "t.co" };
  assert.deepEqual(prepare("page_view", props, acquisitionOnly, true)?.properties, props);
  assert.equal(prepare("page_view", props, acquisitionOnly, false), null, "later pages are product analytics");
  assert.equal(prepare("outbound_link", { path: "/", host: "colosseum.com" }, acquisitionOnly, true), null);
  assert.equal(prepare("signup_submitted", { path: "/" }, acquisitionOnly, true), null);
});

test("consent mapping: both sends campaign fields on page views; neither sends nothing", () => {
  const props = { path: "/", utm_source: "youtube", utm_medium: "video", referrer_host: "youtube.com" };
  assert.deepEqual(prepare("page_view", props, both, true)?.properties, props);
  assert.equal(prepare("page_view", props, { product: false, acquisition: false }, true), null);
});

test("persistence follows consent: memory for acquisition alone, localStorage with product, never a cookie", () => {
  assert.equal(persistenceFor(acquisitionOnly), "memory");
  assert.equal(persistenceFor(productOnly), "localStorage");
  assert.equal(persistenceFor(both), "localStorage");
});

// ------------------------------------------------------------------ configuration
test("analytics is inert without a valid key; the host must be https, or a loopback stub", () => {
  assert.equal(readAnalyticsConfig({}), null);
  assert.equal(readAnalyticsConfig({ key: "", host: "https://us.i.posthog.com" }), null);
  assert.equal(readAnalyticsConfig({ key: "not-a-key" }), null);
  assert.deepEqual(readAnalyticsConfig({ key: KEY }), { key: KEY, host: "https://us.i.posthog.com" });
  assert.deepEqual(readAnalyticsConfig({ key: KEY, host: "https://us.i.posthog.com/" }), { key: KEY, host: "https://us.i.posthog.com" });
  assert.deepEqual(readAnalyticsConfig({ key: KEY, host: "http://127.0.0.1:3093" }), { key: KEY, host: "http://127.0.0.1:3093" });
  assert.equal(readAnalyticsConfig({ key: KEY, host: "http://example.com" }), null);
  assert.equal(readAnalyticsConfig({ key: KEY, host: "javascript:alert(1)" }), null);
});

test("init options switch every optional feature off", () => {
  const o = initOptions(config, "localStorage", () => null);
  assert.equal(o.autocapture, false);
  assert.equal(o.capture_pageview, false, "automatic pageview capture stays off; the site sends $pageview itself after consent");
  assert.equal(o.capture_pageleave, false);
  assert.equal(o.disable_session_recording, true);
  assert.equal(o.disable_surveys, true);
  assert.equal(o.person_profiles, "identified_only");
  assert.equal(o.capture_heatmaps, false);
  assert.equal(o.capture_dead_clicks, false);
  assert.equal(o.capture_exceptions, false);
  assert.equal(o.disable_external_dependency_loading, true);
  assert.equal(o.advanced_disable_flags, true);
  assert.equal(o.save_campaign_params, false);
  assert.equal(o.request_batching, false);
  assert.equal(o.api_host, config.host);
  assert.ok(!("ip" in o), "ip handling is left to the project setting");
  assert.ok(o.persistence === "localStorage");
});

// ------------------------------------------------------------------ withdrawal and the controller
type Call = { op: string; args: unknown[] };
function fakePostHog() {
  const calls: Call[] = [];
  const sent: { event: string; properties: Record<string, unknown> }[] = [];
  let beforeSend: ((e: unknown) => unknown) | null = null;
  const ph: PostHogLike = {
    init(key, options) { calls.push({ op: "init", args: [key, options] }); beforeSend = options.before_send as (e: unknown) => unknown; },
    capture(event, properties) {
      calls.push({ op: "capture", args: [event, properties] });
      // PostHog adds its own properties, then calls before_send
      const decorated = { event, properties: { ...properties, token: KEY, distinct_id: "anon", $current_url: "https://agent-protocol.reddi.tech/?utm_source=jane@example.com", $referrer: "https://t.co/secret?x=1", $initial_referrer: "x", utm_term: "t", $set: { a: 1 }, $browser: "Chrome" } };
      const result = beforeSend?.(decorated) as { event: string; properties: Record<string, unknown> } | null;
      if (result) sent.push(result);
    },
    reset() { calls.push({ op: "reset", args: [] }); },
    set_config(options) { calls.push({ op: "set_config", args: [options] }); },
  };
  return { ph, calls, sent };
}

function harness() {
  const f = fakePostHog();
  let loads = 0;
  let clears = 0;
  const controller = createController({ config, load: async () => { loads++; return f.ph; }, clearStorage: () => { clears++; }, origin: "https://agent-protocol.reddi.tech", ownHost: "agent-protocol.reddi.tech" });
  return { ...f, controller, loads: () => loads, clears: () => clears };
}

test("WEB-17-S01 before any choice nothing is loaded, initialised or sent", async () => {
  const h = harness();
  h.controller.navigate("/", "?utm_source=x", "https://t.co/");
  await h.controller.apply(null);
  h.controller.navigate("/updates", "", "");
  assert.equal(h.loads(), 0, "the PostHog script is not even imported");
  assert.equal(h.calls.length, 0);
  assert.equal(h.controller.track("outbound_link", { host: "colosseum.com" }), false);
});

test("accepting both sends the landing page view with allowlisted campaign fields and strips everything else PostHog adds", async () => {
  const h = harness();
  h.controller.navigate("/", "?utm_source=x&utm_medium=organic_social&utm_campaign=launch_2026&utm_content=post_7&email=a@b.c&utm_term=q", "https://t.co/abc?z=1");
  await h.controller.apply(both);
  assert.equal(h.loads(), 1);
  assert.equal(h.sent.length, 1);
  const [event] = h.sent;
  assert.equal(event.event, "$pageview", "the page view travels under PostHog's own name");
  assert.deepEqual(event.properties, {
    token: KEY, distinct_id: "anon", $browser: "Chrome",
    path: "/", utm_source: "x", utm_medium: "organic_social", utm_campaign: "launch_2026", utm_content: "post_7", referrer_host: "t.co",
    $current_url: "https://agent-protocol.reddi.tech/", $pathname: "/", $host: "agent-protocol.reddi.tech",
  });
  const init = h.calls.find((c) => c.op === "init")!.args[1] as Record<string, unknown>;
  assert.equal(init.persistence, "localStorage");
  assert.equal(init.autocapture, false);
});

test("acquisition only: one landing event, memory persistence, nothing after navigation or outbound clicks", async () => {
  const h = harness();
  h.controller.navigate("/", "?utm_source=superteam&utm_medium=community", "");
  await h.controller.apply(acquisitionOnly);
  h.controller.navigate("/updates", "", "");
  h.controller.track("outbound_link", { host: "colosseum.com" });
  assert.deepEqual(h.sent.map((e) => e.properties.path), ["/"]);
  assert.equal(h.sent[0].properties.utm_source, "superteam");
  assert.equal((h.calls.find((c) => c.op === "init")!.args[1] as Record<string, unknown>).persistence, "memory");
});

test("product only: every page view without campaign fields, and outbound clicks with the host only", async () => {
  const h = harness();
  h.controller.navigate("/", "?utm_source=x", "https://t.co/");
  await h.controller.apply(productOnly);
  h.controller.navigate("/updates", "", "");
  h.controller.track("outbound_link", { host: "colosseum.com", href: "https://colosseum.com/arena?secret=1" });
  assert.deepEqual(h.sent.map((e) => [e.event, e.properties.path, e.properties.utm_source, e.properties.host, e.properties.href]), [["$pageview", "/", undefined, undefined, undefined], ["$pageview", "/updates", undefined, undefined, undefined], ["outbound_link", "/updates", undefined, "colosseum.com", undefined]]);
});

test("token routes: path only, no campaign fields, no query", async () => {
  const h = harness();
  h.controller.navigate("/newsletter/confirm", "?utm_source=newsletter&t=SECRET", "");
  await h.controller.apply(both);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].properties.path, "/newsletter/confirm");
  assert.equal(h.sent[0].properties.utm_source, undefined);
  assert.ok(!JSON.stringify(h.sent).includes("SECRET"));
  assert.equal(h.sent[0].properties.$current_url, "https://agent-protocol.reddi.tech/newsletter/confirm");
});

test("WEB-17-S02 withdrawal: capture stops at once, PostHog is reset and storage cleared, and nothing more is sent", async () => {
  const h = harness();
  h.controller.navigate("/", "", "");
  await h.controller.apply(both);
  assert.equal(h.sent.length, 1);
  const clearsBefore = h.clears();
  const withdrawing = h.controller.apply({ product: false, acquisition: false }); // not awaited: the gate must already be shut
  assert.equal(h.controller.track("outbound_link", { host: "colosseum.com" }), false, "synchronously refused");
  await withdrawing;
  assert.ok(h.clears() > clearsBefore);
  const ops = h.calls.map((c) => c.op);
  assert.ok(ops.includes("reset"));
  assert.deepEqual(h.calls.filter((c) => c.op === "set_config").at(-1)?.args[0], { persistence: "memory", disable_persistence: true });
  h.controller.navigate("/updates", "", "");
  h.controller.track("outbound_link", { host: "colosseum.com" });
  assert.equal(h.sent.length, 1, "no event after withdrawal");
  assert.equal(h.loads(), 1);
});

test("withdrawing one category keeps the other and drops the identifiers of the withdrawn one", async () => {
  const h = harness();
  h.controller.navigate("/", "?utm_source=x", "");
  await h.controller.apply(both);
  const clearsBefore = h.clears();
  await h.controller.apply(acquisitionOnly); // product withdrawn
  assert.ok(h.clears() > clearsBefore, "product identifiers cleared");
  assert.deepEqual(h.calls.filter((c) => c.op === "set_config").at(-1)?.args[0], { persistence: "memory", disable_persistence: false });
  h.controller.navigate("/updates", "", "");
  assert.equal(h.controller.track("outbound_link", { host: "colosseum.com" }), false);
  assert.deepEqual(h.sent.map((e) => e.properties.path), ["/"], "no product events after product is withdrawn");
});

test("re-accepting after withdrawal sends the current page once, without re-importing PostHog", async () => {
  const h = harness();
  h.controller.navigate("/", "", "");
  await h.controller.apply(productOnly);
  await h.controller.apply({ product: false, acquisition: false });
  await h.controller.apply(productOnly);
  assert.equal(h.loads(), 1);
  assert.equal(h.sent.length, 2);
  assert.deepEqual(h.calls.filter((c) => c.op === "set_config").at(-1)?.args[0], { persistence: "localStorage", disable_persistence: false });
});

test("a withdrawal that arrives while PostHog is still loading leaves it silent", async () => {
  const f = fakePostHog();
  let release: (value: PostHogLike) => void = () => {};
  const controller = createController({ config, load: () => new Promise<PostHogLike>((r) => { release = r; }), clearStorage: () => {}, origin: "https://agent-protocol.reddi.tech", ownHost: "agent-protocol.reddi.tech" });
  controller.navigate("/", "", "");
  const accepting = controller.apply(productOnly);
  await controller.apply({ product: false, acquisition: false });
  release(f.ph);
  await accepting;
  assert.equal(f.sent.length, 0);
  assert.equal(f.calls.filter((c) => c.op === "capture").length, 0);
});

test("the taxonomy keeps page_view as its internal name and maps it to the one $-named wire event", () => {
  assert.equal(PAGE_VIEW_EVENT, "$pageview");
  assert.deepEqual(Object.keys(EVENTS).filter((n) => n.startsWith("$")), [], "no taxonomy name starts with $");
  assert.ok(isEventName("page_view") && !isEventName("$pageview"));
});

test("PostHog's own events never leave: before_send refuses anything outside the taxonomy", async () => {
  const h = harness();
  h.controller.navigate("/", "", "");
  await h.controller.apply(both);
  const init = h.calls.find((c) => c.op === "init")!.args[1] as { before_send: (e: unknown) => unknown };
  // The one $-named event is $pageview, which this site sends itself (the internal name stays page_view); it passes only
  // with allowlisted properties, and a bare internal `page_view` name is not a wire name any more.
  assert.notEqual(init.before_send({ event: "$pageview", properties: { path: "/" } }), null, "$pageview, sent by us, passes");
  assert.equal((init.before_send({ event: "$pageview", properties: { path: "/", $current_url: "https://evil.example/?x=1", email: "a@b.c" } }) as { properties: Record<string, unknown> }).properties.$current_url, "https://agent-protocol.reddi.tech/", "the recorded URL is rebuilt from the path, never taken from the caller");
  for (const name of ["$autocapture", "$exception", "$feature_flag_called", "$snapshot", "$pageleave", "newsletter_request"]) assert.equal(init.before_send({ event: name, properties: { path: "/" } }), null, name);
});

// ------------------------------------------------------------------ clearing storage
test("clearing removes only PostHog keys and leaves the consent record", () => {
  const items = new Map<string, string>([["ph_phc_test_posthog", "1"], ["__ph_opt_in_out_phc_test", "1"], ["rap.consent", "{}"], ["other", "x"], ["POSTHOG_thing", "1"]]);
  const storage = { get length() { return items.size; }, key: (i: number) => [...items.keys()][i] ?? null, removeItem: (k: string) => { items.delete(k); } };
  const removed = clearKeyedStorage(storage);
  assert.deepEqual(removed.sort(), ["POSTHOG_thing", "__ph_opt_in_out_phc_test", "ph_phc_test_posthog"]);
  assert.deepEqual([...items.keys()].sort(), ["other", "rap.consent"]);
  assert.ok(isAnalyticsKey("ph_phc_x_posthog") && !isAnalyticsKey("rap.consent"));
});

test("clearing cookies expires analytics cookies on the host and its parent domains, and tolerates blocked storage", () => {
  const writes: string[] = [];
  const doc = { get cookie() { return "ph_phc_test_posthog=abc; theme=dark; __ph_x=1"; }, set cookie(v: string) { writes.push(v); } };
  assert.deepEqual(clearCookies(doc, "www.agent-protocol.reddi.tech"), ["ph_phc_test_posthog", "__ph_x"]);
  assert.ok(writes.some((w) => w.includes("domain=agent-protocol.reddi.tech")) && writes.every((w) => w.includes("expires=Thu, 01 Jan 1970")));
  assert.ok(!writes.some((w) => w.startsWith("theme")));
  const blocked = { get length(): number { throw new Error("blocked"); }, key: () => null, removeItem() {} };
  assert.deepEqual(clearKeyedStorage(blocked), []);
});

test("the build is inert without a key, and the choice names the provider's region only for PostHog's two public hosts", async () => {
  const { ANALYTICS_ENABLED, analyticsRegion } = await import("../lib/analytics/enabled.ts");
  assert.equal(ANALYTICS_ENABLED, false); // the test run sets no key
  assert.equal(analyticsRegion("https://us.i.posthog.com"), "United States");
  assert.equal(analyticsRegion("https://eu.i.posthog.com"), "European Union");
  assert.equal(analyticsRegion("http://127.0.0.1:9"), null);
  assert.equal(analyticsRegion(undefined), null);
});

test("update_opened carries the path and the update's slug only, and needs product consent", () => {
  assert.deepEqual(prepare("update_opened", { path: "/updates/devnet-sandbox-open", slug: "devnet-sandbox-open", title: "x" }, { product: true, acquisition: false }, false)?.properties, { path: "/updates/devnet-sandbox-open", slug: "devnet-sandbox-open" });
  assert.equal(prepare("update_opened", { path: "/updates/a", slug: "a" }, { product: false, acquisition: true }, true), null);
  assert.deepEqual(prepare("update_opened", { path: "/updates/a", slug: "Not A Slug" }, { product: true, acquisition: true }, false)?.properties, { path: "/updates/a" });
});

test("Vercel Web Analytics records the plain path and allowlisted campaign tags only, never a token", async () => {
  const { scrubVercelEvent } = await import("../lib/analytics/vercel.ts");
  const origin = "https://agent-protocol.reddi.tech";
  assert.deepEqual(scrubVercelEvent({ type: "pageview", url: `${origin}/?utm_source=x&utm_medium=organic_social&email=a@b.c#top` }), { type: "pageview", url: `${origin}/?utm_source=x&utm_medium=organic_social` });
  assert.deepEqual(scrubVercelEvent({ type: "pageview", url: `${origin}/newsletter/confirm?token=abc&utm_source=x` }), { type: "pageview", url: `${origin}/newsletter/confirm` });
  assert.equal(scrubVercelEvent({ type: "pageview", url: "nope" }), null);
});
