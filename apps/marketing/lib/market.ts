// The market case shown on /market. Every figure is either cited (a source with a URL and the date it covers)
// or marked as our own estimate. tests/market.test.ts holds that rule, and recomputes the derived numbers.

export type Source = { label: string; url: string };
export type Figure = { value: string; label: string; asOf: string; source?: Source; estimate?: true };

export const AS_OF = '20 November 2026';

const S = {
  openChainBench: { label: 'OpenChainBench', url: 'https://openchainbench.com/benchmarks/network-fees/solana' },
  solanaFees: { label: 'Solana docs', url: 'https://solana.com/docs/core/fees' },
  alpenglow: { label: 'Solana Foundation', url: 'https://solana.com/upgrades/alpenglow' },
  stripe: { label: 'Stripe pricing', url: 'https://stripe.com/pricing' },
  fireblocks: { label: 'Fireblocks, citing agenteconomy.to', url: 'https://www.fireblocks.com/blog/agent-economy-numbers-x402-data' },
  fireblocksAllium: { label: 'Fireblocks, citing Allium', url: 'https://www.fireblocks.com/blog/agent-economy-numbers-x402-data' },
  fireblocksChainalysis: { label: 'Fireblocks, citing Chainalysis', url: 'https://www.fireblocks.com/blog/agent-economy-numbers-x402-data' },
  solanaCompass: { label: 'Solana Compass, citing x402scan', url: 'https://solanacompass.com/news/solana-flips-base-in-daily-x402-transactions-for-the-first-time-in-six-months' },
  coinbase: { label: 'Coinbase CDP x402 FAQ', url: 'https://docs.cdp.coinbase.com/x402/support/faq' },
  mnm: { label: 'MarketsandMarkets (Feb 2025)', url: 'https://www.marketsandmarkets.com/PressReleases/ai-inference.asp' },
  juniper: { label: 'Juniper Research (Apr 2026)', url: 'https://www.juniperresearch.com/press/agentic-commerce-set-to-generate-15-trillion-globally-by-2030-as-payments-infrastructure-leaders-revealed/' },
  feeIssue: { label: 'Fee design, issue #744', url: 'https://github.com/nissan/reddi-agent-protocol/issues/744' },
} satisfies Record<string, Source>;

/** Planned V1 fee: 5 basis points of the listed price, rounded down to the token's smallest unit. */
export const FEE_BPS = 5;
export const feeFor = (priceBaseUnits: number) => Math.floor((priceBaseUnits * FEE_BPS) / 10_000);
export const USDC_DECIMALS = 6;

/** Median Solana network fee in USD, 24 h p50, 20 Nov 2026 (OpenChainBench). */
export const SOLANA_FEE_USD = 0.000365;
export const CARD = { pct: 0.029, fixed: 0.3 };

export const FEE_FACTS: Figure[] = [
  { value: '$0.000365', label: 'Median Solana network fee per transfer', asOf: '20 Nov 2026', source: S.openChainBench },
  { value: '5,000 lamports', label: 'Protocol base fee per signature', asOf: 'current', source: S.solanaFees },
  { value: '~150 ms', label: 'Target time to finality since Alpenglow went live (was ~12.8 s)', asOf: '21 Oct 2026', source: S.alpenglow },
  { value: '2.9% + 30¢', label: 'A standard US card payment', asOf: '20 Nov 2026', source: S.stripe },
];

export const CALL_PRICES = [0.001, 0.01, 0.05, 0.1, 1];
export function priceRow(price: number) {
  const base = Math.round(price * 10 ** USDC_DECIMALS);
  return {
    price,
    networkPct: (SOLANA_FEE_USD / price) * 100,
    cardPct: ((CARD.pct * price + CARD.fixed) / price) * 100,
    rapFee: feeFor(base) / 10 ** USDC_DECIMALS,
  };
}

export const VOLUME_TODAY: Figure[] = [
  { value: '196 million', label: 'x402 payments to date across 12 chains, settling more than $42M', asOf: 'to 1 Nov 2026', source: S.fireblocks },
  { value: '$274,000', label: 'x402 value settled in October 2026, from 5.1 million payments', asOf: 'Oct 2026', source: S.fireblocks },
  { value: '~5¢', label: 'Average agent payment (68.3M payments, $3.7M)', asOf: 'Q3 2026', source: S.fireblocksAllium },
  { value: '87%+', label: 'Share of x402 payments worth between 0.01¢ and 10¢', asOf: '16 months to Sep 2026', source: S.fireblocksChainalysis },
  { value: '~70%', label: "Solana's share of monthly x402 value", asOf: 'mid-Aug 2026', source: S.solanaCompass },
  { value: '$0.001', label: 'Coinbase facilitator charge per settlement after 1,000 free a month', asOf: '20 Nov 2026', source: S.coinbase },
];

export const FORECASTS: Figure[] = [
  { value: '$255B', label: 'Global AI inference market in 2030 (from $106B in 2025)', asOf: 'forecast', source: S.mnm },
  { value: '$1.5T', label: 'Global agentic commerce spend in 2030', asOf: 'forecast', source: S.juniper },
];

export const TAM_USD = 254.98e9;
export type Scenario = { key: 'low' | 'base' | 'high'; samShare: number; somShare: number; volume2027: number };
/** Our estimates, not sourced figures. SAM = share of TAM bought per call by agents over open on-chain rails. SOM = share of SAM paid with a RAP receipt. */
export const SCENARIOS: Scenario[] = [
  { key: 'low', samShare: 0.005, somShare: 0.01, volume2027: 1e6 },
  { key: 'base', samShare: 0.02, somShare: 0.05, volume2027: 10e6 },
  { key: 'high', samShare: 0.05, somShare: 0.15, volume2027: 50e6 },
];
export const AVG_CALL_USD = 0.05;
export function scenarioRow(s: Scenario) {
  const sam = TAM_USD * s.samShare;
  const som = sam * s.somShare;
  return { ...s, sam, som, revenue2030: (som * FEE_BPS) / 10_000, revenue2027: (s.volume2027 * FEE_BPS) / 10_000, calls2030: som / AVG_CALL_USD };
}
export const REVENUE_TARGETS = [10_000, 100_000, 1_000_000, 10_000_000];
export const volumeFor = (revenue: number) => (revenue * 10_000) / FEE_BPS;

export const OCT_2026_X402_USD = 274_000;
export const SOURCES = S;
