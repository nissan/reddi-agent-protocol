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

const PROVIDER = "7Y6oUj3vCz7xqGmJmT7Q7m4mGkq3rq9t7u7Hq3iJ1dQp";
const SIGNATURE = "4".repeat(88);

jest.mock("@/lib/onboarding/planner-router", () => ({
  routePlannerPolicy: jest.fn(() => ({
    ok: true,
    selected: { walletAddress: "7Y6oUj3vCz7xqGmJmT7Q7m4mGkq3rq9t7u7Hq3iJ1dQp", endpointUrl: "https://specialist.example", perCallUsd: 0.01 },
    candidates: [],
    rejected: [],
  })),
}));

const processX402Challenge = jest.fn();
jest.mock("@/lib/onboarding/x402-settlement", () => ({ processX402Challenge }));
jest.mock("@/lib/torque/client", () => ({ emitTorqueEvent: jest.fn() }));

const CHALLENGE = JSON.stringify({ network: "solana-devnet", payTo: PROVIDER, amount: "0.002", currency: "SOL", endpoint: "/v1/chat/completions", nonce: "n-1" });
const receipt = { network: "solana-devnet", payTo: PROVIDER, amount: "0.002", currency: "SOL", nonce: "n-1", signature: SIGNATURE };

function response(status: number, body: string, headers: Record<string, string> = {}) {
  return { ok: status >= 200 && status < 300, status, text: async () => body, headers: new Headers(headers) };
}

describe("planner execution, wallet payment mode (#738)", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  async function run(input: Record<string, unknown>) {
    const { executePlannerSpecialistCall } = await import("@/lib/onboarding/planner-execution");
    return executePlannerSpecialistCall({ prompt: "summarize this", paymentMode: "wallet", ...input });
  }

  it("hands the provider's challenge back and never simulates a payment", async () => {
    global.fetch = jest.fn().mockResolvedValue(response(402, "", { "x402-request": CHALLENGE })) as unknown as typeof fetch;
    const result = await run({ preferredWallet: PROVIDER });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      paymentRequired: { challenge: CHALLENGE, selectedWallet: PROVIDER, perCallUsd: 0.01 },
      result: { status: "payment_required", paymentMode: "wallet", challengeSeen: true, paymentAttempted: false, paymentSatisfied: false },
    });
    expect(result.result.x402TxSignature).toBeUndefined();
    expect(processX402Challenge).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("requests no payment when the selected listing is not the one routed to", async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    const result = await run({ preferredWallet: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" });
    expect(result.ok).toBe(false);
    expect(result.result.error).toMatch(/not eligible/);
    expect("paymentRequired" in result ? result.paymentRequired : undefined).toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses an unpaid completion", async () => {
    global.fetch = jest.fn().mockResolvedValue(response(200, "free")) as unknown as typeof fetch;
    const result = await run({});
    expect(result.result).toMatchObject({ status: "failed", error: expect.stringContaining("without an x402 challenge") });
  });

  it("forwards a wallet receipt once and completes when the provider accepts it", async () => {
    const fetchMock = jest.fn().mockResolvedValue(response(200, JSON.stringify({ choices: [] })));
    global.fetch = fetchMock as unknown as typeof fetch;
    const result = await run({ paymentReceipt: receipt, preferredWallet: PROVIDER });
    expect(result.ok).toBe(true);
    expect(result.result).toMatchObject({ status: "completed", paymentAttempted: true, paymentSatisfied: true, x402TxSignature: SIGNATURE, x402ReceiptNonce: "n-1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].headers["x402-payment"])).toEqual(receipt);
    expect(processX402Challenge).not.toHaveBeenCalled();
  });

  it("reports a refused receipt as failed, not paid", async () => {
    global.fetch = jest.fn().mockResolvedValue(response(402, "duplicate_nonce", { "x402-request": CHALLENGE })) as unknown as typeof fetch;
    const result = await run({ paymentReceipt: receipt });
    expect(result.ok).toBe(false);
    expect(result.result).toMatchObject({ status: "failed", paymentAttempted: true, paymentSatisfied: false, error: expect.stringContaining("did not accept") });
  });

  it.each([
    ["a mock signature", { ...receipt, signature: "mock_tx_signature_abc" }],
    ["a demo receipt", { ...receipt, demo: true }],
    ["a receipt for another provider", { ...receipt, payTo: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" }],
    ["a malformed receipt", "not-an-object"],
  ])("never forwards %s", async (_name, bad) => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    const result = await run({ paymentReceipt: bad });
    expect(result.ok).toBe(false);
    expect(result.result).toMatchObject({ status: "failed", paymentAttempted: false, paymentSatisfied: false });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("keeps the signature on the record when the provider cannot be reached after payment", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("timeout")) as unknown as typeof fetch;
    const result = await run({ paymentReceipt: receipt });
    expect(result.result).toMatchObject({ status: "failed", paymentAttempted: true, x402TxSignature: SIGNATURE, error: expect.stringContaining("do not pay twice") });
  });
  it("still returns the paid answer when the run log cannot be written (audit S2-claude-04)", async () => {
    const fs = jest.requireMock("fs") as { writeFileSync: jest.Mock };
    fs.writeFileSync.mockImplementation(() => {
      throw Object.assign(new Error("EROFS: read-only file system, open '/var/task/data/onboarding/planner-runs.json'"), { code: "EROFS" });
    });
    try {
      global.fetch = jest.fn().mockResolvedValue(response(200, JSON.stringify({ choices: [{ message: { content: "answer" } }] }))) as unknown as typeof fetch;
      const result = await run({ paymentReceipt: receipt, preferredWallet: PROVIDER });
      expect(result.ok).toBe(true);
      expect(result.result).toMatchObject({ status: "completed", paymentSatisfied: true });
      expect(JSON.stringify(result)).not.toContain("/var/task");
    } finally {
      fs.writeFileSync.mockReset();
    }
  });

  it("does not follow a provider's redirect to an internal address (audit S2-claude-02)", async () => {
    const fetchMock = jest.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.redirect).toBe("manual");
      return response(303, "", { location: "http://169.254.169.254/latest/meta-data/" });
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const result = await run({ preferredWallet: PROVIDER });
    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://specialist.example/v1/chat/completions");
  });

  describe("per-token calls (#794)", () => {
    const ESCROW = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
    const metered = {
      settlement: "metered-escrow", network: "solana-devnet", currency: "USDC", payTo: PROVIDER,
      payer: ESCROW, nonce: "09".repeat(16), escrow: ESCROW, lockSignature: SIGNATURE,
    };

    it("hands the provider's metered offer back with the challenge", async () => {
      const offer = { settlement: "metered-escrow", currency: "USDC", minimumLockBaseUnits: "15300", payTo: PROVIDER };
      global.fetch = jest.fn().mockResolvedValue(response(402, JSON.stringify({ error: "payment_required", metered: offer }), { "x402-request": CHALLENGE })) as unknown as typeof fetch;
      const result = await run({ preferredWallet: PROVIDER });
      expect(result).toMatchObject({ paymentRequired: { challenge: CHALLENGE, metered: offer } });
    });

    it("adds no metered offer when the 402 body has none", async () => {
      global.fetch = jest.fn().mockResolvedValue(response(402, "not json", { "x402-request": CHALLENGE })) as unknown as typeof fetch;
      const result = await run({ preferredWallet: PROVIDER });
      expect((result as { paymentRequired?: { metered?: unknown } }).paymentRequired?.metered).toBeUndefined();
    });

    it("forwards the lock as a metered header and keeps the provider's settle signature", async () => {
      const settle = "6".repeat(88);
      const fetchMock = jest.fn().mockResolvedValue(response(200, JSON.stringify({ choices: [], reddi: { metered: { settleSignature: settle } } })));
      global.fetch = fetchMock as unknown as typeof fetch;
      const result = await run({ paymentReceipt: metered, preferredWallet: PROVIDER });
      expect(result.ok).toBe(true);
      expect(JSON.parse(fetchMock.mock.calls[0][1].headers["x402-payment"])).toEqual({ settlement: "metered-escrow", escrow: ESCROW, payer: ESCROW, nonce: "09".repeat(16) });
      expect(result.result).toMatchObject({ status: "completed", x402TxSignature: SIGNATURE, settleTxSignature: settle });
    });

    it("tells the buyer the maximum stays locked when the provider fails after the lock", async () => {
      global.fetch = jest.fn().mockResolvedValue(response(502, JSON.stringify({ error: "settle_failed" }))) as unknown as typeof fetch;
      const result = await run({ paymentReceipt: metered, preferredWallet: PROVIDER });
      expect(result.result).toMatchObject({ status: "failed", error: expect.stringContaining("Nothing is charged until the provider settles") });
    });
  });
});
