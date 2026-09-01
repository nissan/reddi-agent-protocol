"use client";

import dynamic from "next/dynamic";
import { useWallet } from "@solana/wallet-adapter-react";
import { useMemo, useState } from "react";

import { OnboardingVideoCard } from "@/components/onboarding/OnboardingVideoCard";

import {
  buildEconomicRunReport,
  economicDemoScenarios,
  formatLamports,
  lamportsDelta,
  type EconomicDemoScenario,
} from "@/lib/economic-demo/fixture";
import type { EconomicDemoBalanceReport } from "@/lib/economic-demo/balances";
import type { DryRunEconomicPlan } from "@/lib/economic-demo/dry-run";
import type { SurfpoolRehearsalReport } from "@/lib/economic-demo/surfpool-rehearsal";
import type { EconomicDemoPaymentReadiness } from "@/lib/economic-demo/payment-readiness";
import {
  getDisclosureLedgerEvidenceStatus,
  type WebpageLiveWorkflowEvidence,
} from "@/lib/economic-demo/webpage-live-workflow-evidence";
import type { EconomicDemoLedgerReconciliation } from "@/lib/economic-demo/ledger-reconciliation";
import type { EconomicDemoHostedChallengeProbe } from "@/lib/economic-demo/hosted-challenge-probe";
import type { EconomicDemoLiveRun } from "@/lib/economic-demo/live-run";
import type { EconomicDemoLivePaidDevnetRun } from "@/lib/economic-demo/live-paid-devnet-run";
import type { ResearchWorkflowDesign } from "@/lib/economic-demo/research-workflow-design";
import type { PictureStoryboardDesign } from "@/lib/economic-demo/picture-storyboard-design";
import {
  PROGRAM_COMPATIBILITY,
  PROGRAM_FRAMEWORK,
  PROGRAM_KNOWN_GAPS,
  PROGRAM_SUBMISSION_READY,
  PROGRAM_TARGET,
} from "@/lib/program";
import quasarDeployments from "@/config/quasar/deployments.json";
import { onboardingVideos } from "@/lib/onboarding/video-guides";

function shortWallet(wallet: string) {
  return `${wallet.slice(0, 8)}…${wallet.slice(-6)}`;
}

function formatUsdc(amount: number) {
  return `$${amount.toFixed(2)} USDC`;
}

const WalletMultiButton = dynamic(
  async () =>
    (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false },
);

const quasarJudgeProgramIds =
  quasarDeployments.quasarDeployments.devnet.programIds;

const fundedDevnetJudgeProof = {
  status: "complete",
  spentUsdc: "0.130000",
  artifact:
    "artifacts/economic-demo-live-paid-devnet/20260508T104751Z-funded-hosted-run/hosted-live-run-summary.json",
  boundary: "Bounded Solana devnet proof only — no mainnet settlement claim.",
  specialists: [
    {
      name: "planning-agent",
      amount: "0.03",
      tx: "4onxCVsg4hBLFq3fJJN4AucidRXwzEnKeqJ1ebY3nTrKHU8b2i6YwedBUTuHUTN4RNVKxTvuxhQ1FZZD7SBfGnVi",
    },
    {
      name: "content-creation-agent",
      amount: "0.025",
      tx: "5yewyevX8kCZSeB3iRpNueESbHfgFjKsWMGAyvjuP4gQvhSs9uH8pqcttYnYx9fBtftBT6tm4vA39MkoLznq4BUf",
    },
    {
      name: "code-generation-agent",
      amount: "0.05",
      tx: "4wemS8r5iEDnN8dPxYP8Nfe53Q4tGVduHEwrNsv4fGxnUqrHcQx7JAad67AzQp3BHohJqBezJfoVvKXnbgfP8nto",
    },
    {
      name: "verification-validation-agent",
      amount: "0.025",
      tx: "41riCtDUQfc6ZFzF539Rvnf795TtixSkdoLuWf9x1g6FmswXXBsZHnTbQL3fYfZTPUMWuVE7r1PKyPHBEKWwMLp",
    },
  ],
} as const;

const localEvidenceArtifacts = [
  {
    label: "Picture storyboard dry-run",
    path: "artifacts/economic-demo-picture-storyboard/20260505T034749Z/SUMMARY.md",
    detail:
      "Storyboard-only artifact: no OpenAI/Fal image calls, no paid provider requests, no signing, no transfer.",
  },
  {
    label: "Research workflow dry-run",
    path: "artifacts/economic-demo-research-dry-run/20260505T025224Z/research-dry-run.json",
    detail:
      "Phase 6 design artifact: planned specialist graph only; live research remains approval-gated.",
  },
  {
    label: "Surfpool local rehearsal",
    path: "artifacts/economic-demo-surfpool-rehearsal/20260505T021309Z/SUMMARY.md",
    detail:
      "Local/offline SOL rehearsal evidence; no hosted/devnet mutation claim.",
  },
  {
    label: "Pay.sh / reddi-x402 sandbox charge",
    path: "artifacts/pay-sh-reddi-x402/20260507T064842Z/SUMMARY.md",
    detail:
      "Proven sandbox HTTP 402 → Pay.sh payment → HTTP 200 receipt evidence for Reddi Agent Protocol's reddi-x402 package surface.",
  },
  {
    label: "Umbra private x402 adapter + devnet encrypted-balance deposit",
    path: "artifacts/umbra-devnet-smoke/20260507T075904Z/SUMMARY.md",
    detail:
      "Executable adapter-contract evidence plus bounded devnet wSOL → Umbra encrypted-balance deposit; no mainnet/live-production settlement claimed.",
  },
] as const;

function statusClass(status: EconomicDemoScenario["edges"][number]["status"]) {
  if (status === "blocked")
    return "border-red-400/40 bg-red-400/10 text-red-200";
  if (status === "attested")
    return "border-[#14F195]/40 bg-[#14F195]/10 text-[#14F195]";
  if (status === "paid")
    return "border-accent-purple/40 bg-accent-purple/10 text-accent-purple";
  return "border-white/15 bg-white/5 text-gray-300";
}

export default function EconomicDemoPage() {
  const [scenarioId, setScenarioId] = useState(economicDemoScenarios[0].id);
  const [dryRunPlan, setDryRunPlan] = useState<DryRunEconomicPlan | null>(null);
  const [dryRunStatus, setDryRunStatus] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const [balanceReport, setBalanceReport] =
    useState<EconomicDemoBalanceReport | null>(null);
  const [balanceStatus, setBalanceStatus] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const [surfpoolReport, setSurfpoolReport] =
    useState<SurfpoolRehearsalReport | null>(null);
  const [surfpoolStatus, setSurfpoolStatus] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const [paymentReadiness, setPaymentReadiness] =
    useState<EconomicDemoPaymentReadiness | null>(null);
  const [paymentReadinessStatus, setPaymentReadinessStatus] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const [webpageLiveEvidence, setWebpageLiveEvidence] =
    useState<WebpageLiveWorkflowEvidence | null>(null);
  const [webpageLiveEvidenceStatus, setWebpageLiveEvidenceStatus] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const [ledgerReconciliation, setLedgerReconciliation] =
    useState<EconomicDemoLedgerReconciliation | null>(null);
  const [ledgerReconciliationStatus, setLedgerReconciliationStatus] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const [researchDesign, setResearchDesign] =
    useState<ResearchWorkflowDesign | null>(null);
  const [researchDesignStatus, setResearchDesignStatus] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const [pictureStoryboardDesign, setPictureStoryboardDesign] =
    useState<PictureStoryboardDesign | null>(null);
  const [pictureStoryboardStatus, setPictureStoryboardStatus] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const [controlledLiveRun, setControlledLiveRun] =
    useState<EconomicDemoLiveRun | null>(null);
  const [livePaidDevnetRun, setLivePaidDevnetRun] =
    useState<EconomicDemoLivePaidDevnetRun | null>(null);
  const [livePaidDevnetStatus, setLivePaidDevnetStatus] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const [hostedChallengeProbe, setHostedChallengeProbe] =
    useState<EconomicDemoHostedChallengeProbe | null>(null);
  const [hostedChallengeProbeStatus, setHostedChallengeProbeStatus] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const [paymentAsset, setPaymentAsset] = useState<"USDC" | "SOL">("USDC");
  const [runStarted, setRunStarted] = useState(false);
  const { connected, publicKey } = useWallet();
  const scenario = useMemo(
    () =>
      economicDemoScenarios.find((candidate) => candidate.id === scenarioId) ??
      economicDemoScenarios[0],
    [scenarioId],
  );
  const totalPlanned = scenario.edges.reduce(
    (sum, edge) => sum + edge.amountLamports,
    0,
  );
  const runReport = useMemo(() => buildEconomicRunReport(scenario), [scenario]);
  const activeDryRunPlan =
    dryRunPlan?.scenarioId === scenario.id ? dryRunPlan : null;
  const activeBalanceReport =
    balanceReport?.scenarioId === scenario.id ? balanceReport : null;
  const activeSurfpoolReport =
    surfpoolReport?.scenarioId === scenario.id ? surfpoolReport : null;
  const webpageDisclosureStatus = webpageLiveEvidence
    ? getDisclosureLedgerEvidenceStatus(
        webpageLiveEvidence.disclosureLedgerSummary,
      )
    : null;

  async function loadDryRunPlan() {
    setDryRunStatus("loading");
    try {
      const res = await fetch(
        `/api/economic-demo/dry-run?scenario=${scenario.id}`,
      );
      const payload = (await res.json()) as {
        ok?: boolean;
        plan?: DryRunEconomicPlan;
      };
      if (!res.ok || !payload.ok || !payload.plan)
        throw new Error("dry_run_plan_failed");
      setDryRunPlan(payload.plan);
      setBalanceReport(null);
      setBalanceStatus("idle");
      setSurfpoolReport(null);
      setSurfpoolStatus("idle");
      setPaymentReadiness(null);
      setPaymentReadinessStatus("idle");
      setDryRunStatus("loaded");
    } catch {
      setDryRunStatus("error");
    }
  }

  async function loadBalanceSnapshot() {
    setBalanceStatus("loading");
    try {
      const res = await fetch(
        `/api/economic-demo/balances?scenario=${scenario.id}`,
      );
      const payload = (await res.json()) as {
        ok?: boolean;
        report?: EconomicDemoBalanceReport;
      };
      if (!res.ok || !payload.ok || !payload.report)
        throw new Error("balance_snapshot_failed");
      setBalanceReport(payload.report);
      setBalanceStatus("loaded");
    } catch {
      setBalanceStatus("error");
    }
  }

  async function loadSurfpoolRehearsal() {
    setSurfpoolStatus("loading");
    try {
      const res = await fetch(
        `/api/economic-demo/surfpool-rehearsal?scenario=${scenario.id}`,
      );
      const payload = (await res.json()) as {
        ok?: boolean;
        report?: SurfpoolRehearsalReport;
      };
      if (!res.ok || !payload.ok || !payload.report)
        throw new Error("surfpool_rehearsal_failed");
      setSurfpoolReport(payload.report);
      setSurfpoolStatus("loaded");
    } catch {
      setSurfpoolStatus("error");
    }
  }

  async function loadPaymentReadiness() {
    setPaymentReadinessStatus("loading");
    try {
      const res = await fetch("/api/economic-demo/payment-readiness");
      const payload = (await res.json()) as {
        ok?: boolean;
        readiness?: EconomicDemoPaymentReadiness;
      };
      if (!res.ok || !payload.ok || !payload.readiness)
        throw new Error("payment_readiness_failed");
      setPaymentReadiness(payload.readiness);
      setPaymentReadinessStatus("loaded");
    } catch {
      setPaymentReadinessStatus("error");
    }
  }

  async function loadWebpageLiveEvidence() {
    setWebpageLiveEvidenceStatus("loading");
    try {
      const res = await fetch("/api/economic-demo/webpage-live-workflow");
      const payload = (await res.json()) as {
        ok?: boolean;
        evidence?: WebpageLiveWorkflowEvidence;
      };
      if (!res.ok || !payload.ok || !payload.evidence)
        throw new Error("webpage_live_evidence_failed");
      setWebpageLiveEvidence(payload.evidence);
      setWebpageLiveEvidenceStatus("loaded");
    } catch {
      setWebpageLiveEvidenceStatus("error");
    }
  }

  async function loadLedgerReconciliation() {
    setLedgerReconciliationStatus("loading");
    try {
      const res = await fetch("/api/economic-demo/ledger-reconciliation");
      const payload = (await res.json()) as {
        ok?: boolean;
        reconciliation?: EconomicDemoLedgerReconciliation;
      };
      if (!res.ok || !payload.ok || !payload.reconciliation)
        throw new Error("ledger_reconciliation_failed");
      setLedgerReconciliation(payload.reconciliation);
      setLedgerReconciliationStatus("loaded");
    } catch {
      setLedgerReconciliationStatus("error");
    }
  }

  async function loadResearchDesign() {
    setResearchDesignStatus("loading");
    try {
      const res = await fetch("/api/economic-demo/research-workflow-design");
      const payload = (await res.json()) as {
        ok?: boolean;
        design?: ResearchWorkflowDesign;
      };
      if (!res.ok || !payload.ok || !payload.design)
        throw new Error("research_design_failed");
      setResearchDesign(payload.design);
      setResearchDesignStatus("loaded");
    } catch {
      setResearchDesignStatus("error");
    }
  }

  async function loadPictureStoryboardDesign() {
    setPictureStoryboardStatus("loading");
    try {
      const res = await fetch("/api/economic-demo/picture-storyboard-design");
      const payload = (await res.json()) as {
        ok?: boolean;
        design?: PictureStoryboardDesign;
      };
      if (!res.ok || !payload.ok || !payload.design)
        throw new Error("picture_storyboard_failed");
      setPictureStoryboardDesign(payload.design);
      setPictureStoryboardStatus("loaded");
    } catch {
      setPictureStoryboardStatus("error");
    }
  }

  async function runControlledDemo() {
    setRunStarted(true);
    setHostedChallengeProbeStatus("loading");
    setWebpageLiveEvidenceStatus("loading");
    try {
      const probeRes = await fetch(
        "/api/economic-demo/hosted-challenge-probe",
        {
          method: "POST",
        },
      );
      const probePayload = (await probeRes.json()) as {
        ok?: boolean;
        probe?: EconomicDemoHostedChallengeProbe;
      };
      if (probeRes.ok && probePayload.ok && probePayload.probe) {
        setHostedChallengeProbe(probePayload.probe);
        setHostedChallengeProbeStatus("loaded");
      } else {
        setHostedChallengeProbe(null);
        setHostedChallengeProbeStatus("error");
      }
    } catch {
      setHostedChallengeProbe(null);
      setHostedChallengeProbeStatus("error");
    }

    try {
      const res = await fetch("/api/economic-demo/live-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenarioId: scenario.id,
          prompt: scenario.prompt,
          mode: "controlled_hosted_evidence",
          clientRunNonce: `ui-${Date.now()}`,
        }),
      });
      const payload = (await res.json()) as {
        ok?: boolean;
        run?: EconomicDemoLiveRun;
      };
      if (!res.ok || !payload.ok || !payload.run) {
        throw new Error("controlled_live_run_failed");
      }
      setControlledLiveRun(payload.run);
      setWebpageLiveEvidence(payload.run.evidence);
      setWebpageLiveEvidenceStatus("loaded");
    } catch {
      setControlledLiveRun(null);
      setWebpageLiveEvidenceStatus("error");
    }
  }

  async function runLivePaidDevnetDemo() {
    setRunStarted(true);
    setLivePaidDevnetStatus("loading");
    try {
      const res = await fetch("/api/economic-demo/live-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenarioId: scenario.id,
          prompt: scenario.prompt,
          mode: "live_paid_devnet",
          clientRunNonce: `ui-paid-${Date.now()}`,
        }),
      });
      const payload = (await res.json()) as {
        ok?: boolean;
        livePaidDevnetRun?: EconomicDemoLivePaidDevnetRun;
      };
      if (!res.ok || !payload.ok || !payload.livePaidDevnetRun) {
        throw new Error("live_paid_devnet_run_failed");
      }
      setLivePaidDevnetRun(payload.livePaidDevnetRun);
      setLivePaidDevnetStatus("loaded");
    } catch {
      setLivePaidDevnetRun(null);
      setLivePaidDevnetStatus("error");
    }
  }

  async function probeHostedChallenges() {
    setHostedChallengeProbeStatus("loading");
    try {
      const res = await fetch("/api/economic-demo/hosted-challenge-probe", {
        method: "POST",
      });
      const payload = (await res.json()) as {
        ok?: boolean;
        probe?: EconomicDemoHostedChallengeProbe;
      };
      if (!res.ok || !payload.ok || !payload.probe) {
        throw new Error("hosted_challenge_probe_failed");
      }
      setHostedChallengeProbe(payload.probe);
      setHostedChallengeProbeStatus("loaded");
    } catch {
      setHostedChallengeProbe(null);
      setHostedChallengeProbeStatus("error");
    }
  }

  return (
    <main className="min-h-screen bg-page">
      <section className="relative overflow-hidden border-b border-white/5">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(153,69,255,0.22),transparent_35%),radial-gradient(circle_at_80%_10%,rgba(20,241,149,0.16),transparent_28%)]" />
        <div className="relative mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="max-w-4xl space-y-5">
            <span className="section-label">
              Economic demo · agent commerce lighthouse
            </span>
            <h1 className="font-display text-4xl font-bold text-white sm:text-5xl">
              Watch an agent hire specialists, pay through x402, and return
              verified work
            </h1>
            <p className="max-w-3xl text-base leading-7 text-gray-400">
              One user request becomes a quoted, paid, attested multi-agent
              workflow. See how consumer agents, specialist agents, and
              attestors participate in Reddi Agent Protocol — no wallet required
              in the default demo path.
            </p>
            <div
              data-testid="economic-proof-pills"
              className="flex flex-wrap gap-2"
            >
              {[
                "4 specialists paid on devnet",
                "0.13 USDC spent",
                "HTTP 402 → SPL payment → HTTP 200",
                "Receipts + attestation",
                "No mainnet claim",
              ].map((pill) => (
                <span
                  key={pill}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-gray-200"
                >
                  {pill}
                </span>
              ))}
            </div>
            <section id="video-guide" className="pt-2">
              <OnboardingVideoCard video={onboardingVideos.find((video) => video.id === "economic-proof") ?? onboardingVideos[1]} layout="horizontal" />
            </section>

            <div
              data-testid="funded-devnet-judge-proof"
              className="rounded-2xl border border-[#14F195]/25 bg-black/30 p-5 shadow-card"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-[#14F195]">
                    Judge proof: funded devnet paid run
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-white">
                    One request paid 4 specialist agents and received 4
                    completions
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-300">
                    The strongest submission evidence is a bounded Solana devnet
                    run: each specialist returned an HTTP 402 challenge,
                    received an SPL/USDC payment, then returned HTTP 200
                    completion evidence.
                  </p>
                </div>
                <div className="rounded-xl border border-[#14F195]/25 bg-[#14F195]/10 p-4 text-right">
                  <p className="text-xs uppercase tracking-wide text-gray-400">
                    completed spend
                  </p>
                  <p className="mt-1 font-mono text-3xl text-[#14F195]">
                    {fundedDevnetJudgeProof.spentUsdc} USDC
                  </p>
                  <p className="mt-1 text-xs text-yellow-100">
                    {fundedDevnetJudgeProof.boundary}
                  </p>
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {fundedDevnetJudgeProof.specialists.map((specialist) => (
                  <div
                    key={specialist.name}
                    className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs leading-5"
                  >
                    <p className="font-semibold text-white">
                      {specialist.name}
                    </p>
                    <p className="mt-1 text-gray-300">
                      402 → {specialist.amount} USDC → HTTP 200
                    </p>
                    <p className="mt-1 font-mono text-[#14F195]">
                      tx {shortWallet(specialist.tx)}
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-4 break-all font-mono text-xs text-gray-500">
                Evidence: {fundedDevnetJudgeProof.artifact}
              </p>
            </div>

            <div className="space-y-4 pt-1">
              <div className="flex flex-wrap gap-3">
                <a
                  href="#evidence-archive"
                  className="rounded-lg bg-[#14F195] px-5 py-3 text-sm font-bold text-black shadow-card transition hover:bg-[#14F195]/90"
                >
                  Verify recorded proof
                </a>
                <a
                  href="/judge-replication"
                  className="rounded-lg border border-[#14F195]/30 bg-[#14F195]/10 px-5 py-3 text-sm font-semibold text-[#14F195] transition hover:bg-[#14F195]/15"
                >
                  Open replication guide
                </a>
                <a
                  href="#participation-paths"
                  className="rounded-lg border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-gray-200 transition hover:border-[#14F195]/30 hover:text-[#14F195]"
                >
                  Choose your role
                </a>
              </div>

              <details className="rounded-2xl border border-yellow-300/20 bg-yellow-300/5 p-4 text-sm text-yellow-50">
                <summary className="cursor-pointer font-semibold text-yellow-100">
                  Advanced: run fresh devnet actions
                </summary>
                <p className="mt-2 max-w-3xl text-xs leading-5 text-yellow-100/80">
                  Fresh runs may call hosted endpoints or submit devnet transactions. The recorded proof below is enough to verify the submitted videos; use these only when deliberately testing new state.
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={runControlledDemo}
                    disabled={webpageLiveEvidenceStatus === "loading"}
                    className="rounded-lg border border-yellow-300/25 bg-black/25 px-5 py-3 text-sm font-semibold text-yellow-50 transition hover:bg-yellow-300/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {webpageLiveEvidenceStatus === "loading"
                      ? "Running demo…"
                      : "Run controlled demo"}
                  </button>
                  <button
                    type="button"
                    onClick={probeHostedChallenges}
                    disabled={hostedChallengeProbeStatus === "loading"}
                    className="rounded-lg border border-yellow-300/25 bg-black/25 px-5 py-3 text-sm font-semibold text-yellow-50 transition hover:bg-yellow-300/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {hostedChallengeProbeStatus === "loading"
                      ? "Probing hosted 402s…"
                      : "Probe hosted 402s"}
                  </button>
                  <button
                    type="button"
                    onClick={runLivePaidDevnetDemo}
                    disabled={livePaidDevnetStatus === "loading"}
                    className="rounded-lg border border-accent-purple/40 bg-accent-purple/10 px-5 py-3 text-sm font-semibold text-accent-purple transition hover:bg-accent-purple/15 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {livePaidDevnetStatus === "loading"
                      ? "Running live paid devnet…"
                      : "Run live paid devnet demo"}
                  </button>
                </div>
              </details>
            </div>
            <div
              id="participation-paths"
              className="grid gap-3 pt-3 md:grid-cols-3"
            >
              {[
                {
                  title: "Register as a specialist",
                  desc: "Earn by completing scoped tasks behind reddi-x402 gates.",
                  href: "/register",
                },
                {
                  title: "Connect a consumer agent",
                  desc: "Use MCP/planner rails to discover specialists and enforce budget policy.",
                  href: "/planner",
                },
                {
                  title: "Become an attestor",
                  desc: "Verify outputs, receipt chains, and release criteria for paid work.",
                  href: "/attestation",
                },
              ].map((role) => (
                <a
                  key={role.title}
                  href={role.href}
                  className="rounded-xl border border-white/10 bg-white/5 p-4 transition hover:border-[#14F195]/40 hover:bg-white/[0.07]"
                >
                  <p className="text-sm font-semibold text-white">
                    {role.title}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-gray-400">
                    {role.desc}
                  </p>
                </a>
              ))}
            </div>
            {hostedChallengeProbeStatus !== "idle" && (
              <div
                data-testid="hosted-challenge-probe"
                className="rounded-xl border border-[#14F195]/25 bg-black/30 p-4 text-sm leading-6 text-gray-200"
              >
                <p className="text-xs uppercase tracking-wide text-[#14F195]">
                  Fresh unpaid hosted endpoint probe
                </p>
                {hostedChallengeProbeStatus === "error" && (
                  <p className="mt-2 text-yellow-100">
                    Probe did not complete cleanly. No payment retry was
                    attempted.
                  </p>
                )}
                {hostedChallengeProbe && (
                  <div className="mt-3 space-y-3">
                    <p>
                      Observed {hostedChallengeProbe.summary.ok}/
                      {hostedChallengeProbe.summary.requested} allowlisted x402
                      challenges. {hostedChallengeProbe.claimBoundary}
                    </p>
                    <div className="grid gap-2 md:grid-cols-2">
                      {hostedChallengeProbe.results.map((result) => (
                        <div
                          key={result.profileId}
                          className="rounded-lg border border-white/10 bg-white/5 p-3 text-xs leading-5"
                        >
                          <p className="font-semibold text-white">
                            {result.profileId} · HTTP {result.httpStatus ?? "—"}
                          </p>
                          <p className="break-all text-gray-400">
                            {result.endpoint}
                          </p>
                          <p
                            className={
                              result.ok ? "text-[#14F195]" : "text-yellow-100"
                            }
                          >
                            {result.ok
                              ? `x402 ${result.challenge?.network} ${result.challenge?.amount} ${result.challenge?.currency}`
                              : result.error}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              {economicDemoScenarios.map((candidate) => (
                <button
                  key={candidate.id}
                  onClick={() => setScenarioId(candidate.id)}
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                    candidate.id === scenario.id
                      ? "border-[#14F195]/50 bg-[#14F195]/15 text-[#14F195]"
                      : "border-white/10 bg-white/5 text-gray-300 hover:border-white/25 hover:text-white"
                  }`}
                >
                  {candidate.title}
                </button>
              ))}
            </div>
            <div className="grid gap-3 pt-3 md:grid-cols-3">
              {economicDemoScenarios.map((candidate) => (
                <button
                  key={`card-${candidate.id}`}
                  type="button"
                  onClick={() => {
                    setScenarioId(candidate.id);
                    setRunStarted(false);
                  }}
                  className={`rounded-2xl border p-4 text-left transition ${candidate.id === scenario.id ? "border-[#14F195]/50 bg-[#14F195]/10" : "border-white/10 bg-white/5 hover:border-white/25"}`}
                >
                  <p className="text-xs uppercase tracking-wide text-gray-500">
                    Prompt template
                  </p>
                  <h3 className="mt-2 font-semibold text-white">
                    {candidate.title}
                  </h3>
                  <p className="mt-2 text-sm leading-5 text-gray-400">
                    {candidate.finalOutputSummary}
                  </p>
                  <p className="mt-3 font-mono text-sm text-[#14F195]">
                    {formatUsdc(candidate.quote.totalUsdc)}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1.5fr)]">
          <div className="min-w-0 space-y-6">
            <div className="rounded-2xl border border-white/10 bg-card/70 p-6 shadow-card">
              <p className="section-label">User request</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                {scenario.title}
              </h2>
              <p className="mt-3 rounded-xl border border-white/10 bg-black/20 p-4 text-sm leading-6 text-gray-200">
                “{scenario.prompt}”
              </p>
              <div
                data-testid="economic-demo-story-spine"
                className="mt-5 rounded-xl border border-white/10 bg-black/20 p-4"
              >
                <p className="text-xs uppercase tracking-wide text-gray-500">
                  Story spine
                </p>
                <div className="mt-3 grid gap-2 text-sm md:grid-cols-6">
                  {[
                    "Prompt",
                    "Quote",
                    "x402 payment",
                    "Specialist work",
                    "Attestation",
                    "Evidence",
                  ].map((step, index) => (
                    <div
                      key={step}
                      className="rounded-lg border border-white/10 bg-white/5 p-3"
                    >
                      <p className="font-mono text-xs text-[#14F195]">
                        {String(index + 1).padStart(2, "0")}
                      </p>
                      <p className="mt-1 font-semibold text-white">{step}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div
                data-testid="economic-upfront-quote"
                className="mt-6 rounded-xl border border-[#14F195]/25 bg-[#14F195]/10 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-[#14F195]">
                      Quote / payment boundary
                    </p>
                    <h3 className="mt-1 text-xl font-semibold text-white">
                      One request, four paid specialist calls
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-gray-300">
                      The default lane tells the story without asking you to
                      connect a wallet. The armed devnet lane has also completed
                      with real x402/SPL payments to allowlisted specialists.
                    </p>
                  </div>
                  <div className="min-w-48 rounded-lg border border-white/10 bg-black/25 p-3 text-right">
                    <p className="text-xs text-gray-400">modeled quote</p>
                    <p className="font-mono text-2xl text-[#14F195]">
                      {formatUsdc(scenario.quote.totalUsdc)}
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <p className="text-xs text-gray-500">
                      downstream specialists
                    </p>
                    <p className="mt-1 font-mono text-sm text-white">
                      {formatUsdc(scenario.quote.downstreamFeesUsdc)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <p className="text-xs text-gray-500">attestors</p>
                    <p className="mt-1 font-mono text-sm text-white">
                      {formatUsdc(scenario.quote.attestorFeesUsdc)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <p className="text-xs text-gray-500">orchestrator markup</p>
                    <p className="mt-1 font-mono text-sm text-[#14F195]">
                      {formatUsdc(scenario.quote.orchestratorMarkupUsdc)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <p className="text-xs text-gray-500">devnet paid proof</p>
                    <p className="mt-1 font-mono text-sm text-white">
                      0.13 USDC live run
                    </p>
                  </div>
                </div>
                <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
                  <p className="text-xs uppercase tracking-wide text-gray-500">
                    Money + work graph
                  </p>
                  <div className="mt-3 grid gap-2 text-xs md:grid-cols-5">
                    {[
                      `User pays ${formatUsdc(scenario.quote.totalUsdc)}`,
                      `Orchestrator keeps ${formatUsdc(scenario.quote.orchestratorMarkupUsdc)}`,
                      `Specialists receive ${formatUsdc(scenario.quote.downstreamFeesUsdc)}`,
                      `Attestors receive ${formatUsdc(scenario.quote.attestorFeesUsdc)}`,
                      "Receipts update reputation",
                    ].map((item) => (
                      <div
                        key={item}
                        className="rounded-lg border border-white/10 bg-white/5 p-3 text-gray-200"
                      >
                        {item}
                      </div>
                    ))}
                  </div>
                </div>

                <p className="mt-4 rounded-lg border border-yellow-400/30 bg-yellow-400/10 p-3 text-xs leading-5 text-yellow-50/90">
                  Boundary: this lane does not claim mainnet payment, production
                  settlement, arbitrary-wallet private settlement, or a
                  successful Jupiter devnet swap.
                </p>
                <details className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-gray-200">
                    Optional user-devnet wallet lane (advanced)
                  </summary>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <WalletMultiButton />
                    <span
                      className={
                        connected
                          ? "rounded-full border border-[#14F195]/30 px-3 py-1 text-xs text-[#14F195]"
                          : "rounded-full border border-yellow-400/40 px-3 py-1 text-xs text-yellow-100"
                      }
                    >
                      {connected && publicKey
                        ? `connected ${shortWallet(publicKey.toBase58())}`
                        : "connect wallet only for bounded devnet mode"}
                    </span>
                    {(["USDC", "SOL"] as const).map((asset) => (
                      <button
                        key={asset}
                        type="button"
                        onClick={() => setPaymentAsset(asset)}
                        className={
                          paymentAsset === asset
                            ? "rounded-lg border border-accent-purple/40 bg-accent-purple/15 px-3 py-2 text-sm font-semibold text-accent-purple"
                            : "rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-gray-300"
                        }
                      >
                        Pay with {asset}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setRunStarted(true)}
                      disabled={!connected}
                      className={
                        connected
                          ? "rounded-lg bg-[#14F195] px-4 py-2 text-sm font-bold text-black shadow-card"
                          : "rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-gray-500"
                      }
                    >
                      {paymentAsset === "SOL"
                        ? "Show Jupiter boundary and run"
                        : `Pay ${formatUsdc(scenario.quote.totalUsdc)} and run`}
                    </button>
                  </div>
                  {!connected && (
                    <p className="mt-3 text-xs text-yellow-100">
                      Only connect a devnet wallet if you explicitly want to
                      test the bounded user-funded mode.
                    </p>
                  )}
                  {paymentAsset === "SOL" && (
                    <div
                      data-testid="jupiter-swap-proof"
                      className="mt-4 rounded-lg border border-yellow-400/30 bg-yellow-400/10 p-3"
                    >
                      <p className="text-xs uppercase tracking-wide text-yellow-100">
                        Jupiter swap boundary lane
                      </p>
                      <p className="mt-2 text-sm leading-6 text-yellow-50/90">
                        Intended execution story: user starts with SOL, Jupiter
                        would convert {scenario.quote.solEstimate.toFixed(3)}{" "}
                        SOL → {formatUsdc(scenario.quote.totalUsdc)} on mainnet
                        liquidity, then the orchestrator pays downstream agents
                        from the USDC budget. Slippage cap:{" "}
                        {scenario.quote.slippageBps} bps; allowance:{" "}
                        {formatUsdc(scenario.quote.jupiterSwapAllowanceUsdc)}.
                      </p>
                      <div className="mt-3 rounded border border-white/10 bg-black/20 p-2 text-xs leading-5 text-yellow-50/90">
                        <p>
                          Composite proof: live Jupiter route quote +
                          wallet-specific transaction build/signature attempt;
                          successful Jupiter execution is not claimed on devnet.
                        </p>
                        <p className="break-all font-mono text-gray-400">
                          signed devnet budget-lane tx, not Jupiter swap
                          receipt:{" "}
                          {runReport.jupiterSwapProof.transactionAddress}
                        </p>
                      </div>
                    </div>
                  )}
                </details>
                {runStarted && (
                  <div
                    data-testid="live-run-status"
                    className="mt-4 rounded-lg border border-[#14F195]/30 bg-black/20 p-3"
                  >
                    <p className="text-xs uppercase tracking-wide text-[#14F195]">
                      Controlled live-run timeline started
                    </p>
                    <p className="mt-2 text-sm leading-6 text-gray-200">
                      Prompt selected → quote boundary accepted → hosted x402
                      challenge probes observed → returned output and evidence
                      drawer shown below.
                    </p>
                    {controlledLiveRun && (
                      <div
                        data-testid="controlled-live-run-envelope"
                        className="mt-3 space-y-2"
                      >
                        <div className="rounded border border-white/10 bg-black/30 p-2 text-xs leading-5 text-gray-300">
                          <p className="font-mono text-white">
                            run: {controlledLiveRun.runId}
                          </p>
                          <p className="break-all">
                            prompt hash: {controlledLiveRun.promptHash}
                          </p>
                          <p className="text-yellow-100">
                            {controlledLiveRun.claimBoundary}
                          </p>
                        </div>
                        <div className="grid gap-2 md:grid-cols-2">
                          {controlledLiveRun.timeline.map((step) => (
                            <div
                              key={step.id}
                              className="rounded border border-white/10 bg-white/5 p-2 text-xs leading-5 text-gray-300"
                            >
                              <p className="font-semibold text-white">
                                {step.label}
                              </p>
                              <p>{step.detail}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {livePaidDevnetStatus !== "idle" && (
                      <div
                        data-testid="live-paid-devnet-run-envelope"
                        className="mt-3 space-y-2 rounded-lg border border-accent-purple/30 bg-accent-purple/10 p-3"
                      >
                        <p className="text-xs uppercase tracking-wide text-accent-purple">
                          Live paid devnet lane
                        </p>
                        {livePaidDevnetStatus === "error" && (
                          <p className="text-sm text-yellow-100">
                            Live paid devnet run failed before returning a
                            bounded envelope.
                          </p>
                        )}
                        {livePaidDevnetRun && (
                          <>
                            <div className="rounded border border-white/10 bg-black/30 p-2 text-xs leading-5 text-gray-300">
                              <p className="font-mono text-white">
                                status: {livePaidDevnetRun.status}
                              </p>
                              <p className="break-all">
                                orchestrator:{" "}
                                {livePaidDevnetRun.orchestratorWallet ??
                                  "not armed"}
                              </p>
                              <p>
                                spent: {livePaidDevnetRun.spentUsdc} USDC / cap{" "}
                                {livePaidDevnetRun.maxUsdc} USDC
                              </p>
                              <p className="text-yellow-100">
                                {livePaidDevnetRun.claimBoundary}
                              </p>
                            </div>
                            <div className="grid gap-2 md:grid-cols-2">
                              {livePaidDevnetRun.timeline.map((step) => (
                                <div
                                  key={step.id}
                                  className="rounded border border-white/10 bg-white/5 p-2 text-xs leading-5 text-gray-300"
                                >
                                  <p className="font-semibold text-white">
                                    {step.profileId} · {step.status}
                                  </p>
                                  <p className="break-all text-gray-500">
                                    {step.endpoint}
                                  </p>
                                  {step.amountUsdc && (
                                    <p>{step.amountUsdc} USDC</p>
                                  )}
                                  {step.txSignature && (
                                    <p className="break-all text-[#14F195]">
                                      tx: {step.txSignature}
                                    </p>
                                  )}
                                  {step.outputPreview && (
                                    <p>{step.outputPreview}</p>
                                  )}
                                  {step.error && (
                                    <p className="text-yellow-100">
                                      {step.error}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                            <details className="rounded border border-white/10 bg-black/20 p-2 text-xs text-gray-300">
                              <summary className="cursor-pointer font-semibold text-white">
                                Future guardrails noted, not demo blockers
                              </summary>
                              <ul className="mt-2 list-disc space-y-1 pl-5">
                                {livePaidDevnetRun.futureGuardrails.map(
                                  (item) => (
                                    <li key={item}>{item}</li>
                                  ),
                                )}
                              </ul>
                            </details>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <details
                id="evidence-archive"
                data-testid="economic-evidence-archive"
                className="mt-6 rounded-xl border border-white/10 bg-black/20 p-4"
              >
                <summary className="cursor-pointer text-sm font-semibold text-white">
                  Evidence archive and operator controls
                </summary>
                <p className="mt-3 text-sm leading-6 text-gray-400">
                  These controls load historical or design evidence. They are
                  deliberately below the main story so archive material does not
                  masquerade as a live run.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    onClick={loadDryRunPlan}
                    disabled={dryRunStatus === "loading"}
                    className="rounded-lg border border-[#14F195]/30 bg-[#14F195]/10 px-4 py-2 text-sm font-semibold text-[#14F195] transition hover:bg-[#14F195]/15 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {dryRunStatus === "loading"
                      ? "Building dry-run plan…"
                      : "Build dry-run economic graph"}
                  </button>
                  <button
                    onClick={loadBalanceSnapshot}
                    disabled={balanceStatus === "loading"}
                    className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-gray-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {balanceStatus === "loading"
                      ? "Reading balances…"
                      : "Read devnet balances"}
                  </button>
                  <button
                    onClick={loadSurfpoolRehearsal}
                    disabled={surfpoolStatus === "loading"}
                    className="rounded-lg border border-accent-purple/30 bg-accent-purple/10 px-4 py-2 text-sm font-semibold text-accent-purple transition hover:bg-accent-purple/15 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {surfpoolStatus === "loading"
                      ? "Planning rehearsal…"
                      : "Plan Surfpool rehearsal"}
                  </button>
                  <button
                    onClick={loadPaymentReadiness}
                    disabled={paymentReadinessStatus === "loading"}
                    className="rounded-lg border border-yellow-400/30 bg-yellow-400/10 px-4 py-2 text-sm font-semibold text-yellow-100 transition hover:bg-yellow-400/15 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {paymentReadinessStatus === "loading"
                      ? "Checking payment readiness…"
                      : "Show payment readiness"}
                  </button>
                  <button
                    onClick={loadWebpageLiveEvidence}
                    disabled={webpageLiveEvidenceStatus === "loading"}
                    className="rounded-lg border border-[#14F195]/30 bg-[#14F195]/10 px-4 py-2 text-sm font-semibold text-[#14F195] transition hover:bg-[#14F195]/15 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {webpageLiveEvidenceStatus === "loading"
                      ? "Loading evidence…"
                      : "Load latest hosted evidence"}
                  </button>
                  <button
                    onClick={loadLedgerReconciliation}
                    disabled={ledgerReconciliationStatus === "loading"}
                    className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-gray-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {ledgerReconciliationStatus === "loading"
                      ? "Reconciling ledger…"
                      : "Reconcile ledger"}
                  </button>
                  <button
                    onClick={loadResearchDesign}
                    disabled={researchDesignStatus === "loading"}
                    className="rounded-lg border border-accent-purple/30 bg-accent-purple/10 px-4 py-2 text-sm font-semibold text-accent-purple transition hover:bg-accent-purple/15 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {researchDesignStatus === "loading"
                      ? "Designing research path…"
                      : "Design research workflow"}
                  </button>
                  <button
                    onClick={loadPictureStoryboardDesign}
                    disabled={pictureStoryboardStatus === "loading"}
                    className="rounded-lg border border-yellow-400/30 bg-yellow-400/10 px-4 py-2 text-sm font-semibold text-yellow-100 transition hover:bg-yellow-400/15 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {pictureStoryboardStatus === "loading"
                      ? "Building storyboard…"
                      : "Design picture storyboard"}
                  </button>
                  <a
                    href="#local-evidence-artifacts"
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-gray-200 transition hover:border-[#14F195]/30 hover:text-[#14F195]"
                  >
                    Latest local evidence paths →
                  </a>
                </div>
              </details>
              {dryRunStatus === "error" && (
                <p className="mt-3 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">
                  Dry-run plan failed. Fixture view is still available.
                </p>
              )}
              {balanceStatus === "error" && (
                <p className="mt-3 rounded-lg border border-yellow-400/30 bg-yellow-400/10 p-3 text-sm text-yellow-100">
                  Balance snapshot failed. No transfer was attempted.
                </p>
              )}
              {surfpoolStatus === "error" && (
                <p className="mt-3 rounded-lg border border-yellow-400/30 bg-yellow-400/10 p-3 text-sm text-yellow-100">
                  Surfpool rehearsal plan failed. No local transfer was
                  attempted.
                </p>
              )}
              {paymentReadinessStatus === "error" && (
                <p className="mt-3 rounded-lg border border-yellow-400/30 bg-yellow-400/10 p-3 text-sm text-yellow-100">
                  Payment readiness failed. No live retry was attempted from the
                  UI.
                </p>
              )}
              {webpageLiveEvidenceStatus === "error" && (
                <p className="mt-3 rounded-lg border border-yellow-400/30 bg-yellow-400/10 p-3 text-sm text-yellow-100">
                  Hosted evidence failed to load. No live specialist payment was
                  attempted from the UI.
                </p>
              )}
              {ledgerReconciliationStatus === "error" && (
                <p className="mt-3 rounded-lg border border-yellow-400/30 bg-yellow-400/10 p-3 text-sm text-yellow-100">
                  Ledger reconciliation failed. No live call or transfer was
                  attempted.
                </p>
              )}
              {researchDesignStatus === "error" && (
                <p className="mt-3 rounded-lg border border-yellow-400/30 bg-yellow-400/10 p-3 text-sm text-yellow-100">
                  Research workflow design failed. No live call or Coolify
                  mutation was attempted.
                </p>
              )}
              {pictureStoryboardStatus === "error" && (
                <p className="mt-3 rounded-lg border border-yellow-400/30 bg-yellow-400/10 p-3 text-sm text-yellow-100">
                  Picture storyboard design failed. No image-generation
                  provider, signing, or transfer was attempted.
                </p>
              )}

              <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <dt className="text-gray-500">Orchestrator</dt>
                  <dd className="mt-1 font-mono text-[#14F195]">
                    {scenario.orchestrator}
                  </dd>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <dt className="text-gray-500">Mode now</dt>
                  <dd className="mt-1 font-mono text-gray-200">
                    {scenario.mode}
                  </dd>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <dt className="text-gray-500">Edges</dt>
                  <dd className="mt-1 text-gray-200">
                    {scenario.edges.length}
                  </dd>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <dt className="text-gray-500">Planned flow</dt>
                  <dd className="mt-1 text-gray-200">
                    {formatLamports(totalPlanned)}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="rounded-2xl border border-white/10 bg-card/70 p-6 shadow-card">
              <p data-testid="economic-final-output" className="section-label">
                Final output
              </p>
              <h3 className="mt-2 text-xl font-semibold text-white">
                {scenario.finalOutputType}
              </h3>
              <p className="mt-3 text-sm leading-6 text-gray-300">
                {scenario.finalOutputSummary}
              </p>
              <div className="mt-5 rounded-xl border border-[#14F195]/20 bg-[#14F195]/10 p-4 text-sm text-[#14F195]">
                Next live loop: replace fixture receipts with exact allowlisted
                devnet x402 receipts and balance snapshots.
              </div>
            </div>

            <div
              className={`rounded-2xl border p-6 shadow-card ${PROGRAM_TARGET === "quasar" ? "border-amber-400/25 bg-amber-500/10" : "border-white/10 bg-card/70"}`}
            >
              <p className="section-label">Solana program target</p>
              <h3 className="mt-2 text-xl font-semibold text-white">
                {PROGRAM_TARGET === "quasar"
                  ? "Quasar hackathon target active"
                  : "Historical reference mode — not final judge proof"}
              </h3>
              <p className="mt-3 text-sm leading-6 text-gray-300">
                Final judge claims use the Quasar devnet proof path and the
                funded devnet x402/SPL run above. Historical/reference program
                modes remain below the fold and are not the final submission
                claim.
              </p>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <dt className="text-gray-500">Quasar Escrow program</dt>
                  <dd className="mt-1 break-all font-mono text-[#14F195]">
                    {quasarJudgeProgramIds.escrow}
                  </dd>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <dt className="text-gray-500">Quasar Registry program</dt>
                  <dd className="mt-1 break-all font-mono text-[#14F195]">
                    {quasarJudgeProgramIds.registry}
                  </dd>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <dt className="text-gray-500">Quasar Reputation program</dt>
                  <dd className="mt-1 break-all font-mono text-[#14F195]">
                    {quasarJudgeProgramIds.reputation}
                  </dd>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <dt className="text-gray-500">Quasar Attestation program</dt>
                  <dd className="mt-1 break-all font-mono text-[#14F195]">
                    {quasarJudgeProgramIds.attestation}
                  </dd>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <dt className="text-gray-500">Target / framework</dt>
                  <dd className="mt-1 font-mono text-gray-200">
                    final proof: quasar · quasar
                    <br />
                    runtime config: {PROGRAM_TARGET} · {PROGRAM_FRAMEWORK}
                  </dd>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <dt className="text-gray-500">Compatibility</dt>
                  <dd className="mt-1 font-mono text-gray-200">
                    {PROGRAM_COMPATIBILITY}
                  </dd>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <dt className="text-gray-500">Submission readiness</dt>
                  <dd
                    className={
                      PROGRAM_SUBMISSION_READY
                        ? "mt-1 font-semibold text-[#14F195]"
                        : "mt-1 font-semibold text-yellow-100"
                    }
                  >
                    {PROGRAM_SUBMISSION_READY ? "ready" : "blocked"}
                  </dd>
                </div>
              </dl>
              {!PROGRAM_SUBMISSION_READY && PROGRAM_KNOWN_GAPS.length > 0 && (
                <div className="mt-4 rounded-xl border border-yellow-400/30 bg-yellow-400/10 p-4 text-sm text-yellow-50/90">
                  <p className="font-semibold text-yellow-50">
                    {PROGRAM_TARGET === "quasar"
                      ? "Known Quasar proof gaps before judge-ready submission:"
                      : "Known readiness gaps for the active network profile:"}
                  </p>
                  <ul className="mt-2 space-y-1">
                    {PROGRAM_KNOWN_GAPS.map((gap) => (
                      <li key={gap} className="flex gap-2">
                        <span>•</span>
                        <span>{gap}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3 text-xs leading-5 text-gray-300">
                Hard boundary: this page must not sign, mutate wallets, transfer
                devnet funds, deploy programs, mutate Coolify/Vercel/env
                settings, or perform paid/live specialist work unless Nissan
                explicitly approves that specific loop.
              </p>
            </div>

            <div
              id="local-evidence-artifacts"
              className="rounded-2xl border border-[#14F195]/20 bg-card/70 p-6 shadow-card"
            >
              <p className="section-label">Latest local evidence</p>
              <h3 className="mt-2 text-xl font-semibold text-white">
                Dry-run artifact paths
              </h3>
              <p className="mt-3 text-sm leading-6 text-gray-300">
                These are repo-local, ignored artifacts for demo prep. The UI
                links the operator to exact paths without publishing private
                logs or triggering live calls.
              </p>
              <div className="mt-4 space-y-3">
                {localEvidenceArtifacts.map((artifact) => (
                  <div
                    key={artifact.path}
                    className="rounded-xl border border-white/10 bg-black/20 p-3"
                  >
                    <p className="text-sm font-medium text-white">
                      {artifact.label}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-gray-400">
                      {artifact.detail}
                    </p>
                    <p className="mt-2 break-all font-mono text-xs text-[#14F195]">
                      {artifact.path}
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-4 rounded-lg border border-yellow-400/30 bg-yellow-400/10 p-3 text-xs leading-5 text-yellow-50/90">
                Approval gates still apply: no Phase 6 live research, real
                OpenAI/Fal image generation, signing, wallet mutation, or devnet
                transfer from this panel.
              </p>
            </div>

            <div className="rounded-2xl border border-accent-purple/25 bg-accent-purple/10 p-6 shadow-card">
              <p className="section-label">Agentic workflow disclosure</p>
              <h3 className="mt-2 text-xl font-semibold text-white">
                Autonomous agents can become consumers
              </h3>
              <p className="mt-3 text-sm leading-6 text-gray-300">
                Specialists and attestors are wallet-bearing autonomous agents.
                If they may hire other marketplace agents while fulfilling their
                role, their manifest must disclose that before purchase and
                their response must return a downstream-disclosure ledger.
              </p>
              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">
                    Manifest disclosure
                  </p>
                  <p className="mt-2 text-gray-300">
                    may call agents · expected capabilities · budget policy ·
                    attestor expectations · payload-disclosure policy
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">
                    Return disclosure
                  </p>
                  <p className="mt-2 text-gray-300">
                    called agent · wallet/endpoint · payload summary/hash · x402
                    state · attestor links · moat-protection marker
                  </p>
                </div>
              </div>
              <p className="mt-4 text-xs leading-5 text-yellow-100">
                Moat protection can obfuscate proprietary returned value-add
                details, but not called-agent identity, payload class, payment
                evidence, or attestation chain.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-card/70 p-6 shadow-card">
              <p className="section-label">Guardrails</p>
              <ul className="mt-3 space-y-2 text-sm text-gray-300">
                {scenario.guardrails.map((guardrail) => (
                  <li key={guardrail} className="flex gap-2">
                    <span className="text-[#14F195]">•</span>
                    <span>{guardrail}</span>
                  </li>
                ))}
              </ul>
            </div>

            {scenario.id === "picture" && (
              <div className="rounded-2xl border border-accent-purple/25 bg-accent-purple/10 p-6 shadow-card">
                <p className="section-label">Image adapter path</p>
                <h3 className="mt-2 text-xl font-semibold text-white">
                  OpenAI first · Fal.ai fallback
                </h3>
                <p className="mt-3 text-sm leading-6 text-gray-300">
                  The picture scenario is now modeled as a gated tool adapter:
                  `tool-using-agent` can call OpenAI image generation when
                  configured, or Fal.ai as fallback. The live route stays
                  disabled until `ENABLE_ECONOMIC_DEMO_IMAGE_GENERATION=true`.
                </p>
                <p className="mt-3 font-mono text-xs text-gray-500">
                  /api/economic-demo/image · GET readiness · POST generate
                </p>
              </div>
            )}
          </div>

          <div className="min-w-0 space-y-6">
            <div className="rounded-2xl border border-white/10 bg-card/70 p-6 shadow-card">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="section-label">Payload + money graph</p>
                  <h2 className="mt-2 text-2xl font-semibold text-white">
                    Agent workflow
                  </h2>
                </div>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-gray-400">
                  fixture · zero spend
                </span>
              </div>

              <div className="mt-6 grid gap-4 xl:grid-cols-2">
                <div
                  data-testid="communication-flow"
                  className="rounded-xl border border-white/10 bg-black/20 p-4"
                >
                  <p className="text-xs uppercase tracking-wide text-gray-500">
                    Communication flow
                  </p>
                  <div className="mt-3 space-y-2">
                    {scenario.communicationFlow.map((edge) => (
                      <div
                        key={`${edge.from}-${edge.to}-${edge.label}`}
                        className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-white">
                            {edge.from}
                          </span>
                          <span className="text-gray-500">→</span>
                          <span className="font-mono text-white">
                            {edge.to}
                          </span>
                          <span className="rounded-full border border-white/10 px-2 py-0.5 text-xs text-gray-300">
                            {edge.status}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-gray-400">
                          {edge.label}: {edge.payload}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
                <div
                  data-testid="payment-flow"
                  className="rounded-xl border border-[#14F195]/20 bg-black/20 p-4"
                >
                  <p className="text-xs uppercase tracking-wide text-[#14F195]">
                    Payment flow + budget reconciliation
                  </p>
                  <div className="mt-3 space-y-2">
                    {scenario.budgetLedger.map((entry) => (
                      <div
                        key={`${entry.from}-${entry.to}-${entry.label}`}
                        className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-mono text-white">
                            {entry.from} → {entry.to}
                          </span>
                          <span className="font-mono text-[#14F195]">
                            {formatUsdc(entry.amountUsdc)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-gray-400">
                          {entry.category}: {entry.label}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div
                data-testid="run-report"
                className="mt-6 rounded-xl border border-[#14F195]/25 bg-[#14F195]/10 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-[#14F195]">
                      Run report · specialist calls, attestations, payments,
                      reputation
                    </p>
                    <h3 className="mt-1 text-xl font-semibold text-white">
                      {runReport.title}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-gray-300">
                      {runReport.narrative}
                    </p>
                  </div>
                  <span className="rounded-full border border-yellow-400/40 bg-yellow-400/10 px-2 py-0.5 text-xs text-yellow-100">
                    fixture/local proof · live receipts gated
                  </span>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <div className="rounded-lg border border-yellow-400/25 bg-yellow-400/10 p-3 lg:col-span-2">
                    <p className="text-xs uppercase tracking-wide text-yellow-100">
                      Jupiter quote boundary before downstream payments
                    </p>
                    <p className="mt-2 text-sm leading-6 text-yellow-50/90">
                      {runReport.jupiterSwapProof.inputAmount?.toFixed(3)}{" "}
                      {runReport.jupiterSwapProof.inputAsset} →{" "}
                      {formatUsdc(runReport.jupiterSwapProof.amountUsdc)}{" "}
                      {runReport.jupiterSwapProof.outputAsset}; this is the
                      intended cross-token budget path, while public Jupiter
                      devnet execution remains an explicit boundary.
                    </p>
                    <p className="mt-2 break-all font-mono text-xs text-gray-400">
                      signed demo budget-lane tx, not a Jupiter swap receipt:{" "}
                      {runReport.jupiterSwapProof.transactionAddress}
                    </p>
                    <p className="mt-1 text-xs text-yellow-100">
                      status: {runReport.jupiterSwapProof.proofStatus} ·
                      wallet-backed Jupiter quote/build/sign attempt captured
                      separately; no successful devnet Jupiter swap claimed
                    </p>
                  </div>
                  {runReport.specialistCalls.map((call) => (
                    <div
                      key={`${call.step}-${call.specialistProfileId}`}
                      className="rounded-lg border border-white/10 bg-black/20 p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-mono text-sm text-white">
                          {call.step}. {call.specialistProfileId}
                        </p>
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-gray-300">
                          {call.capability}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-gray-300">
                        {call.payloadSummary}
                      </p>
                      <div className="mt-3 rounded border border-[#14F195]/20 bg-[#14F195]/10 p-2 text-xs leading-5 text-gray-200">
                        <p className="text-[#14F195]">
                          Payment receipt: {call.paymentReceipt.purpose}
                        </p>
                        <p>
                          Amount: {formatUsdc(call.paymentReceipt.amountUsdc)} ·
                          status: {call.paymentReceipt.proofStatus}
                        </p>
                        <p className="break-all font-mono text-gray-400">
                          tx: {call.paymentReceipt.transactionAddress}
                        </p>
                      </div>
                      {call.validation && (
                        <div className="mt-3 rounded border border-accent-purple/25 bg-accent-purple/10 p-2 text-xs leading-5 text-gray-200">
                          <p className="text-accent-purple">
                            Attested by {call.validation.attestorProfileId}:{" "}
                            {call.validation.result}
                          </p>
                          <p>{call.validation.validation}</p>
                          <p className="break-all font-mono text-gray-400">
                            attestation receipt:{" "}
                            {call.validation.attestationReceipt}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div
                  data-testid="attestation-proof"
                  className="mt-4 rounded-lg border border-accent-purple/25 bg-black/20 p-3"
                >
                  <p className="text-xs uppercase tracking-wide text-accent-purple">
                    Attestor validation chain
                  </p>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {runReport.attestations.map((attestation) => (
                      <div
                        key={`${attestation.attestorProfileId}-${attestation.validatesProfileId}`}
                        className="rounded border border-white/10 bg-white/5 p-2 text-xs leading-5 text-gray-300"
                      >
                        <p className="font-mono text-white">
                          {attestation.attestorProfileId} → validates{" "}
                          {attestation.validatesProfileId}
                        </p>
                        <p className="mt-1 text-[#14F195]">
                          {attestation.result}
                        </p>
                        <p className="mt-1">{attestation.validation}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div
                  data-testid="reputation-commit-reveal"
                  className="mt-4 rounded-lg border border-yellow-400/25 bg-black/20 p-3"
                >
                  <p className="text-xs uppercase tracking-wide text-yellow-100">
                    Reputation commit-reveal impact
                  </p>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {runReport.reputationEvents.map((event) => (
                      <div
                        key={event.profileId}
                        className="rounded border border-white/10 bg-white/5 p-2 text-xs leading-5 text-gray-300"
                      >
                        <p className="font-mono text-white">
                          {event.profileId}
                        </p>
                        <p className="mt-1">
                          score: {event.beforeScore} → commit{" "}
                          {event.committedScore}/5 → {event.afterScore}
                        </p>
                        <p className="mt-1 break-all font-mono text-gray-500">
                          commit tx: {event.commitTx}
                        </p>
                        <p className="mt-1 break-all font-mono text-gray-500">
                          reveal tx: {event.revealTx}
                        </p>
                        <p className="mt-1 text-yellow-100">{event.status}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {scenario.agents.map((agent) => (
                  <div
                    key={agent.profileId}
                    className="rounded-xl border border-white/10 bg-black/20 p-4"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded-full border border-accent-purple/30 bg-accent-purple/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent-purple">
                        {agent.role}
                      </span>
                    </div>
                    <h3 className="mt-3 break-words font-mono text-sm text-white">
                      {agent.profileId}
                    </h3>
                    <p className="mt-2 text-xs leading-5 text-gray-400">
                      {agent.description}
                    </p>
                  </div>
                ))}
              </div>

              {activeDryRunPlan && (
                <div className="mt-6 rounded-xl border border-[#14F195]/25 bg-[#14F195]/10 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-[#14F195]">
                        Dry-run orchestration plan
                      </p>
                      <p className="mt-1 font-mono text-sm text-white">
                        {activeDryRunPlan.orchestrator.id}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-400">
                        downstream calls executed
                      </p>
                      <p className="font-mono text-lg text-[#14F195]">
                        {activeDryRunPlan.downstreamCallsExecuted}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 space-y-2">
                    {activeDryRunPlan.edges.map((edge) => (
                      <div
                        key={`${edge.toProfileId}-${edge.capability}`}
                        className="rounded-lg border border-white/10 bg-black/20 p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="font-mono text-white">
                            {edge.fromProfileId}
                          </span>
                          <span className="text-gray-500">→</span>
                          <span className="font-mono text-white">
                            {edge.toProfileId}
                          </span>
                          <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-xs text-gray-300">
                            planned
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-gray-300">
                          {edge.payloadSummary}
                        </p>
                        <p className="mt-2 break-all font-mono text-xs text-gray-500">
                          {edge.endpoint}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-6 space-y-3">
                {scenario.edges.map((edge, index) => (
                  <div
                    key={`${edge.from}-${edge.to}-${edge.capability}`}
                    className="rounded-xl border border-white/10 bg-black/20 p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-mono text-white">{edge.from}</span>
                      <span className="text-gray-500">→</span>
                      <span className="font-mono text-white">{edge.to}</span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs ${statusClass(edge.status)}`}
                      >
                        {edge.status}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-gray-500">
                          Payload {index + 1} · {edge.capability}
                        </p>
                        <p className="mt-1 text-sm leading-6 text-gray-300">
                          {edge.payloadSummary}
                        </p>
                        <p className="mt-2 break-all font-mono text-xs text-gray-500">
                          {edge.receipt}
                        </p>
                      </div>
                      <div className="rounded-lg border border-[#14F195]/20 bg-[#14F195]/10 px-3 py-2 text-right">
                        <p className="text-xs text-gray-400">x402 amount</p>
                        <p className="font-mono text-sm text-[#14F195]">
                          {formatLamports(edge.amountLamports)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {paymentReadiness && (
              <div
                className={
                  paymentReadiness.status === "ready"
                    ? "mt-6 rounded-xl border border-[#14F195]/30 bg-[#14F195]/10 p-4"
                    : "mt-6 rounded-xl border border-yellow-400/30 bg-yellow-400/10 p-4"
                }
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p
                      className={
                        paymentReadiness.status === "ready"
                          ? "text-xs uppercase tracking-wide text-[#14F195]"
                          : "text-xs uppercase tracking-wide text-yellow-100"
                      }
                    >
                      Live x402 payment readiness
                    </p>
                    <p className="mt-1 break-all font-mono text-sm text-white">
                      {paymentReadiness.endpoint}
                    </p>
                  </div>
                  <span
                    className={
                      paymentReadiness.status === "ready"
                        ? "rounded-full border border-[#14F195]/40 bg-[#14F195]/10 px-2 py-0.5 text-xs text-[#14F195]"
                        : "rounded-full border border-yellow-400/40 bg-yellow-400/10 px-2 py-0.5 text-xs text-yellow-100"
                    }
                  >
                    {paymentReadiness.status}
                    {paymentReadiness.blocker
                      ? `: ${paymentReadiness.blocker}`
                      : ""}
                  </span>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <p className="text-xs text-gray-500">challenge</p>
                    <p className="mt-1 text-sm text-[#14F195]">
                      reachable · {paymentReadiness.liveChallenge.network}
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <p className="text-xs text-gray-500">price</p>
                    <p className="mt-1 font-mono text-sm text-white">
                      {paymentReadiness.liveChallenge.amount}{" "}
                      {paymentReadiness.liveChallenge.currency}
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <p className="text-xs text-gray-500">paid retry</p>
                    <p
                      className={
                        paymentReadiness.paidCompletion.reached
                          ? "mt-1 font-mono text-sm text-[#14F195]"
                          : "mt-1 font-mono text-sm text-yellow-100"
                      }
                    >
                      HTTP {paymentReadiness.paidCompletion.lastAttemptStatus}
                    </p>
                  </div>
                </div>
                <p
                  className={
                    paymentReadiness.status === "ready"
                      ? "mt-4 text-sm leading-6 text-[#14F195]/90"
                      : "mt-4 text-sm leading-6 text-yellow-50/90"
                  }
                >
                  {paymentReadiness.status === "ready"
                    ? "Controlled demo-paid completion reached HTTP 200 against the deployed code-generation specialist. The UI still will not auto-retry live payment; the next demo loop can promote this from one paid edge to a multi-edge workflow."
                    : "Paid completion is blocked because the deployed specialist rejects demo receipts. The UI will not auto-retry live payment; choose controlled demo receipts or real devnet receipt verification next."}
                </p>
                <div
                  className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3"
                  data-testid="pay-sh-reddi-x402-readiness"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-[#14F195]">
                        Pay.sh / reddi-x402 compatibility
                      </p>
                      <p className="mt-1 text-sm leading-6 text-gray-200">
                        Proven sandbox charge flow for Reddi Agent Protocol:
                        plain curl returns{" "}
                        {paymentReadiness.payShCompatibility.plainCurlStatus},
                        then Pay.sh sandbox retry returns{" "}
                        {paymentReadiness.payShCompatibility.paidRetryStatus}{" "}
                        with a{" "}
                        {paymentReadiness.payShCompatibility.receiptMethod}{" "}
                        receipt marked{" "}
                        {paymentReadiness.payShCompatibility.receiptStatus}.
                      </p>
                    </div>
                    <span className="rounded-full border border-[#14F195]/40 bg-[#14F195]/10 px-2 py-0.5 text-xs text-[#14F195]">
                      {paymentReadiness.payShCompatibility.sandboxStatus.replaceAll(
                        "_",
                        " ",
                      )}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <div className="rounded border border-white/10 bg-black/30 p-2">
                      <p className="text-xs text-gray-500">package</p>
                      <p className="mt-1 font-mono text-sm text-white">
                        {paymentReadiness.payShCompatibility.packageName}
                      </p>
                    </div>
                    <div className="rounded border border-white/10 bg-black/30 p-2">
                      <p className="text-xs text-gray-500">price</p>
                      <p className="mt-1 font-mono text-sm text-white">
                        $
                        {paymentReadiness.payShCompatibility.priceUsd.toFixed(
                          2,
                        )}{" "}
                        ·{" "}
                        {paymentReadiness.payShCompatibility.currencies.join(
                          "/",
                        )}
                      </p>
                    </div>
                    <div className="rounded border border-white/10 bg-black/30 p-2">
                      <p className="text-xs text-gray-500">evidence</p>
                      <p className="mt-1 break-all font-mono text-xs text-gray-300">
                        {
                          paymentReadiness.payShCompatibility
                            .evidenceArtifactPath
                        }
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 rounded border border-yellow-400/30 bg-yellow-400/10 p-3">
                    <p className="text-xs uppercase tracking-wide text-yellow-100">
                      Extension probes, not final demo claims
                    </p>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      {paymentReadiness.payShCompatibility.extensions.map(
                        (extension) => (
                          <div
                            key={extension.id}
                            className="rounded border border-white/10 bg-black/30 p-2 text-xs leading-5 text-gray-300"
                          >
                            <p className="font-mono text-white">
                              {extension.id.replaceAll("_", " ")}:{" "}
                              {extension.status.replaceAll("_", " ")}
                            </p>
                            <p className="mt-1">{extension.observed}</p>
                            <p className="mt-1 text-yellow-100">
                              blocker: {extension.blocker}
                            </p>
                            <p className="mt-1 break-all font-mono text-gray-500">
                              {extension.evidenceArtifactPath}
                            </p>
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-yellow-50/90">
                    {paymentReadiness.payShCompatibility.claimBoundary}
                  </p>
                </div>
                <div
                  className="mt-4 rounded-lg border border-accent-purple/30 bg-accent-purple/10 p-3"
                  data-testid="umbra-private-x402-readiness"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-accent-purple">
                        Umbra private x402 adapter
                      </p>
                      <p className="mt-1 text-sm leading-6 text-gray-200">
                        Reddi Agent Protocol now has an executable
                        private-payment adapter contract for{" "}
                        {paymentReadiness.umbraPrivatePayment.packageName}:
                        payer creates a receiver-claimable Umbra UTXO, the
                        recipient scans claimable UTXOs, then claims into an
                        encrypted balance via relayer. A bounded devnet smoke
                        also proves public wSOL deposit into an Umbra encrypted
                        balance.
                      </p>
                    </div>
                    <span className="rounded-full border border-accent-purple/40 bg-accent-purple/10 px-2 py-0.5 text-xs text-accent-purple">
                      {paymentReadiness.umbraPrivatePayment.status.replaceAll(
                        "_",
                        " ",
                      )}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <div className="rounded border border-white/10 bg-black/30 p-2">
                      <p className="text-xs text-gray-500">operation</p>
                      <p className="mt-1 font-mono text-xs text-white">
                        {paymentReadiness.umbraPrivatePayment.operation}
                      </p>
                    </div>
                    <div className="rounded border border-white/10 bg-black/30 p-2">
                      <p className="text-xs text-gray-500">program</p>
                      <p className="mt-1 break-all font-mono text-xs text-white">
                        {paymentReadiness.umbraPrivatePayment.programId}
                      </p>
                    </div>
                    <div className="rounded border border-white/10 bg-black/30 p-2">
                      <p className="text-xs text-gray-500">evidence</p>
                      <p className="mt-1 break-all font-mono text-xs text-gray-300">
                        {
                          paymentReadiness.umbraPrivatePayment
                            .evidenceArtifactPath
                        }
                      </p>
                      <p className="mt-1 break-all font-mono text-xs text-gray-300">
                        {
                          paymentReadiness.umbraPrivatePayment
                            .devnetEvidenceArtifactPath
                        }
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 rounded border border-white/10 bg-black/30 p-2 text-xs leading-5 text-gray-300">
                    <p className="text-accent-purple">
                      Selective disclosure receipt:{" "}
                      {
                        paymentReadiness.umbraPrivatePayment.selectiveDisclosure
                          .receiptType
                      }
                    </p>
                    <p className="mt-1">
                      Reveals:{" "}
                      {paymentReadiness.umbraPrivatePayment.selectiveDisclosure.reveals.join(
                        ", ",
                      )}
                    </p>
                    <p className="mt-1 text-yellow-100">
                      Hides:{" "}
                      {paymentReadiness.umbraPrivatePayment.selectiveDisclosure.hides.join(
                        ", ",
                      )}
                    </p>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-yellow-50/90">
                    {paymentReadiness.umbraPrivatePayment.claimBoundary}
                  </p>
                </div>
              </div>
            )}

            {researchDesign && (
              <div className="mt-6 rounded-xl border border-accent-purple/25 bg-accent-purple/10 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-accent-purple">
                      Phase 5 research workflow dry-run
                    </p>
                    <p className="mt-1 text-sm leading-6 text-gray-200">
                      {researchDesign.userRequest}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-gray-400">
                      Orchestrator:{" "}
                      <span className="font-mono text-white">
                        {researchDesign.orchestrator.profileId}
                      </span>{" "}
                      — {researchDesign.orchestrator.separationRationale}
                    </p>
                  </div>
                  <span className="rounded-full border border-accent-purple/40 bg-accent-purple/10 px-2 py-0.5 text-xs text-accent-purple">
                    dry-run · downstream calls:{" "}
                    {researchDesign.downstreamCallsExecuted}
                  </span>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {researchDesign.edges.map((edge) => (
                    <div
                      key={edge.profileId}
                      className="rounded-lg border border-white/10 bg-black/20 p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-mono text-sm text-white">
                          {edge.step}. {edge.profileId}
                        </p>
                        <p className="text-xs text-yellow-100">
                          x402 {edge.disclosureLedgerExpectation.x402State}
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-gray-400">
                        {edge.payloadClass.replaceAll("_", " ")} ·{" "}
                        {edge.capability} · {edge.priceUsdc} USDC
                      </p>
                      <p className="mt-2 text-sm leading-6 text-gray-300">
                        {edge.scopedPayload}
                      </p>
                      <p className="mt-2 text-xs leading-5 text-[#14F195]">
                        Evidence gate: {edge.evidenceRequirement}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-yellow-100">
                        Citation/caveat: {edge.citationOrEvidenceCaveat}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-gray-400">
                        Refund/dispute: {edge.refundOrDisputeBehavior}
                      </p>
                      <p className="mt-2 text-xs text-gray-500">
                        Ledger:{" "}
                        {edge.disclosureLedgerExpectation.requiredSchemaVersion}{" "}
                        ·{" "}
                        {edge.disclosureLedgerExpectation.disclosureScope.replaceAll(
                          "_",
                          " ",
                        )}{" "}
                        · required fields{" "}
                        {edge.disclosureLedgerExpectation.requiredFields.length}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <p className="text-xs uppercase tracking-wide text-gray-400">
                      Acceptance criteria
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-gray-300">
                      {researchDesign.acceptanceCriteria.map((criterion) => (
                        <li key={criterion}>{criterion}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <p className="text-xs uppercase tracking-wide text-gray-400">
                      Live-call guardrails
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-gray-300">
                      <li>
                        No live specialist calls:{" "}
                        {String(researchDesign.guardrails.noLiveCalls)}
                      </li>
                      <li>
                        No paid provider requests:{" "}
                        {String(
                          researchDesign.guardrails.noPaidProviderRequests,
                        )}
                      </li>
                      <li>
                        No signing or wallet mutation:{" "}
                        {String(
                          researchDesign.guardrails.noSigningOperations &&
                            researchDesign.guardrails.noWalletMutation,
                        )}
                      </li>
                      <li>
                        No devnet transfer:{" "}
                        {String(researchDesign.guardrails.noDevnetTransfer)}
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {pictureStoryboardDesign && (
              <div className="mt-6 rounded-xl border border-yellow-400/25 bg-yellow-400/10 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-yellow-100">
                      Phase 7 picture storyboard dry-run
                    </p>
                    <p className="mt-1 text-sm leading-6 text-gray-200">
                      {pictureStoryboardDesign.userRequest}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-gray-400">
                      Orchestrator:{" "}
                      <span className="font-mono text-white">
                        {pictureStoryboardDesign.orchestrator.profileId}
                      </span>{" "}
                      —{" "}
                      {pictureStoryboardDesign.orchestrator.separationRationale}
                    </p>
                  </div>
                  <span className="rounded-full border border-yellow-400/40 bg-yellow-400/10 px-2 py-0.5 text-xs text-yellow-100">
                    storyboard · images generated:{" "}
                    {pictureStoryboardDesign.imageGenerationExecuted}
                  </span>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {pictureStoryboardDesign.storyboard.map((frame) => (
                    <div
                      key={frame.frame}
                      className="rounded-lg border border-white/10 bg-black/20 p-3"
                    >
                      <p className="font-mono text-sm text-white">
                        Frame {frame.frame}: {frame.title}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-gray-300">
                        {frame.visualPrompt}
                      </p>
                      <p className="mt-2 text-xs leading-5 text-red-100">
                        Negative prompt: {frame.negativePrompt}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-yellow-100">
                        Evidence caveat: {frame.evidenceCaveat}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 space-y-2">
                  {pictureStoryboardDesign.edges.map((edge) => (
                    <div
                      key={`${edge.step}-${edge.profileId}`}
                      className="rounded-lg border border-white/10 bg-black/20 p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-mono text-sm text-white">
                          {edge.step}. {edge.profileId}
                        </p>
                        <span
                          className={
                            edge.status === "blocked"
                              ? "rounded-full border border-red-400/40 bg-red-400/10 px-2 py-0.5 text-xs text-red-200"
                              : "rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-xs text-gray-300"
                          }
                        >
                          {edge.status}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-gray-400">
                        {edge.payloadClass.replaceAll("_", " ")} ·{" "}
                        {edge.capability} · {edge.priceUsdc} USDC
                      </p>
                      <p className="mt-2 text-sm leading-6 text-gray-300">
                        {edge.scopedPayload}
                      </p>
                      <p className="mt-2 text-xs leading-5 text-[#14F195]">
                        Expected output: {edge.expectedOutput}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-yellow-100">
                        Guardrail: {edge.guardrail}
                      </p>
                      <p className="mt-2 text-xs text-gray-500">
                        Ledger:{" "}
                        {edge.disclosureLedgerExpectation.requiredSchemaVersion}{" "}
                        · {edge.disclosureLedgerExpectation.x402State} · calls{" "}
                        {
                          edge.disclosureLedgerExpectation
                            .downstreamCallsExecuted
                        }
                      </p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3">
                  <p className="text-xs uppercase tracking-wide text-gray-400">
                    Provider guardrails
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-gray-300">
                    <li>
                      OpenAI image generation:{" "}
                      {String(
                        !pictureStoryboardDesign.guardrails
                          .noOpenAiImageGeneration,
                      )}
                    </li>
                    <li>
                      Fal.ai image generation:{" "}
                      {String(
                        !pictureStoryboardDesign.guardrails
                          .noFalImageGeneration,
                      )}
                    </li>
                    <li>
                      Paid provider requests:{" "}
                      {String(
                        !pictureStoryboardDesign.guardrails
                          .noPaidProviderRequests,
                      )}
                    </li>
                    <li>
                      Signing/wallet mutation/devnet transfer:{" "}
                      {String(
                        !(
                          pictureStoryboardDesign.guardrails
                            .noSigningOperations &&
                          pictureStoryboardDesign.guardrails.noWalletMutation &&
                          pictureStoryboardDesign.guardrails.noDevnetTransfer
                        ),
                      )}
                    </li>
                  </ul>
                </div>
              </div>
            )}

            {ledgerReconciliation && (
              <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-300">
                      Ledger reconciliation
                    </p>
                    <p className="mt-1 text-sm leading-6 text-gray-200">
                      Controlled receipt totals are reconciled against x402
                      challenge amounts and Surfpool/local transfer semantics.
                    </p>
                  </div>
                  <span className="rounded-full border border-yellow-400/40 bg-yellow-400/10 px-2 py-0.5 text-xs text-yellow-100">
                    no production settlement claim
                  </span>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-4">
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <p className="text-xs text-gray-500">x402 total</p>
                    <p className="mt-1 font-mono text-lg text-white">
                      {ledgerReconciliation.totals.challengeAmountUsdc} USDC
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <p className="text-xs text-gray-500">demo completions</p>
                    <p className="mt-1 font-mono text-lg text-[#14F195]">
                      {ledgerReconciliation.totals.controlledPaidCompletions}/4
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <p className="text-xs text-gray-500">real settlements</p>
                    <p className="mt-1 font-mono text-lg text-yellow-100">
                      {ledgerReconciliation.totals.realSettlementsVerified}
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <p className="text-xs text-gray-500">
                      Surfpool local proof
                    </p>
                    <p className="mt-1 font-mono text-lg text-white">
                      {ledgerReconciliation.totals.surfpoolLocalTransferSol} SOL
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {ledgerReconciliation.edges.map((edge) => (
                    <div
                      key={edge.profileId}
                      className="rounded-lg border border-white/10 bg-black/20 p-3"
                    >
                      <p className="font-mono text-sm text-white">
                        {edge.profileId}
                      </p>
                      <p className="mt-1 text-xs text-gray-400">
                        {edge.challengeAmountUsdc} USDC challenge →{" "}
                        {shortWallet(edge.payeeWallet)}
                      </p>
                      <p className="mt-2 text-xs text-[#14F195]">
                        controlled receipt: {edge.controlledReceiptStatus}
                      </p>
                      <p className="mt-1 text-xs text-yellow-100">
                        real settlement: {edge.realSettlementStatus}
                      </p>
                      <p className="mt-1 text-xs text-gray-400">
                        Surfpool local transfer:{" "}
                        {formatLamports(edge.surfpoolLocalTransferLamports)}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 grid gap-2 md:grid-cols-2">
                  {ledgerReconciliation.proofLayers.map((layer) => (
                    <div
                      key={layer.id}
                      className="rounded-lg border border-white/10 bg-black/20 p-3"
                    >
                      <p className="text-xs uppercase tracking-wide text-gray-400">
                        {layer.id}: {layer.status}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-gray-300">
                        {layer.summary}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {webpageLiveEvidence && webpageDisclosureStatus && (
              <div
                data-testid="webpage-live-workflow-evidence"
                className="mt-6 rounded-xl border border-[#14F195]/30 bg-[#14F195]/10 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-[#14F195]">
                      Multi-edge live x402 evidence
                    </p>
                    <p className="mt-1 text-sm leading-6 text-gray-200">
                      {webpageLiveEvidence.userRequest}
                    </p>
                  </div>
                  <span className="rounded-full border border-[#14F195]/40 bg-[#14F195]/10 px-2 py-0.5 text-xs text-[#14F195]">
                    {webpageLiveEvidence.conclusion}
                  </span>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-4">
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <p className="text-xs text-gray-500">bounded calls</p>
                    <p className="mt-1 font-mono text-lg text-white">
                      {webpageLiveEvidence.downstreamCallsExecuted}
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <p className="text-xs text-gray-500">paid completions</p>
                    <p className="mt-1 font-mono text-lg text-[#14F195]">
                      {webpageLiveEvidence.edges.length}/4
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <p className="text-xs text-gray-500">receipt mode</p>
                    <p className="mt-1 text-sm text-yellow-100">
                      controlled demo receipts
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <p className="text-xs text-gray-500">evidence pack</p>
                    <p className="mt-1 text-sm text-gray-200">
                      {webpageLiveEvidence.latestEvidencePack
                        ? "latest generated"
                        : "fallback summary"}
                    </p>
                  </div>
                </div>
                {webpageLiveEvidence.latestEvidencePack && (
                  <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3 text-xs leading-5 text-gray-300">
                    <p>
                      Evidence pack:{" "}
                      <span className="font-mono text-white">
                        {webpageLiveEvidence.latestEvidencePack.artifactPath}
                      </span>
                    </p>
                    <p className="mt-1">
                      Generated:{" "}
                      <span className="font-mono text-gray-100">
                        {webpageLiveEvidence.latestEvidencePack.generatedAt}
                      </span>
                    </p>
                    {webpageLiveEvidence.latestEvidencePack
                      .sourceArtifactPath && (
                      <p className="mt-1">
                        Source:{" "}
                        <span className="font-mono text-gray-100">
                          {
                            webpageLiveEvidence.latestEvidencePack
                              .sourceArtifactPath
                          }
                        </span>
                      </p>
                    )}
                  </div>
                )}
                <div
                  className={
                    webpageDisclosureStatus.isComplete
                      ? "mt-4 rounded-lg border border-[#14F195]/30 bg-black/20 p-3"
                      : "mt-4 rounded-lg border border-yellow-400/40 bg-yellow-400/10 p-3"
                  }
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p
                        className={
                          webpageDisclosureStatus.isComplete
                            ? "text-xs uppercase tracking-wide text-[#14F195]"
                            : "text-xs uppercase tracking-wide text-yellow-100"
                        }
                      >
                        Downstream disclosure ledger
                      </p>
                      <p className="mt-1 text-sm leading-6 text-gray-200">
                        {webpageDisclosureStatus.detail}
                      </p>
                    </div>
                    <span
                      className={
                        webpageDisclosureStatus.isComplete
                          ? "rounded-full border border-[#14F195]/30 px-2 py-0.5 text-xs text-[#14F195]"
                          : "rounded-full border border-yellow-400/40 px-2 py-0.5 text-xs text-yellow-100"
                      }
                    >
                      {webpageDisclosureStatus.label}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {webpageLiveEvidence.disclosureLedgerSummary.edges.map(
                      (edge) => (
                        <div
                          key={edge.profileId}
                          className="rounded-lg border border-white/10 bg-black/20 p-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-mono text-sm text-white">
                              {edge.step}. {edge.profileId}
                            </p>
                            <span className="rounded-full border border-white/10 px-2 py-0.5 text-xs text-gray-300">
                              {edge.disclosureScope}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-gray-400">
                            ledger entries: {edge.entryCount}
                          </p>
                          {edge.entries.length === 0 ? (
                            <p className="mt-2 text-xs leading-5 text-yellow-100/90">
                              No downstream disclosure entries available for
                              this edge in the current evidence summary.
                            </p>
                          ) : (
                            <div className="mt-2 space-y-2">
                              {edge.entries.map((entry) => (
                                <div
                                  key={`${edge.profileId}-${entry.calledProfileId}-${entry.endpoint ?? "none"}`}
                                  className="rounded border border-white/10 bg-black/30 p-2 text-xs text-gray-300"
                                >
                                  <p className="font-mono text-white">
                                    called: {entry.calledProfileId}
                                  </p>
                                  <p className="mt-1">
                                    wallet:{" "}
                                    {entry.walletAddress
                                      ? shortWallet(entry.walletAddress)
                                      : "not disclosed"}
                                  </p>
                                  <p className="mt-1">
                                    endpoint:{" "}
                                    {entry.endpoint ?? "not disclosed"}
                                  </p>
                                  <p className="mt-1">
                                    payload:{" "}
                                    {entry.payloadSummary ||
                                      (entry.payloadHashPresent
                                        ? "hash present"
                                        : "not disclosed")}
                                  </p>
                                  <p className="mt-1 text-yellow-100">
                                    x402: {entry.x402.state} · challenge=
                                    {String(entry.x402.challengePresent)} ·
                                    receipt={String(entry.x402.receiptPresent)}
                                  </p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ),
                    )}
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  {webpageLiveEvidence.edges.map((edge) => (
                    <div
                      key={edge.profileId}
                      className="rounded-lg border border-white/10 bg-black/20 p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-mono text-sm text-white">
                            {edge.step}. {edge.profileId}
                          </p>
                          <p className="mt-1 text-xs text-gray-400">
                            {edge.capability} · {edge.unpaidChallenge.amount}{" "}
                            {edge.unpaidChallenge.currency} →{" "}
                            {shortWallet(edge.unpaidChallenge.payTo)}
                          </p>
                        </div>
                        <p className="text-xs text-[#14F195]">
                          402 challenge → 200 paid
                        </p>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-gray-300">
                        {edge.paidCompletion.outputPreview}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-sm leading-6 text-yellow-50/90">
                  This panel reads a sanitized evidence summary only. Loading it
                  does not call live specialist endpoints, sign receipts, or
                  transfer devnet funds. Real devnet receipt verification
                  remains a later phase.
                </p>
              </div>
            )}

            {activeSurfpoolReport && (
              <div className="mt-6 rounded-xl border border-accent-purple/25 bg-accent-purple/10 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-accent-purple">
                      Surfpool/local rehearsal plan
                    </p>
                    <p className="mt-1 text-sm text-gray-200">
                      {activeSurfpoolReport.networkProfile} ·{" "}
                      {activeSurfpoolReport.transferSemantics} · downstream
                      calls executed:{" "}
                      {activeSurfpoolReport.downstreamCallsExecuted}
                    </p>
                  </div>
                  <span
                    className={
                      activeSurfpoolReport.positiveProof.balanced
                        ? "rounded-full border border-[#14F195]/30 bg-[#14F195]/10 px-2 py-0.5 text-xs text-[#14F195]"
                        : "rounded-full border border-red-400/30 bg-red-400/10 px-2 py-0.5 text-xs text-red-200"
                    }
                  >
                    balanced:{" "}
                    {String(activeSurfpoolReport.positiveProof.balanced)}
                  </span>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <p className="text-xs text-gray-500">upfront funding</p>
                    <p className="mt-1 font-mono text-sm text-[#14F195]">
                      {formatUsdc(
                        activeSurfpoolReport.upfrontFunding.amountUsdc,
                      )}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      user → {activeSurfpoolReport.upfrontFunding.toProfileId}
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <p className="text-xs text-gray-500">Jupiter SOL route</p>
                    <p className="mt-1 font-mono text-sm text-yellow-100">
                      {activeSurfpoolReport.jupiterSolRoute.estimatedInputSol.toFixed(
                        3,
                      )}{" "}
                      SOL →{" "}
                      {formatUsdc(
                        activeSurfpoolReport.jupiterSolRoute.outputUsdc,
                      )}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      {activeSurfpoolReport.jupiterSolRoute.status}
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <p className="text-xs text-gray-500">planned transfers</p>
                    <p className="mt-1 font-mono text-lg text-white">
                      {activeSurfpoolReport.transfers.length}
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <p className="text-xs text-gray-500">debited / credited</p>
                    <p className="mt-1 font-mono text-sm text-[#14F195]">
                      {formatLamports(
                        activeSurfpoolReport.positiveProof.totalDebitedLamports,
                      ).replace(/^\+/, "")}{" "}
                      /{" "}
                      {formatLamports(
                        activeSurfpoolReport.positiveProof
                          .totalCreditedLamports,
                      ).replace(/^\+/, "")}
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <p className="text-xs text-gray-500">markup retained</p>
                    <p className="mt-1 font-mono text-sm text-[#14F195]">
                      {formatUsdc(
                        activeSurfpoolReport.upfrontFunding.markupUsdc,
                      )}
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <p className="text-xs text-gray-500">blocked delta</p>
                    <p className="mt-1 font-mono text-lg text-white">
                      {formatLamports(
                        activeSurfpoolReport.negativeProof
                          .totalBlockedDeltaLamports,
                      ).replace(/^\+/, "")}
                    </p>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  {activeSurfpoolReport.participants.map((participant) => {
                    const delta =
                      participant.endingLamports - participant.startingLamports;
                    return (
                      <div
                        key={participant.profileId}
                        className="grid gap-2 rounded-lg border border-white/10 bg-black/20 p-3 text-sm sm:grid-cols-[1fr_auto]"
                      >
                        <div>
                          <p className="font-mono text-white">
                            {participant.profileId}
                          </p>
                          <p className="mt-1 font-mono text-xs text-gray-500">
                            local {shortWallet(participant.localWalletAddress)}
                          </p>
                        </div>
                        <p
                          className={`font-mono ${delta > 0 ? "text-[#14F195]" : delta < 0 ? "text-red-300" : "text-gray-300"}`}
                        >
                          {formatLamports(delta)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {activeBalanceReport && (
              <div className="mt-6 rounded-xl border border-white/10 bg-black/20 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500">
                      Read-only balance snapshot
                    </p>
                    <p className="mt-1 text-sm text-gray-300">
                      No transfers attempted · downstream calls executed:{" "}
                      {activeBalanceReport.downstreamCallsExecuted}
                    </p>
                  </div>
                  <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-xs text-gray-300">
                    {activeBalanceReport.mode}
                  </span>
                </div>
                <div className="mt-4 space-y-2">
                  {activeBalanceReport.snapshots.map((snapshot) => (
                    <div
                      key={`${snapshot.profileId}-${snapshot.walletAddress}`}
                      className="grid gap-2 rounded-lg border border-white/10 bg-white/5 p-3 text-sm sm:grid-cols-[1fr_auto]"
                    >
                      <div>
                        <p className="font-mono text-white">
                          {snapshot.profileId}
                        </p>
                        <p className="mt-1 font-mono text-xs text-gray-500">
                          {shortWallet(snapshot.walletAddress)}
                        </p>
                      </div>
                      <div className="text-left sm:text-right">
                        <p
                          className={
                            snapshot.status === "available"
                              ? "font-mono text-[#14F195]"
                              : "font-mono text-yellow-200"
                          }
                        >
                          {snapshot.status === "available" &&
                          snapshot.lamports !== null
                            ? formatLamports(snapshot.lamports).replace(
                                /^\+/,
                                "",
                              )
                            : "balance unavailable"}
                        </p>
                        <p className="mt-1 text-xs text-gray-500">
                          {snapshot.status}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-white/10 bg-card/70 p-6 shadow-card">
              <p className="section-label">Wallet balance ledger</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                Start → end balances
              </h2>
              <div className="mt-5 overflow-hidden rounded-xl border border-white/10">
                <div className="grid grid-cols-[1.1fr_0.7fr_0.7fr_0.7fr] gap-3 bg-white/5 px-4 py-3 text-xs uppercase tracking-wide text-gray-500">
                  <span>Wallet</span>
                  <span>Start</span>
                  <span>End</span>
                  <span>Delta</span>
                </div>
                {scenario.balances.map((balance) => {
                  const delta = lamportsDelta(balance);
                  return (
                    <div
                      key={`${balance.profileId}-${balance.wallet}`}
                      className="grid grid-cols-[1.1fr_0.7fr_0.7fr_0.7fr] gap-3 border-t border-white/10 px-4 py-3 text-sm"
                    >
                      <div>
                        <p className="font-mono text-white">
                          {balance.profileId}
                        </p>
                        <p className="mt-1 font-mono text-xs text-gray-500">
                          {shortWallet(balance.wallet)}
                        </p>
                      </div>
                      <span className="font-mono text-gray-300">
                        {formatLamports(balance.startingLamports).replace(
                          /^\+/,
                          "",
                        )}
                      </span>
                      <span className="font-mono text-gray-300">
                        {formatLamports(balance.endingLamports).replace(
                          /^\+/,
                          "",
                        )}
                      </span>
                      <span
                        className={`font-mono ${delta > 0 ? "text-[#14F195]" : delta < 0 ? "text-red-300" : "text-gray-400"}`}
                      >
                        {formatLamports(delta)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
