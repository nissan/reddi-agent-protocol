/**
 * What a per-token listing costs, for the provider directory (#908). Same
 * arithmetic as the sandbox (`lib/sandbox/pricing.ts`): whole micro-dollars,
 * a call's cost rounded up, AUDD and SOL at the labelled demo rates. The most
 * a call may cost is the buyer's default maximum, twice the estimate
 * (`DEFAULT_MAX_MULTIPLE`). Nothing here is charged.
 */

import { DEFAULT_MAX_MULTIPLE } from "@/lib/payments/metered-quote";
import { TYPICAL_REVIEW, triPriceFromMicroUsd, type TokenUsage, type TriPrice } from "@/lib/sandbox/pricing";

export type ListingPrice = {
  inputPerMillionUsd: string;
  outputPerMillionUsd: string;
  usage: TokenUsage;
  typicalCall: TriPrice;
  maxPerCall: TriPrice;
};

const MILLION = BigInt(1_000_000);

/** A non-negative dollar amount in whole micro-dollars, or null if it is not a usable price. */
function toMicroUsd(value: number | undefined): bigint | null {
  if (value === undefined || !Number.isFinite(value) || value < 0) return null;
  return BigInt(Math.round(value * 1_000_000));
}

function usd(microUsd: bigint): string {
  const whole = microUsd / MILLION;
  const fraction = (microUsd % MILLION).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/**
 * The directory price for a listing, or null when it has no per-token price
 * (both prices missing, invalid or zero); the card then keeps its per-call rate.
 */
export function listingPrice(
  inputPerMillionUsd: number | undefined,
  outputPerMillionUsd: number | undefined,
  usage: TokenUsage = TYPICAL_REVIEW,
): ListingPrice | null {
  const input = toMicroUsd(inputPerMillionUsd) ?? (inputPerMillionUsd === undefined ? BigInt(0) : null);
  const output = toMicroUsd(outputPerMillionUsd) ?? (outputPerMillionUsd === undefined ? BigInt(0) : null);
  if (input === null || output === null || input + output === BigInt(0)) return null;
  const total = BigInt(usage.inputTokens) * input + BigInt(usage.outputTokens) * output;
  const cost = (total + MILLION - BigInt(1)) / MILLION;
  return {
    inputPerMillionUsd: usd(input),
    outputPerMillionUsd: usd(output),
    usage,
    typicalCall: triPriceFromMicroUsd(cost),
    maxPerCall: triPriceFromMicroUsd(cost * BigInt(DEFAULT_MAX_MULTIPLE)),
  };
}
