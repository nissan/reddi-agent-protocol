/**
 * Per-token pricing for a listing, as most AI inference services price. Prices
 * are decimal amounts of `currency` per million tokens, with at most the
 * currency's own number of decimal places.
 */
export interface PerTokenPrice {
    currency: string;
    inputPerMillion: string;
    outputPerMillion: string;
}
export interface TokenCounts {
    inputTokens: number;
    outputTokens: number;
}
/**
 * Cost of `counts` tokens in base units of the price currency, rounded up to
 * the next base unit so a provider is never paid less than its listed rate.
 */
export declare function tokenCostBaseUnits(price: PerTokenPrice, counts: TokenCounts): bigint;
export interface MeteredQuote {
    currency: string;
    /** Expected cost of the estimated token counts. */
    estimatedCost: string;
    /** The most the buyer authorises, which is what an escrow locks. */
    maxCharge: string;
    /** Protocol fee if the estimate holds, taken out of the provider's share. */
    estimatedFee: string;
}
/**
 * What a buyer sees before a metered call: the estimated cost and the maximum
 * it authorises. The maximum must cover the estimate.
 */
export declare function quoteMeteredCall(price: PerTokenPrice, estimate: TokenCounts, maxCharge: string): MeteredQuote;
export interface MeteredSettlement {
    currency: string;
    inputTokens: number;
    outputTokens: number;
    /** Cost of the tokens actually used, at the listed rates. */
    actualCost: string;
    /** What the buyer pays: the actual cost, never more than the authorised maximum. */
    charged: string;
    /** 2.5% of `charged`, rounded down; at most 0.1 SOL for SOL. Goes to the treasury. */
    fee: string;
    /** `charged` less the fee. */
    provider: string;
    /** Authorised maximum less `charged`, returned to the buyer. */
    refund: string;
    /** True when the actual cost went above the maximum and the charge was held to it. */
    capped: boolean;
    /** `charged` in base units: the amount to pass to the escrow program's settle instruction. */
    chargedBaseUnits: bigint;
}
/**
 * Works out a metered call once the response is in and the real token counts
 * are known. This is the same split the escrow program applies on-chain when
 * the payee settles with `chargedBaseUnits`.
 */
export declare function settleMeteredCall(price: PerTokenPrice, usage: TokenCounts, maxCharge: string): MeteredSettlement;
