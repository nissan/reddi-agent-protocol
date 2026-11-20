import { baseUnitsToDecimal, decimalToBaseUnits, directPaymentCurrency, PROTOCOL_FEE_BPS, protocolFeeBaseUnits, protocolFeeCapBaseUnits } from './payment';

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

const MILLION = BigInt(1_000_000);

function perMillionUnits(value: string, decimals: number): bigint {
  if (value === '0') return BigInt(0);
  const units = decimalToBaseUnits(value, decimals);
  if (units === undefined) throw new Error(`per-million price must be a non-negative amount with at most ${decimals} decimal places`);
  return units;
}

function count(value: number, name: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a whole number of tokens`);
  return BigInt(value);
}

function currencyDecimals(currency: string): number {
  const decimals = directPaymentCurrency(currency)?.decimals;
  if (decimals === undefined) throw new Error(`unsupported currency: ${currency}`);
  return decimals;
}

/**
 * Cost of `counts` tokens in base units of the price currency, rounded up to
 * the next base unit so a provider is never paid less than its listed rate.
 */
export function tokenCostBaseUnits(price: PerTokenPrice, counts: TokenCounts): bigint {
  const decimals = currencyDecimals(price.currency);
  const scaled =
    count(counts.inputTokens, 'inputTokens') * perMillionUnits(price.inputPerMillion, decimals) +
    count(counts.outputTokens, 'outputTokens') * perMillionUnits(price.outputPerMillion, decimals);
  return (scaled + MILLION - BigInt(1)) / MILLION;
}

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
export function quoteMeteredCall(price: PerTokenPrice, estimate: TokenCounts, maxCharge: string): MeteredQuote {
  const decimals = currencyDecimals(price.currency);
  const estimated = tokenCostBaseUnits(price, estimate);
  const max = decimalToBaseUnits(maxCharge, decimals);
  if (max === undefined) throw new Error(`maxCharge must be a positive ${price.currency} amount with at most ${decimals} decimal places`);
  if (max < estimated) throw new Error('maxCharge must be at least the estimated cost');
  return {
    currency: price.currency,
    estimatedCost: baseUnitsToDecimal(estimated, decimals),
    maxCharge: baseUnitsToDecimal(max, decimals),
    estimatedFee: baseUnitsToDecimal(protocolFeeBaseUnits(estimated, PROTOCOL_FEE_BPS, protocolFeeCapBaseUnits(price.currency)), decimals),
  };
}

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
export function settleMeteredCall(price: PerTokenPrice, usage: TokenCounts, maxCharge: string): MeteredSettlement {
  const decimals = currencyDecimals(price.currency);
  const max = decimalToBaseUnits(maxCharge, decimals);
  if (max === undefined) throw new Error(`maxCharge must be a positive ${price.currency} amount with at most ${decimals} decimal places`);
  const actual = tokenCostBaseUnits(price, usage);
  const charged = actual > max ? max : actual;
  const fee = protocolFeeBaseUnits(charged, PROTOCOL_FEE_BPS, protocolFeeCapBaseUnits(price.currency));
  const text = (units: bigint) => baseUnitsToDecimal(units, decimals);
  return {
    currency: price.currency,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    actualCost: text(actual),
    charged: text(charged),
    fee: text(fee),
    provider: text(charged - fee),
    refund: text(max - charged),
    capped: actual > max,
    chargedBaseUnits: charged,
  };
}
