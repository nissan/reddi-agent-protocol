import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import type { X402Challenge } from './types';
export interface DirectPaymentInput {
    challenge: X402Challenge;
    /** Wallet that pays and signs. */
    payer: PublicKey;
    /**
     * Required for a token currency (USDC, AUDD, PYUSD, USDG): the buyer's own
     * configured mint for that currency, never one named by the seller.
     */
    mint?: PublicKey;
    /** Older name for `mint`, kept for USDC callers. */
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
export declare function buildDirectPaymentInstructions(input: DirectPaymentInput): TransactionInstruction[];
