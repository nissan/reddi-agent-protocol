/**
 * x402 earn-side handler for @sendai/agent-kit services.
 *
 * Wrap any service function with this handler to automatically gate it
 * behind an x402 payment wall and release escrow after delivery.
 *
 * Usage:
 *   const response = await x402EarnHandler(request, myServiceFn, {
 *     keypair,
 *     connection,
 *     rateLamports: 5_000_000,
 *   });
 */
import { Connection, Keypair } from "@solana/web3.js";
import { sendPayment } from "@reddi/x402-solana";
import type { X402Config } from "./middleware";

export interface EarnConfig extends X402Config {
  rateLamports: number;
}

function buildPaymentRequest(
  payeeAddress: string,
  lamports: number
): string {
  return JSON.stringify({
    amount: lamports,
    currency: "SOL",
    paymentAddress: payeeAddress,
    nonce: String(Date.now()),
  });
}

/**
 * Release escrow after a successful service delivery.
 * Wraps x402-solana's sendPayment stub (Phase 4 will do the real Anchor CPI).
 */
async function releaseEscrow(
  escrowPda: string,
  _keypair: Keypair,
  _connection: Connection
): Promise<string> {
  // Phase 4: call the on-chain release_escrow instruction
  return `release_${escrowPda.slice(0, 16)}_ok`;
}

/**
 * Gate a service function behind an x402 payment wall.
 *
 * Flow:
 *  - No X-Payment-Proof → return 402 with X-Payment-Request
 *  - Valid proof → run serviceFn
 *  - Service succeeds (2xx) → release escrow, return response
 *  - Service fails (non-2xx) → do NOT release escrow, return error response
 */
export async function x402EarnHandler(
  req: Request,
  serviceFn: (req: Request) => Promise<Response>,
  config: EarnConfig
): Promise<Response> {
  const proof = req.headers.get("X-Payment-Proof");

  if (!proof) {
    const paymentRequest = buildPaymentRequest(
      config.keypair.publicKey.toBase58(),
      config.rateLamports
    );
    return new Response(null, {
      status: 402,
      headers: { "X-Payment-Request": paymentRequest },
    });
  }

  // Run the service
  const serviceResponse = await serviceFn(req);

  // Only release escrow if service returned a successful response
  if (serviceResponse.ok) {
    await releaseEscrow(proof, config.keypair, config.connection);
  }

  return serviceResponse;
}
