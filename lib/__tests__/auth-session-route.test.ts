jest.mock("server-only", () => ({}));

const WALLET = "7Y6oUj3vCz7xqGmJmT7Q7m4mGkq3rq9t7u7Hq3iJ1dQp";
const USER_ID = "3f2c1a7e-0b6d-4c1e-9a55-2f0f6a1d9b10";
const TOKEN = "b".repeat(40);
const SERVICE_KEY = "test-service-role-key";

describe("POST /api/auth/session (#740)", () => {
  const originalFetch = global.fetch;
  const env = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.example";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  });
  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...env };
  });

  function mockServices(profileStatus = 201) {
    const calls: Array<{ url: string; init: { method: string; headers: Record<string, string>; body?: string } }> = [];
    global.fetch = jest.fn(async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
      calls.push({ url, init });
      if (url.endsWith("/auth/v1/user")) {
        return { ok: true, status: 200, json: async () => ({ id: USER_ID, identities: [{ provider: "web3", provider_id: `web3:solana:${WALLET}` }] }) };
      }
      return { ok: profileStatus < 300, status: profileStatus, json: async () => ({}) };
    }) as unknown as typeof fetch;
    return calls;
  }

  async function post(headers: Record<string, string> = {}, body?: unknown) {
    const { POST } = await import("@/app/api/auth/session/route");
    return POST(new Request("https://app.example/api/auth/session", { method: "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  }

  it("refuses without a session and writes nothing", async () => {
    const calls = mockServices();
    const res = await post();
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("records the wallet the auth service vouches for, ignoring anything in the body", async () => {
    const calls = mockServices();
    const res = await post({ authorization: `Bearer ${TOKEN}` }, { wallet: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", user_id: "someone-else" });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, wallet: WALLET });
    const write = calls.find((c) => c.url.includes("/rest/v1/profiles"));
    expect(write).toBeDefined();
    expect(JSON.parse(write!.init.body!)).toEqual({ user_id: USER_ID, wallet: WALLET });
    expect(write!.init.headers.apikey).toBe(SERVICE_KEY);
    // The service key goes to the database only, never to the auth check or the browser.
    const authCall = calls.find((c) => c.url.endsWith("/auth/v1/user"))!;
    expect(JSON.stringify(authCall.init.headers)).not.toContain(SERVICE_KEY);
    expect(JSON.stringify(await (await post({ authorization: `Bearer ${TOKEN}` })).json())).not.toContain(SERVICE_KEY);
  });

  it("reports a wallet already linked elsewhere as a conflict", async () => {
    mockServices(409);
    const res = await post({ authorization: `Bearer ${TOKEN}` });
    expect(res.status).toBe(409);
  });

  it("is unavailable when the server has no database credentials", async () => {
    mockServices();
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await post({ authorization: `Bearer ${TOKEN}` });
    expect(res.status).toBe(503);
  });
});
