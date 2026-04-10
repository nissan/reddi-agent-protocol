/**
 * Tests for x402Fetch middleware.
 * All network and escrow calls are mocked.
 */
import { x402Fetch } from "../src/middleware";
import type { X402Config } from "../src/middleware";

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock @reddi/x402-solana so we don't need a real Solana connection
jest.mock("@reddi/x402-solana", () => ({
  parseX402Header: jest.requireActual("@reddi/x402-solana").parseX402Header,
  sendPayment: jest.fn(),
}));

const { sendPayment } = require("@reddi/x402-solana") as {
  sendPayment: jest.MockedFunction<typeof import("@reddi/x402-solana").sendPayment>;
};

// Mock fetch globally
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

const MOCK_CONFIG: X402Config = {
  keypair: {
    publicKey: { toBase58: () => "PayerPublicKey111111111111111111111111" },
    secretKey: new Uint8Array(64),
  } as any,
  connection: {} as any,
};

const PAYMENT_REQUEST = JSON.stringify({
  amount: 5000,
  currency: "SOL",
  paymentAddress: "PayeeAddress111111111111111111111111111",
  nonce: "nonce-test-001",
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("x402Fetch middleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("200 response: passes through unchanged without touching payment logic", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("ok", { status: 200 })
    );

    const res = await x402Fetch("https://api.example.com/data", {}, MOCK_CONFIG);

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(sendPayment).not.toHaveBeenCalled();
  });

  it("402 response: locks escrow → retries with X-Payment-Proof → returns 200", async () => {
    sendPayment.mockResolvedValueOnce({
      txSignature: "tx_lock_ok",
      slot: 1000,
      lamports: 5000,
      nonce: "nonce-test-001",
    });

    // First fetch returns 402 with payment request header
    mockFetch.mockResolvedValueOnce(
      new Response(null, {
        status: 402,
        headers: { "X-Payment-Request": PAYMENT_REQUEST },
      })
    );
    // Second fetch (retry with proof) returns 200
    mockFetch.mockResolvedValueOnce(
      new Response("service response", { status: 200 })
    );

    const res = await x402Fetch("https://api.example.com/data", {}, MOCK_CONFIG);

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(sendPayment).toHaveBeenCalledTimes(1);

    // Second call must include X-Payment-Proof header
    const retryCall = mockFetch.mock.calls[1];
    const retryHeaders = retryCall[1]?.headers as Record<string, string>;
    expect(retryHeaders?.["X-Payment-Proof"]).toBeDefined();
    expect(typeof retryHeaders?.["X-Payment-Proof"]).toBe("string");
  });

  it("402 response: lockEscrow throws InsufficientFunds → error propagates", async () => {
    sendPayment.mockRejectedValueOnce(new Error("insufficient funds: need 5000 lamports"));

    mockFetch.mockResolvedValueOnce(
      new Response(null, {
        status: 402,
        headers: { "X-Payment-Request": PAYMENT_REQUEST },
      })
    );

    await expect(
      x402Fetch("https://api.example.com/data", {}, MOCK_CONFIG)
    ).rejects.toThrow("insufficient funds");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(sendPayment).toHaveBeenCalledTimes(1);
  });
});
