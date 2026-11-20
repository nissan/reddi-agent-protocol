jest.mock("server-only", () => ({}));

import type { Listing } from "@/lib/listings/listing-store";

const WALLET = "7Y6oUj3vCz7xqGmJmT7Q7m4mGkq3rq9t7u7Hq3iJ1dQp";
const OTHER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const MAINNET_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MAINNET_AUDD = "AUDDttiEpCydTm7joUMbYddm72jAWXZnCpPZtDoxqBSw";
const SERVICE_KEY = "test-service-role-key";
const ANON_KEY = "public-anon-key";

function listing(overrides: Partial<Listing> = {}): Listing {
  return {
    wallet: WALLET, displayName: "Fast summaries", endpointUrl: "https://provider.example/v1", declaredModels: [], capabilities: { taskTypes: ["summarize"], privacyModes: ["public", "secret"] },
    pricePerCallBaseUnits: "2500", priceInputPerMillionBaseUnits: "0", priceOutputPerMillionBaseUnits: "0", priceMint: DEVNET_USDC, network: "solana-devnet", status: "listed", healthStatus: "pass", lastSeenAt: new Date().toISOString(), updatedAt: "2026-11-20T00:00:00Z",
    ...overrides,
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    wallet: WALLET, display_name: "Fast summaries", endpoint_url: "https://provider.example/v1", declared_models: [], capabilities: { taskTypes: ["summarize"], privacyModes: ["public"] },
    price_per_call_base_units: 2500, price_mint: DEVNET_USDC, network: "solana-devnet", status: "listed", health_status: "pass", last_seen_at: new Date().toISOString(), updated_at: "2026-11-20T00:00:00Z",
    ...overrides,
  };
}

describe("database listings as the planner index (#740)", () => {
  const originalFetch = global.fetch;
  const env = { ...process.env };
  type Call = { url: string; init: { method: string; headers?: Record<string, string>; body?: string; redirect?: string } };

  beforeEach(() => {
    jest.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.example";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
    process.env.NETWORK_PROFILE = "devnet";
    delete process.env.CRON_SECRET;
  });
  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...env };
  });

  function mockServices(options: { rows?: unknown[]; readStatus?: number; patchStatus?: number; health?: Record<string, number | "throw"> } = {}) {
    const calls: Call[] = [];
    global.fetch = jest.fn(async (url: string, init: Call["init"]) => {
      calls.push({ url, init });
      if (url.includes("/rest/v1/providers") && init.method === "GET") {
        const status = options.readStatus ?? 200;
        return { ok: status < 300, status, json: async () => options.rows ?? [row()] };
      }
      if (url.includes("/rest/v1/providers") && init.method === "PATCH") {
        const status = options.patchStatus ?? 204;
        return { ok: status < 300, status, json: async () => ({}) };
      }
      const outcome = options.health?.[url] ?? 200;
      if (outcome === "throw") throw new Error("unreachable");
      return { ok: outcome >= 200 && outcome < 300, status: outcome, json: async () => ({}) };
    }) as unknown as typeof fetch;
    return calls;
  }

  it("states a dollar price only for a US dollar stablecoin on that network", async () => {
    const { listingPerCallUsd } = await import("@/lib/listings/listing-index");
    expect(listingPerCallUsd(listing())).toBe(0.0025);
    expect(listingPerCallUsd(listing({ network: "solana-mainnet", priceMint: MAINNET_USDC, pricePerCallBaseUnits: "1000000" }))).toBe(1);
    expect(listingPerCallUsd(listing({ priceMint: "SOL" }))).toBeUndefined();
    expect(listingPerCallUsd(listing({ network: "solana-mainnet", priceMint: MAINNET_AUDD }))).toBeUndefined();
    // A mainnet mint address proves nothing on devnet, where anyone can create a mint.
    expect(listingPerCallUsd(listing({ priceMint: MAINNET_USDC }))).toBeUndefined();
    expect(listingPerCallUsd(listing({ pricePerCallBaseUnits: "9".repeat(18) }))).toBeUndefined();
  });

  it("lists per-token prices in dollars per million tokens, and leaves out a zero per-job price", async () => {
    const { listingToIndexEntry } = await import("@/lib/listings/listing-index");
    const entry = listingToIndexEntry(listing({ pricePerCallBaseUnits: "0", priceInputPerMillionBaseUnits: "150000", priceOutputPerMillionBaseUnits: "600000" }));
    expect(entry.capabilities.pricing).toEqual({ baseUsd: 0, inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 });
    const sol = listingToIndexEntry(listing({ priceMint: "SOL", priceInputPerMillionBaseUnits: "150000" }));
    expect(sol.capabilities.pricing).toEqual({ baseUsd: 0 });
  });

  it("takes price, endpoint and health from the listing, not from what the owner wrote in capabilities", async () => {
    const { listingToIndexEntry } = await import("@/lib/listings/listing-index");
    const entry = listingToIndexEntry(listing({
      healthStatus: "unknown",
      capabilities: { taskTypes: ["summarize", 7], privacyModes: ["public", "secret"], pricing: { perCallUsd: 0 }, healthcheckStatus: "pass", attested: true, endpointUrl: "https://elsewhere.example" },
    }));
    expect(entry.capabilities.pricing).toEqual({ baseUsd: 0, perCallUsd: 0.0025 });
    expect(entry.healthcheckStatus).toBe("pending");
    expect(entry.attested).toBe(false);
    expect(entry.endpointUrl).toBe("https://provider.example/v1");
    expect(entry.capabilities.taskTypes).toEqual(["summarize"]);
    expect(entry.capabilities.privacyModes).toEqual(["public"]);
  });

  it("uses files when no database is configured, and never falls back to them when one is", async () => {
    mockServices({ readStatus: 500 });
    const { loadListingIndex } = await import("@/lib/listings/listing-index");
    expect(await loadListingIndex()).toEqual({ source: "database", available: false, entries: [] });
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(await loadListingIndex()).toEqual({ source: "files" });
  });

  it("routes only to listings the server has seen healthy", async () => {
    mockServices({ rows: [row({ health_status: "unknown" }), row({ wallet: OTHER })] });
    const { loadListingIndex } = await import("@/lib/listings/listing-index");
    const { routePlannerPolicy } = await import("@/lib/onboarding/planner-router");
    const index = await loadListingIndex();
    expect(index.source).toBe("database");
    const entries = index.source === "database" ? index.entries : [];
    const routed = routePlannerPolicy({ requiresHealthPass: true, maxPerCallUsd: 1 }, entries);
    expect(routed.selected?.walletAddress).toBe(OTHER);
    expect(routed.rejected).toEqual([{ walletAddress: WALLET, reasons: ["healthcheck pass required"] }]);
    expect(routePlannerPolicy({ requiresHealthPass: true }, []).selected).toBeNull();
  });

  it("records what the server observed at each listed endpoint, without following redirects", async () => {
    const calls = mockServices({
      rows: [row(), row({ wallet: OTHER, endpoint_url: "https://down.example/" })],
      health: { "https://down.example/healthz": 302 },
    });
    const { observeListedHealth } = await import("@/lib/listings/listing-health");
    const sweep = await observeListedHealth();
    expect(sweep).toEqual({ source: "database", available: true, checked: 2, passed: 1, failed: 1, unrecorded: 0 });
    const probes = calls.filter((c) => c.url.endsWith("/healthz"));
    expect(probes.map((c) => c.url).sort()).toEqual(["https://down.example/healthz", "https://provider.example/v1/healthz"]);
    expect(probes.every((c) => c.init.redirect === "manual")).toBe(true);
    expect(JSON.stringify(probes)).not.toContain(SERVICE_KEY);
    const patches = calls.filter((c) => c.init.method === "PATCH");
    const byWallet = Object.fromEntries(patches.map((c) => [c.url.split("wallet=eq.")[1], JSON.parse(c.init.body!).health_status]));
    expect(byWallet).toEqual({ [WALLET]: "pass", [OTHER]: "fail" });
    expect(Object.keys(JSON.parse(patches[0].init.body!)).sort()).toEqual(["health_status", "last_seen_at"]);
  });

  it("treats an unreachable endpoint as failed and a failed write as not recorded", async () => {
    mockServices({ health: { "https://provider.example/v1/healthz": "throw" }, patchStatus: 500 });
    const { observeListedHealth } = await import("@/lib/listings/listing-health");
    expect(await observeListedHealth()).toEqual({ source: "database", available: false, checked: 1, passed: 0, failed: 0, unrecorded: 1 });
  });

  it("lets only the scheduler trigger a sweep when a cron secret is set", async () => {
    const calls = mockServices();
    process.env.CRON_SECRET = "cron-secret-value";
    const { GET } = await import("@/app/api/cron/heartbeat/route");
    expect((await GET(new Request("https://app.example/api/cron/heartbeat"))).status).toBe(401);
    expect((await GET(new Request("https://app.example/api/cron/heartbeat", { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
    expect(calls).toHaveLength(0);
    const ok = await GET(new Request("https://app.example/api/cron/heartbeat", { headers: { authorization: "Bearer cron-secret-value" } }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, specialists_checked: 1 });
  });
});
