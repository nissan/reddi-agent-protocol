import Link from "next/link";

import {
  directoryFixtureProfileCount,
  sourceTrustConformanceCaseCount,
} from "@/lib/assurance/public-metrics";

const RECEIPT_ROWS: Array<[string, string]> = [
  ["provider", "Atlas Review"],
  ["model declared", "atlas-coder-large"],
  ["tokens", "12,000 in · 1,500 out"],
  ["cost", "0.0975 USDC"],
  ["max you allowed", "0.1950 USDC"],
  ["fee (planned)", "2.5% of cost"],
];

const WAYS_IN = [
  {
    role: "Buyer",
    title: "Buy inference",
    desc: "Compare providers by price per token and track record. Set the most a call may cost. Pay only for what it used.",
    href: "/agents",
    cta: "Browse providers",
  },
  {
    role: "Provider",
    title: "Run a provider",
    desc: "Put your model behind one endpoint, set your price per token, and get paid per call on Solana devnet.",
    href: "/register",
    cta: "Start setup",
    tinted: true,
  },
  {
    role: "Anyone",
    title: "Check a receipt",
    desc: "Make a test call in the sandbox and see who answered, what they declared, and which payment covered it.",
    href: "/sandbox",
    cta: "Open the sandbox",
  },
];

const NEXT_UP = [
  {
    title: "Try it on devnet today",
    desc: "Make a paid call with test funds and check its receipt, right now.",
  },
  {
    title: "Mainnet, coming soon",
    desc: "The same providers, prices and receipts, with real payments, in the next release.",
  },
  {
    title: "Simple pricing",
    desc: "A planned 2.5% of the actual cost, from the provider's share. Buyers pay only for the tokens used.",
  },
];

const PUBLIC_COUNTS = [
  { label: "Directory fixtures", value: directoryFixtureProfileCount },
  { label: "Source-trust conformance cases", value: sourceTrustConformanceCaseCount },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-paper text-ink">
      <p className="border-b border-line bg-[#101216] px-4 py-2 text-center font-mono text-xs text-[#e9e6dc]">
        Running on Solana devnet with test funds. Mainnet is coming soon.
      </p>

      <section className="mx-auto max-w-6xl px-4 pb-16 pt-14 sm:px-6 lg:px-8 lg:pt-20">
        <div className="grid items-center gap-14 lg:grid-cols-2">
          <div>
            <p className="section-label mb-4">The app</p>
            <h1 className="text-5xl leading-[1.02] sm:text-6xl">
              Pay for an answer.{" "}
              <span className="block text-brand-violet">Keep the receipt.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-muted sm:text-xl">
              Buy inference from independent providers, priced per token, with a
              signed receipt for every call. Or run a provider and start a public
              track record.
            </p>
            <p className="mt-4 max-w-xl text-base font-semibold">
              Payments prove transfer; RAP Assurance proves paid work.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-5">
              <Link
                href="/sandbox"
                className="rounded border-2 border-ink bg-ink px-5 py-3 font-bold text-paper no-underline hover:opacity-90"
              >
                Try the sandbox
              </Link>
              <Link
                href="/agents"
                className="font-bold underline decoration-2 underline-offset-4 hover:text-brand-violet"
              >
                Browse providers
              </Link>
            </div>
          </div>

          <figure className="m-0 flex justify-center">
            <div className="w-full max-w-sm rotate-[1.5deg] border border-line bg-paper-raised p-6 font-mono text-[13px] shadow-[0_18px_40px_rgba(20,22,26,0.12)]">
              <div className="mb-1.5 flex items-center justify-between border-b border-dashed border-ink pb-3">
                <strong>RECEIPT</strong>
                <span className="border-[1.5px] border-brand-violet px-2 py-0.5 text-[11px] font-bold tracking-[0.08em] text-brand-violet">
                  EXAMPLE
                </span>
              </div>
              <dl className="m-0">
                {RECEIPT_ROWS.map(([label, value]) => (
                  <div
                    key={label}
                    className="grid grid-cols-[120px_minmax(0,1fr)] gap-2.5 border-b border-dotted border-line py-2"
                  >
                    <dt className="text-ink-muted">{label}</dt>
                    <dd className="m-0">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mb-1.5 mt-3.5 font-bold text-brand-green">✓ signature matches provider key</p>
              <figcaption className="text-[11px] text-ink-muted">
                Made-up values for illustration.
              </figcaption>
            </div>
          </figure>
        </div>
      </section>

      <section aria-labelledby="ways-in" className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 lg:px-8">
        <p className="section-label mb-4">What do you want to do?</p>
        <h2 id="ways-in" className="mb-7 text-4xl">
          Three ways in.
        </h2>
        <div className="grid overflow-hidden rounded-md border-2 border-ink bg-paper-raised md:grid-cols-3">
          {WAYS_IN.map((way, index) => (
            <Link
              key={way.title}
              href={way.href}
              className={`group flex flex-col gap-2.5 p-7 no-underline ${
                way.tinted ? "bg-well" : ""
              } ${index < WAYS_IN.length - 1 ? "border-b border-line md:border-b-0 md:border-r" : ""}`}
            >
              <span className="font-mono text-xs font-bold uppercase text-brand-violet">{way.role}</span>
              <strong className="text-[22px] tracking-tight">{way.title}</strong>
              <span className="text-[15px] leading-relaxed text-ink-muted">{way.desc}</span>
              <span className="mt-auto pt-2 font-bold underline underline-offset-4 group-hover:text-brand-violet">
                {way.cta}
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="whats-next" className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 lg:px-8">
        <h2 id="whats-next" className="mb-4 text-xl">
          Now and next
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {NEXT_UP.map((item) => (
            <div key={item.title} className="rounded border border-line-strong bg-paper-raised p-4">
              <strong className="block text-[15px]">{item.title}</strong>
              <span className="text-sm text-ink-muted">{item.desc}</span>
            </div>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap gap-x-10 gap-y-4 text-sm text-ink-muted">
          {PUBLIC_COUNTS.map((stat) => (
            <div key={stat.label}>
              <strong className="block font-mono text-2xl text-ink">{stat.value}</strong>
              <span>{stat.label}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
