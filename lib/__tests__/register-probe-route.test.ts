// Endpoints are fetched through the outbound guard, which resolves the host first.
// Test hosts resolve to a public address here; the guard itself is tested in outbound-guard.test.ts.
jest.mock("dns/promises", () => ({ lookup: jest.fn(async () => [{ address: "93.184.215.14", family: 4 }]) }));
// The pinned transport (undici with a fixed lookup) is tested in outbound-guard.test.ts; here it
// hands the request to the suite's global fetch mock.
jest.mock("undici", () => ({
  Agent: class { close() { return Promise.resolve(); } destroy() { return Promise.resolve(); } },
  fetch: (url: string, init: RequestInit) => globalThis.fetch(url, init),
}));

import { NextRequest } from "next/server";

describe("register probe route", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("blocks private-network targets in hosted context", async () => {
    const { POST } = await import("@/app/api/register/probe/route");
    const req = new NextRequest("http://localhost/api/register/probe", {
      method: "POST",
      body: JSON.stringify({ endpoint: "http://192.168.1.10:11434" }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req as unknown as Request);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      status: "invalid_url",
    });
  });

  it("allows Cloudflare tunnel endpoints when endpoint checks pass", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: "qwen3:8b" }] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 402,
        headers: { get: (name: string) => (name.toLowerCase() === "x402-request" ? "{}" : null) },
      }) as unknown as typeof fetch;

    const { POST } = await import("@/app/api/register/probe/route");
    const req = new NextRequest("http://localhost/api/register/probe", {
      method: "POST",
      body: JSON.stringify({ endpoint: "https://abc.trycloudflare.com" }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req as unknown as Request);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      status: "ollama_detected",
      securityStatus: "x402_challenge_detected",
    });
  });

  it("rejects malformed sourceAdapter manifests with actionable errors", async () => {
    const { POST } = await import("@/app/api/register/probe/route");
    const req = new NextRequest("http://localhost/api/register/probe", {
      method: "POST",
      body: JSON.stringify({
        endpoint: "https://demo.reddi.tech",
        sourceAdapter: {
          version: "source-adapter.v1",
          source: "openclaw",
          role: "attestor",
          runtime: "ollama",
          capabilities: { taskTypes: ["judge"] },
          paymentPolicy: "x402_required",
        },
      }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req as unknown as Request);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      status: "invalid_source_adapter",
    });
  });

  it("accepts valid sourceAdapter manifests and continues endpoint probe", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: "qwen3:8b" }] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 402,
        headers: { get: (name: string) => (name.toLowerCase() === "x402-request" ? "{}" : null) },
      }) as unknown as typeof fetch;

    const { POST } = await import("@/app/api/register/probe/route");
    const req = new NextRequest("http://localhost/api/register/probe", {
      method: "POST",
      body: JSON.stringify({
        endpoint: "https://demo.reddi.tech",
        sourceAdapter: {
          version: "source-adapter.v1",
          source: "openclaw",
          role: "consumer",
          runtime: "ollama",
          capabilities: { taskTypes: ["resolve", "invoke"], inputModes: ["text"], outputModes: ["text"] },
          paymentPolicy: "x402_required",
          failurePolicy: { maxRetries: 2, refundOnFailure: true },
        },
      }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req as unknown as Request);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      status: "ollama_detected",
      integration: "openclaw",
    });
  });

  it("returns actionable contract mismatch error for openonion specialist", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ adapter: "openonion", role: "specialist" }),
      }) as unknown as typeof fetch;

    const { POST } = await import("@/app/api/register/probe/route");
    const req = new NextRequest("http://localhost/api/register/probe", {
      method: "POST",
      body: JSON.stringify({ endpoint: "https://demo.openonion.ai", integration: "openonion" }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req as unknown as Request);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      status: "invalid_contract",
    });
  });

  it("hard-fails insecure endpoints that return completions without x402 challenge", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: "qwen3:8b" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
      }) as unknown as typeof fetch;

    const { POST } = await import("@/app/api/register/probe/route");
    const req = new NextRequest("http://localhost/api/register/probe", {
      method: "POST",
      body: JSON.stringify({ endpoint: "https://specialist.example" }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req as unknown as Request);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      status: "insecure_endpoint",
      securityStatus: "insecure_open_completion",
      error: expect.stringContaining("without an x402 challenge"),
    });
  });

  it("recognizes x402 challenge behavior when 402 + header are returned", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: "qwen3:8b" }] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 402,
        headers: { get: (name: string) => (name.toLowerCase() === "x402-request" ? "{}" : null) },
      }) as unknown as typeof fetch;

    const { POST } = await import("@/app/api/register/probe/route");
    const req = new NextRequest("http://localhost/api/register/probe", {
      method: "POST",
      body: JSON.stringify({ endpoint: "https://specialist.example" }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req as unknown as Request);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      status: "ollama_detected",
      securityStatus: "x402_challenge_detected",
    });
  });

  it("blocks insecure endpoint when requireX402 is enabled", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: "qwen3:8b" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
      }) as unknown as typeof fetch;

    const { POST } = await import("@/app/api/register/probe/route");
    const req = new NextRequest("http://localhost/api/register/probe", {
      method: "POST",
      body: JSON.stringify({ endpoint: "https://specialist.example", requireX402: true }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req as unknown as Request);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      status: "insecure_endpoint",
      securityStatus: "insecure_open_completion",
    });
  });
});
