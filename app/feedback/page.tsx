import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquare } from "lucide-react";

export const metadata: Metadata = {
  title: "Give Feedback",
  description:
    "How to give feedback on the ReddiAgent ADL open spec: implementation reports, structured review intake, and the open gaps we want challenged.",
};

const statusVocabulary = [
  {
    word: "stable",
    desc: "Specified, schema-checked, and covered by conformance tests.",
  },
  {
    word: "experimental",
    desc: "Specified but still expected to change on feedback.",
  },
  {
    word: "report-only",
    desc: "Mapped and diagnosed, but not executed — compatibility reports, not runtime claims.",
  },
  {
    word: "executable prototype",
    desc: "Runs locally under fail-closed constraints (e.g. x402-dry-run).",
  },
  {
    word: "future work",
    desc: "Named but not built. Anything mainnet-facing lives here until externally audited.",
  },
];

const openGaps = [
  "Charge-side conformance enforcement — the seller side of payment intent is specified more loosely than the buyer side.",
  "Price discovery — how buyer agents compare quotes across sellers is not yet standardized.",
  "Session caps — per-session spend limits beyond the single-delegation cap.",
  "Output schemas — machine-checkable contracts for what a paid delegation returns.",
];

export default function FeedbackPage() {
  return (
    <div className="min-h-screen bg-page text-white">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8 space-y-10">
        <header className="space-y-4">
          <p className="section-label">Open specification</p>
          <h1 className="font-display text-4xl sm:text-5xl font-bold">
            Help set the standard
          </h1>
          <p className="max-w-3xl text-gray-300">
            The spec is stewarded today with an explicit goal:{" "}
            <b className="text-white">community governance</b> as the
            contributor base forms. The highest-value feedback is an
            implementation report — you tried to build against ADL and hit
            friction.
          </p>
          <div className="flex flex-wrap gap-3">
            <a
              href="https://github.com/reddinft/reddiagent-lab/issues/new?template=open-spec-review.md"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#14F195] px-4 py-2 text-sm font-bold text-black hover:opacity-90"
            >
              <MessageSquare aria-hidden="true" size={16} />
              Open a spec-review issue
            </a>
            <a
              href="https://github.com/reddinft/reddiagent-lab/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-white/90 hover:border-[#14F195]/50"
            >
              Browse open issues
            </a>
          </div>
          <p className="max-w-3xl text-xs text-gray-500">
            The structured intake template lives at{" "}
            <code className="rounded border border-white/10 bg-black/30 px-1.5 py-0.5">
              .github/ISSUE_TEMPLATE/open-spec-review.md
            </code>{" "}
            in the spec repo. If the repo 404s, the public flip is imminent —
            try again shortly, or grab the spec from the{" "}
            <Link href="/spec" className="text-indigo-300 hover:text-indigo-200">
              downloads on the spec page
            </Link>
            .
          </p>
        </header>

        <section className="space-y-4">
          <h2 className="font-display text-2xl font-semibold">
            Classify your feedback: the five-word status vocabulary
          </h2>
          <p className="max-w-3xl text-sm leading-6 text-gray-400">
            Every surface in the spec carries one of five state
            classifications, and the review template asks you to pick one.
            Using the same words keeps claims honest on both sides.
          </p>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {statusVocabulary.map((status) => (
              <div
                key={status.word}
                className="rounded-xl border border-white/10 bg-card/40 p-4"
              >
                <p className="font-mono text-sm text-[#14F195]">
                  {status.word}
                </p>
                <p className="mt-2 text-sm leading-6 text-gray-400">
                  {status.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-indigo-300/20 bg-card/30 p-6 space-y-3 glow-border">
          <h2 className="font-display text-2xl font-semibold">
            Open gaps we <em>want</em> challenged
          </h2>
          <p className="max-w-3xl text-sm leading-6 text-gray-400">
            These are the known weak points of v0.2.0-beta. Feedback that
            attacks them — especially with a reproduction or a proposed schema
            — moves the spec fastest.
          </p>
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-6 text-gray-300">
            {openGaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-white/10 bg-card/30 p-6 space-y-3">
          <h2 className="font-display text-2xl font-semibold">Where next</h2>
          <p className="max-w-3xl text-sm leading-6 text-gray-400">
            Read the spec, check what has shipped, then tell us where it
            breaks.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/spec"
              className="rounded-lg border border-[#14F195]/40 bg-[#14F195]/10 px-4 py-2 text-sm font-medium text-[#14F195] hover:bg-[#14F195]/15"
            >
              ADL v0.2.0-beta spec →
            </Link>
            <Link
              href="/updates"
              className="rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-white/90 hover:border-[#14F195]/50"
            >
              Project updates →
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
