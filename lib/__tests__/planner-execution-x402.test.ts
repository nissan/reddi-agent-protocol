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
});
