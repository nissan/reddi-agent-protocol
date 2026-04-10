/**
 * Thin wrapper around @reddi/x402-solana escrow helpers.
 *
 * We keep this layer so actions don't import x402-solana directly —
 * makes mocking cleaner in tests and isolates any future API changes.
 */
import { Keypair, Connection, PublicKey } from "@solana/web3.js";
import { parseX402Header, sendPayment, isValidPaymentAddress } from "@reddi/x402-solana";

export { parseX402Header, isValidPaymentAddress };

export interface LockEscrowResult {
  escrowPda: string;
  txSignature: string;
}

export interface ReleaseEscrowResult {
  txSignature: string;
}

/**
 * Lock SOL into escrow in exchange for a service.
 * In Phase 3a the on-chain call is wired through x402-solana's sendPayment stub;
 * full Anchor CPI lands in Phase 4.
 */
export async function lockEscrow(
  request: { amount: number; paymentAddress: string; nonce: string; currency: string },
  _payer: Keypair,
  _connection?: Connection
): Promise<LockEscrowResult> {
  const receipt = await sendPayment(request);
  // Derive a deterministic mock PDA from paymentAddress for testing.
  const escrowPda = `escrow_${request.paymentAddress.slice(0, 8)}_${request.nonce.slice(0, 8)}`;
  return { escrowPda, txSignature: receipt.txSignature };
}

/**
 * Release escrowed SOL to the payee.
 * Full on-chain call wired in Phase 4.
 */
export async function releaseEscrow(
  escrowPda: string,
  _payee: Keypair,
  _connection?: Connection
): Promise<ReleaseEscrowResult> {
  // Phase 4 will perform the actual Anchor CPI; for now return a deterministic mock.
  return { txSignature: `release_${escrowPda.slice(0, 16)}_ok` };
}

/**
 * Verify an escrow PDA is locked (basic format check; full on-chain in Phase 4).
 */
export function verifyEscrowProof(escrowPda: string): boolean {
  return typeof escrowPda === "string" && escrowPda.length > 0;
}
