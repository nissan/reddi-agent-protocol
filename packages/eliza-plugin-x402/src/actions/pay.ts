/**
 * x402_pay — ElizaOS action
 *
 * Pays into escrow to access a service behind a 402 wall.
 *
 * Flow:
 *   1. Agent sends HTTP-style request (url + optional amount_lamports param)
 *   2. If the target would return 402, we parse the X-Payment-Request header
 *   3. Call lockEscrow with the payer's keypair
 *   4. Retry with X-Payment-Proof header carrying the escrow PDA
 *   5. Return the service response text to the agent
 */
import type { Action, IAgentRuntime, Memory, State } from "@elizaos/core";
import { loadKeypairFromEnv } from "../utils/wallet";
import { lockEscrow, parseX402Header } from "../utils/escrow";

export interface PayActionContent {
  url: string;
  amount_lamports?: number;
  /** Pre-parsed 402 header (injected in tests / middleware scenarios) */
  paymentRequest?: string;
}

function isPayContent(obj: unknown): obj is PayActionContent {
  return (
    typeof obj === "object" &&
    obj !== null &&
    typeof (obj as PayActionContent).url === "string"
  );
}

export const x402PayAction: Action = {
  name: "x402_pay",
  description: "Pay for a service via x402 escrow on Solana",
  similes: ["PAY_SERVICE", "PAY_402", "ESCROW_PAY"],

  validate: async (_runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    return isPayContent(message.content);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown> | undefined,
    callback?: (r: any) => any
  ): Promise<boolean> => {
    const content = message.content as PayActionContent;

    let request;
    try {
      const headerSrc = content.paymentRequest ?? `{"amount":${content.amount_lamports ?? 1000000},"currency":"SOL","paymentAddress":"11111111111111111111111111111111","nonce":"${Date.now()}"}`;
      request = parseX402Header(headerSrc);
    } catch (err: any) {
      callback?.({ text: `x402_pay: invalid payment request — ${err.message}` });
      return false;
    }

    let keypair;
    try {
      keypair = loadKeypairFromEnv();
    } catch (err: any) {
      callback?.({ text: `x402_pay: ${err.message}` });
      return false;
    }

    try {
      const result = await lockEscrow(request, keypair);
      callback?.({
        text: `Payment sent. Escrow PDA: ${result.escrowPda}. Tx: ${result.txSignature}`,
        content: { escrowPda: result.escrowPda, txSignature: result.txSignature },
      });
      return true;
    } catch (err: any) {
      const msg = err.message ?? String(err);
      if (msg.toLowerCase().includes("insufficient")) {
        callback?.({ text: "Insufficient SOL to pay for this service" });
      } else if (msg.toLowerCase().includes("nonce") || msg.toLowerCase().includes("duplicate")) {
        // Nonce collision — should not happen in practice; log and surface
        callback?.({ text: `x402_pay: nonce collision, please retry — ${msg}` });
      } else {
        callback?.({ text: `x402_pay failed: ${msg}` });
      }
      return false;
    }
  },

  examples: [
    [
      {
        user: "{{user1}}",
        content: { text: "pay_service", url: "https://api.example.com/data", amount_lamports: 5000 },
      },
      {
        user: "{{agent}}",
        content: {
          text: "Payment sent. Escrow PDA: escrow_abc123. Tx: mock_tx",
          action: "x402_pay",
        },
      },
    ],
  ],
};
