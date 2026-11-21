/**
 * The buyer's signed step for a per-token call (#794): lock the approved
 * maximum in a metered token escrow. The provider settles the actual cost
 * after the response; the program pays the fee to the treasury and returns
 * the rest to the buyer.
 */

import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { buildLockTokenEscrowInstruction, tokenEscrowAddresses } from "@redditech/x402-solana/token-escrow";
import { buildOpenRatingInstruction } from "@redditech/x402-solana/rating";
import { directPaymentCurrency } from "@redditech/x402-solana/payment";
import type { MeteredBuyQuote } from "@/lib/payments/metered-quote";

export interface MeteredLockInput {
  quote: Extract<MeteredBuyQuote, { ok: true }>;
  programId: PublicKey;
  payer: PublicKey;
  payee: PublicKey;
  mint: PublicKey;
  /** 16 random bytes that name this escrow. */
  nonce: Uint8Array;
  /**
   * Opt the job in to rating (#842): `open_rating` follows the lock in the same
   * transaction, as the program requires (same slot). The payer pays the rating
   * account's rent, returned when the rating is closed or the job is refunded.
   */
  rating?: { judge?: PublicKey };
}

export type MeteredLock =
  | {
      ok: true;
      /** The lock alone. */
      instruction: TransactionInstruction;
      /** Everything the buyer signs, in order: the lock, then `open_rating` when the job is rated. */
      instructions: TransactionInstruction[];
      escrow: PublicKey;
      vault: PublicKey;
      amountBaseUnits: bigint;
      /** The rating account's address, when the job is rated. */
      rating?: PublicKey;
    }
  | { ok: false; reason: "unsupported_currency" | "invalid_nonce" | "invalid_judge"; message: string };

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
  const instruction = buildLockTokenEscrowInstruction(terms);
  if (!input.rating) return { ok: true, instruction, instructions: [instruction], escrow, vault, amountBaseUnits: terms.amount };
  const judge = input.rating.judge;
  if (judge && (judge.equals(input.payer) || judge.equals(input.payee))) {
    return { ok: false, reason: "invalid_judge", message: "The judge cannot be the buyer or the provider." };
  }
  const open = buildOpenRatingInstruction({ programId: input.programId, escrow, payer: input.payer, judge });
  return { ok: true, instruction, instructions: [instruction, open], escrow, vault, amountBaseUnits: terms.amount, rating: open.keys[0].pubkey };
}
