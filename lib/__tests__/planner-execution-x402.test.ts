// Provider endpoints are fetched through the outbound guard, which resolves the host first.
// Test hosts resolve to a public address here; the guard itself is tested in outbound-guard.test.ts.
jest.mock("dns/promises", () => ({ lookup: jest.fn(async () => [{ address: "93.184.215.14", family: 4 }]) }));
// The pinned transport (undici with a fixed lookup) is tested in outbound-guard.test.ts; here it
// hands the request to the suite's global fetch mock.
jest.mock("undici", () => ({
  Agent: class { close() { return Promise.resolve(); } destroy() { return Promise.resolve(); } },
  fetch: (url: string, init: RequestInit) => globalThis.fetch(url, init),
}));

jest.mock("server-only", () => ({}));

jest.mock("fs", () => ({
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(() => "[]"),
  writeFileSync: jest.fn(),
}));

jest.mock("@/lib/onboarding/planner-router", () => ({
  routePlannerPolicy: jest.fn(() => ({
    ok: true,
    selected: {
      walletAddress: "wallet-specialist-111111111111111111111111111111",
      endpointUrl: "https://specialist.example",
    },
    candidates: [],
    rejected: [],
  })),
}));

jest.mock("@/lib/onboarding/x402-settlement", () => ({
  processX402Challenge: jest.fn(),
}));

jest.mock("@/lib/torque/client", () => ({
  emitTorqueEvent: jest.fn(),
}));

describe("planner execution x402 fail-closed behavior", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("refuses unpaid completions when the specialist does not return an x402 challenge first", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: "free answer" } }] }),
    }) as unknown as typeof fetch;

    const { executePlannerSpecialistCall } = await import("@/lib/onboarding/planner-execution");

    const result = await executePlannerSpecialistCall({ prompt: "summarize this" });

    expect(result.ok).toBe(false);
    expect(result.result).toMatchObject({
      status: "failed",
      challengeSeen: false,
      paymentAttempted: false,
      paymentSatisfied: false,
      responseStatus: 200,
      error: expect.stringContaining("without an x402 challenge"),
    });
    expect((result as { response?: string }).response).toBeUndefined();
    expect(result.result.trace).toContain("x402:missing_challenge_unpaid_response_blocked");
  });

  it("refuses the non-wallet (operator-paid, simulated) path on mainnet without calling the provider (audit S2-claude-10)", async () => {
    const saved = process.env.NETWORK_PROFILE;
    process.env.NETWORK_PROFILE = "mainnet";
    try {
      global.fetch = jest.fn() as unknown as typeof fetch;
      const { executePlannerSpecialistCall } = await import("@/lib/onboarding/planner-execution");
      const { processX402Challenge } = await import("@/lib/onboarding/x402-settlement");
      const result = await executePlannerSpecialistCall({ prompt: "summarize this" });
      expect(result.ok).toBe(false);
      expect(result.result.error).toMatch(/wallet payment only/);
      expect(global.fetch).not.toHaveBeenCalled();
      expect(processX402Challenge).not.toHaveBeenCalled();
    } finally {
      if (saved === undefined) delete process.env.NETWORK_PROFILE;
      else process.env.NETWORK_PROFILE = saved;
    }
  });
});
