/**
 * /api/rpc cost limits (security audit round 1, S2-claude-05, condition C4).
 */
import { checkRpcBody } from "@/lib/rpc/proxy";
import { createRpcRateLimiter, rpcClientKey } from "@/lib/rpc/rate-limit";

const PROGRAM = "DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu";
const programs = new Set([PROGRAM]);
const scan = (id: number, config?: unknown) => ({ jsonrpc: "2.0", id, method: "getProgramAccounts", params: config === undefined ? [PROGRAM] : [PROGRAM, config] });

describe("getProgramAccounts through the proxy", () => {
  it.each([
    ["no config", undefined],
    ["no filters", { commitment: "confirmed" }],
    ["empty filters", { filters: [] }],
    ["a junk filter", { filters: [{ foo: 1 }] }],
    ["memcmp without bytes", { filters: [{ memcmp: { offset: 0 } }] }],
  ])("refuses %s", (_name, config) => {
    const result = checkRpcBody(JSON.stringify(scan(1, config)), programs);
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it("accepts a dataSize or memcmp filter and counts it as a scan", () => {
    expect(checkRpcBody(JSON.stringify(scan(1, { filters: [{ dataSize: 200 }] })), programs)).toMatchObject({ ok: true, calls: 1, scans: 1 });
    expect(checkRpcBody(JSON.stringify(scan(1, { filters: [{ memcmp: { offset: 0, bytes: "abc" } }] })), programs)).toMatchObject({ ok: true, scans: 1 });
  });

  it("allows one scan per request", () => {
    const batch = [scan(1, { filters: [{ dataSize: 200 }] }), scan(2, { filters: [{ dataSize: 200 }] })];
    expect(checkRpcBody(JSON.stringify(batch), programs)).toMatchObject({ ok: false, status: 413 });
  });

  it("counts batch calls", () => {
    const batch = Array.from({ length: 5 }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "getSlot" }));
    expect(checkRpcBody(JSON.stringify(batch), programs)).toMatchObject({ ok: true, calls: 5, scans: 0 });
  });
});

describe("rpc rate limiter", () => {
  it("limits calls and scans per client per window, and resets after the window", () => {
    let now = 0;
    const limiter = createRpcRateLimiter(() => now, { calls: 10, scans: 2, windowMs: 60_000 });
    expect(limiter.take("a", 10, 0).ok).toBe(true);
    expect(limiter.take("a", 1, 0)).toMatchObject({ ok: false, retryAfterSeconds: 60 });
    expect(limiter.take("b", 1, 0).ok).toBe(true);
    now = 30_000;
    expect(limiter.take("a", 1, 0)).toMatchObject({ ok: false, retryAfterSeconds: 30 });
    now = 60_000;
    expect(limiter.take("a", 1, 1).ok).toBe(true);
    expect(limiter.take("a", 1, 1).ok).toBe(true);
    expect(limiter.take("a", 1, 1).ok).toBe(false);
  });

  it("does not charge a refused request", () => {
    const limiter = createRpcRateLimiter(() => 0, { calls: 10, scans: 1, windowMs: 60_000 });
    expect(limiter.take("a", 20, 0).ok).toBe(false);
    expect(limiter.take("a", 10, 0).ok).toBe(true);
  });

  it("takes the platform's client address first", () => {
    expect(rpcClientKey(new Headers({ "x-vercel-forwarded-for": "1.2.3.4", "x-forwarded-for": "9.9.9.9" }))).toBe("1.2.3.4");
    expect(rpcClientKey(new Headers({ "x-real-ip": "5.6.7.8", "x-forwarded-for": "9.9.9.9" }))).toBe("5.6.7.8");
    expect(rpcClientKey(new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("9.9.9.9");
    expect(rpcClientKey(new Headers())).toBe("unknown");
  });
});

describe("POST /api/rpc", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    jest.resetModules();
  });

  it("answers 429 with retry-after once a client is over its limit, and never reaches upstream for it", async () => {
    const upstream = jest.fn(async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: 1 }), { headers: { "content-type": "application/json" } }));
    const originalFetch = global.fetch;
    global.fetch = upstream as unknown as typeof fetch;
    try {
      const { POST } = await import("@/app/api/rpc/route");
      const batch = JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "getSlot" })));
      const call = () =>
        POST(new Request("https://app.example/api/rpc", { method: "POST", headers: { origin: "https://app.example", "x-real-ip": "203.0.113.9", "content-type": "application/json" }, body: batch }));
      for (let i = 0; i < 15; i += 1) expect((await call()).status).toBe(200);
      const limited = await call();
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toBeTruthy();
      expect(upstream).toHaveBeenCalledTimes(15);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
