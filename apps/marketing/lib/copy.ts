// All of the site's factual claims live here so one test (tests/claims.test.ts) can hold them to the repository's
// public-claim boundary (docs/PUBLIC-CLAIM-BOUNDARY.md at the repository root). Edit status rows only when the
// thing they describe has actually changed; each row names where a reader can check it.

export const SITE_NAME = "Reddi Agent Protocol";
export const X_HANDLE = "@reddiagent";
export const X_URL = "https://x.com/reddiagent";
export const GITHUB_URL = "https://github.com/nissan/reddi-agent-protocol";
export const RFS_URL = "https://solana.com/request-for-startups#ai-inference-marketplace";
export const CENTRAL_MESSAGE = "Payments prove transfer; RAP Assurance proves paid work.";
export const DEFAULT_DESCRIPTION = "Receipted AI inference on Solana: an OpenAI-style request, a per-call x402 payment, and a signed receipt that names the provider and the model it declared. In development; nothing is on mainnet yet.";

// The stage line shown in the header strip, the hero and the footer. One place, so it changes once.
export const STAGE = "In development. Devnet today. Nothing is on mainnet yet.";

export const STEPS = [
  { n: "01", title: "Ask", body: "Your app or agent sends an ordinary OpenAI-style chat request to a provider's endpoint. No new SDK to learn." },
  { n: "02", title: "Pay", body: "The provider answers with an x402 payment request. Your client pays for that one call on Solana, in SOL or USDC, and retries." },
  { n: "03", title: "Get the receipt", body: "The answer comes back with a receipt signed by the provider. It names the provider, the model the provider says it ran, hashes of the request and response, and the payment transaction." },
  { n: "04", title: "Build the record", body: "Receipts and spot checks by independent attestors become a provider's public track record, so the next buyer has something to go on." },
] as const;

export const LAYERS = [
  { key: "choose", title: "Choose", who: "Gateways and registries", body: "One request shape across many independent providers. Others are building this, and RAP is designed to sit beside them.", ours: false },
  { key: "verify", title: "Verify", who: "Reddi Agent Protocol", body: "A signed receipt for every paid call, and a track record built from receipts and spot checks. This is the part we are building.", ours: true },
  { key: "pay", title: "Pay", who: "x402 on Solana", body: "Per-call payment over an open standard, settled on Solana. RAP records the payment reference; it does not move or hold the money.", ours: false },
] as const;

export type StatusRow = { item: string; note: string; where: string; href: string };
export const STATUS: { exists: StatusRow[]; building: StatusRow[]; planned: StatusRow[] } = {
  exists: [
    { item: "Open-source receipt and conformance packages", note: "Receipt envelopes, policy decisions, replay fixtures and conformance checks that run locally and offline.", where: "packages/ in the repository", href: `${GITHUB_URL}/tree/main/packages` },
    { item: "x402 payment checks for Solana", note: "Helpers that check a payment proof against the transaction, the network and the amount, and refuse a replayed one.", where: "packages/x402-solana", href: `${GITHUB_URL}/tree/main/packages/x402-solana` },
    { item: "A devnet demo app", note: "Walkthroughs of registering a specialist, a paid call and the receipt that follows, on Solana devnet with test funds.", where: "The developer demo", href: resolveAppUrl(process.env.NEXT_PUBLIC_APP_URL) },
    { item: "On-chain reference program (source)", note: "Anchor source and tests for the registry and escrow instructions. It is reference source: not reviewed by an outside auditor and not deployed to mainnet.", where: "programs/escrow", href: `${GITHUB_URL}/tree/main/programs/escrow` },
  ],
  building: [
    { item: "OpenAI-style interface with a model-naming receipt", note: "The request shape developers already use, answered with a receipt.", where: "Issue 739", href: `${GITHUB_URL}/issues/739` },
    { item: "Real per-call x402 payment", note: "Replacing the demo's simulated buyer payment with a real one, with spend limits.", where: "Issue 738", href: `${GITHUB_URL}/issues/738` },
    { item: "Wallet sign-in and accounts", note: "So providers and buyers can see their own receipts and history.", where: "Issue 740", href: `${GITHUB_URL}/issues/740` },
    { item: "Focused security review", note: "A scoped review of the program and payment path before any mainnet step. This is a review in progress, not a completed audit.", where: "Issue 737", href: `${GITHUB_URL}/issues/737` },
  ],
  planned: [
    { item: "Guarded beta on Solana mainnet", note: "A small first release with SOL and USDC and low per-job limits. Planned; no date is promised.", where: "Issue 736", href: `${GITHUB_URL}/issues/736` },
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

export const SCENARIOS = [
  { tag: "BUYER", title: "Did I get the model I paid for?", body: "Send the same prompt to two providers. Compare the receipts: who answered, which model each one declared, what each call cost." },
  { tag: "AGENT", title: "Give an agent a budget, not a blank cheque.", body: "Set a spend limit, let an agent buy inference call by call, and read the receipt trail it leaves behind." },
  { tag: "PROVIDER", title: "Earn a track record from your first call.", body: "Stand up a test provider, serve a paid request, and watch a signed receipt become the first line of your public record." },
] as const;

export const FAQ = [
  { q: "Can I use it today?", a: "You can read the code, run the packages locally and walk through the devnet demo. The guarded beta is not open, and nothing runs on Solana mainnet yet. Sign up below and we will tell you when that changes." },
  { q: "Is this a marketplace?", a: "No. Solana's request describes an open marketplace where developers choose, verify and pay inference providers. We are building the verify part: receipts and track records that any gateway, registry or marketplace can use." },
  { q: "Does a receipt prove which model ran?", a: "Not by itself, and we will not say it does. A receipt is the provider's signed statement of which model answered, bound to the hashes of your request and the response and to the payment. Independent spot checks test those statements over time. That is evidence you can check and hold a provider to, not a mathematical proof of execution." },
  { q: "What is x402?", a: "An open payment handshake built on the web's 402 Payment Required status. A provider answers an unpaid request with its price; your client pays and retries with proof of payment. Providers are protected from unpaid calls, and buyers see the price before they pay." },
  { q: "What is an attestor?", a: "An independent checker. An attestor samples a provider's answers and tests them against what the receipt says, such as the declared model. The results feed the provider's track record. Attestors are part of the design being built; none is running on mainnet." },
  { q: "Who holds my money?", a: "For a single inference call, you pay the provider directly over x402. RAP records the payment reference in the receipt and never holds the funds." },
  { q: "What will it cost?", a: "The code is open source. Providers set their own prices per call. Any protocol fee is a plan, not something that exists today." },
  { q: "What is RAP Assurance?", a: `It is the name of the open receipt and conformance layer inside Reddi Agent Protocol. Its one-line summary: ${CENTRAL_MESSAGE}` },
] as const;
