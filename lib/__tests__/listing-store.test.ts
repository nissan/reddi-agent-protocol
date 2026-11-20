jest.mock("server-only", () => ({}));

import { listingNetworkForProfile, validateListingInput } from "@/lib/listings/listing-store";

const WALLET = "7Y6oUj3vCz7xqGmJmT7Q7m4mGkq3rq9t7u7Hq3iJ1dQp";
const OTHER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const USER_ID = "3f2c1a7e-0b6d-4c1e-9a55-2f0f6a1d9b10";
const TOKEN = "b".repeat(40);
const SERVICE_KEY = "test-service-role-key";
const ANON_KEY = "public-anon-key";
const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const VALID = { displayName: "Fast summaries", endpointUrl: "https://provider.example/v1", declaredModels: ["meta/llama-3.3-70b"], pricePerCallBaseUnits: "2500", priceMint: MINT, status: "listed" };

function row(overrides: Record<string, unknown> = {}) {
  return {
    wallet: WALLET, display_name: "Fast summaries", endpoint_url: "https://provider.example/v1", declared_models: ["meta/llama-3.3-70b"], capabilities: {},
    price_per_call_base_units: 2500, price_mint: MINT, network: "solana-devnet", status: "listed", health_status: "unknown", last_seen_at: null, updated_at: "2026-11-20T00:00:00Z",
    ...overrides,
  };
}

describe("listing input checks (#740)", () => {
  it("accepts a well-formed listing and defaults to a draft", () => {
    const rest: Record<string, unknown> = { ...VALID };
    delete rest.status;
    const checked = validateListingInput(rest);
    expect(checked).toMatchObject({ ok: true, input: { status: "draft", pricePerCallBaseUnits: "2500", capabilities: {} } });
  });

  it("drops fields an owner may not set", () => {
    const checked = validateListingInput({ ...VALID, wallet: OTHER, owner_user_id: "x", network: "solana-mainnet", health_status: "pass", healthStatus: "pass", last_seen_at: "now" });
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(Object.keys(checked.input).sort()).toEqual(["capabilities", "declaredModels", "displayName", "endpointUrl", "priceMint", "pricePerCallBaseUnits", "status"]);
  });

  it.each([
    ["an empty name", { displayName: "  " }],
    ["a long name", { displayName: "n".repeat(81) }],
    ["a plain http endpoint", { endpointUrl: "http://provider.example" }],
    ["an endpoint with credentials", { endpointUrl: "https://user:pass@provider.example" }],
    ["a script endpoint", { endpointUrl: "javascript:alert(1)" }],
    ["an IP address endpoint", { endpointUrl: "https://169.254.169.254/latest" }],
    ["an IPv6 endpoint", { endpointUrl: "https://[::1]/v1" }],
    ["a localhost endpoint", { endpointUrl: "https://localhost/v1" }],
    ["a single-label endpoint", { endpointUrl: "https://intranet/v1" }],
    ["an internal-looking endpoint", { endpointUrl: "https://db.prod.internal/v1" }],
    ["a numeric price", { pricePerCallBaseUnits: 2500 }],
    ["a fractional price", { pricePerCallBaseUnits: "2.5" }],
    ["a negative price", { pricePerCallBaseUnits: "-1" }],
    ["an exponent price", { pricePerCallBaseUnits: "1e6" }],
    ["a price beyond a 64-bit integer", { pricePerCallBaseUnits: "9".repeat(19) }],
    ["an unknown currency", { priceMint: "USDC" }],
    ["the removed status", { status: "removed" }],
    ["too many models", { declaredModels: Array.from({ length: 21 }, (_, i) => `m${i}`) }],
    ["a model name with markup", { declaredModels: ["<b>x</b>"] }],
    ["array capabilities", { capabilities: [] }],
    ["oversized capabilities", { capabilities: { blob: "x".repeat(17000) } }],
  ])("refuses %s", (_name, change) => {
    expect(validateListingInput({ ...VALID, ...change })).toMatchObject({ ok: false, code: "invalid_listing" });
  });

  it("refuses a body that is not an object", () => {
    expect(validateListingInput(null).ok).toBe(false);
    expect(validateListingInput([VALID]).ok).toBe(false);
  });

  it("has no listing network for a local profile", () => {
    expect(listingNetworkForProfile("devnet")).toBe("solana-devnet");
    expect(listingNetworkForProfile("mainnet")).toBe("solana-mainnet");
    expect(listingNetworkForProfile("local-surfpool")).toBeUndefined();
  });
});

describe("listing routes (#740)", () => {
  const originalFetch = global.fetch;
  const env = { ...process.env };
  type Call = { url: string; init: { method: string; headers: Record<string, string>; body?: string } };

  beforeEach(() => {
    jest.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.example";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
    process.env.NETWORK_PROFILE = "devnet";
  });
  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...env };
  });

  function mockServices(options: { existing?: unknown[]; saved?: unknown; saveStatus?: number; listed?: unknown; readStatus?: number } = {}) {
    const calls: Call[] = [];
    global.fetch = jest.fn(async (url: string, init: Call["init"]) => {
      calls.push({ url, init });
      if (url.endsWith("/auth/v1/user")) {
        return { ok: true, status: 200, json: async () => ({ id: USER_ID, user_metadata: { wallet: OTHER }, identities: [{ provider: "web3", provider_id: `web3:solana:${WALLET}` }] }) };
      }
      if (init.method === "POST") {
        const status = options.saveStatus ?? 201;
        return { ok: status < 300, status, json: async () => options.saved ?? [row()] };
      }
      if (url.includes("select=network,status")) return { ok: true, status: 200, json: async () => options.existing ?? [] };
      const status = options.readStatus ?? 200;
      return { ok: status < 300, status, json: async () => options.listed ?? [row()] };
    }) as unknown as typeof fetch;
    return calls;
  }

  async function put(body: unknown, headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }) {
    const { PUT } = await import("@/app/api/listings/route");
    return PUT(new Request("https://app.example/api/listings", { method: "PUT", headers, body: typeof body === "string" ? body : JSON.stringify(body) }));
  }

  it("refuses a save without a session and writes nothing", async () => {
    const calls = mockServices();
    const res = await put(VALID, {});
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("saves under the signed-in wallet, whatever the body claims", async () => {
    const calls = mockServices();
    const res = await put({ ...VALID, wallet: OTHER, walletAddress: OTHER, owner_user_id: "someone-else", network: "solana-mainnet", health_status: "pass" });
    expect(res.status).toBe(200);
    const write = calls.find((c) => c.init.method === "POST")!;
    const sent = JSON.parse(write.init.body!);
    expect(sent).toEqual({
      wallet: WALLET, owner_user_id: USER_ID, display_name: "Fast summaries", endpoint_url: "https://provider.example/v1", declared_models: ["meta/llama-3.3-70b"],
      capabilities: {}, price_per_call_base_units: "2500", price_mint: MINT, network: "solana-devnet", status: "listed",
    });
    expect(write.url).not.toContain(OTHER);
    expect(write.url).not.toContain("owner_user_id,");
    const body = await res.json();
    expect(body.listing).toMatchObject({ wallet: WALLET, pricePerCallBaseUnits: "2500", network: "solana-devnet" });
    expect(JSON.stringify(body)).not.toContain(SERVICE_KEY);
    expect(JSON.stringify(body)).not.toContain(USER_ID);
  });

  it("refuses an invalid listing before touching the database", async () => {
    const calls = mockServices();
    const res = await put({ ...VALID, endpointUrl: "http://provider.example" });
    expect(res.status).toBe(400);
    expect(calls.filter((c) => c.url.includes("/rest/v1/"))).toHaveLength(0);
  });

  it("refuses a body that is not JSON", async () => {
    mockServices();
    expect((await put("not json")).status).toBe(400);
  });

  it("does not let an owner bring back a removed listing", async () => {
    const calls = mockServices({ existing: [{ network: "solana-devnet", status: "removed" }] });
    const res = await put(VALID);
    expect(res.status).toBe(403);
    expect(calls.some((c) => c.init.method === "POST")).toBe(false);
  });

  it("does not move a listing to another network", async () => {
    const calls = mockServices({ existing: [{ network: "solana-mainnet", status: "listed" }] });
    const res = await put(VALID);
    expect(res.status).toBe(400);
    expect(calls.some((c) => c.init.method === "POST")).toBe(false);
  });

  it("reports a database failure as unavailable, not as saved", async () => {
    mockServices({ saveStatus: 500 });
    expect((await put(VALID)).status).toBe(503);
  });

  it("is unavailable on a local profile and without server credentials", async () => {
    mockServices();
    process.env.NETWORK_PROFILE = "local-surfpool";
    expect((await put(VALID)).status).toBe(503);
    process.env.NETWORK_PROFILE = "devnet";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    jest.resetModules();
    expect((await put(VALID)).status).toBe(503);
  });

  it("reads public listings with the public key and returns only listed rows for this network", async () => {
    const calls = mockServices({ listed: [row(), row({ wallet: OTHER, status: "draft" }), row({ wallet: OTHER, network: "solana-mainnet" }), row({ wallet: "bad" }), row({ wallet: OTHER, price_per_call_base_units: 1.5 })] });
    const { GET } = await import("@/app/api/listings/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.listings.map((l: { wallet: string }) => l.wallet)).toEqual([WALLET]);
    const read = calls[0];
    expect(read.url).toContain("status=eq.listed");
    expect(read.url).toContain("network=eq.solana-devnet");
    expect(read.url).not.toContain("owner_user_id");
    expect(read.init.headers.apikey).toBe(ANON_KEY);
    expect(JSON.stringify(read.init.headers)).not.toContain(SERVICE_KEY);
  });

  it("reports a failed public read as unavailable", async () => {
    mockServices({ readStatus: 500 });
    const { GET } = await import("@/app/api/listings/route");
    expect((await GET()).status).toBe(503);
  });

  it("returns only the signed-in wallet's own listing", async () => {
    const calls = mockServices({ listed: [row({ status: "draft" })] });
    const { GET } = await import("@/app/api/listings/mine/route");
    const res = await GET(new Request("https://app.example/api/listings/mine?wallet=" + OTHER, { headers: { authorization: `Bearer ${TOKEN}` } }));
    expect(res.status).toBe(200);
    expect((await res.json()).listing).toMatchObject({ wallet: WALLET, status: "draft" });
    const read = calls.find((c) => c.url.includes("/rest/v1/providers"))!;
    expect(read.url).toContain(`wallet=eq.${WALLET}`);
    expect(read.url).not.toContain(OTHER);
  });

  it("refuses the own-listing read without a session", async () => {
    const calls = mockServices();
    const { GET } = await import("@/app/api/listings/mine/route");
    expect((await GET(new Request("https://app.example/api/listings/mine"))).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});
