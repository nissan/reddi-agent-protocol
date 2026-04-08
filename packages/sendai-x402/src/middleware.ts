/**
 * x402 middleware for @sendai/agent-kit HTTP calls.
 *
 * Drop-in replacement for fetch: intercepts 402 responses, locks escrow,
 * and retries with a payment proof header — all transparent to the caller.
 *
 * Usage:
 *   // Instead of:
 *   const res = await fetch(url, init);
 *
 *   // Use:
 *   const res = await x402Fetch(url, init, { keypair, connection });
 */
import { Connection, Keypair } from "@solana/web3.js";
import { parseX402Header, sendPayment } from "@reddi/x402-solana";

export interface X402Config {
  keypair: Keypair;
  connection: Connection;
  /** Maximum number of payment retries. Default: 1 */
  maxRetries?: number;
}

export interface LockEscrowResult {
  escrowPda: string;
  txSignature: string;
}

/**
 * Lock escrow in exchange for a service.
 * Wraps @reddi/x402-solana's sendPayment stub.
 * Full Anchor CPI wired in Phase 4.
 */
async function lockEscrow(
  paymentRequest: ReturnType<typeof parseX402Header>,
  keypair: Keypair,
  _connection: Connection
): Promise<LockEscrowResult> {
  const receipt = await sendPayment(paymentRequest);
  const escrowPda = `escrow_${paymentRequest.paymentAddress.slice(0, 8)}_${paymentRequest.nonce.slice(0, 8)}`;
  return { escrowPda, txSignature: receipt.txSignature };
}

/**
 * Fetch wrapper that automatically handles HTTP 402 Payment Required responses.
 *
 * 1. Makes the initial request
 * 2. If not 402 → returns response as-is
 * 3. If 402 → parses X-Payment-Request header, locks escrow, retries with proof
 */
export async function x402Fetch(
  url: string,
  init: RequestInit = {},
  config: X402Config
): Promise<Response> {
  const res = await fetch(url, init);

  if (res.status !== 402) {
    return res;
  }

  const headerRaw = res.headers.get("X-Payment-Request");
  if (!headerRaw) {
    // 402 without payment instructions — surface as-is
    return res;
  }

  const paymentRequest = parseX402Header(headerRaw);

  // Lock escrow
  const { escrowPda } = await lockEscrow(
    paymentRequest,
    config.keypair,
    config.connection
  );

  // Retry original request with proof
  const retryRes = await fetch(url, {
    ...init,
    headers: {
      ...((init.headers as Record<string, string>) ?? {}),
      "X-Payment-Proof": escrowPda,
    },
  });

  return retryRes;
}
