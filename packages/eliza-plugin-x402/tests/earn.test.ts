/**
 * Tests for x402_earn action.
 * All Solana I/O and escrow calls are mocked.
 */
import { x402EarnAction } from "../src/actions/earn";
import type { IAgentRuntime } from "@elizaos/core";

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock("../src/utils/wallet", () => ({
  loadKeypairFromEnv: jest.fn(() => ({
    publicKey: { toBase58: () => "PayeePublicKey111111111111111111111111" },
    secretKey: new Uint8Array(64),
  })),
}));

jest.mock("../src/utils/escrow", () => ({
  releaseEscrow: jest.fn(),
  verifyEscrowProof: jest.requireActual("../src/utils/escrow").verifyEscrowProof,
}));

const { releaseEscrow } = require("../src/utils/escrow") as {
  releaseEscrow: jest.MockedFunction<typeof import("../src/utils/escrow").releaseEscrow>;
};

const MOCK_RUNTIME = {} as unknown as IAgentRuntime;
const makeMemory = (content: unknown) => ({ content } as any);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("x402_earn", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("valid proof → service runs → escrow released → response returned", async () => {
    releaseEscrow.mockResolvedValueOnce({ txSignature: "release_tx_ok" });

    const received: { text?: string; content?: Record<string, unknown> }[] = [];
    const callback = (r: typeof received[number]) => received.push(r);

    const memory = makeMemory({
      paymentProof: "escrow_payer11_nonce111",
      serviceResult: "Here is your data",
      rate_lamports: 5000,
    });
    const result = await x402EarnAction.handler(MOCK_RUNTIME, memory, undefined, undefined, callback as any);

    expect(result).toBe(true);
    expect(releaseEscrow).toHaveBeenCalledWith("escrow_payer11_nonce111", expect.any(Object));
    expect(received[0].text).toBe("Here is your data");
    expect(received[0].content?.releaseTx).toBe("release_tx_ok");
  });

  it("missing proof → returns 402 Payment Required with X-Payment-Request", async () => {
    const received: { text?: string; content?: Record<string, unknown> }[] = [];
    const callback = (r: typeof received[number]) => received.push(r);

    const memory = makeMemory({ rate_lamports: 5000 }); // no paymentProof
    const result = await x402EarnAction.handler(MOCK_RUNTIME, memory, undefined, undefined, callback as any);

    expect(result).toBe(false);
    expect(releaseEscrow).not.toHaveBeenCalled();
    expect(received[0].text).toBe("402 Payment Required");
    expect(received[0].content?.status).toBe(402);
    expect(received[0].content?.["X-Payment-Request"]).toBeDefined();
  });

  it("wrong keypair (ConstraintHasOne) → 402 returned, release not completed", async () => {
    releaseEscrow.mockRejectedValueOnce(
      new Error("ConstraintHasOne: signer does not own this escrow")
    );

    const received: { text?: string; content?: Record<string, unknown> }[] = [];
    const callback = (r: typeof received[number]) => received.push(r);

    const memory = makeMemory({
      paymentProof: "escrow_wrong_owner_pda",
      serviceResult: "should not reach",
    });
    const result = await x402EarnAction.handler(MOCK_RUNTIME, memory, undefined, undefined, callback as any);

    expect(result).toBe(false);
    expect(received[0].text).toBe("402 Payment Required");
    expect(received[0].content?.status).toBe(402);
    expect(received[0].content?.error).toBe("escrow_owner_mismatch");
  });
});
