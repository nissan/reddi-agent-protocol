import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Docs",
  description: "Where to start with Reddi Agent Protocol: give your agent a Budget, set your agent up to pay, or run a paid provider. Every path ends with a receipt.",
};

const PATHS = [
  {
    role: "Buyer",
    title: "Give your agent a Budget",
    steps: [
      "Lock one amount from your own wallet, in one token, for 72 hours.",
      "Pick up to four providers. None can take more than half.",
      "Hand your agent the key. It pays per call and you get an email for every share taken.",
      "Close it when the job is done. What nobody used comes straight back.",
    ],
    links: [
      { href: "/budget", label: "Set a budget" },
      { href: "/sandbox?scenario=budget", label: "Preview it without a wallet" },
    ],
  },
  {
    role: "Agent",
    title: "Set your agent up to pay",
    steps: [
      "Give your agent the skill file. It covers paying from a Budget key and paying from its own wallet.",
      "It asks for a price first, stays inside the limit you set and checks the signed receipt.",
      "Building your own agent? Two npm packages do the paying and the receipt check.",
    ],
    links: [
      { href: "/agent-setup", label: "Agent setup" },
      { href: "/skill.md", label: "Skill file", plain: true },
      { href: "/llms.txt", label: "llms.txt", plain: true },
    ],
  },
  {
    role: "Provider",
    title: "Run a paid provider",
    steps: [
      "Install the provider kit and put a paid endpoint in front of any OpenAI-compatible model.",
      "Set your price per million tokens. The kit meters each call and signs the receipt.",
      "List it, so buyers and their agents can find you.",
    ],
    links: [
      { href: "/register", label: "Run a provider" },
      { href: "/provider.md", label: "Provider skill file", plain: true },
      { href: "/adl", label: "ADL v0.3" },
    ],
  },
];

const REFERENCE = [
  { href: "/pricing.md", label: "Pricing and fees", note: "Per-token pricing, the maximum you approve, the 5% fee with its 2.5% launch rate, tokens and Founding Providers.", plain: true },
  { href: "/faq", label: "FAQ", note: "Refunds, disputes, the judge, what a receipt proves, devnet and mainnet." },
  { href: "/try", label: "Pay for one answer yourself", note: "One call from your own wallet, with the receipt, before you hand anything to an agent." },
  { href: "/agents", label: "Providers", note: "Who is listed, at what price per token, with what track record." },
  { href: "/jobs", label: "My jobs", note: "Every paid call recorded for your wallet, with its receipt." },
  { href: "/llms-full.txt", label: "Everything in one file for LLMs", note: "The index, both skill files and the pricing page.", plain: true },
  { href: "https://github.com/nissan/reddi-agent-protocol", label: "Source on GitHub", note: "The Solana program, SDKs, provider kit and examples.", plain: true },
];

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-page text-white">
      <div className="mx-auto max-w-5xl space-y-10 px-4 pb-16 pt-12 sm:px-6 lg:px-8">
        <header className="rounded-3xl border border-brand-green/25 bg-paper-raised p-8 md:p-10">
          <p className="section-label">Docs</p>
          <h1 className="mt-3 font-display text-4xl font-bold tracking-tight md:text-5xl">Three ways in. Each one ends with a receipt.</h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-gray-300">
            Reddi Agent Protocol lets you and your agents pay independent AI providers per token on Solana. You set the most that can be spent, the provider is paid for what it used, and the rest comes back.
          </p>
        </header>

        <section aria-labelledby="docs-paths" className="grid gap-5 md:grid-cols-3" data-testid="docs-paths">
          <h2 id="docs-paths" className="sr-only">Choose a path</h2>
          {PATHS.map((path) => (
            <article key={path.title} className="flex flex-col rounded-3xl border border-white/10 bg-paper-raised p-6">
              <p className="section-label">{path.role}</p>
              <h3 className="mt-2 font-display text-2xl font-bold text-white">{path.title}</h3>
              <ol className="mt-4 flex-1 list-decimal space-y-2 pl-5 text-sm leading-6 text-gray-300">
                {path.steps.map((step) => <li key={step}>{step}</li>)}
              </ol>
              <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-sm font-semibold">
                {path.links.map((link) => "plain" in link && link.plain
                  ? <a key={link.href} className="underline hover:text-white" href={link.href}>{link.label}</a>
                  : <Link key={link.href} className="underline hover:text-white" href={link.href}>{link.label}</Link>)}
              </div>
            </article>
          ))}
        </section>

        <section aria-labelledby="docs-reference" className="rounded-3xl border border-white/10 bg-paper-raised p-6 md:p-8">
          <h2 id="docs-reference" className="font-display text-2xl font-bold text-white">Reference</h2>
          <ul className="mt-4 divide-y divide-white/10">
            {REFERENCE.map((item) => (
              <li key={item.href} className="py-3 text-sm leading-6 text-gray-300">
                {item.plain
                  ? <a className="font-semibold text-white underline" href={item.href}>{item.label}</a>
                  : <Link className="font-semibold text-white underline" href={item.href}>{item.label}</Link>}
                <span className="block">{item.note}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
