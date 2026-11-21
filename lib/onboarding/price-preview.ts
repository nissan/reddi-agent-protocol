/**
 * What a provider's per-token price earns on one typical call, for the
 * onboarding price step. Same arithmetic as the sandbox (`lib/sandbox/pricing.ts`):
 * whole micro-dollars, cost rounded up, the planned 2.5% protocol fee rounded
 * down and taken from the provider's share. AUDD and SOL use the labelled
 * demo rates. Nothing here is charged or collected.
 */

import {
  SANDBOX_FEE_BPS,
  TYPICAL_REVIEW,
  formatUnits,
  triPriceFromMicroUsd,
  type TokenUsage,
  type TriPrice,
} from "@/lib/sandbox/pricing";

export const PRICE_PREVIEW_USAGE: TokenUsage = TYPICAL_REVIEW;

export type PricePreview = {
  usage: TokenUsage;
  buyerPays: TriPrice;
  feeUsdc: string;
  providerReceivesUsdc: string;
};

const MILLION = BigInt(1_000_000);

/** A US dollar amount with at most six decimals, in micro-dollars; null if it is not one. */
export function parseUsdPerMillion(value: string): bigint | null {
  const match = /^\s*(\d+)(?:\.(\d{0,6}))?\s*$/.exec(value);
  if (!match) return null;
  return BigInt(match[1]) * MILLION + BigInt((match[2] ?? "").padEnd(6, "0") || "0");
}

/**
 * The preview for a price, or null until both prices are valid numbers and at
 * least one is above zero.
 */
export function previewEarnings(
  inputPerMillionUsd: string,
  outputPerMillionUsd: string,
  usage: TokenUsage = PRICE_PREVIEW_USAGE,
): PricePreview | null {
  const input = parseUsdPerMillion(inputPerMillionUsd);
  const output = parseUsdPerMillion(outputPerMillionUsd);
  if (input === null || output === null || input + output === BigInt(0)) return null;
  const total = BigInt(usage.inputTokens) * input + BigInt(usage.outputTokens) * output;
  const cost = (total + MILLION - BigInt(1)) / MILLION;
  const fee = (cost * SANDBOX_FEE_BPS) / BigInt(10_000);
  return {
    usage,
    buyerPays: triPriceFromMicroUsd(cost),
    feeUsdc: formatUnits(fee, 6),
    providerReceivesUsdc: formatUnits(cost - fee, 6),
  };
}
