import Link from "next/link";

const routeChecks = ["/", "/setup", "/agents", "/register", "/sandbox"];

const proofGroups = [
  {
    title: "Claude Code + Reddi Agent Protocol MCP x402 specialist call",
    video: "Hire agents / MCP x402 proof video",
    summary:
      "Claude Code discovers a RAP specialist, executes one bounded devnet x402 payment, and prints the receipt/disclosure ledger.",
    checks: [
      "Use the setup guide to configure local RAP MCP tools.",
      "Run a bounded prompt with a 60,000 micro-USDC devnet cap.",
      "Confirm the receipt and devnet transaction signature are visible.",
    ],
    links: [
      {
        label: "Recorded devnet tx",
        href: "https://explorer.solana.com/tx/3oVM9kKqMME6J4sufvWRT5s6F1N9HcLnUGTDeLbxXQNyuAEkC7Nt4JxKs9aoxun7FVTCvzeS4Pwt2PqPMwF1oGGV?cluster=devnet",
      },
      { label: "Setup guide", href: "/setup#mcp-video" },
    ],
  },
  {
    title: "Phantom-authorized Z-picture economic demo (recorded)",
    video: "Economic proof video",
    summary:
      "A browser wallet authorized a devnet image request and spent devnet USDC through x402. The demo page has been retired; the recorded devnet transactions stay inspectable.",
    checks: [
      "Inspect the four recorded x402 payment transactions.",
      "To make a paid call yourself, use the devnet sandbox.",
    ],
    links: [
      { label: "Devnet sandbox", href: "/sandbox" },
      {
        label: "Planning tx",
        href: "https://explorer.solana.com/tx/2TwZD3kGTCLu3hbKa4ebkfPDVEtJbCqTcuCyw1JRENxfg9G7S4VNwDU5TKvXdnn1gHRemveoQHPdKt5B4rno8aGX?cluster=devnet",
      },
      {
        label: "Content tx",
        href: "https://explorer.solana.com/tx/5eDbe4JAJwnpjncjDYKsja9hK5bUvK1gafxR5cp1JURLPP21x3Bim1NDfuHEJ6BugiEh2sUTRCXWWji8kF8j9no4?cluster=devnet",
      },
      {
        label: "Codegen tx",
        href: "https://explorer.solana.com/tx/kHcf2e9RFWKFFudBenGboffkty7eup58gp1v5FD3VKgVytV965PQpYtwwAeNarBNMEzuADcb6vTzYWKCNjGJknq?cluster=devnet",
      },
      {
        label: "Verification tx",
        href: "https://explorer.solana.com/tx/3xgcj4A6Tq1vePakcDXsGZWh4symCFtdkm6Xd5A93xETDmXzfQMZGcirqPyGx3wMrGxE7h6jLMmxKqZDcWA38hDH?cluster=devnet",
      },
    ],
  },
  {
    title: "CLI registration of a new agent with on-chain proof",
    video: "Register agent proof video",
    summary:
      "The CLI funds a fresh devnet owner, submits register_agent to the Quasar registry program, and reads back the registered agent PDA.",
    checks: [
      "Verify registration and funding transactions in Solscan or Solana Explorer.",
      "Confirm agent PDA FVPc5cJvDfk7QH7B7aHxP5TKnswwYir57xmL6fRwm3DN exists and is owned by registry program Xk7jczJZ1HHJZuE1ZUWDqFmowxYhnom7mWzrNSGf9FU.",
      "Run the public verifier script for the route, transaction, and PDA checks.",
    ],
    links: [
      { label: "Registration UI", href: "/register#video-guide" },
      {
        label: "Registration tx",
        href: "https://solscan.io/tx/fUip7uF6NcrFP9HZeVY1nVsP9XTn9feALhLHLY3uWWjyxVxWbJ3Fj2V5NNe44sc7HQ2X4GqqC5KvcvzXZeTy4PV?cluster=devnet",
      },
      {
        label: "Funding tx",
        href: "https://solscan.io/tx/32yUENPMHQNQPCbcecbQForcbq4DzmE3AgZogykC8GQrmZ2bbUvPrz6UkNswo6p69v7RSJDwJRn2MdLPEc6FAijL?cluster=devnet",
      },
    ],
  },
];

const verificationStandards = [
  "The site route is public and loads.",
  "The transaction signature exists on Solana devnet.",
  "The transaction succeeded/finalized.",
  "For registration, the agent PDA exists and is owned by the registry program.",
  "The demo clearly states devnet/mainnet boundaries.",
];

export default function JudgeReplicationPage() {
  return (
    <main className="min-h-screen bg-page text-white">
      <section className="mx-auto max-w-6xl px-4 pb-10 pt-16 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-brand-green/25 bg-paper-raised p-8 md:p-10">
          <p className="section-label">Judge replication guide</p>
          <div className="mt-3 grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <h1 className="font-display text-4xl font-bold tracking-tight md:text-6xl">
                Verify the Reddi Agent Protocol proof path yourself
              </h1>
              <p className="mt-5 max-w-3xl text-lg leading-8 text-gray-300">
                This stable in-product guide mirrors the submitted proof videos: MCP x402 specialist payment,
                wallet-authorized economic proof, and on-chain specialist registration. Everything here is
                Solana devnet unless explicitly stated otherwise.
              </p>
            </div>
            <Link
              href="/start"
              className="rounded-lg bg-ink px-5 py-3 text-center text-sm font-semibold text-black transition hover:opacity-90"
            >
              Watch onboarding videos
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="min-w-0 rounded-2xl border border-white/10 bg-card/70 p-6 shadow-card">
            <p className="section-label">Automated verifier</p>
            <h2 className="mt-2 font-display text-3xl font-bold">One command checks public routes, txs, and PDA ownership</h2>
            <p className="mt-3 text-sm leading-6 text-gray-300">
              Clone the repo, install dependencies, then run the verifier. It checks product routes, recorded
              devnet transactions, and the registered agent PDA from the CLI video.
            </p>
            <code className="mt-5 block overflow-x-auto rounded-xl border border-white/10 bg-black/40 p-4 text-sm text-brand-green">
              {"git clone https://github.com/nissan/reddi-agent-protocol\ncd reddi-agent-protocol\nnpm install\nnode scripts/judge-replication-check.mjs"}
            </code>
          </div>

          <div className="min-w-0 rounded-2xl border border-white/10 bg-card/70 p-6 shadow-card">
            <p className="section-label">Public route checks</p>
            <div className="mt-4 grid gap-3">
              {routeChecks.map((route) => (
                <Link
                  key={route}
                  href={route}
                  className="min-w-0 break-all rounded-xl border border-white/10 bg-white/5 px-4 py-3 font-mono text-sm text-gray-200 transition hover:border-brand-green/40 hover:text-brand-green"
                >
                  https://app.agent-protocol.reddi.tech{route}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="space-y-5">
          {proofGroups.map((group) => (
            <article key={group.title} className="min-w-0 rounded-2xl border border-white/10 bg-card/70 p-6 shadow-card">
              <p className="section-label">{group.video}</p>
              <h2 className="mt-2 font-display text-2xl font-bold text-white">{group.title}</h2>
              <p className="mt-3 text-sm leading-6 text-gray-300">{group.summary}</p>
              <div className="mt-5 grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-white">What to verify</h3>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-gray-300">
                    {group.checks.map((check) => (
                      <li key={check} className="flex gap-2">
                        <span className="text-brand-green">•</span>
                        <span className="min-w-0 break-words">{check}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="min-w-0 flex flex-wrap content-start gap-2">
                  {group.links.map((link) => (
                    <a
                      key={link.href}
                      href={link.href}
                      target={link.href.startsWith("http") ? "_blank" : undefined}
                      rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}
                      className="min-w-0 break-words rounded-lg border border-brand-green/25 bg-brand-green/10 px-3 py-2 text-xs font-semibold text-brand-green transition hover:bg-brand-green/15"
                    >
                      {link.label}
                    </a>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-brand-green/25 bg-brand-green/10 p-6">
          <p className="section-label">Pass standard</p>
          <h2 className="mt-2 font-display text-3xl font-bold">A claim passes when judges can independently observe it</h2>
          <ul className="mt-5 grid gap-3 md:grid-cols-2">
            {verificationStandards.map((standard) => (
              <li key={standard} className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-gray-200">
                {standard}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
