import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import type { SolanaPaymentNetwork, X402Challenge, X402FeeTerms, X402PaymentReceipt } from './types';
/** What the buyer chose to buy, taken from the listing they selected, never from the challenge. */
export interface BuyerListing {
    /** Provider wallet named on the listing. */
    payTo: string;
    /** Listed price per call, as a decimal amount of `currency`. */
    amount: string | number;
    currency: string;
}
export interface BuyerDirectPaymentInput {
    /** Raw `x402-request` header value from the provider's 402 response, or an already parsed object. */
    challenge: unknown;
    listing: BuyerListing;
    /** Network the buyer's wallet is connected to. */
    network: SolanaPaymentNetwork;
    /** Most the buyer will pay for this call, as a decimal amount of the listing currency. */
    spendCap: string | number;
    payer: PublicKey;
    /** Required for USDC: the buyer's own configured mint. */
    usdcMint?: PublicKey;
    payerTokenAccount?: PublicKey;
    /** Highest fee rate the buyer accepts. Defaults to PROTOCOL_FEE_BPS. */
    maxFeeBps?: number;
}
export type BuyerPaymentRefusalReason = 'invalid_challenge' | 'wrong_network' | 'wrong_payee' | 'wrong_currency' | 'price_above_listing' | 'above_spend_cap' | 'fee_terms_rejected';
export type BuyerDirectPaymentPlan = {
    ok: true;
    challenge: X402Challenge;
    instructions: TransactionInstruction[];
    /** Everything the buyer pays for the call, in base units. Equals the challenge amount. */
    totalBaseUnits: bigint;
    fee?: X402FeeTerms;
    /** Builds the receipt to send back once the wallet has signed and the transaction is confirmed. */
    receiptFor(signature: string): X402PaymentReceipt;
} | {
    ok: false;
    reason: BuyerPaymentRefusalReason;
    message: string;
};
/** Reads a provider challenge without trusting its shape. Returns undefined when a required field is missing or mistyped. */
export declare function parseX402Challenge(value: unknown): X402Challenge | undefined;
/**
 * Decides whether a buyer should pay a provider's challenge, and if so builds
 * the payment instructions. Every check runs before any instruction exists:
 * the challenge must name the wallet's network, the provider and currency of
 * the listing the buyer selected, a price no higher than the listed price and
 * the buyer's spend cap, and fee terms that add up at an accepted rate.
 *
 * This signs nothing and sends nothing. The wallet does both.
 */
export declare function planBuyerDirectPayment(input: BuyerDirectPaymentInput): BuyerDirectPaymentPlan;
