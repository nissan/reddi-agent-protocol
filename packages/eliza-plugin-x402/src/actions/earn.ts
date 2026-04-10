/**
 * x402_earn — ElizaOS action
 *
 * Wraps a service function behind an x402 payment gate and releases escrow
 * after successful completion.
 *
 * Flow:
 *   1. Inbound call arrives with X-Payment-Proof header (escrow PDA)
 *   2. If missing → return 402 with X-Payment-Request header
 *   3. Verify the proof (escrow PDA is non-empty; full on-chain check in Phase 4)
 *   4. Run the service function
 *   5. Call releaseEscrow to pay the agent
 *   6. Return the service result
 */
import type { Action, IAgentRuntime, Memory, State } from "@elizaos/core";
import { loadKeypairFromEnv } from "../utils/wallet";
import { releaseEscrow, verifyEscrowProof } from "../utils/escrow";

export interface EarnActionContent {
  /** Base58 escrow PDA from X-Payment-Proof header */
  paymentProof?: string;
  /** Pre-built service response (for testing / simple use-cases) */
  serviceResult?: string;
  /** lamports to charge — read from AgentAccount if registered */
  rate_lamports?: number;
}

function isEarnContent(obj: unknown): obj is EarnActionContent {
  return typeof obj === "object" && obj !== null;
}

function buildPaymentRequest(rate_lamports: number, payeeAddress: string): string {
  return JSON.stringify({
    amount: rate_lamports,
    currency: "SOL",
    paymentAddress: payeeAddress,
    nonce: String(Date.now()),
  });
}

export const x402EarnAction: Action = {
  name: "x402_earn",
  description: "Earn SOL by providing a service, releasing escrow on completion",
  similes: ["EARN_402", "ESCROW_EARN", "RELEASE_PAYMENT"],

  validate: async (_runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    return isEarnContent(message.content);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown> | undefined,
    callback?: (r: any) => any
  ): Promise<boolean> => {
    const content = message.content as EarnActionContent;
    const rate = content.rate_lamports ?? 1_000_000;

    // Load payee keypair — needed for its public key and for releasing
    let keypair;
    try {
      keypair = loadKeypairFromEnv();
    } catch (err: any) {
      callback?.({ text: `x402_earn: ${err.message}` });
      return false;
    }

    // Gate: require payment proof
    if (!content.paymentProof || !verifyEscrowProof(content.paymentProof)) {
      const paymentRequest = buildPaymentRequest(rate, keypair.publicKey.toBase58());
      callback?.({
        text: "402 Payment Required",
        content: {
          status: 402,
          "X-Payment-Request": paymentRequest,
        },
      });
      return false;
    }

    // Service work (use injected result or default placeholder)
    const serviceResult = content.serviceResult ?? "Service completed successfully";

    // Release escrow
    try {
      const release = await releaseEscrow(content.paymentProof, keypair);
      callback?.({
        text: serviceResult,
        content: {
          serviceResult,
          releaseTx: release.txSignature,
        },
      });
      return true;
    } catch (err: any) {
      const msg = err.message ?? String(err);
      if (msg.toLowerCase().includes("has_one") || msg.toLowerCase().includes("constrainthasone")) {
        // Wrong keypair — shouldn't release someone else's escrow
        callback?.({
          text: "402 Payment Required",
          content: { status: 402, error: "escrow_owner_mismatch" },
        });
      } else {
        callback?.({ text: `x402_earn: release failed — ${msg}` });
      }
      return false;
    }
  },

  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          text: "process_payment",
          paymentProof: "escrow_abc123_def456",
          serviceResult: "Here is your answer",
          rate_lamports: 5000,
        },
      },
      {
        user: "{{agent}}",
        content: {
          text: "Here is your answer",
          action: "x402_earn",
        },
      },
    ],
  ],
};
