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

// ---- The Solana RFS this case builds on, and proof we were building before it ----
export const RFS = {
  url: 'https://solana.com/request-for-startups#ai-inference-marketplace',
  title: 'An open marketplace for AI inference',
  author: 'Jacob Creech, VP Technology, Solana Foundation',
  thesis: 'Let developers choose, verify, and pay inference providers through one interface.',
  whyNow: 'Jacob Creech sees an opening where unified model access meets verifiable inference and payment channels.',
  published: '9 November 2026',
  publishedSource: { label: 'KuCoin News, 9 Nov 2026', url: 'https://www.kucoin.com/news/flash/solana-publishes-11-startup-ideas-covering-ai-housing-and-stablecoins' },
} as const;

export const BUILD_HISTORY: Figure[] = [
  { value: '23 Mar 2026', label: 'First commit of Reddi Agent Protocol, 7½ months before the RFS', asOf: 'public git history', source: { label: 'GitHub', url: 'https://github.com/nissan/reddi-agent-protocol/commits/main?since=2026-03-23&until=2026-03-24' } },
  { value: '5 Apr 2026', label: 'Our x402 payment library for Solana started', asOf: 'public git history', source: { label: 'GitHub', url: 'https://github.com/nissan/reddi-agent-protocol/commits/main/packages/x402-solana' } },
  { value: '899', label: 'Commits made before the RFS was published', asOf: 'to 9 Nov 2026', source: { label: 'GitHub', url: 'https://github.com/nissan/reddi-agent-protocol/commits/main?until=2026-11-09' } },
];

/** How each RFS ask maps to what we build. `rfs` is the RFS's own wording (quoted on the page). */
export const RFS_MAP = [
  { rfs: 'choose', ours: 'An OpenAI-style request to any registered provider, and a public reputation to choose by.' },
  { rfs: 'verify', ours: 'A provider-signed receipt naming the model it says it ran, with hashes of the request and response.' },
  { rfs: 'pay', ours: 'Per-call payment over x402 on Solana, with the payment bound to the receipt.' },
  { rfs: 'reputation', ours: 'Receipts and checks feed a provider record anyone can read.' },
  { rfs: 'payment channels', ours: 'Escrow for larger jobs today; batched and streamed payment is on the roadmap.' },
];

// ---- Revenue roadmap: more lines beyond the 5 bps settlement fee. All amounts are our estimates. ----
export type Stage = 'First mainnet release' | 'Planned' | 'Exploring';
export type RevenueLine = {
  key: string; name: string; payer: string; fee: string; stage: Stage; rfs: string; nonCustodial: string;
  benchmark: { text: string; source: Source };
  /** 2030 protocol revenue in USD per scenario (our estimates). */
  revenue: (s: ReturnType<typeof scenarioRow>, a: Attach) => number;
};
export type Attach = { verified: number; checked: number; escrowMultiple: number; lookupsPerCall: number; providers: number; privateShare: number };
export const ATTACH: Record<Scenario['key'], Attach> = {
  low: { verified: 0.1, checked: 0.05, escrowMultiple: 0.25, lookupsPerCall: 0.2, providers: 200, privateShare: 0.02 },
  base: { verified: 0.25, checked: 0.15, escrowMultiple: 0.5, lookupsPerCall: 0.5, providers: 2_000, privateShare: 0.05 },
  high: { verified: 0.4, checked: 0.3, escrowMultiple: 1, lookupsPerCall: 1, providers: 10_000, privateShare: 0.1 },
};
const BENCH = {
  uniswap: { label: 'Uniswap', url: 'https://blog.uniswap.org/unification' },
  near: { label: 'NEAR AI Cloud', url: 'https://near.ai/cloud' },
  jupiter: { label: 'Jupiter docs', url: 'https://developers.jup.ag/docs/ultra/fees.md' },
  akash: { label: 'Akash AEP-76', url: 'https://akash.network/roadmap/aep-76/' },
  uma: { label: 'UMA docs', url: 'https://docs.uma.xyz/developers/setting-custom-bond-and-liveness-parameters' },
  graph: { label: 'The Graph pricing', url: 'https://thegraph.com/pricing.md' },
  arcium: { label: 'Arcium docs', url: 'https://docs.arcium.com/computations/pricing-and-incentives' },
} satisfies Record<string, Source>;

export const REVENUE_LINES: RevenueLine[] = [
  { key: 'settle', name: 'Settlement fee', payer: 'Buyer, on each direct per-call payment', fee: '0.05% of the listed price', stage: 'First mainnet release', rfs: 'pay',
    nonCustodial: 'Split inside the buyer’s own payment transaction.', benchmark: { text: 'Uniswap’s protocol share is 1/6 of the swap fee', source: BENCH.uniswap },
    revenue: (s) => s.som * 0.0005 },
  { key: 'verified', name: 'Verified receipts', payer: 'Buyer who wants a receipt backed by a hardware (TEE) attestation or a proof', fee: '+0.20% on that call', stage: 'Planned', rfs: 'verify',
    nonCustodial: 'Same split as the settlement fee. We check the evidence, never the funds.', benchmark: { text: 'Private TEE inference sells at the ordinary per-token price', source: BENCH.near },
    revenue: (s, a) => s.som * a.verified * 0.002 },
  { key: 'checks', name: 'Independent spot checks', payer: 'Buyer who opts into attestors re-running sampled calls', fee: '10% of the attestor’s fee', stage: 'Planned', rfs: 'verify',
    nonCustodial: 'Buyer pays the attestor directly; the protocol share is split in the same transaction.', benchmark: { text: 'Jupiter keeps 20% of integrator fees', source: BENCH.jupiter },
    revenue: (s, a) => s.som * a.checked * 0.03 * 0.1 },
  { key: 'escrow', name: 'Escrow for larger jobs', payer: 'Buyer, when a job is released', fee: '0.25% on release', stage: 'Planned', rfs: 'payment channels',
    nonCustodial: 'Funds sit in the on-chain program and move only by its rules.', benchmark: { text: 'Akash is moving to a spread of up to 25 bps', source: BENCH.akash },
    revenue: (s, a) => s.som * a.escrowMultiple * 0.0025 },
  { key: 'lookups', name: 'Reputation and receipt lookups', payer: 'Agents checking a provider before they pay', fee: '$0.0002 per lookup, paid over x402', stage: 'Planned', rfs: 'reputation',
    nonCustodial: 'The record stays public on-chain. Anyone can run their own index; we sell the fast path.', benchmark: { text: 'The Graph sells queries at $2 per 100,000', source: BENCH.graph },
    revenue: (s, a) => s.calls2030 * a.lookupsPerCall * 0.0002 },
  { key: 'disputes', name: 'Disputes and judgments', payer: 'The losing side of an escrow dispute', fee: 'Half of the losing bond', stage: 'Exploring', rfs: 'reputation',
    nonCustodial: 'Bonds held by the program; staked jurors decide, not us.', benchmark: { text: 'UMA sends the unpaid half of a losing bond to its protocol', source: BENCH.uma },
    revenue: (s, a) => s.som * a.escrowMultiple * 0.005 * 0.05 * 0.5 },
  { key: 'listing', name: 'Provider listing and bonds', payer: 'Providers, yearly; slashed bonds after a proven misreport', fee: 'About $50 a year', stage: 'Exploring', rfs: 'choose',
    nonCustodial: 'Bonds held by the registry program; slashing only on evidence anyone can check.', benchmark: { text: 'Today’s registration burns 0.01 SOL', source: { label: 'Reddi Agent Protocol', url: 'https://github.com/nissan/reddi-agent-protocol' } },
    revenue: (_s, a) => a.providers * 50 },
  { key: 'private', name: 'Private receipts', payer: 'Buyer who wants the prompt and receipt kept private', fee: '+0.10% on that call', stage: 'Exploring', rfs: 'verify',
    nonCustodial: 'Confidential transfers and encrypted receipts; we never see the plain text.', benchmark: { text: 'Arcium prices private compute per unit, set by its node operators', source: BENCH.arcium },
    revenue: (s, a) => s.som * a.privateShare * 0.001 },
];

export function stackRow(s: Scenario) {
  const row = scenarioRow(s);
  const lines = REVENUE_LINES.map((l) => ({ key: l.key, revenue: l.revenue(row, ATTACH[s.key]) }));
  const total = lines.reduce((t, l) => t + l.revenue, 0);
  return { ...row, lines, total, effectiveBps: (total / row.som) * 10_000 };
}
