// All of the site's factual claims live here so one test (tests/claims.test.ts) can hold them to the repository's
// public-claim boundary (docs/PUBLIC-CLAIM-BOUNDARY.md at the repository root). Edit status rows only when the
// thing they describe has actually changed; each row names where a reader can check it.

export const SITE_NAME = "Reddi Agent Protocol";
export const X_HANDLE = "@reddiagent";
export const X_URL = "https://x.com/reddiagent";
export const GITHUB_URL = "https://github.com/nissan/reddi-agent-protocol";
export const RFS_URL = "https://solana.com/request-for-startups#ai-inference-marketplace";
export const CENTRAL_MESSAGE = "Payments prove transfer; RAP Assurance proves paid work.";
// Launch switch (#1151): set NEXT_PUBLIC_RAP_MAINNET_LIVE=true on the production project only after runbook
// section 6 has verified a collected fee on mainnet. It switches the stage line and the fee wording below; the app
// reads the same variable. Owner decision, 26 November 2026: Budgets launch on mainnet, single paid calls stay on
// devnet for now.
export const MAINNET_LIVE = process.env.NEXT_PUBLIC_RAP_MAINNET_LIVE?.trim() === "true";

export const DEFAULT_DESCRIPTION = MAINNET_LIVE
  ? "Receipted AI inference on Solana: an OpenAI-style request, an x402 payment priced per token, and a signed receipt that names the provider, the model it declared and the tokens used. Budgets run on Solana mainnet; single paid calls run on devnet for now."
  : "Receipted AI inference on Solana: an OpenAI-style request, an x402 payment priced per token, and a signed receipt that names the provider, the model it declared and the tokens used. Running on Solana devnet today. Mainnet is coming soon.";

// The stage line shown in the header strip, the hero and the footer. One place, so it changes once.
export const STAGE = MAINNET_LIVE
  ? "Budgets run on Solana mainnet. Single paid calls run on devnet with test funds for now."
  : "Running on Solana devnet. Mainnet is coming soon.";

export const STEPS = [
  { n: "01", title: "Ask", body: "Your app or agent sends an ordinary OpenAI-style chat request to a provider's endpoint. No new SDK to learn." },
  { n: "02", title: "Pay", body: "The provider answers with an x402 payment request. It gives a price per million tokens, an estimate for this call and the most the call could cost. Your client approves a maximum, locks it on Solana and retries. At launch it can pay in SOL, USDC, AUDD or one of several other supported stablecoins." },
  { n: "03", title: "Get the receipt", body: "The answer comes back with a receipt signed by the provider. It names the provider, the model the provider says it ran, the tokens used, hashes of the request and response, and the payment transaction. You pay for the tokens used and the rest of your maximum comes back to you." },
  { n: "04", title: "Build the record", body: "Receipts and spot checks by independent attestors become a provider's public track record, so the next buyer has something to go on." },
] as const;

export const LAYERS = [
  { key: "choose", title: "Choose", who: "Gateways and registries", body: "One request shape across many independent providers. Others are building this, and RAP is designed to sit beside them.", ours: false },
  { key: "verify", title: "Verify", who: "Reddi Agent Protocol", body: "A signed receipt for every paid call, and a track record built from receipts and spot checks. This is the part we are building.", ours: true },
  { key: "pay", title: "Pay", who: "x402 on Solana", body: "Payment over an open standard, priced per token and settled on Solana. The buyer's maximum sits in an on-chain escrow program until the provider settles the real cost. No Reddi company account or server holds the money.", ours: false },
] as const;

// Launch pricing for providers. The figures must match the escrow program (programs/pinocchio-escrow/program/src/consts.rs:
// PROTOCOL_FEE_BPS, LAUNCH_FEE_BPS, LAUNCH_RATE_ENDS_UNIX, SOL_FEE_CAP_LAMPORTS) and apps/marketing/lib/market.ts.
export const LAUNCH_OFFER = {
  eyebrow: "05 / FOR PROVIDERS",
  headline: "Sell inference. Keep more of it.",
  lede: "The protocol fee will be 5% of what a call actually cost, taken from the provider's share. Until 31 March 2027 it is 2.5%, a date set in the escrow program. On Budgets with no judge, we pay even that back.",
  cards: [
    { figure: "100%", title: "Judge-free Budgets", body: "Get paid through a Budget with no judge before 1 April 2027 (UTC) and you keep all of it. The fee still comes out at payout. On 1 April 2027 we pay all of it back to your wallet, in the token you were paid in." },
    { figure: "2.5%", title: "Launch rate", body: "On every payout up to the end of 31 March 2027 (UTC). On SOL payments the fee never goes above 0.1 SOL, at either rate." },
    { figure: "1.5%", title: "Founding Providers", body: "For the first 100 services to take a paid job on mainnet. Every 90 days for your first year, if buyers rate you 4.5 stars or better and you rank in the top 100 by volume, we pay back every fee you paid above 1.5%." },
    { figure: "4.5★", title: "Rated on chain", body: "Ratings live on Solana, so nobody has to take our word for who qualified. The score needs at least 10 rated jobs from 5 different buyers." },
  ],
  note: MAINNET_LIVE
    ? "The launch rate applies to mainnet payouts up to the end of 31 March 2027 (UTC). Up to 3 Founding seats per owner wallet, and a rebate never exceeds the fees paid."
    : "Fees are planned for the first mainnet release. None is collected today. Up to 3 Founding seats per owner wallet, and a rebate never exceeds the fees paid.",
  // Judge-free payback (owner decision, 28 November 2026; epic #1260, brief rap-marketing/judge-free-rebate/brief.md).
  // No program change: BudgetOpened records the judge, BudgetPaid the provider, fee and slot. Exclusions (Nissan,
  // 28 November 2026): RAP's own providers and the RAP treasury.
  judgeFree: "The payback covers Budget payouts that land before 1 April 2027, 00:00 UTC. A payout after that pays the standard 5% and nothing comes back. RAP's own providers and the RAP treasury are left out. We'll publish the list before the payback, built from the program's own on-chain records, so anyone can check it. Each wallet also gets a soulbound receipt NFT on Solana that records the amount. It is a record, not a token, an investment or a voucher. A Budget with no judge can't be disputed, so buyers should pick it only for providers they trust. The RAP judge stays the default.",
  cta: "Tell me when it opens",
} as const;

export type StatusRow = { item: string; note: string; where: string; href: string };
export const STATUS: { exists: StatusRow[]; building: StatusRow[]; planned: StatusRow[] } = {
  exists: [
    { item: "Open-source receipt and conformance packages", note: "Receipt envelopes, policy decisions, replay fixtures and conformance checks that run locally and offline.", where: "packages/ in the repository", href: `${GITHUB_URL}/tree/main/packages` },
    { item: "x402 payment checks for Solana", note: "Helpers that check a payment proof against the transaction, the network and the amount, and refuse a replayed one.", where: "packages/x402-solana", href: `${GITHUB_URL}/tree/main/packages/x402-solana` },
    { item: "A devnet sandbox", note: "Four short scenarios in the browser, each ending in a receipt. Prices are per token. With a devnet wallet, a call locks your maximum in the escrow program and the provider settles the real cost. A session lets several calls share one locked maximum and settle once. Test funds only.", where: "The devnet sandbox", href: `${resolveAppUrl(process.env.NEXT_PUBLIC_APP_URL)}/sandbox` },
    { item: "On-chain program, on devnet", note: "The registry and the metered escrow, deployed to Solana devnet on 21 November 2026. The V1 program is written in Pinocchio, about a sixth of the size of the first build, and adds opt-in job ratings and judge attestations for paid jobs.", where: "programs/pinocchio-escrow", href: `${GITHUB_URL}/tree/main/programs/pinocchio-escrow` },
  ],
  building: [
    { item: "OpenAI-style interface with a model-naming receipt", note: "The request shape developers already use, answered with a receipt.", where: "Issue 739", href: `${GITHUB_URL}/issues/739` },
    { item: "Real x402 payment, priced per token", note: "Paying from the buyer's own wallet up to a maximum the buyer approves. It works in the devnet sandbox; the rest of the app is being finished.", where: "Issue 738", href: `${GITHUB_URL}/issues/738` },
    { item: "Wallet sign-in and accounts", note: "So providers and buyers can see their own receipts and history.", where: "Issue 740", href: `${GITHUB_URL}/issues/740` },
    { item: "Focused security review", note: "A scoped review of the program and payment path before the mainnet release. The review is under way.", where: "Issue 1154", href: `${GITHUB_URL}/issues/1154` },
  ],
  planned: [
    { item: "Guarded beta on Solana mainnet", note: "A small first release with SOL, USDC, AUDD, PYUSD and USDG and low per-job limits. Planned; no date is promised.", where: "Issue 1172", href: `${GITHUB_URL}/issues/1172` },
    { item: "Public provider track records", note: "A page per provider built from receipts and attestor spot checks.", where: "Planned", href: GITHUB_URL },
    { item: "Bug bounty", note: "Planned for after the guarded beta opens.", where: "Planned", href: GITHUB_URL },
  ],
};

// The developer app is a separate deployment. NEXT_PUBLIC_APP_URL (https only, build time) names its address; the default is
// its long-standing vercel.app address, which keeps working wherever the custom domain points.
export function resolveAppUrl(raw: string | undefined): string {
  const fallback = "https://reddi-agent-protocol.vercel.app";
  if (!raw) return fallback;
  try { const u = new URL(raw.trim()); return u.protocol === "https:" ? u.origin : fallback; } catch { return fallback; }
}
export const APP_URL = resolveAppUrl(process.env.NEXT_PUBLIC_APP_URL);
export const DEV_LINKS = [
  { title: "Start here", body: "Pick a path: run agents, build a specialist, or check the recorded proofs.", path: "/start" },
  { title: "Developer FAQ", body: "Registration, endpoints, health checks and x402 in practice.", path: "/faq" },
  { title: "Playbook", body: "A bounded demo run first, then what to build.", path: "/playbook" },
  { title: "Spec and whitepaper", body: "The agent description spec and the working whitepaper draft.", path: "/spec" },
] as const;

// The four scenarios mirror the devnet sandbox catalog in the developer app (lib/sandbox/catalog.ts at the repository root).
// `id` is the sandbox's own scenario id and becomes the ?scenario= deep link; keep the two lists in step.
export const SCENARIOS = [
  { id: "buy-a-review", tag: "BUYER", title: "Buy a code review.", body: "One request, one small payment, one receipt you can check yourself: the provider, the declared model, and hashes of what was asked and answered." },
  { id: "shop-around", tag: "AGENT", title: "Shop around.", body: "Same prompt, three prices, three track records. The cheapest provider fails a spot check, and its score drops where you can see it." },
  { id: "try-to-cheat", tag: "ADVERSARY", title: "Try to cheat.", body: "Reuse a payment, underpay, or edit the answer afterwards. See what each attempt runs into." },
  { id: "provider-offline", tag: "FAILURE", title: "Provider goes dark.", body: "Call a provider that is listed but not answering. Nothing is paid and no receipt is written." },
] as const;

export const FAQ = [
  { q: "Can I use it today?", a: "Yes, on Solana devnet. Read the code, run the packages locally and try the devnet sandbox with test funds. The guarded beta on Solana mainnet is coming soon. Sign up below and we will tell you the day it opens." },
  { q: "Is this a marketplace?", a: "No. Solana's request describes an open marketplace where developers choose, verify and pay inference providers. We are building the verify part: receipts and track records that any gateway, registry or marketplace can use." },
  { q: "Does a receipt prove which model ran?", a: "Not by itself, and we will not say it does. A receipt is the provider's signed statement of which model answered, bound to the hashes of your request and the response and to the payment. Independent spot checks test those statements over time. That is evidence you can check and hold a provider to, not a mathematical proof of execution." },
  { q: "What is x402?", a: "An open payment handshake built on the web's 402 Payment Required status. A provider answers an unpaid request with its price; your client pays and retries with proof of payment. Providers are protected from unpaid calls, and buyers see the price before they pay." },
  { q: "What is an attestor?", a: "An independent checker. An attestor samples a provider's answers and tests them against what the receipt says, such as the declared model. The results feed the provider's track record. The first mainnet release includes judge attestations: a judge the buyer names can attest a paid job on chain." },
  { q: "Who holds my money?", a: "Your wallet locks the maximum you approved in an on-chain escrow program. After the answer, the provider settles the real token cost and the program sends the rest back to you. No Reddi company account or server holds your money. The provider reports the token count, so treat the maximum as the most a call can cost you." },
  { q: "What will it cost?", a: "The code is open source. Providers set their own prices per million input and output tokens, and you approve a maximum before each call. A protocol fee is planned for the first mainnet release: 5% of what a call actually cost, with a launch rate of 2.5% until 31 March 2027. It comes out of the provider's share, so it adds nothing to your price. On Budgets with no judge, we'll pay the fee back to providers on 1 April 2027 for every payout before that date. No protocol fee is collected today." },
  { q: "What is a Founding Provider?", a: "One of the first 100 services to take a paid job on mainnet. Every 90 days for their first year, Founding Providers rated 4.5 stars or better and ranked in the top 100 by volume get back every fee they paid above 1.5%. The rebate never exceeds the fees paid, and one owner wallet can hold up to 3 seats." },
  { q: "What is the judge-free payback?", a: "Until 1 April 2027 (UTC), a provider paid through a Budget with no judge keeps the whole payment. The fee still comes out at payout, as it does on every payout. On 1 April 2027 we pay back every fee taken on judge-free Budget payouts, from the RAP treasury to each provider's wallet, in the same token. Each wallet also gets a soulbound receipt NFT on Solana that records the amount. The cut-off is when the payout lands: from 1 April 2027, 00:00 UTC, payouts pay the standard 5% and nothing comes back. RAP's own providers and the RAP treasury are left out. The list comes from the program's own on-chain records, and we'll publish it before the payback so anyone can check it." },
  { q: "Should a buyer pick a Budget with no judge?", a: "Only with providers you trust. With no judge, a provider is paid as soon as the work is done and nothing can be disputed. The RAP judge is the default because it protects you: it checks what a provider claims against its signed receipts and can send money back to you. The payback is for providers. Buyers never pay the fee on top, with a judge or without one." },
  { q: "What is RAP Assurance?", a: `It is the name of the open receipt and conformance layer inside Reddi Agent Protocol. Its one-line summary: ${CENTRAL_MESSAGE}` },
] as const;

// Why Solana (owner direction, 23 November 2026). Agent payments are many and small, so they need a public ledger
// both sides can check, settling faster than an agent waits and cheaply enough that a one-cent call is still worth
// making. Figures match lib/market.ts (FEE_FACTS) and their sources.
export const WHY_SOLANA = {
  eyebrow: "02 / WHY SOLANA",
  headline: "Agents pay often. The rails have to keep up.",
  lede: "An agent can call a provider hundreds of times a day, and every call is a payment that both sides should be able to check later. That takes a public, verifiable ledger. It also has to confirm faster than the agent is willing to wait, and cost so little that a one-cent call is still worth making for the buyer and the provider.",
  points: [
    { value: "Under a second", label: "For a payment to confirm, so the agent is not left waiting on its answer." },
    { value: "~0.000005 SOL", label: "Network fee per transaction, a tiny fraction of a cent. Still tiny with a priority fee added." },
    { value: "~$0.003", label: "Network fees for a whole metered call, lock and settle together, on a $0.04 code review. Measured on devnet." },
    { value: "Public record", label: "Every lock and settle is on chain, so anyone can check a receipt against the payment." },
  ],
  close: "A ten-cent code review can't carry a 30-cent card fee or a multi-second wait. Solana gives every payment a public record, confirms it in under a second and charges a fraction of a cent, so the agent and the provider both stay ahead on every call. That is why the open inference marketplace in Solana's Request for Startups can work here.",
} as const;
