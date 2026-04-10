/**
 * Tests for x402_pay action.
 * All Solana I/O and escrow calls are mocked.
 */
import { x402PayAction } from "../src/actions/pay";
import type { IAgentRuntime } from "@elizaos/core";
type CB = (r: { text?: string; content?: Record<string, unknown> }) => void;

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock("../src/utils/wallet", () => ({
  loadKeypairFromEnv: jest.fn(() => ({
    publicKey: { toBase58: () => "PayerPublicKey111111111111111111111111" },
    secretKey: new Uint8Array(64),
  })),
}));

jest.mock("../src/utils/escrow", () => ({
  parseX402Header: jest.requireActual("../src/utils/escrow").parseX402Header,
  lockEscrow: jest.fn(),
  isValidPaymentAddress: jest.fn(() => true),
}));

const { lockEscrow } = require("../src/utils/escrow") as {
  lockEscrow: jest.MockedFunction<typeof import("../src/utils/escrow").lockEscrow>;
};

const MOCK_RUNTIME = {} as unknown as IAgentRuntime;
const makeMemory = (content: unknown) => ({ content } as any);

const PAYMENT_REQUEST = JSON.stringify({
  amount: 5000,
  currency: "SOL",
  paymentAddress: "PayeeAddress111111111111111111111111111",
  nonce: "test-nonce-001",
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("x402_pay", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("happy path: sends 402 → locks escrow → returns proof", async () => {
    lockEscrow.mockResolvedValueOnce({
      escrowPda: "escrow_PayeeAdd_test-non",
      txSignature: "tx_abc123",
    });

    const messages: string[] = [];
    const callback: CB = (r) => {
      if (r.text) messages.push(r.text);
    };

    const memory = makeMemory({ url: "https://api.example.com/data", paymentRequest: PAYMENT_REQUEST });
    const result = await x402PayAction.handler(MOCK_RUNTIME, memory, undefined, undefined, callback as any);

    expect(result).toBe(true);
    expect(lockEscrow).toHaveBeenCalledTimes(1);
    expect(messages[0]).toContain("escrow_PayeeAdd_test-non");
    expect(messages[0]).toContain("tx_abc123");
  });

  it("insufficient funds → returns error message to agent", async () => {
    lockEscrow.mockRejectedValueOnce(new Error("insufficient funds: need 5000 lamports"));

    const messages: string[] = [];
    const callback: CB = (r) => {
      if (r.text) messages.push(r.text);
    };

    const memory = makeMemory({ url: "https://api.example.com/data", paymentRequest: PAYMENT_REQUEST });
    const result = await x402PayAction.handler(MOCK_RUNTIME, memory, undefined, undefined, callback as any);

    expect(result).toBe(false);
    expect(messages[0]).toBe("Insufficient SOL to pay for this service");
  });

  it("no 402 header → uses fallback request and passes through", async () => {
    lockEscrow.mockResolvedValueOnce({
      escrowPda: "escrow_fallback_pda",
      txSignature: "tx_fallback",
    });

    const messages: string[] = [];
    const callback: CB = (r) => {
      if (r.text) messages.push(r.text);
    };

    // No paymentRequest header — action builds a fallback
    const memory = makeMemory({ url: "https://api.example.com/data", amount_lamports: 1000 });
    const result = await x402PayAction.handler(MOCK_RUNTIME, memory, undefined, undefined, callback as any);

    expect(result).toBe(true);
    expect(lockEscrow).toHaveBeenCalledTimes(1);
    // Should still return a success message
    expect(messages[0]).toMatch(/Payment sent/);
  });
});
