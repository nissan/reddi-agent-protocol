/**
 * Per-token pricing for the sandbox (#794).
 *
 * Providers list a US dollar price per million input tokens and per million
 * output tokens, and an output limit that sets the most one call can cost.
 * The sandbox pays in devnet SOL; USDC and AUDD figures are shown next to it
 * at fixed demo rates, which are labelled as such wherever they appear.
 *
 * All arithmetic is in whole base units (micro-dollars, lamports, AUDD's six
 * decimals) with no floating point. Costs round up, so a provider is never
 * paid less than its listed rate; the protocol fee rounds down, as on chain.
 */

import type { SandboxProvider } from "@/lib/sandbox/catalog";

/** Fixed rates for the demo only. Not market prices. */
export const SANDBOX_DEMO_RATES = {
  /** US dollars per SOL. */
  usdPerSol: "150",
  /** AUDD per US dollar. */
  auddPerUsd: "1.55",
} as const;

export const SANDBOX_DEMO_RATES_NOTE = `Demo rates: 1 SOL = ${SANDBOX_DEMO_RATES.usdPerSol} USD, 1 USD = ${SANDBOX_DEMO_RATES.auddPerUsd} AUDD. Not market prices.`;

/** Protocol fee in basis points, as the escrow program takes it. */
export const SANDBOX_FEE_BPS = BigInt(250);
/** The protocol treasury the escrow program pays fees to: the Squads vault. */
export const SANDBOX_FEE_TREASURY = "5CsBuTBFKu12JSs4CUbmv5MR218RYtNmAoQmLf5x3Hxe";

const MILLION = BigInt(1_000_000);
const LAMPORTS_PER_SOL = BigInt(1_000_000_000);

function decimalUnits(value: string, decimals: number): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match || (match[2] ?? "").length > decimals) throw new Error(`invalid decimal: ${value}`);
  return BigInt(match[1]) * BigInt(10) ** BigInt(decimals) + BigInt((match[2] ?? "").padEnd(decimals, "0") || "0");
}

function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - BigInt(1)) / b;
}

/** Whole base units as an exact decimal, trailing zeros trimmed. */
export function formatUnits(units: bigint, decimals: number): string {
  const scale = BigInt(10) ** BigInt(decimals);
  const whole = units / scale;
  const fraction = (units % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/** Tokens in a piece of text, at about four characters a token. */
export function countTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export type TokenUsage = { inputTokens: number; outputTokens: number };

/**
 * Tokens in a typical single-pass code review of a real pull request: the diff,
 * the code around it and the reviewer's instructions in, a written review out.
 * The sandbox prompts are a few dozen tokens, so their costs look like nothing;
 * this shows what a real job would cost. It is our estimate (median case) from
 * the task token research of 21 Nov 2026, not a measurement.
 */
export const TYPICAL_REVIEW: TokenUsage = { inputTokens: 12_000, outputTokens: 1_500 };

/** Cost of the given tokens in micro-dollars, rounded up. */
export function usageCostMicroUsd(provider: SandboxProvider, usage: TokenUsage): bigint {
  const input = decimalUnits(provider.pricing.inputPerMillionUsd, 6);
  const output = decimalUnits(provider.pricing.outputPerMillionUsd, 6);
  return ceilDiv(BigInt(usage.inputTokens) * input + BigInt(usage.outputTokens) * output, MILLION);
}

/** Micro-dollars in lamports at the demo rate, rounded up. */
export function microUsdToLamports(microUsd: bigint): bigint {
  return ceilDiv(microUsd * LAMPORTS_PER_SOL, decimalUnits(SANDBOX_DEMO_RATES.usdPerSol, 6));
}

/** Micro-dollars in AUDD base units (six decimals) at the demo rate, rounded up. */
export function microUsdToAuddUnits(microUsd: bigint): bigint {
  return ceilDiv(microUsd * decimalUnits(SANDBOX_DEMO_RATES.auddPerUsd, 6), MILLION);
}

/** Lamports in micro-dollars at the demo rate, rounded down. For showing a SOL amount in dollars. */
export function lamportsToMicroUsd(lamports: bigint): bigint {
  return (lamports * decimalUnits(SANDBOX_DEMO_RATES.usdPerSol, 6)) / LAMPORTS_PER_SOL;
}

/** One amount in the three demo currencies. */
export type TriPrice = { usdc: string; audd: string; sol: string };

export function triPriceFromMicroUsd(microUsd: bigint): TriPrice {
  return { usdc: formatUnits(microUsd, 6), audd: formatUnits(microUsdToAuddUnits(microUsd), 6), sol: formatUnits(microUsdToLamports(microUsd), 9) };
}

export function triPriceFromLamports(lamports: bigint): TriPrice {
  const microUsd = lamportsToMicroUsd(lamports);
  return { usdc: formatUnits(microUsd, 6), audd: formatUnits(microUsdToAuddUnits(microUsd), 6), sol: formatUnits(lamports, 9) };
}

/** Input tokens a request carries: every message's text. */
export function requestInputTokens(messages: readonly { content: string }[]): number {
  return messages.reduce((total, message) => total + countTokens(message.content), 0);
}

/** The most this call can cost: the request plus the provider's full output limit, in lamports. */
export function maxChargeLamports(provider: SandboxProvider, inputTokens: number): bigint {
  return microUsdToLamports(usageCostMicroUsd(provider, { inputTokens, outputTokens: provider.pricing.maxOutputTokens }));
}

export type MeteredSettlementLamports = {
  usage: TokenUsage;
  maxAmount: bigint;
  amount: bigint;
  fee: bigint;
  provider: bigint;
  refunded: bigint;
};

/**
 * Settles a call at its actual tokens against the maximum the buyer locked,
 * as the metered escrow does: the cost never exceeds the maximum, the fee is
 * 2.5% of the cost rounded down, and the rest of the maximum goes back.
 */
export function settleSandboxCall(provider: SandboxProvider, usage: TokenUsage, maxAmount: bigint): MeteredSettlementLamports {
  const cost = microUsdToLamports(usageCostMicroUsd(provider, usage));
  const amount = cost < maxAmount ? cost : maxAmount;
  const fee = (amount * SANDBOX_FEE_BPS) / BigInt(10_000);
  return { usage, maxAmount, amount, fee, provider: amount - fee, refunded: maxAmount - amount };
}
