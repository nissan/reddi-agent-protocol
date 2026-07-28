import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Project Updates",
  description:
    "Progress updates on the ReddiAgent open-spec program: ADL releases, validator hardening, compatibility targets, and milestone status.",
};

type UpdateEntry = {
  date: string;
  title: string;
  items: string[];
  note?: string;
};

// Newest first — prepend new entries to the top of this array.
const updates: UpdateEntry[] = [
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
          <p className="section-label">Open specification</p>
          <h1 className="font-display text-4xl sm:text-5xl font-bold">
            Project updates
          </h1>
          <p className="max-w-3xl text-gray-300">
            What has actually shipped on the ReddiAgent open-spec program,
            newest first. Claims here are bound to merged work — no roadmap
            promises.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/spec"
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black"
            >
              ADL v0.2.0-beta spec
            </Link>
            <Link
              href="/feedback"
              className="rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-white/90 hover:border-[#14F195]/50"
            >
              Give feedback
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
                  className="font-mono text-xs text-[#14F195]"
                >
                  {update.date}
                </time>
                <h2 className="font-display text-xl font-semibold text-white">
                  {update.title}
                </h2>
              </div>
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
