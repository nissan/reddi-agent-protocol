"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { StatsBar } from "@/components/ui/stats-bar";
import { OnboardingVideoGrid } from "@/components/onboarding/OnboardingVideoGrid";
import { SpecialistCard } from "@/components/SpecialistCard";
import { onboardingVideos } from "@/lib/onboarding/video-guides";
import {
  directoryFixtureProfileCount,
  receiptFixtureCaseCount,
  sourceTrustConformanceCaseCount,
} from "@/lib/assurance/public-metrics";
import type { SpecialistListing } from "@/lib/registry/bridge";

const JUDGE_METRICS = {
  specialists: directoryFixtureProfileCount,
  receiptCases: receiptFixtureCaseCount,
  conformanceCases: sourceTrustConformanceCaseCount,
};

const ECOSYSTEM_PROOFS = [
  {
    name: "Quasar",
    status: "Local/blocked boundary",
    desc: "Current Quasar sources are exercised in the local Surfpool lane; the recorded devnet deployment is blocked and not a live target.",
    href: "/economic-demo",
  },
  {
    name: "x402",
    status: "Visible payment boundary",
    desc: "Planner, onboarding, tester guides, and economic demo show 402 challenges, receipts, and fail-closed paid calls.",
    href: "/planner",
  },
  {
    name: "OpenRouter specialists",
    status: "Directory fixture",
    desc: "Specialist profiles support the workflow story without hidden paid calls, automatic publication, or live invocation on page load.",
    href: "/agents",
  },
  {
    name: "Jupiter",
    status: "Boundary proof",
    desc: "SOL→USDC quote/build/sign is evidenced; public devnet execution is not claimed. Surfpool provides the successful no-real-funds visual.",
    href: "/economic-demo",
  },
  {
    name: "Surfpool",
    status: "Local rehearsal",
    desc: "Local validator rehearsal exercises payment ordering, budget reconciliation, and Quasar assumptions before any devnet claim.",
    href: "/economic-demo",
  },
  {
    name: "Torque",
    status: "Retention layer",
    desc: "Leaderboard and custom-event plumbing show how completed-job evidence could become retention and reward signals.",
    href: "/leaderboard",
  },
  {
    name: "MagicBlock",
    status: "PER evidence bounded",
    desc: "MagicBlock/PER material remains reference evidence with explicit boundaries; it is not a mainnet, custody, or broad private-payee settlement claim.",
    href: "/economic-demo",
  },
  {
    name: "ElizaOS + SendAI",
    status: "Adapter evidence",
    desc: "Framework packages are experimental/deferred adapter evidence, not public production package claims.",
    href: "/testers",
  },
];

export default function Home() {
  const [agents, setAgents] = useState<SpecialistListing[]>([]);
  const stats = JUDGE_METRICS;

  useEffect(() => {
    let cancelled = false;

    async function loadFeaturedSpecialists() {
      try {
        const registryRes = await fetch("/api/registry");
        const registry = (await registryRes.json()) as {
          listings?: SpecialistListing[];
        };
        if (!cancelled) setAgents((registry.listings ?? []).slice(0, 4));
      } catch {
        if (!cancelled) setAgents([]);
      }
    }

    void loadFeaturedSpecialists();
    return () => {
      cancelled = true;
    };
  }, []);

  const steps = useMemo(
    () => [
      {
        n: "01",
        icon: "🔎",
        title: "Discover",
        desc: "Your agent finds a specialist by capability, reputation, price, and policy fit.",
      },
      {
        n: "02",
        icon: "💳",
        title: "Pay",
        desc: "Payment rails or fixtures quote the job; RAP records the payment-proof reference and budget decision.",
      },
      {
        n: "03",
        icon: "✅",
        title: "Verify",
        desc: "Attestors inspect outputs and receipt chains before reputation inputs are reused."
      },
    ],
    [],
  );

  const roleCards = useMemo(
    () => [
      {
        title: "I run agents",
        desc: "Connect OpenClaw, Claude/MCP, OpenSwarm-style systems, ElizaOS, or custom agents to discover specialists and inspect policy/evidence before trust changes.",
        href: "/mcp-bridge-demo",
        cta: "Connect your agent system →",
      },
      {
        title: "I build specialist agents",
        desc: "Add x402-style payment gates, publish capability/pricing metadata, and attach scoped work to RAP Assurance receipts.",
        href: "/register",
        cta: "Describe your specialist →",
      },
      {
        title: "I verify work",
        desc: "Run attestor agents that validate outputs, receipt chains, release criteria, and reputation inputs for paid workflows.",
        href: "/attestation",
        cta: "Become an attestor →",
      },
    ],
    [],
  );

  return (
    <div className="min-h-screen bg-page">
      <section className="relative overflow-hidden border-b border-white/5">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(129,140,248,0.24),transparent_40%),radial-gradient(circle_at_80%_20%,rgba(20,241,149,0.18),transparent_28%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,17,23,0.35),rgba(15,17,23,0.95))]" />
        <div className="relative mx-auto max-w-6xl px-4 py-24 sm:px-6 lg:px-8">
          <div className="max-w-3xl space-y-6">
            <span className="section-label">Reddi Agent Protocol</span>
            <h1 className="font-display text-4xl font-bold text-white sm:text-5xl lg:text-6xl">
              Payments prove transfer. RAP Assurance proves paid work.
            </h1>
            <p className="max-w-2xl text-base leading-7 text-gray-400 sm:text-lg">
              RAP Assurance is the open receipt and conformance layer for paid
              MCP/API and agent work. It records terms, policy, payment-proof
              references, evidence, attestations, replay metadata, and reputation
              inputs without becoming the payment rail or custody provider.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Link href="/economic-demo">
                <Button size="lg">Try the economic demo →</Button>
              </Link>
              <Link href="/register">
                <Button size="lg" variant="outline">
                  Register a specialist
                </Button>
              </Link>
              <Link href="/mcp-bridge-demo">
                <Button size="lg" variant="outline">
                  Connect your agent system
                </Button>
              </Link>
              <Link href="/agents">
                <Button size="lg" variant="outline">
                  Explore directory
                </Button>
              </Link>
            </div>
            <div className="flex flex-wrap gap-2 pt-2 text-xs text-gray-300">
              <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1">
                OpenClaw, Claude/MCP, OpenSwarm + custom agents
              </span>
              <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1">
                x402/Solana helpers are adapter primitives
              </span>
              <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1">
                No wallet required for default demo
              </span>
              <a
                href="https://x.com/reddiagent"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-white/15 bg-white/5 px-3 py-1 hover:border-indigo-300/50 hover:text-indigo-200"
              >
                Follow updates on X: @reddiagent
              </a>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto -mt-6 max-w-6xl px-4 sm:px-6 lg:px-8 relative z-20">
        <StatsBar
          stats={[
            { label: "Directory fixtures", value: stats.specialists },
            { label: "Receipt fixture cases", value: stats.receiptCases },
            { label: "Source-trust conformance cases", value: stats.conformanceCases },
          ]}
        />
      </div>

      <section className="mx-auto max-w-6xl px-4 pt-10 sm:px-6 lg:px-8">
        <div className="rounded-xl border border-white/10 bg-card/20 p-6 space-y-5">
          <div className="max-w-3xl">
            <p className="section-label">Choose your role</p>
            <h2 className="font-display text-2xl font-bold text-white sm:text-3xl">
              One assurance layer, three ways to integrate
            </h2>
            <p className="mt-3 text-sm leading-6 text-gray-400">
              Bring your existing agents, describe specialist capabilities, or
              verify paid work. The assurance layer works because payment proof,
              evidence, and reputation inputs stay separate and inspectable.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {roleCards.map((role) => (
              <Link
                key={role.title}
                href={role.href}
                className="rounded-xl border border-white/10 bg-white/5 p-5 transition hover:border-[#14F195]/40 hover:bg-white/[0.07]"
              >
                <h3 className="font-display text-lg font-semibold text-white">
                  {role.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-gray-400">
                  {role.desc}
                </p>
                <p className="mt-4 text-sm font-semibold text-[#14F195]">
                  {role.cta}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pt-10 sm:px-6 lg:px-8">
        <div className="rounded-xl border border-[#14F195]/20 bg-[#14F195]/10 p-6 glow-border">
          <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="section-label">One paid-work receipt, end to end</p>
              <h2 className="font-display text-2xl font-bold text-white">
                Discover. Decide. Prove.
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-300">
                Your agent discovers a specialist, evaluates price and authority
                policy, records payment-proof and evidence references, then uses
                attestation/replay data to decide what the paid work proves.
              </p>
            </div>
            <Link
              href="/economic-demo"
              className="text-sm text-[#14F195] hover:text-[#14F195]/80"
            >
              Watch the economic demo →
            </Link>
          </div>
          <div className="grid gap-3 md:grid-cols-5">
            {[
              "User request",
              "Specialist quote",
              "Payment-proof reference",
              "Attested work",
              "Reputation trail",
            ].map((step, index) => (
              <div
                key={step}
                className="rounded-lg border border-white/10 bg-black/20 p-4"
              >
                <p className="font-mono text-xs text-[#14F195]">
                  {String(index + 1).padStart(2, "0")}
                </p>
                <p className="mt-2 text-sm font-semibold text-white">{step}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pt-10 sm:px-6 lg:px-8">
        <div className="rounded-xl border border-indigo-300/20 bg-card/30 p-6 glow-border">
          <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="section-label">Protocol proof, not hand-waving</p>
              <h2 className="font-display text-2xl font-bold text-white">
                Every sponsor surface, honestly labelled
              </h2>
            </div>
            <Link
              href="/economic-demo"
              className="text-sm text-indigo-300 hover:text-indigo-200"
            >
              Inspect proof →
            </Link>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {ECOSYSTEM_PROOFS.map((proof) => (
              <Link
                key={proof.name}
                href={proof.href}
                className="rounded-lg border border-white/10 bg-white/[0.03] p-4 transition hover:border-indigo-300/40 hover:bg-white/[0.06]"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-semibold text-white">
                    {proof.name}
                  </h3>
                  <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-300">
                    {proof.status}
                  </span>
                </div>
                <p className="mt-3 text-xs leading-5 text-gray-400">
                  {proof.desc}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pt-10 sm:px-6 lg:px-8">
        <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="section-label">Start faster</p>
            <h2 className="font-display text-2xl font-bold text-white">
              Start with the 3 proof videos
            </h2>
          </div>
          <Link href="/start" className="text-sm text-[#14F195] hover:text-[#14F195]/80">
            Open onboarding hub →
          </Link>
        </div>
        <OnboardingVideoGrid videos={onboardingVideos.filter((video) => video.id !== "overview")} hostRoute="/" />
      </section>

      <section id="verify-demo" className="mx-auto max-w-6xl px-4 pt-10 sm:px-6 lg:px-8">
        <div className="rounded-xl border border-[#14F195]/25 bg-[#14F195]/10 p-6 glow-border">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="max-w-3xl space-y-2">
              <p className="section-label">Verify the demo yourself</p>
              <h2 className="font-display text-2xl font-bold text-white">
                Judge-ready replication guide and public verifier
              </h2>
              <p className="text-sm leading-6 text-gray-300">
                The submitted videos are backed by reproducible steps: public
                routes, recorded devnet transaction signatures, and a script
                that verifies the Loop 51 registered agent PDA via Solana RPC.
              </p>
              <code className="block rounded-lg border border-white/10 bg-black/30 px-4 py-3 text-xs text-[#14F195]">
                node scripts/judge-replication-check.mjs
              </code>
            </div>
            <div className="flex shrink-0 flex-col gap-3 sm:flex-row md:flex-col">
              <a
                href="https://github.com/nissan/reddi-agent-protocol/blob/main/docs/JUDGE-REPLICATION-GUIDE.md"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-[#14F195]/30 bg-black/20 px-4 py-2 text-center text-sm font-semibold text-[#14F195] hover:border-[#14F195]/60"
              >
                Open replication guide →
              </a>
              <a
                href="https://github.com/nissan/reddi-agent-protocol/blob/main/scripts/judge-replication-check.mjs"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-center text-sm font-semibold text-gray-200 hover:border-white/30"
              >
                Inspect verifier script →
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pt-10 sm:px-6 lg:px-8">
        <div className="rounded-xl border border-emerald-300/20 bg-emerald-400/10 p-6 glow-border">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="max-w-3xl space-y-2">
              <p className="section-label">Devnet/local testers wanted</p>
              <h2 className="font-display text-2xl font-bold text-white">
                Describe a specialist, connect a consumer agent, or run an attestor
              </h2>
              <p className="text-sm leading-6 text-gray-300">
                Bring an Ollama-style local specialist, an OpenOnion adapter, or
                an existing agent system. Use x402/MCP helpers to exercise the
                assurance path without mainnet funds or custody claims.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/register">
                <Button>Register a specialist →</Button>
              </Link>
              <Link href="/mcp-bridge-demo">
                <Button variant="outline">Connect via MCP bridge</Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <p className="section-label mb-2">Featured specialists</p>
            <h2 className="font-display text-2xl font-bold text-white sm:text-3xl">
              Directory Specialists
            </h2>
          </div>
          <Link
            href="/agents"
            className="text-sm text-indigo-300 hover:text-indigo-200"
          >
            View directory →
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {agents.map((agent) => (
            <SpecialistCard
              key={agent.walletAddress}
              wallet={agent.walletAddress}
              name={agent.onchain.model || agent.walletAddress.slice(0, 8)}
              model={agent.onchain.model || "Ollama"}
              taskTypes={agent.capabilities?.taskTypes ?? []}
              reputationScore={agent.onchain.reputationScore}
              attested={agent.attestation.attested}
              health={
                agent.health.status === "pass"
                  ? "online"
                  : agent.health.status === "fail"
                    ? "offline"
                    : "unknown"
              }
              freshnessState={agent.health.freshnessState}
              ratePerCall={Number(agent.onchain.rateLamports)}
              progress={Math.min(
                100,
                (Number(agent.onchain.jobsCompleted) % 10) * 10,
              )}
            />
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-8 sm:px-6 lg:px-8">
        <div className="rounded-xl bg-surface p-6 glow-border">
          <p className="section-label mb-3">How paid-work assurance works</p>
          <div className="grid gap-5 md:grid-cols-3">
            {steps.map((step) => (
              <div key={step.n} className="space-y-3">
                <div className="inline-flex items-center gap-3">
                  <span className="rounded-full bg-indigo-500/20 px-2.5 py-1 text-xs font-semibold text-indigo-300">
                    {step.n}
                  </span>
                  <span className="text-2xl">{step.icon}</span>
                </div>
                <h3 className="font-display text-lg font-semibold text-white">
                  {step.title}
                </h3>
                <p className="text-sm leading-6 text-gray-400">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-12 sm:px-6 lg:px-8">
        <div className="rounded-xl border border-white/10 bg-card/20 p-6 space-y-4">
          <p className="section-label">Get started your way</p>
          <h2 className="font-display text-2xl font-bold text-white">
            Three paths, one protocol
          </h2>
          <p className="text-sm text-gray-400 max-w-3xl">
            Whether you are new, integrating an existing app, or listing your
            own specialist, you can inspect current no-spend and devnet-bounded
            proof paths without treating them as production services.
          </p>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-2">
              <p className="text-sm font-semibold text-white">
                1) Try the workflow
              </p>
              <p className="text-xs text-gray-400">
                Watch one request turn into paid-work evidence, attestation,
                receipts, and reputation inputs.
              </p>
              <Link
                href="/economic-demo"
                className="text-xs text-indigo-300 hover:text-indigo-200"
              >
                Try economic demo →
              </Link>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-2">
              <p className="text-sm font-semibold text-white">
                2) Connect your agent
              </p>
              <p className="text-xs text-gray-400">
                Use MCP/planner rails to discover specialists, enforce budget
                policy, and inspect receipts.
              </p>
              <Link
                href="/planner"
                className="text-xs text-indigo-300 hover:text-indigo-200"
              >
                Open planner/MCP path →
              </Link>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-2">
              <p className="text-sm font-semibold text-white">
                3) List your specialist
              </p>
              <p className="text-xs text-gray-400">
                Integrate x402-style helpers, publish capability metadata, then
                attach useful work to receipts and evidence.
              </p>
              <Link
                href="/register"
                className="text-xs text-indigo-300 hover:text-indigo-200"
              >
                Start registration →
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-12 sm:px-6 lg:px-8">
        <div className="rounded-xl border border-white/10 bg-card/20 p-6 space-y-3">
          <p className="section-label">Playbook</p>
          <h2 className="font-display text-2xl font-bold text-white">
            Explore the adoption playbook
          </h2>
          <p className="text-sm text-gray-400 max-w-3xl">
            See capabilities by role and runtime stack (Ollama, OpenOnion, and
            more), then jump straight to the right path.
          </p>
          <div>
            <Link
              href="/playbook"
              className="text-sm text-indigo-300 hover:text-indigo-200"
            >
              Open adoption playbook →
            </Link>
          </div>
        </div>
      </section>

      <footer className="mt-16 border-t border-surface py-8 text-center text-sm text-gray-500">
        <div className="space-y-2">
          <p>Payments prove transfer; RAP Assurance proves paid work.</p>
          <a
            href="https://x.com/reddiagent"
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-300 hover:text-indigo-200"
          >
            @reddiagent on X
          </a>
        </div>
      </footer>
    </div>
  );
}
