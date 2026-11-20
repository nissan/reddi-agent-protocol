/**
 * What a buyer sees before a per-token call (#794): the estimated cost and the
 * most they authorise. The maximum is what the metered escrow locks; the
 * provider settles the actual cost after the response and the rest returns to
 * the buyer.
 */

import { baseUnitsToDecimal, decimalToBaseUnits, PROTOCOL_FEE_BPS, protocolFeeBaseUnits, protocolFeeCapBaseUnits } from "@reddi/x402-solana/payment";
import { tokenCostBaseUnits, type PerTokenPrice, type TokenCounts } from "@reddi/x402-solana/metered";

/** The default maximum, as a multiple of the estimate (Nissan, 20 November 2026). */
export const DEFAULT_MAX_MULTIPLE = 2;
/** Output tokens assumed when the request sets no limit. */
export const DEFAULT_OUTPUT_TOKENS = 1_000;

/** Shown next to the maximum on the buyer's screen. */
export const METERED_BUYER_NOTICE =
  "The provider reports the tokens used. You will never pay more than the maximum you approve.";

const USD_STABLECOINS = new Set(["USDC", "PYUSD", "USDG"]);
const DECIMALS = 6;

/** A rough token count for a prompt: about four characters a token. */
export function estimateTokens(prompt: string, maxOutputTokens?: number): TokenCounts {
  const outputTokens =
    maxOutputTokens !== undefined && Number.isSafeInteger(maxOutputTokens) && maxOutputTokens > 0 ? maxOutputTokens : DEFAULT_OUTPUT_TOKENS;
  return { inputTokens: Math.ceil(prompt.length / 4), outputTokens };
}

/** Listed US dollar prices per million tokens, from the listing index. */
export interface ListedTokenPrices {
  inputPerMillionUsd?: number;
  outputPerMillionUsd?: number;
}

function usd(value: number | undefined): string | undefined {
  if (value === undefined) return "0";
  if (!Number.isFinite(value) || value < 0) return undefined;
  return value.toFixed(DECIMALS);
}

/** The listing's per-token price in a US dollar stablecoin, or undefined when it is not priced per token. */
export function perTokenPriceFor(prices: ListedTokenPrices, currency: string): PerTokenPrice | undefined {
  if (!USD_STABLECOINS.has(currency)) return undefined;
  const inputPerMillion = usd(prices.inputPerMillionUsd);
  const outputPerMillion = usd(prices.outputPerMillionUsd);
  if (inputPerMillion === undefined || outputPerMillion === undefined) return undefined;
  if (Number(inputPerMillion) === 0 && Number(outputPerMillion) === 0) return undefined;
  return { currency, inputPerMillion, outputPerMillion };
}

export type MeteredBuyQuote =
  | {
      ok: true;
      currency: string;
      estimate: TokenCounts;
      estimatedCost: string;
      defaultMax: string;
      maxCharge: string;
      /** Base units the escrow locks. */
      maxChargeBaseUnits: bigint;
      estimatedFee: string;
      notice: string;
    }
  | { ok: false; reason: "not_per_token" | "estimate_zero" | "invalid_max" | "max_below_estimate"; message: string };

/**
 * The quote for a buyer's request. `maxCharge` is what the buyer typed; left
 * out, the default maximum applies. The maximum is never below the estimate.
 */
export function quoteMeteredBuy(input: {
  prices: ListedTokenPrices;
  currency: string;
  prompt: string;
  maxOutputTokens?: number;
  maxCharge?: string;
}): MeteredBuyQuote {
  const price = perTokenPriceFor(input.prices, input.currency);
  if (!price) return { ok: false, reason: "not_per_token", message: `This listing has no per-token price in ${input.currency}.` };
  const estimate = estimateTokens(input.prompt, input.maxOutputTokens);
  const estimated = tokenCostBaseUnits(price, estimate);
  if (estimated <= BigInt(0)) return { ok: false, reason: "estimate_zero", message: "Write a request before getting a quote." };
  const defaultMax = estimated * BigInt(DEFAULT_MAX_MULTIPLE);
  let max = defaultMax;
  if (input.maxCharge !== undefined && input.maxCharge.trim() !== "") {
    const typed = decimalToBaseUnits(input.maxCharge.trim(), DECIMALS);
    if (typed === undefined || typed <= BigInt(0)) {
      return { ok: false, reason: "invalid_max", message: `Write the maximum in ${input.currency}, with at most six decimal places.` };
    }
    max = typed;
  }
  if (max < estimated) {
    return {
      ok: false,
      reason: "max_below_estimate",
      message: `The maximum must be at least the estimate of ${baseUnitsToDecimal(estimated, DECIMALS)} ${input.currency}.`,
    };
  }
  const fee = protocolFeeBaseUnits(estimated, PROTOCOL_FEE_BPS, protocolFeeCapBaseUnits(input.currency));
  return {
    ok: true,
    currency: input.currency,
    estimate,
    estimatedCost: baseUnitsToDecimal(estimated, DECIMALS),
    defaultMax: baseUnitsToDecimal(defaultMax, DECIMALS),
    maxCharge: baseUnitsToDecimal(max, DECIMALS),
    maxChargeBaseUnits: max,
    estimatedFee: baseUnitsToDecimal(fee, DECIMALS),
    notice: METERED_BUYER_NOTICE,
  };
}
