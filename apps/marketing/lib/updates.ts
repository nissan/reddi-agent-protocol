// Build updates (the devlog). One typed record per update, kept in this file so a change is reviewed like code and the
// public-claim test (tests/claims.test.ts) reads every word. The same records feed /updates, each update's page, the
// sitemap and the newsletter issue that announces an update.
//
// Rules, enforced by tests/updates.test.ts:
//  - `status: "draft"` is shown only where reviewers look (previews and local builds; resolveShowDrafts in lib/site.ts).
//    Only "published" updates appear on the public site, in the sitemap or in an email.
//  - `newsletterSend: true` asks for the update to be emailed to confirmed subscribers once it is published and its
//    date has arrived. The reviewed, merged change that sets it is the owner's approval. Never set it without the owner.
//  - every update names at least one link where a reader can check what it says.
export type UpdateStatus = "draft" | "published";
export type Update = {
  slug: string;        // lower-case words joined by hyphens; the address is /updates/<slug>
  date: string;        // YYYY-MM-DD, meant as a calendar day in Sydney
  title: string;
  summary: string;     // one or two sentences; this is the body of the email
  body: readonly string[]; // paragraphs of plain text
  links: readonly { label: string; href: string }[];
  status: UpdateStatus;
  newsletterSend?: boolean;
};

export const UPDATES: readonly Update[] = [
  {
    slug: "devnet-sandbox-open",
    date: "2026-11-20",
    title: "The devnet sandbox is open",
    summary: "You can now walk through four short scenarios in the browser and see the receipt each one produces. Payments are simulated by default and nothing is on mainnet yet.",
    body: [
      "The sandbox is the first thing you can try. It runs four short scenarios: buy a code review, shop around between providers, try to cheat, and see what happens when a provider goes dark. Each one ends with the receipt the protocol produces, so you can read what was asked, what was paid and what came back.",
      "The default payment is simulated, so you do not need a wallet. A Solana devnet wallet is optional. The sandbox providers answer from a script, not from a running model, and every receipt says so.",
      "Nothing is on mainnet yet. The status page lists what exists today, what is being built and what is only planned.",
    ],
    links: [
      { label: "Open the sandbox", href: "https://app.agent-protocol.reddi.tech/sandbox" },
      { label: "Read the source", href: "https://github.com/nissan/reddi-agent-protocol" },
    ],
    status: "published",
    newsletterSend: true,
  },
  {
    slug: "per-token-pricing",
    date: "2026-11-21",
    title: "Prices are now per token",
    summary: "Providers now price by the token, the way most AI services do. You approve a maximum before each call, pay for the tokens used and get the rest back. It runs in the devnet sandbox with test funds.",
    body: [
      "Most AI services bill by the token, so a flat price per call never fitted inference well. Providers now list a price per million input tokens and per million output tokens.",
      "Before a call you see an estimate and approve a maximum. Your wallet locks that maximum in an on-chain escrow program. After the answer, the provider settles the cost of the tokens actually used and the program sends the rest back to you. The receipt shows the token counts, the cost and the settle transaction.",
      "One limit to know about: the provider reports the token count, and nothing on-chain checks it yet. So treat the maximum as the most a call can cost you. Receipts and spot checks are how a provider that over-reports gets found out.",
      "A protocol fee of 2.5% of what a call actually cost is planned for the first mainnet release. It would come out of the provider's share. No protocol fee is collected today.",
      "The escrow program was deployed to Solana devnet on 21 November 2026 and the sandbox uses it when you pay with a devnet wallet. It has not been reviewed by an outside auditor, and nothing is on mainnet yet.",
    ],
    links: [
      { label: "Try it in the sandbox", href: "https://app.agent-protocol.reddi.tech/sandbox" },
      { label: "Read the devnet deployment record", href: "https://github.com/nissan/reddi-agent-protocol/blob/main/DEPLOY.md" },
    ],
    status: "published",
    newsletterSend: true,
  },
  {
    slug: "new-app-look-and-sessions",
    date: "2026-11-22",
    title: "A provider kit on npm, sessions and ratings",
    summary: "Anyone can now run an inference provider: the provider kit and its payment libraries are published on npm. The developer app has a new look, the sandbox can run many calls on one locked maximum, and the V1 program carries job ratings and judge attestations. Mainnet is coming soon.",
    body: [
      "The developer app now matches this site: the same paper look, a dark mode that follows your system, and a switch for Auto, Light or Dark. The home page leads with what the protocol does: pay for an answer and keep the receipt.",
      "Solana's Request for Startups calls for a market where developers choose, verify and pay inference providers. A market like that needs providers on day one, so the tools to run one are now public. Three packages are on npm: @redditech/provider-kit, @redditech/agent-protocol and @redditech/x402-solana.",
      "Install the kit with npm i @redditech/provider-kit and it gives you a command called rap-provider. Point it at any OpenAI-compatible model, set a price per million input and output tokens, and buyers can pay you per token through the escrow program. Every paid answer carries a receipt signed by your wallet. Each package is published with SLSA provenance, so you can check it was built from this repository.",
      "Why Solana, in one line: agents pay often and in small amounts, so the payments need a public record anyone can check, a payment that confirms in under a second, and a network fee that is a tiny fraction of a cent. That is what keeps a one-cent call worth making for both the agent and the provider.",
      "Running a provider from the developer app is a short guided setup too. You set your prices and see what a typical call would cost a buyer before you publish it.",
      "The sandbox has sessions. You lock one maximum, make several calls against it, and the provider settles the real token cost once at the end, so a run of small calls pays one network fee instead of many.",
      "The V1 program, written in Pinocchio, adds two trust services for paid jobs. A buyer can opt in to rate a job, and a judge the buyer names can attest the work on chain. Both are recorded on chain against the job.",
      "All of this runs on Solana devnet today with test funds. Mainnet is coming soon, and the status page lists each piece with a link you can check.",
    ],
    links: [
      { label: "Get the provider kit on npm", href: "https://www.npmjs.com/package/@redditech/provider-kit" },
      { label: "Open the developer app", href: "https://app.agent-protocol.reddi.tech" },
      { label: "Try a session in the sandbox", href: "https://app.agent-protocol.reddi.tech/sandbox" },
      { label: "Read the V1 program", href: "https://github.com/nissan/reddi-agent-protocol/tree/main/programs/pinocchio-escrow" },
    ],
    status: "draft",
  },
  {
    slug: "launch-pricing",
    date: "2026-11-23",
    title: "Launch pricing for providers",
    summary: "The protocol fee will be 5% of what a call actually cost, with a launch rate of 2.5% until 31 March 2027. The first 100 services on mainnet can bring theirs down to 1.5%.",
    body: [
      "Solana's Request for Startups asks for a market where developers choose, verify and pay inference providers. A market like that needs providers first, so we are paying to bring good ones in early.",
      "The standard protocol fee will be 5% of what a call actually cost. It comes out of the provider's share, so a buyer's price doesn't change. Until 31 March 2027 the fee is 2.5%. The end date is a constant in the escrow program, so anyone can read when the launch rate ends. On SOL payments the fee never goes above 0.1 SOL.",
      "The first 100 services to take a paid job on mainnet become Founding Providers. Every 90 days for their first year, Founding Providers rated 4.5 stars or better, from at least 10 rated jobs by 5 different buyers, and ranked in the top 100 by volume get back every fee they paid above 1.5%.",
      "Ratings are on chain, so nobody has to take our word for who qualified. A rebate never exceeds the fees a provider paid, and one owner wallet can hold up to 3 seats.",
      "All of this starts with the mainnet release, which is coming soon. No protocol fee is collected today.",
    ],
    links: [
      { label: "Read the fee in the program", href: "https://github.com/nissan/reddi-agent-protocol/blob/main/programs/pinocchio-escrow/program/src/consts.rs" },
      { label: "See the numbers", href: "https://agent-protocol.reddi.tech/market" },
    ],
    status: "draft",
  },
  {
    slug: "judge-free-payback",
    date: "2026-11-28",
    title: "Judge-free Budgets: providers keep 100% until 1 April 2027",
    summary: "Get paid through a Budget with no judge before 1 April 2027 (UTC) and we pay the protocol fee back to you on that date, in the same token.",
    body: [
      "This is a new launch offer, and it is for providers. A Budget can name a judge, the RAP judge by default, or no judge at all. With no judge, a provider is paid as soon as the work is done.",
      "Until 1 April 2027, 00:00 UTC, a provider paid through a Budget with no judge keeps the whole payment. The fee still comes out at payout, as it does on every payout. On 1 April 2027 we pay back every fee taken on judge-free Budget payouts, from the RAP treasury to each provider's wallet, in the token it was paid in.",
      "The cut-off is when the payout lands. A Budget that pays out on or after 1 April 2027 pays the standard 5%, and nothing comes back.",
      "We didn't need to change the program for this. Every Budget records its judge when it opens, and every payout records the provider, the amount and the fee. We'll build the list from those records and publish it before the payback, so anyone can check it. Each wallet also gets a soulbound receipt NFT on Solana that records the amount. It is a record, not a token, an investment or a voucher.",
      "A Budget with no judge can't be disputed, so it suits providers a buyer already trusts. The RAP judge stays the default, because it protects the buyer. Buyers never pay the fee on top, with a judge or without one.",
    ],
    links: [
      { label: "Budget events in the program", href: "https://github.com/nissan/reddi-agent-protocol/tree/main/programs/pinocchio-escrow" },
      { label: "Pricing and fees", href: "https://app.agent-protocol.reddi.tech/pricing.md" },
    ],
    status: "draft",
  },
];

const byNewest = (a: Update, b: Update) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug.localeCompare(b.slug));

// What a visitor may see: published updates everywhere, drafts only where drafts are shown. Newest first.
export function visibleUpdates(showDrafts: boolean, updates: readonly Update[] = UPDATES): Update[] {
  return updates.filter((u) => u.status === "published" || showDrafts).sort(byNewest);
}

export function findUpdate(slug: string, showDrafts: boolean, updates: readonly Update[] = UPDATES): Update | null {
  return visibleUpdates(showDrafts, updates).find((u) => u.slug === slug) ?? null;
}

// Problems with the records, as readable lines; an empty list means they are valid. Run by the tests, so a bad record
// fails CI before it can reach a page or an email.
export function validateUpdates(updates: readonly Update[] = UPDATES): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const u of updates) {
    const at = u.slug || "(no slug)";
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(u.slug)) problems.push(`${at}: slug must be lower-case words joined by hyphens`);
    if (seen.has(u.slug)) problems.push(`${at}: slug is used twice`);
    seen.add(u.slug);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(u.date) || Number.isNaN(Date.parse(`${u.date}T00:00:00Z`))) problems.push(`${at}: date must be YYYY-MM-DD`);
    if (u.title.trim().length < 8 || u.title.length > 90) problems.push(`${at}: title must be 8 to 90 characters`);
    if (u.summary.trim().length < 40 || u.summary.length > 320) problems.push(`${at}: summary must be 40 to 320 characters`);
    if (u.body.length === 0 || u.body.some((p) => p.trim().length === 0)) problems.push(`${at}: body needs at least one paragraph and no empty ones`);
    if (u.links.length === 0) problems.push(`${at}: at least one link where the reader can check it`);
    for (const l of u.links) if (!/^https:\/\/[^\s]+$/.test(l.href) || l.label.trim().length === 0) problems.push(`${at}: link "${l.label}" must be a labelled https address`);
    if (u.status !== "draft" && u.status !== "published") problems.push(`${at}: status must be draft or published`);
  }
  return problems;
}
