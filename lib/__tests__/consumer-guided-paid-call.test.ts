import { summarizeConsumerPolicy, summarizeConsumerReceipt } from "@/lib/consumer/guided-paid-call";

describe("consumer guided paid call summaries", () => {
  it("requires specialist selection before execution", () => {
    const summary = summarizeConsumerPolicy({
      requiredPrivacyMode: "per",
      requiresHealthPass: true,
      requiresAttested: true,
      maxPerCallUsd: 0.05,
    });

    expect(summary.status).toBe("needs_selection");
    expect(summary.nextAction).toMatch(/Select a resolved specialist/i);
    expect(summary.safeguards.join(" ")).toMatch(/HTTP 402/);
  });

  it("marks policy ready when spend, privacy, attestation, and wallet are explicit", () => {
    const summary = summarizeConsumerPolicy({
      requiredPrivacyMode: "vanish",
      requiresHealthPass: true,
      requiresAttested: false,
      maxPerCallUsd: 0.01,
      preferredWallet: "wallet-specialist",
    });

    expect(summary.status).toBe("ready");
    expect(summary.maxSpendLabel).toBe("$0.0100 max");
    expect(summary.privacyLabel).toMatch(/Vanish/);
  });

  it("summarizes paid receipt without raw prompt storage", () => {
    const receipt = summarizeConsumerReceipt({
      runId: "run_1",
      createdAt: "2026-04-27T00:00:00.000Z",
      selectedWallet: "wallet-specialist",
      endpointUrl: "https://agent.example",
      policy: { requiredPrivacyMode: "public" },
      promptSha256: "abc",
      status: "completed",
      challengeSeen: true,
      paymentAttempted: true,
      paymentSatisfied: true,
      x402TxSignature: "tx_123",
      x402ReceiptNonce: "nonce_123",
      trace: [],
    } as Parameters<typeof summarizeConsumerReceipt>[0], 0.01);

    expect(receipt).toMatchObject({
      status: "paid",
      txSignature: "tx_123",
      nonce: "nonce_123",
      promptStorage: "sha256_only",
    });
  });

  it("marks unpaid open-completion responses as blocked receipts", () => {
    const receipt = summarizeConsumerReceipt({
      runId: "run_2",
      createdAt: "2026-04-27T00:00:00.000Z",
      selectedWallet: "wallet-specialist",
      endpointUrl: "https://agent.example",
      policy: { requiredPrivacyMode: "public" },
      promptSha256: "abc",
      status: "failed",
      challengeSeen: false,
      paymentAttempted: false,
      paymentSatisfied: false,
      error: "Specialist endpoint returned a completion without an x402 challenge. Refusing unpaid response.",
      trace: ["x402:missing_challenge_unpaid_response_blocked"],
    } as Parameters<typeof summarizeConsumerReceipt>[0]);

    expect(receipt.status).toBe("blocked");
    expect(receipt.amountLabel).toBe("No payment accepted");
    expect(receipt.message).toMatch(/failed closed/i);
  });
});
