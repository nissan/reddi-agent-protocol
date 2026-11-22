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
  feeIssue: { label: 'Fee design, pull request #792', url: 'https://github.com/nissan/reddi-agent-protocol/pull/792' },
  openRouterFee: { label: 'OpenRouter, platform fee (updated 11 Jun 2026)', url: 'https://openrouter.ai/announcements/simplifying-our-platform-fee' },
  anthropicPricing: { label: 'Anthropic pricing (21 Nov 2026)', url: 'https://platform.claude.com/docs/en/about-claude/pricing' },
  sweBench: { label: 'SWE-bench Verified run data', url: 'https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/master/data/leaderboards.json' },
} satisfies Record<string, Source>;

/**
 * Planned V1 fee: a standard 500 basis points (5%) of a call's actual cost, with a launch rate of 250 basis points
 * (2.5%) on every payout before 1 April 2027 00:00 UTC. The switch date is a constant in the escrow program
 * (LAUNCH_RATE_ENDS_UNIX in programs/pinocchio-escrow/program/src/consts.rs). Rounded down to the token's smallest
 * unit, taken out of the provider's share. Capped at 0.1 SOL on SOL payments; stablecoins have no ceiling.
 */
export const FEE_BPS = 500;
export const LAUNCH_FEE_BPS = 250;
export const LAUNCH_RATE_ENDS = '31 March 2027';
export const SOL_FEE_CAP = 0.1;
export const feeFor = (priceBaseUnits: number, bps: number = FEE_BPS) => Math.floor((priceBaseUnits * bps) / 10_000);

/**
 * Founding Providers: the first 100 services to take a paid job on mainnet. After each 90 days, for their first
 * 12 months, those holding 4.5 stars or better and ranking in the top 100 by volume get back every fee they paid
 * above 1.5%. Paid from the treasury; never more than the fees paid.
 */
export const FOUNDING = { seats: 100, effectiveBps: 150, periodDays: 90, months: 12, minStars: 4.5, minRatedJobs: 10, minBuyers: 5, rank: 100, seatsPerOwner: 3 } as const;
/** Share of 2027 volume carried by Founding Providers that qualify for the rebate. Our estimate, set high on purpose. */
export const FOUNDING_SHARE_2027 = 0.4;
/** 2027 blends one quarter at the launch rate with three at the standard rate. */
export const BLENDED_2027_BPS = (LAUNCH_FEE_BPS + 3 * FEE_BPS) / 4;
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
    launchFee: feeFor(base, LAUNCH_FEE_BPS) / 10 ** USDC_DECIMALS,
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
/** Average paid job (one locked maximum, settled once), our estimate. Single sub-cent calls are grouped into jobs or sessions. */
export const AVG_JOB_USD = 0.05;
export function scenarioRow(s: Scenario) {
  const sam = TAM_USD * s.samShare;
  const som = sam * s.somShare;
  const revenue2027 = (s.volume2027 * BLENDED_2027_BPS) / 10_000;
  const rebate2027 = (s.volume2027 * FOUNDING_SHARE_2027 * (BLENDED_2027_BPS - FOUNDING.effectiveBps)) / 10_000;
  return { ...s, sam, som, revenue2030: (som * FEE_BPS) / 10_000, revenue2027, rebate2027, net2027: revenue2027 - rebate2027, jobs2030: som / AVG_JOB_USD };
}
export const REVENUE_TARGETS = [10_000, 100_000, 1_000_000, 10_000_000];
export const volumeFor = (revenue: number) => (revenue * 10_000) / FEE_BPS;

export const OCT_2026_X402_USD = 274_000;

// ---- What real agent jobs cost: tokens per job times a mid-tier list price ----
/** Mid-tier list price per million tokens (Claude Sonnet 5.5), from the provider's pricing page. */
export const MID_TIER = { inputPerMillion: 2, outputPerMillion: 10, cacheReadShare: 0.05, cacheWriteShare: 1.25, model: 'Claude Sonnet 5.5', asOf: '21 Nov 2026', source: S.anthropicPricing };
export type JobCost = {
  task: string; inputTokens: number; outputTokens: number;
  /** Shares of input read from and written to the prompt cache, billed at MID_TIER's cache rates. */
  cachedShare?: number;
  cacheWrittenShare?: number;
  basis: string; measured: boolean; source?: Source; note?: string;
};
/** Median tokens per job. `measured` rows come from published run data; the rest are our estimates from the task research of 21 Nov 2026. */
export const JOB_COSTS: JobCost[] = [
  { task: 'Summarise a news article', inputTokens: 1_040, outputTokens: 75, basis: 'News summarisation datasets: about 780-word articles, 56-word summaries', measured: false },
  { task: 'Answer a question over your documents', inputTokens: 3_000, outputTokens: 250, basis: 'About 3 to 5 retrieved passages plus the question', measured: false },
  { task: 'Write unit tests for one file', inputTokens: 4_500, outputTokens: 2_000, basis: 'One source file plus instructions in, one test file out', measured: false },
  { task: 'Review a pull request (single pass)', inputTokens: 12_000, outputTokens: 1_500, basis: 'The change plus surrounding code and instructions in, a written review out', measured: false },
  { task: 'Fix a real bug as a coding agent', inputTokens: 194_000, outputTokens: 3_700, cachedShare: 0.936, cacheWrittenShare: 0.04, basis: 'Median of 100 sampled SWE-bench Verified runs: 23 model calls, 94% of input from cache', measured: true, source: S.sweBench },
  { task: 'Write a deep research report', inputTokens: 100_000, outputTokens: 10_000, basis: 'Multi-agent research uses about 15 times the tokens of a chat', measured: false, note: 'plus search fees' },
];
/** A job's cost at MID_TIER prices, in US dollars, with cache reads and writes at their list multiples of the input price. */
export function jobCost(j: JobCost): number {
  const read = j.inputTokens * (j.cachedShare ?? 0);
  const written = j.inputTokens * (j.cacheWrittenShare ?? 0);
  const fresh = j.inputTokens - read - written;
  const inputUnits = fresh + read * MID_TIER.cacheReadShare + written * MID_TIER.cacheWriteShare;
  return (inputUnits * MID_TIER.inputPerMillion + j.outputTokens * MID_TIER.outputPerMillion) / 1e6;
}
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
  { rfs: 'pay', ours: 'Per-token prices like any AI API, paid over x402 on Solana, with the payment bound to the receipt.' },
  { rfs: 'reputation', ours: 'Receipts and checks feed a provider record anyone can read.' },
  { rfs: 'payment channels', ours: 'The buyer locks a maximum, the provider settles the real token cost, and the rest comes back. Batched and streamed payment is on the roadmap.' },
];

// ---- Revenue roadmap: more lines beyond the 5% settlement fee. All amounts are our estimates. ----
export type Stage = 'First mainnet release' | 'Planned' | 'Exploring';
export type RevenueLine = {
  key: string; name: string; payer: string; fee: string; stage: Stage; rfs: string; nonCustodial: string;
  benchmark: { text: string; source: Source };
  /** 2030 protocol revenue in USD per scenario (our estimates). */
  revenue: (s: ReturnType<typeof scenarioRow>, a: Attach) => number;
};
/** checked = share of volume whose buyer pays a judge; JUDGE_FEE_SHARE = judge fee as a share of the attested job. */
export type Attach = { verified: number; checked: number; escrowMultiple: number; lookupsPerJob: number; providers: number; privateShare: number };
export const JUDGE_FEE_SHARE = 0.1;
export const ATTACH: Record<Scenario['key'], Attach> = {
  low: { verified: 0.1, checked: 0.05, escrowMultiple: 0.25, lookupsPerJob: 0.2, providers: 200, privateShare: 0.02 },
  base: { verified: 0.25, checked: 0.15, escrowMultiple: 0.5, lookupsPerJob: 0.5, providers: 2_000, privateShare: 0.05 },
  high: { verified: 0.4, checked: 0.3, escrowMultiple: 1, lookupsPerJob: 1, providers: 10_000, privateShare: 0.1 },
};
const BENCH = {
  near: { label: 'NEAR AI Cloud', url: 'https://near.ai/cloud' },
  jupiter: { label: 'Jupiter docs', url: 'https://developers.jup.ag/docs/ultra/fees.md' },
  uma: { label: 'UMA docs', url: 'https://docs.uma.xyz/developers/setting-custom-bond-and-liveness-parameters' },
  graph: { label: 'The Graph pricing', url: 'https://thegraph.com/pricing.md' },
  arcium: { label: 'Arcium docs', url: 'https://docs.arcium.com/computations/pricing-and-incentives' },
} satisfies Record<string, Source>;

export const REVENUE_LINES: RevenueLine[] = [
  { key: 'settle', name: 'Settlement fee', payer: 'Provider, out of every paid call and escrow job', fee: '5% of the actual cost (2.5% launch rate until 31 March 2027), at most 0.1 SOL on SOL payments', stage: 'First mainnet release', rfs: 'pay',
    nonCustodial: 'The escrow program splits the payment when the call settles. The treasury only receives.', benchmark: { text: 'OpenRouter charges 5.5% on card top-ups and 5% in crypto', source: S.openRouterFee },
    revenue: (s) => s.som * 0.05 },
  { key: 'verified', name: 'Verified receipts', payer: 'Buyer who wants a receipt backed by a hardware (TEE) attestation or a proof', fee: '+0.20% on that call', stage: 'Planned', rfs: 'verify',
    nonCustodial: 'Same split as the settlement fee. We check the evidence, never the funds.', benchmark: { text: 'Private TEE inference sells at the ordinary per-token price', source: BENCH.near },
    revenue: (s, a) => s.som * a.verified * 0.002 },
  { key: 'checks', name: 'Independent spot checks', payer: 'Buyer who opts into attestors re-running sampled calls', fee: '10% of the attestor’s fee', stage: 'Planned', rfs: 'verify',
    nonCustodial: 'Buyer pays the attestor directly; the protocol share is split in the same transaction.', benchmark: { text: 'Jupiter keeps 20% of integrator fees', source: BENCH.jupiter },
    revenue: (s, a) => s.som * a.checked * JUDGE_FEE_SHARE * 0.1 },
  { key: 'lookups', name: 'Reputation and receipt lookups', payer: 'Agents checking a provider before they pay', fee: '$0.0002 per lookup, paid over x402', stage: 'Planned', rfs: 'reputation',
    nonCustodial: 'The record stays public on-chain. Anyone can run their own index; we sell the fast path.', benchmark: { text: 'The Graph sells queries at $2 per 100,000', source: BENCH.graph },
    revenue: (s, a) => s.jobs2030 * a.lookupsPerJob * 0.0002 },
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
