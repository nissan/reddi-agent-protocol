// The app's visitor measurement: ids are scrubbed from every recorded path, the PostHog taxonomy guard, consent
// gating and withdrawal against a fake PostHog, and the Vercel Web Analytics hook. Nothing here touches the network.
import { UTM_CAMPAIGNS, UTM_CONTENT_PREFIXES, UTM_MEDIUMS, UTM_SOURCES, SOURCE_MEDIUMS, isTokenRoute, safePath } from "../campaign";
import * as marketingCampaign from "../../../apps/marketing/lib/analytics/campaign";
import { EVENTS, prepare } from "../taxonomy";
import { createController, type PostHogLike } from "../controller";
import { capture, captureOutboundLink, setController } from "../capture";
import { scrubVercelEvent } from "../vercel";
import { readAnalyticsConfig, initOptions } from "../config";

const KEY = "phc_testkey000000";
const config = { key: KEY, host: "http://127.0.0.1:3093" };
const ORIGIN = "https://app.agent-protocol.reddi.tech";
const HOST = "app.agent-protocol.reddi.tech";
const WALLET = "5CsBuTBFKu12JSs4CUbmv5MR218RYtNmAoQmLf5x3Hxe";
const SIGNATURE = "3yZe7d4pJ9xYbWQx5q6M2s8u7Hn1kTzvR4fLcA9gE2wPmN5bV8cX1zQ7jK3hG6tY4rU2iO9pL5aS8dF3gH7jK1l";

describe("safePath", () => {
  it("replaces wallet addresses, signatures, UUIDs, hex, long numbers and keys with :id", () => {
    expect(safePath(`/agents/${WALLET}`)).toBe("/agents/:id");
    expect(safePath(`/runs/${SIGNATURE.slice(0, 80)}`)).toBe("/runs/:id");
    expect(safePath("/app/runs/7f3c2a10-1b2c-4d5e-8f90-a1b2c3d4e5f6")).toBe("/app/runs/:id");
    expect(safePath("/app/agents/0123456789abcdef0123")).toBe("/app/agents/:id");
    expect(safePath("/agents/candidates/123456")).toBe("/agents/candidates/:id");
    expect(safePath("/budget/rap_budget_AbCdEf123456789")).toBe("/budget/:id");
    expect(safePath("/x/aB3dE5fG7hJ9kL")).toBe("/x/:id");
  });

  it("keeps the app's own route names", () => {
    for (const path of ["/", "/budget", "/budget/new", "/agent-setup", "/judge-replication", "/agents/candidates", "/sandbox", "/whitepaper", "/circle-x402", "/mcp-bridge-demo", "/leaderboard"]) {
      expect(safePath(path)).toBe(path);
    }
  });

  it("never keeps a query string or fragment, and rejects odd characters", () => {
    expect(safePath("/pass?key=rap_pass_secret")).toBe("/pass");
    expect(safePath("/budget#token")).toBe("/budget");
    expect(safePath("/a b")).toBe("/unknown");
    expect(safePath("/jane@example.com")).toBe("/unknown");
    expect(safePath("")).toBe("/unknown");
  });

  it("treats /pass like the newsletter links: no campaign fields are read there", () => {
    expect(isTokenRoute("/pass")).toBe(true);
    expect(isTokenRoute("/budget")).toBe(false);
  });
});

it("the campaign allowlist is the same as the marketing site's", () => {
  expect(UTM_SOURCES).toEqual(marketingCampaign.UTM_SOURCES);
  expect(UTM_MEDIUMS).toEqual(marketingCampaign.UTM_MEDIUMS);
  expect(UTM_CAMPAIGNS).toEqual(marketingCampaign.UTM_CAMPAIGNS);
  expect(UTM_CONTENT_PREFIXES).toEqual(marketingCampaign.UTM_CONTENT_PREFIXES);
  expect(SOURCE_MEDIUMS).toEqual(marketingCampaign.SOURCE_MEDIUMS);
});

describe("taxonomy", () => {
  it("lists only page views and outbound links", () => {
    expect(Object.keys(EVENTS).sort()).toEqual(["outbound_link", "page_view"]);
  });

  it("refuses unknown events and properties, and a path that still holds an address", () => {
    const both = { product: true, acquisition: true };
    expect(prepare("wallet_connected", { path: "/" }, both, true)).toBeNull();
    expect(prepare("page_view", { path: "/", wallet: WALLET, email: "a@b.c" }, both, true)).toEqual({ name: "page_view", properties: { path: "/" } });
    expect(prepare("page_view", { path: `/agents/${WALLET}@x` }, both, true)).toEqual({ name: "page_view", properties: {} });
    expect(prepare("page_view", { path: "/agents/:id" }, both, true)).toEqual({ name: "page_view", properties: { path: "/agents/:id" } });
  });
});

function harness() {
  const sent: { event: string; properties: Record<string, unknown> }[] = [];
  let beforeSend: ((e: unknown) => unknown) | undefined;
  let loads = 0;
  let clears = 0;
  const init: Record<string, unknown>[] = [];
  const ph: PostHogLike = {
    init(_key, options) { init.push(options); beforeSend = options.before_send as (e: unknown) => unknown; },
    capture(event, properties) {
      const decorated = { event, properties: { ...properties, token: KEY, distinct_id: "anon", $current_url: `${ORIGIN}/agents/${WALLET}?key=secret`, $referrer: "https://t.co/x", $browser: "Chrome" } };
      const result = beforeSend?.(decorated) as { event: string; properties: Record<string, unknown> } | null;
      if (result) sent.push(result);
    },
    reset() {},
    set_config() {},
  };
  const controller = createController({ config, load: async () => { loads++; return ph; }, clearStorage: () => { clears++; }, origin: ORIGIN, ownHost: HOST });
  return { controller, sent, init, loads: () => loads, clears: () => clears };
}

describe("PostHog controller in the app", () => {
  it("loads and sends nothing before a choice", async () => {
    const h = harness();
    h.controller.navigate(`/agents/${WALLET}`, "?utm_source=x", "https://t.co/");
    await h.controller.apply(null);
    expect(h.loads()).toBe(0);
    expect(h.sent).toHaveLength(0);
    expect(h.controller.track("outbound_link", { host: "solana.com" })).toBe(false);
  });

  it("after acceptance, a page view carries the scrubbed path and the recorded URL never holds the address or query", async () => {
    const h = harness();
    h.controller.navigate(`/agents/${WALLET}`, "?utm_source=x&utm_medium=organic_social&key=rap_pass_secret", "https://t.co/abc");
    await h.controller.apply({ product: true, acquisition: true });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].event).toBe("$pageview");
    expect(h.sent[0].properties).toEqual({
      token: KEY, distinct_id: "anon", $browser: "Chrome",
      path: "/agents/:id", utm_source: "x", utm_medium: "organic_social", referrer_host: "t.co",
      $current_url: `${ORIGIN}/agents/:id`, $pathname: "/agents/:id", $host: HOST,
    });
    expect(JSON.stringify(h.sent)).not.toContain(WALLET);
    expect(h.init[0].autocapture).toBe(false);
    expect(h.init[0].disable_session_recording).toBe(true);
  });

  it("withdrawal stops capture and clears storage", async () => {
    const h = harness();
    h.controller.navigate("/budget", "", "");
    await h.controller.apply({ product: true, acquisition: false });
    setController(h.controller);
    expect(captureOutboundLink({ host: "solana.com" })).toBe(true);
    await h.controller.apply(null);
    expect(h.clears()).toBeGreaterThan(0);
    expect(capture("outbound_link", { host: "solana.com" })).toBe(false);
    setController(null);
    expect(h.sent.map((e) => e.event)).toEqual(["$pageview", "outbound_link"]);
  });
});

it("is inert without a valid key and switches every optional PostHog feature off", () => {
  expect(readAnalyticsConfig({})).toBeNull();
  expect(readAnalyticsConfig({ key: "nope" })).toBeNull();
  const options = initOptions(readAnalyticsConfig({ key: KEY })!, "memory", (e) => e);
  expect(options).toMatchObject({ autocapture: false, capture_pageview: false, disable_session_recording: true, persistence: "memory" });
});

describe("Vercel Web Analytics hook", () => {
  it("keeps the scrubbed path and allowlisted campaign tags only", () => {
    expect(scrubVercelEvent({ type: "pageview", url: `${ORIGIN}/agents/${WALLET}?utm_source=x&utm_medium=organic_social&key=secret#frag` }))
      .toEqual({ type: "pageview", url: `${ORIGIN}/agents/:id?utm_source=x&utm_medium=organic_social` });
    expect(scrubVercelEvent({ type: "pageview", url: `${ORIGIN}/budget?address=${WALLET}` })).toEqual({ type: "pageview", url: `${ORIGIN}/budget` });
  });

  it("reads no campaign tags on token routes and drops an unreadable URL", () => {
    expect(scrubVercelEvent({ type: "pageview", url: `${ORIGIN}/pass?utm_source=x&key=rap_pass_secret` })).toEqual({ type: "pageview", url: `${ORIGIN}/pass` });
    expect(scrubVercelEvent({ type: "pageview", url: "not a url" })).toBeNull();
  });
});
