import type { Metadata } from "next";
import Link from "next/link";
import { Download, FileJson, FileText, MessageSquare } from "lucide-react";

export const metadata: Metadata = {
  title: "ReddiAgent ADL v0.2.0-beta",
  description:
    "The open Agent Definition Language — define an AI agent once: model envelope, operating harness, and payment authority. Validate it deterministically. Run it anywhere.",
};

const badges = [
  { label: "v0.2.0-beta", hot: true },
  { label: "Apache-2.0 code", hot: false },
  { label: "CC BY 4.0 specs", hot: false },
  { label: "235-test suite", hot: false },
  { label: "5-level conformance", hot: false },
];

const receiptLayers = [
  ["x402", "payment challenge/proof — the rail"],
  ["AP2 / Verifiable Intent", "delegated authority — who allowed what"],
  ["MCP", "protected-resource access — what was touched"],
  ["Solana", "settlement proof — where value moved"],
  ["RAP", "receipts, accounting, reputation — bound above the rail"],
];

const delegationCards = [
  {
    title: "Buyer side",
    desc: "A paid-research agent with a full payment authority contract: principal, spender, cap, expiry, revocation, receipts — human approval before any spend.",
  },
  {
    title: "Seller side",
    desc: "Three delegation services (research, pricing, review) other agents can discover and pay — charge intents, receipt binding, reputation signals.",
  },
  {
    title: "Dry-run rail only",
    desc: "Every example runs on x402-dry-run. Live settlement stays gated behind external audit — fail-closed by design.",
  },
];

export default function SpecPage() {
  return (
    <div className="min-h-screen bg-page text-white">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8 space-y-10">
        <header className="space-y-4">
          <p className="section-label">Open specification</p>
          <h1 className="font-display text-4xl sm:text-5xl font-bold">
            Reddi<span className="text-[#14F195]">Agent</span> ADL
          </h1>
          <p className="max-w-3xl text-lg text-gray-300">
            The open Agent Definition Language — define an AI agent once: model
            envelope, operating harness, and payment authority. Validate it
            deterministically. Run it anywhere.
          </p>
          <div className="flex flex-wrap gap-2">
            {badges.map((badge) => (
              <span
                key={badge.label}
                className={`rounded-full border px-3 py-1 text-xs ${
                  badge.hot
                    ? "border-[#14F195]/60 text-[#14F195]"
                    : "border-white/15 bg-white/5 text-gray-300"
                }`}
              >
                {badge.label}
              </span>
            ))}
          </div>
        </header>

        <section className="space-y-3">
          <h2 className="font-display text-2xl font-semibold">The thesis</h2>
          <div className="overflow-x-auto rounded-lg border border-white/10 bg-surface px-5 py-4">
            <code className="whitespace-nowrap text-sm text-[#14F195]">
              Agent = model definition + harness definition +
              settlement/reputation extension
            </code>
          </div>
          <p className="max-w-3xl text-sm leading-6 text-gray-400">
            Useful agents shouldn&apos;t start as vendor-specific scripts. ADL
            describes the job, model needs, tools, policies, eval gates,
            observability, and payment intent once — then compatibility reports
            tell you exactly what survives on each target (Microsoft Agent
            Framework, Google ADK, LangGraph, OpenAI, Anthropic, Gemini,
            Ollama…): <em>supported</em>, <em>degraded</em>, or{" "}
            <em>unsupported</em>. Nothing silently dropped.
          </p>
        </section>

        <section className="rounded-xl border border-white/10 bg-card/30 p-6 space-y-4">
          <h2 className="font-display text-2xl font-semibold">
            Settlement is not success
          </h2>
          <p className="max-w-3xl text-sm leading-6 text-gray-300">
            USENIX Security 2026 research found security-rule violations in{" "}
            <b>all 15 major x402 payment facilitators</b>. Our answer ships in
            this release: a <b>receipt-integrity validator</b> that refuses to
            treat payment proof as service success — receipts must bind
            delegated authority, payment evidence, service outcome, and eval
            evidence across 10 layers, tested against a 14-case threat model
            (replay, wrong-payee, paid-but-denied). Hardened by three rounds of
            adversarial review: 33 attack probes, every one failing closed.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">
                The five protocol layers a receipt binds, and the role of each
              </caption>
              <tbody>
                {receiptLayers.map(([layer, role]) => (
                  <tr key={layer}>
                    <td className="whitespace-nowrap border border-white/10 px-4 py-2 font-mono text-xs text-[#14F195]">
                      {layer}
                    </td>
                    <td className="border border-white/10 px-4 py-2 text-gray-300">
                      {role}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="font-display text-2xl font-semibold">
            Agents paying agents — both sides, today
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            {delegationCards.map((card) => (
              <div
                key={card.title}
                className="rounded-xl border border-white/10 bg-card/40 p-5"
              >
                <h3 className="font-display text-lg font-semibold text-white">
                  {card.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-gray-400">
                  {card.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-[#14F195]/25 bg-[#14F195]/10 p-6 space-y-4 glow-border">
          <h2 className="font-display text-2xl font-semibold">Download</h2>
          <div className="flex flex-wrap gap-3">
            <a
              href="/downloads/adl-v0.2.0-beta.zip"
              download
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#14F195] px-4 py-2 text-sm font-bold text-black hover:opacity-90"
            >
              <Download aria-hidden="true" size={16} />
              Spec bundle (.zip, 75 KB)
            </a>
            <a
              href="/downloads/ADL-v0.2.md"
              download
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#14F195]/40 px-4 py-2 text-sm font-semibold text-[#14F195] hover:border-[#14F195]/70"
            >
              <FileText aria-hidden="true" size={16} />
              Spec (Markdown)
            </a>
            <a
              href="/downloads/ADL-v0.2.schema.json"
              download
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#14F195]/40 px-4 py-2 text-sm font-semibold text-[#14F195] hover:border-[#14F195]/70"
            >
              <FileJson aria-hidden="true" size={16} />
              JSON Schema
            </a>
          </div>
          <p className="max-w-3xl text-sm leading-6 text-gray-300">
            The bundle: canonical spec + machine-checked schema + 16 validated
            examples + v0.1→v0.2 migration guide + the receipt-integrity
            validator and conformance checker (runnable:{" "}
            <code className="rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-xs">
              python3 scripts/adl_v02_conformance.py examples/v0.2/simple-agent.yaml
            </code>
            ).
          </p>
        </section>

        <section className="rounded-xl border border-white/10 bg-card/30 p-6 space-y-3">
          <h2 className="font-display text-2xl font-semibold">Spec home</h2>
          <p className="max-w-3xl text-sm leading-6 text-gray-300">
            The specification lives at{" "}
            <a
              href="https://github.com/reddinft/reddiagent-lab"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-300 hover:text-indigo-200"
            >
              github.com/reddinft/reddiagent-lab
            </a>{" "}
            — issues and structured review intake included.
          </p>
          <div className="rounded-lg border-l-2 border-accent-pink bg-surface/60 px-4 py-3 text-sm text-gray-400">
            The spec repo is going public with tagged release v0.2.0-beta — if
            the GitHub link 404s, the flip is imminent. Everything on this page
            is downloadable right here in the meantime.
          </div>
          <div className="flex flex-wrap gap-3 pt-1">
            <Link
              href="/feedback"
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold text-white/90 hover:border-[#14F195]/50"
            >
              <MessageSquare aria-hidden="true" size={16} />
              How to give feedback
            </Link>
            <Link
              href="/updates"
              className="inline-flex min-h-10 items-center rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold text-white/90 hover:border-[#14F195]/50"
            >
              Project updates →
            </Link>
          </div>
        </section>

        <footer className="border-t border-white/10 pt-5 text-sm text-gray-500">
          ReddiAgent Lab · code Apache-2.0 · specifications &amp; docs CC BY
          4.0 · Live payment rails and mainnet remain gated behind external
          security audit. Built in the open, reviewed adversarially, by agents
          — with a human holding the keys.
        </footer>
      </div>
    </div>
  );
}
