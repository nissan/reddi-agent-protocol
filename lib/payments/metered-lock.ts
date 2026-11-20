/**
 * The buyer's signed step for a per-token call (#794): lock the approved
 * maximum in a metered token escrow. The provider settles the actual cost
 * after the response; the program pays the fee to the treasury and returns
 * the rest to the buyer.
 */

import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { buildLockTokenEscrowInstruction, tokenEscrowAddresses } from "@reddi/x402-solana/token-escrow";
import { directPaymentCurrency } from "@reddi/x402-solana/payment";
import type { MeteredBuyQuote } from "@/lib/payments/metered-quote";

export interface MeteredLockInput {
  quote: Extract<MeteredBuyQuote, { ok: true }>;
  programId: PublicKey;
  payer: PublicKey;
  payee: PublicKey;
  mint: PublicKey;
  /** 16 random bytes that name this escrow. */
  nonce: Uint8Array;
}

export type MeteredLock =
  | { ok: true; instruction: TransactionInstruction; escrow: PublicKey; vault: PublicKey; amountBaseUnits: bigint }
  | { ok: false; reason: "unsupported_currency" | "invalid_nonce"; message: string };

export function buildMeteredLock(input: MeteredLockInput): MeteredLock {
  const tokenProgramId = directPaymentCurrency(input.quote.currency)?.tokenProgram;
  if (!tokenProgramId) {
    return { ok: false, reason: "unsupported_currency", message: `${input.quote.currency} cannot be locked in a token escrow.` };
  }
  if (input.nonce.length !== 16) return { ok: false, reason: "invalid_nonce", message: "The escrow nonce must be 16 bytes." };
  const tokenProgram = new PublicKey(tokenProgramId);
  const terms = {
    programId: input.programId,
    tokenProgram,
    payer: input.payer,
    payee: input.payee,
    mint: input.mint,
    source: getAssociatedTokenAddressSync(input.mint, input.payer, true, tokenProgram),
    recipient: getAssociatedTokenAddressSync(input.mint, input.payee, true, tokenProgram),
    amount: input.quote.maxChargeBaseUnits,
    nonce: input.nonce,
    metered: true,
  };
  const { escrow, vault } = tokenEscrowAddresses(terms);
  return { ok: true, instruction: buildLockTokenEscrowInstruction(terms), escrow, vault, amountBaseUnits: terms.amount };
}
