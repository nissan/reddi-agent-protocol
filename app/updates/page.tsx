import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Project Updates",
  description:
    "What changed on Reddi Agent Protocol and why, newest first, including the plans we changed.",
};

type UpdateEntry = {
  date: string;
  title: string;
  /** A short lead paragraph, used when an entry explains a decision. */
  lead?: string;
  items: string[];
  note?: string;
};

// Newest first — prepend new entries to the top of this array.
const updates: UpdateEntry[] = [
  {
    date: "2026-11-26",
    title: "Change of plan: Budgets go to mainnet first, pay-per-call stays on devnet",
    lead: "We changed which way of paying goes to mainnet first. This is what we planned, what we are doing instead, and why.",
    items: [
      "What we planned: open on Solana mainnet on 5 December with pay-per-call, where your wallet locks the maximum for one call and the provider settles the real cost. Budgets were to follow about a week later.",
      "What we are doing instead: Budgets are planned to open on mainnet on 5 December. Pay-per-call stays on devnet with test funds for now, on the Try one call page and in the sandbox.",
      "Why, part one: we think most people would rather set a spending limit once than approve a wallet prompt for every call. With a Budget you lock one amount, pick the providers, and hand your agent a key. The agent never holds a wallet, and what it does not spend comes back to you.",
      "Why, part two: we have not finished the sums on very small single calls. Each one opens and settles its own escrow, so the network cost is a visible share of a call worth a few cents. In our devnet tests it was about 6% of a call of about $0.04. A Budget spreads one lock across many calls. We want to settle pay-per-call pricing before it takes real money.",
      "What this costs: the part of the app that pays providers from a Budget needs one more security review before it handles real funds. That review started today. Budgets open on mainnet only after it passes, and if that moves the date we will say so here.",
      "What does not change: providers price per token, every paid answer carries a signed receipt, and the planned protocol fee is 5% of the actual cost (2.5% for payouts before 1 April 2027 UTC), taken from the provider's share.",
    ],
    note: "Also today: the app now serves only the launch pages, with new Docs, FAQ, Terms and Privacy pages, and the agent files teach an agent to pay from a Budget key.",
  },
  {
    date: "2026-11-24",
    title: "Budgets join the first release",
    items: [
      "A Budget lets a person lock one amount on chain, choose up to four providers, and give their agent a key that can spend from it. We decided to put it in the first release instead of a later one.",
      "On 22 November we set the planned protocol fee: 5% of the actual cost, with a 2.5% launch rate for payouts before 1 April 2027 UTC, capped at 0.1 SOL on SOL payments. It replaced an earlier plan of 0.05%.",
    ],
  },
  {
    date: "2026-11-21",
    title: "The escrow program is on Solana devnet",
    items: [
      "The registry and the metered escrow were deployed to Solana devnet. A buyer locks the most a call can cost, the provider settles the tokens actually used, and the unused part returns to the buyer.",
      "Listings are priced per token, input and output, per million.",
    ],
  },
  {
    date: "2026-08-16",
    title: "ADL v0.2.0-beta published — call for v0.3 feedback, Reddi Arena early access",
    items: [
      "ADL v0.2.0-beta released publicly on GitHub (nissan/reddiagent-lab): canonical spec, JSON Schema, 5-level conformance ladder, receipt-integrity validator, 16 validated examples, v0.1→v0.2 migration guide. Code Apache-2.0, specs CC BY 4.0.",
      "Reddi Arena is live as the spec's proof use case — a competitive homebrew-bot arena where bots are ADL documents, league tiers are the conformance levels, and purses run on escrow + receipts (dry-run rail). Early-access waitlist signups are open.",
      "Call for v0.3 feedback is open. Building the Arena against the beta already surfaced three spec findings, filed as the seed of the v0.3 backlog: no price-discovery field (#440), currency enum excludes non-monetary units (#441), seller-side charge intents escape the authority envelope (#389).",
      "The highest-value contribution is an implementation report: build against the beta, and when you hit a wall the spec should have prevented, file it via the feedback page's open-spec review template.",
    ],
    note: "Arena early access: reddi-arena-production.up.railway.app · Release: github.com/nissan/reddiagent-lab/releases/tag/v0.2.0-beta",
  },
  {
    date: "2026-07-28",
    title: "ADL v0.2.0-beta staged for public release",
    items: [
      "ADL v0.2.0-beta spec bundle staged for public release: canonical spec, machine-checked JSON Schema, 16 validated examples, and a v0.1→v0.2 migration guide.",
      "Receipt-integrity validator merged after three rounds of adversarial review — 33 attack probes, every one failing closed, backed by a 235-test suite.",
      "Microsoft Agent Framework added as a compatibility target with a report-only mapping.",
      "Pay.sh/x402 discovery report merged.",
      "Four paid-delegation examples (buyer and seller side) validated at conformance Level 3.",
      "AUDD grant milestone program structured: M1–M3 plus an ecosystem track, with an evidence-packet protocol for milestone verification.",
    ],
    note: "Launch target: 2026-08-31.",
  },
];

export default function UpdatesPage() {
  return (
    <div className="min-h-screen bg-page text-white">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8 space-y-10">
        <header className="space-y-4">
          <p className="section-label">Updates</p>
          <h1 className="font-display text-4xl sm:text-5xl font-bold">
            Project updates
          </h1>
          <p className="max-w-3xl text-gray-300">
            What changed on Reddi Agent Protocol and why, newest first. When
            we change a plan we say so here, with the reason. Older entries
            are kept as they were written.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/budget"
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black"
            >
              Set a Budget
            </Link>
            <Link
              href="/docs"
              className="rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-white/90 hover:border-brand-green/50"
            >
              Read the docs
            </Link>
          </div>
        </header>

        <section className="space-y-4">
          {updates.map((update) => (
            <article
              key={update.date}
              className="rounded-xl border border-white/10 bg-card/40 p-6 space-y-3"
            >
              <div className="flex flex-wrap items-baseline gap-3">
                <time
                  dateTime={update.date}
                  className="font-mono text-xs text-brand-green"
                >
                  {update.date}
                </time>
                <h2 className="font-display text-xl font-semibold text-white">
                  {update.title}
                </h2>
              </div>
              {update.lead && (
                <p className="text-sm leading-6 text-gray-200">{update.lead}</p>
              )}
              <ul className="list-disc space-y-1.5 pl-5 text-sm leading-6 text-gray-300">
                {update.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              {update.note && (
                <p className="border-t border-white/10 pt-3 text-sm text-gray-400">
                  {update.note}
                </p>
              )}
            </article>
          ))}
        </section>
      </div>
    </div>
  );
}
