import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { createTransferCheckedInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { decimalToBaseUnits, PROTOCOL_FEE_BPS, protocolFeeBaseUnits } from './payment';
import type { X402Challenge } from './types';

const DIRECT_PAYMENT_DECIMALS: Record<string, number> = { SOL: 9, USDC: 6 };

export interface DirectPaymentInput {
  challenge: X402Challenge;
  /** Wallet that pays and signs. */
  payer: PublicKey;
  /** Required for USDC. The buyer's own configured mint, never one named by the seller. */
  usdcMint?: PublicKey;
  /** Buyer's token account. Defaults to the buyer's associated token account. */
  payerTokenAccount?: PublicKey;
  /**
   * Highest fee rate the buyer accepts, in basis points. Defaults to
   * PROTOCOL_FEE_BPS, so a challenge stating a larger fee is refused before
   * anything is signed.
   */
  maxFeeBps?: number;
}

/**
 * Instructions for one direct per-call payment. With fee terms in the challenge
 * the buyer pays the listed amount in total: the provider's share to the payee
 * and the fee to the treasury, in the same transaction. This builds instructions
 * only. It signs nothing and sends nothing.
 *
 * The split is recomputed from the listed amount and the stated rate, and must
 * match the stated amounts exactly, so a challenge cannot make the buyer pay
 * more than the listed price or route more than the stated rate to the fee.
 */
export function buildDirectPaymentInstructions(input: DirectPaymentInput): TransactionInstruction[] {
  const { challenge, payer } = input;
  const decimals = DIRECT_PAYMENT_DECIMALS[challenge.currency];
  if (decimals === undefined) throw new Error(`unsupported direct payment currency: ${challenge.currency}`);
  const price = decimalToBaseUnits(challenge.amount, decimals);
  if (price === undefined) throw new Error('challenge amount is not a valid positive amount');
  const payTo = new PublicKey(challenge.payTo);

  let providerUnits = price;
  let feeUnits = BigInt(0);
  let treasury: PublicKey | undefined;
  if (challenge.fee) {
    const maxFeeBps = input.maxFeeBps ?? PROTOCOL_FEE_BPS;
    if (challenge.fee.bps > maxFeeBps) throw new Error(`challenge fee of ${challenge.fee.bps} bps exceeds the accepted ${maxFeeBps} bps`);
    feeUnits = protocolFeeBaseUnits(price, challenge.fee.bps);
    providerUnits = price - feeUnits;
    const statedFee = challenge.fee.amount === '0' ? BigInt(0) : decimalToBaseUnits(challenge.fee.amount, decimals);
    const statedProvider = decimalToBaseUnits(challenge.fee.providerAmount, decimals);
    if (statedFee !== feeUnits || statedProvider !== providerUnits) {
      throw new Error('challenge fee terms do not add up to the listed amount at the stated rate');
    }
    treasury = new PublicKey(challenge.fee.payTo);
    if (treasury.equals(payTo)) throw new Error('fee treasury must differ from the payee');
  }

  if (challenge.currency === 'SOL') {
    const instructions = [SystemProgram.transfer({ fromPubkey: payer, toPubkey: payTo, lamports: providerUnits })];
    if (treasury && feeUnits > BigInt(0)) instructions.push(SystemProgram.transfer({ fromPubkey: payer, toPubkey: treasury, lamports: feeUnits }));
    return instructions;
  }

  const mint = input.usdcMint;
  if (!mint) throw new Error('usdcMint is required for a USDC payment');
  // Owners may be program-derived addresses, such as a multisig vault.
  const tokenAccountOf = (owner: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true);
  const source = input.payerTokenAccount ?? tokenAccountOf(payer);
  const transfer = (owner: PublicKey, units: bigint) =>
    createTransferCheckedInstruction(source, mint, tokenAccountOf(owner), payer, units, decimals, [], TOKEN_PROGRAM_ID);
  const instructions = [transfer(payTo, providerUnits)];
  if (treasury && feeUnits > BigInt(0)) instructions.push(transfer(treasury, feeUnits));
  return instructions;
}
