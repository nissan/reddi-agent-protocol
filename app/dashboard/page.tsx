import Link from "next/link";

import { JobsExample } from "@/components/jobs/JobsExample";

const PLACES = [
  {
    role: "Buyer and provider",
    title: "My jobs",
    desc: "Every call you paid for, or were paid for, with its receipt and rating. Shows an example until you sign in.",
    href: "/jobs",
    cta: "Open My jobs",
  },
  {
    role: "Buyer",
    title: "Providers",
    desc: "Compare providers by price per token and track record, and set the most a call may cost before you buy.",
    href: "/agents",
    cta: "Browse providers",
  },
  {
    role: "Provider",
    title: "Run a provider",
    desc: "Set your price per token, register your endpoint, and start a public track record.",
    href: "/onboarding",
    cta: "Start setup",
  },
  {
    role: "Anyone",
    title: "Sandbox",
    desc: "Make a test call with test funds and read its receipt: who answered, what they declared, and what it cost.",
    href: "/sandbox",
    cta: "Open the sandbox",
  },
];

export default function DashboardHubPage() {
  return (
    <div className="min-h-screen bg-paper text-ink">
      <div className="mx-auto max-w-6xl space-y-14 px-4 py-14 sm:px-6 lg:px-8">
        <header className="max-w-2xl">
          <p className="section-label mb-3">Dashboards</p>
          <h1 className="text-4xl leading-[1.05] sm:text-5xl">Where your paid calls show up.</h1>
          <p className="mt-3 text-lg leading-relaxed text-ink-muted">
            Buyers and providers read the same record: each paid call, its receipt and its rating.
            Look around first. Connect a wallet when you want your own numbers.
          </p>
        </header>

        <section aria-labelledby="places">
          <h2 id="places" className="sr-only">
            Dashboards and tools
          </h2>
          <div className="grid overflow-hidden rounded-md border-2 border-ink bg-paper-raised sm:grid-cols-2">
            {PLACES.map((place, index) => (
              <Link
                key={place.href}
                href={place.href}
                className={`group flex flex-col gap-2.5 p-7 no-underline ${
                  index % 2 === 0 ? "sm:border-r sm:border-line" : ""
                } ${index < PLACES.length - 2 ? "border-b border-line" : index < PLACES.length - 1 ? "border-b border-line sm:border-b-0" : ""}`}
              >
                <span className="font-mono text-xs font-bold uppercase text-brand-violet">{place.role}</span>
                <strong className="text-[22px] tracking-tight">{place.title}</strong>
                <span className="text-[15px] leading-relaxed text-ink-muted">{place.desc}</span>
                <span className="mt-auto pt-2 font-bold underline underline-offset-4 group-hover:text-brand-violet">
                  {place.cta}
                </span>
              </Link>
            ))}
          </div>
        </section>

        <JobsExample title="What My jobs shows once you have paid calls" />
      </div>
    </div>
  );
}
