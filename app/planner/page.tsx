"use client";

import { Suspense } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/textarea";
import { showToast } from "@/components/ui/toast";
import { TASK_TYPES, PRIVACY_MODES } from "@/lib/capabilities/taxonomy";
import {
  summarizeConsumerPolicy,
  summarizeConsumerReceipt,
} from "@/lib/consumer/guided-paid-call";
import type { SpecialistListing } from "@/lib/registry/bridge";

const WalletMultiButton = dynamic(
  async () =>
    (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false },
);

type PlannerRun = {
  runId: string;
  createdAt: string;
  selectedWallet?: string;
  endpointUrl?: string;
  status: "completed" | "failed";
  challengeSeen: boolean;
  paymentAttempted: boolean;
  paymentSatisfied: boolean;
  x402TxSignature?: string;
  x402ReceiptNonce?: string;
  responsePreview?: string;
  error?: string;
  trace: string[];
};

type ResolveResult = {
  ok: boolean;
  candidate: {
    walletAddress: string;
    endpointUrl: string;
    taskTypes: string[];
    privacyModes: string[];
    perCallUsd: number;
    attested: boolean;
    healthStatus: string;
    reputationScore: number;
    avgFeedbackScore: number;
    selectionReasons: string[];
  } | null;
  alternativeCount: number;
  error?: string;
};

function shortWallet(wallet: string) {
  return wallet.length > 12
    ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}`
    : wallet;
}

function launchConfetti() {
  const colors = ["#818cf8", "#f472b6", "#22c55e", "#fb923c", "#facc15"];
  for (let i = 0; i < 40; i++) {
    const el = document.createElement("div");
    el.className = "confetti-piece";
    el.style.cssText = `
      position: fixed; width: 10px; height: 10px; z-index: 200;
      left: ${Math.random() * 100}vw; top: -10px;
      background: ${colors[Math.floor(Math.random() * 5)]};
      border-radius: ${Math.random() > 0.5 ? "50%" : "0"};
      animation: confettiFall 2s ease-out forwards;
      animation-delay: ${Math.random() * 0.5}s;
    `;
    document.body.appendChild(el);
    window.setTimeout(() => el.remove(), 2500);
  }
}

const STEPS = ["Describe task", "Select specialist", "Execute", "Feedback"];

function PlannerInner() {
  const { connected } = useWallet();
  const searchParams = useSearchParams();
  const preferredWallet = searchParams.get("specialist") ?? "";

  const [step, setStep] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [taskType, setTaskType] = useState<string>(TASK_TYPES[0].id);
  const [privacyMode, setPrivacyMode] = useState<"public" | "per" | "vanish">(
    "public",
  );
  const [maxPerCallUsd, setMaxPerCallUsd] = useState("0.01");
  const [requiresAttested, setRequiresAttested] = useState(false);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [candidates, setCandidates] = useState<SpecialistListing[]>([]);
  const [selectedWallet, setSelectedWallet] = useState<string>(preferredWallet);
  const [resolved, setResolved] = useState<ResolveResult | null>(null);
  const [executing, setExecuting] = useState(false);
  const [run, setRun] = useState<PlannerRun | null>(null);
  const [rating, setRating] = useState(5);
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [allAgents, setAllAgents] = useState<SpecialistListing[]>([]);
  const prevStep = useRef(step);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/registry");
        const data = await res.json();
        if (!cancelled) setAllAgents(data.listings ?? []);
      } catch {
        if (!cancelled) setAllAgents([]);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (prevStep.current !== step) {
      showToast(`Step ${step + 1} of 4`, "info");
      prevStep.current = step;
    }
  }, [step]);

  const topCandidates = useMemo(() => {
    const scored = [...allAgents]
      .filter((agent) => agent.health.status !== "fail")
      .sort((a, b) => {
        const aScore =
          (a.attestation.attested ? 40 : 0) +
          (a.health.status === "pass" ? 20 : 0) +
          a.onchain.reputationScore / 500 +
          a.signals.avgFeedbackScore * 4;
        const bScore =
          (b.attestation.attested ? 40 : 0) +
          (b.health.status === "pass" ? 20 : 0) +
          b.onchain.reputationScore / 500 +
          b.signals.avgFeedbackScore * 4;
        return bScore - aScore;
      });
    return scored.slice(0, 3);
  }, [allAgents]);

  const maxSpend = useMemo(() => {
    const parsed = Number(maxPerCallUsd);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }, [maxPerCallUsd]);

  const consumerPolicy = useMemo(
    () =>
      summarizeConsumerPolicy({
        requiredPrivacyMode: privacyMode,
        requiresHealthPass: true,
        requiresAttested,
        maxPerCallUsd: maxSpend,
        preferredWallet: selectedWallet || undefined,
      }),
    [privacyMode, requiresAttested, maxSpend, selectedWallet],
  );

  const receiptSummary = useMemo(
    () => (run ? summarizeConsumerReceipt(run, maxSpend) : null),
    [run, maxSpend],
  );

  useEffect(() => {
    if (!preferredWallet) return;
    setSelectedWallet(preferredWallet);
  }, [preferredWallet]);

  async function findSpecialists() {
    if (!prompt.trim()) return;
    setLoadingCandidates(true);
    try {
      const res = await fetch("/api/planner/tools/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task: prompt,
          taskTypeHint: taskType,
          policy: {
            preferredPrivacyMode: privacyMode,
            maxPerCallUsd: maxSpend,
            requireAttestation: requiresAttested,
          },
        }),
      });
      const data: ResolveResult = await res.json();
      setResolved(data);
      setCandidates(topCandidates);
      setSelectedWallet(
        data.candidate?.walletAddress ?? topCandidates[0]?.walletAddress ?? "",
      );
      setStep(1);
      showToast(
        data.ok
          ? "Specialists resolved"
          : (data.error ?? "No eligible specialist"),
        data.ok ? "success" : "error",
      );
    } finally {
      setLoadingCandidates(false);
    }
  }

  async function executeRun() {
    if (!prompt.trim()) return;
    setExecuting(true);
    try {
      const res = await fetch("/api/onboarding/planner/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          preferredWallet: selectedWallet,
          policy: {
            requiredPrivacyMode: privacyMode,
            requiresHealthPass: true,
            requiresAttested,
            maxPerCallUsd: maxSpend,
            preferredWallet: selectedWallet,
          },
        }),
      });
      const data = await res.json();
      const nextRun = data.result?.result ?? data.result ?? null;
      setRun(nextRun);
      if (data.ok) {
        setStep(2);
        showToast("Execution complete", "success");
      } else {
        setStep(2);
        showToast(data.error ?? nextRun?.error ?? "Execution failed", "error");
      }
    } finally {
      setExecuting(false);
    }
  }

  async function submitFeedback() {
    if (!run?.runId) return;
    const res = await fetch("/api/onboarding/planner/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId: run.runId,
        score: rating,
        notes: note || undefined,
      }),
    });
    const data = await res.json();
    setSubmitted(true);
    setCompleteOpen(true);
    if (data.ok) {
      launchConfetti();
      showToast("Rating committed", "success");
    } else {
      showToast(data.error ?? "Feedback failed", "error");
    }
  }

  return (
    <div className="min-h-screen bg-page">
      <Modal open={!connected} onClose={() => {}}>
        <div className="p-8 text-center">
          <div className="mb-4 text-4xl">🔗</div>
          <h2 className="mb-2 font-display text-xl text-white">
            Connect Your Wallet
          </h2>
          <p className="mb-6 text-sm text-gray-400">
            You need a Solana wallet to use the planner or register as a
            specialist.
          </p>
          <WalletMultiButton />
        </div>
      </Modal>

      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8 space-y-8">
        <PageHeader
          label="Consumer agent path"
          title="Connect your agent system to RAP Assurance"
          subtitle="Use the planner/MCP flow to discover specialists, enforce budget and authority policy, bind payment-proof and evidence references, then inspect receipts before feedback."
          actions={
            <Link href="/runs">
              <Button variant="outline" size="sm">
                Run history →
              </Button>
            </Link>
          }
        />

        <div className="grid gap-3 md:grid-cols-3">
          {[
            {
              title: "Works with existing agents",
              desc: "Use this path as the human-visible version of what OpenClaw, Claude/MCP, OpenSwarm-style systems, or custom agents can do through MCP rails.",
            },
            {
              title: "Policy before payment",
              desc: "Resolve by task type, privacy mode, attestation requirement, and per-call budget before the x402 challenge is satisfied.",
            },
            {
              title: "Receipts after work",
              desc: "Keep the specialist response, payment state, and feedback trail inspectable for downstream reputation.",
            },
          ].map((item) => (
            <Card key={item.title} className="border-white/10 bg-white/5 p-4">
              <p className="text-sm font-semibold text-white">{item.title}</p>
              <p className="mt-2 text-xs leading-5 text-gray-400">
                {item.desc}
              </p>
            </Card>
          ))}
        </div>

        <div className="flex justify-center gap-2">
          {STEPS.map((_, index) => (
            <div
              key={index}
              className={`step-dot ${index < step ? "completed" : ""} ${index === step ? "current" : ""}`}
            />
          ))}
        </div>

        <div className="rounded-xl bg-surface p-6 glow-border">
          <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <Card className="space-y-4 p-6">
              <p className="section-label">STEP {step + 1} OF 4</p>
              <h3 className="font-display text-2xl text-white">
                {STEPS[step]}
              </h3>
              <p className="text-sm leading-6 text-gray-400">
                {step === 0 &&
                  "Explain what your agent needs, then set category, privacy, attestation, and spend policy."}
                {step === 1 &&
                  "Review the best available specialists before payment is attempted."}
                {step === 2 &&
                  "Watch x402 negotiation, receipt state, and completion status."}
                {step === 3 &&
                  "Commit feedback so future consumer agents can evaluate this specialist."}
              </p>
            </Card>

            <Card className="space-y-4 p-6">
              {step === 0 ? (
                <>
                  <Textarea
                    className="code-area min-h-44"
                    placeholder="Describe the task you want a specialist to complete…"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-2 text-sm text-gray-400">
                      <span>Task type</span>
                      <select
                        className="w-full rounded-lg border border-border bg-page px-3 py-2 text-white"
                        value={taskType}
                        onChange={(e) => setTaskType(e.target.value)}
                      >
                        {TASK_TYPES.map((task) => (
                          <option key={task.id} value={task.id}>
                            {task.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-2 text-sm text-gray-400">
                      <span>Settlement</span>
                      <select
                        className="w-full rounded-lg border border-border bg-page px-3 py-2 text-white"
                        value={privacyMode}
                        onChange={(e) =>
                          setPrivacyMode(
                            e.target.value as "public" | "per" | "vanish",
                          )
                        }
                      >
                        {PRIVACY_MODES.map((mode) => (
                          <option key={mode.id} value={mode.id}>
                            {mode.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-2 text-sm text-gray-400">
                      <span>Max spend / call (USD)</span>
                      <input
                        className="w-full rounded-lg border border-border bg-page px-3 py-2 text-white"
                        inputMode="decimal"
                        value={maxPerCallUsd}
                        onChange={(e) => setMaxPerCallUsd(e.target.value)}
                      />
                    </label>
                    <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-300">
                      <input
                        type="checkbox"
                        checked={requiresAttested}
                        onChange={(e) => setRequiresAttested(e.target.checked)}
                      />
                      Require attested specialist
                    </label>
                  </div>
                  <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/10 p-4 text-sm text-gray-300">
                    <p className="font-medium text-white">
                      Policy before payment
                    </p>
                    <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
                      <span>Budget: {consumerPolicy.maxSpendLabel}</span>
                      <span>Privacy: {consumerPolicy.privacyLabel}</span>
                      <span>Trust: {consumerPolicy.attestationLabel}</span>
                    </div>
                    <p className="mt-2 text-xs text-gray-400">
                      {consumerPolicy.safeguards[1]}
                    </p>
                  </div>
                  <Button
                    className="w-full"
                    disabled={!prompt.trim() || loadingCandidates}
                    onClick={findSpecialists}
                  >
                    {loadingCandidates
                      ? "Finding specialists…"
                      : "Discover specialists →"}
                  </Button>
                </>
              ) : null}

              {step === 1 ? (
                <div className="space-y-3">
                  <p className="text-sm text-gray-400">
                    Resolved candidates, best match is preselected.
                  </p>
                  {resolved ? (
                    <p className="text-xs text-gray-500">
                      {resolved.candidate
                        ? `Reasons: ${resolved.candidate.selectionReasons.join(" · ")}`
                        : resolved.error}
                    </p>
                  ) : null}
                  <div className="space-y-3">
                    {candidates.map((agent, index) => {
                      const selected = selectedWallet === agent.walletAddress;
                      return (
                        <button
                          key={agent.walletAddress}
                          onClick={() => setSelectedWallet(agent.walletAddress)}
                          className={`w-full rounded-xl border p-4 text-left transition ${selected ? "ring-2 ring-indigo-500 border-indigo-500/40 bg-indigo-500/10" : "border-white/10 bg-white/5 hover:border-white/20"}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-medium text-white">
                                {agent.onchain.model ||
                                  shortWallet(agent.walletAddress)}
                              </p>
                              <p className="text-xs text-gray-400">
                                {shortWallet(agent.walletAddress)}
                              </p>
                            </div>
                            <Badge
                              variant="outline"
                              className="border-white/10 bg-white/5 text-gray-300"
                            >
                              #{index + 1}
                            </Badge>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-400">
                            <span>
                              ⭐{" "}
                              {Math.round(agent.onchain.reputationScore / 100)}
                            </span>
                            <span>
                              ◎{" "}
                              {(
                                Number(agent.onchain.rateLamports) /
                                1_000_000_000
                              ).toFixed(4)}{" "}
                              SOL
                            </span>
                            <span>{agent.health.status}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <Button
                    className="w-full"
                    disabled={!selectedWallet || executing}
                    onClick={executeRun}
                  >
                    {executing
                      ? "Executing…"
                      : "Execute with this specialist →"}
                  </Button>
                </div>
              ) : null}

              {step === 2 && run ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="outline"
                        className={
                          run.status === "completed"
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                            : "border-red-500/30 bg-red-500/10 text-red-300"
                        }
                      >
                        {run.status}
                      </Badge>
                      <span className="font-mono text-xs text-gray-400">
                        {run.runId}
                      </span>
                    </div>
                    <div className="mt-3 space-y-2 text-sm text-gray-300">
                      <p>
                        Payment:{" "}
                        {run.paymentSatisfied
                          ? "confirmed"
                          : run.paymentAttempted
                            ? "sent"
                            : "pending"}
                      </p>
                      <p>
                        Escrow:{" "}
                        {run.challengeSeen
                          ? "x402 challenge seen"
                          : "not required"}
                      </p>
                      {run.x402TxSignature ? (
                        <p className="font-mono text-xs text-gray-400">
                          tx {run.x402TxSignature}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <pre className="code-area min-h-40 overflow-auto rounded-xl p-4 text-sm text-gray-200">
                    {run.responsePreview || "No response preview."}
                  </pre>
                  <details className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
                    <summary className="cursor-pointer text-white">
                      Receipt
                    </summary>
                    <div className="mt-3 space-y-1 font-mono text-xs text-gray-400">
                      <p>tx: {run.x402TxSignature ?? "n/a"}</p>
                      <p>nonce: {run.x402ReceiptNonce ?? "n/a"}</p>
                      <p>specialist: {run.selectedWallet ?? "n/a"}</p>
                      <p>amount: {receiptSummary?.amountLabel ?? "n/a"}</p>
                      <p>
                        prompt:{" "}
                        {receiptSummary?.promptStorage === "sha256_only"
                          ? "sha256 only (raw prompt not required)"
                          : "n/a"}
                      </p>
                      <p>status: {run.status}</p>
                    </div>
                  </details>
                  {receiptSummary ? (
                    <div
                      className={`rounded-xl border p-4 text-sm ${receiptSummary.status === "paid" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : receiptSummary.status === "blocked" ? "border-red-500/30 bg-red-500/10 text-red-200" : "border-yellow-500/30 bg-yellow-500/10 text-yellow-100"}`}
                    >
                      <p className="font-medium">
                        {receiptSummary.status === "paid"
                          ? "Paid receipt captured"
                          : receiptSummary.status === "blocked"
                            ? "Unpaid completion blocked"
                            : "Run did not complete"}
                      </p>
                      <p className="mt-1 text-xs opacity-80">
                        {receiptSummary.message}
                      </p>
                    </div>
                  ) : null}
                  <Button className="w-full" onClick={() => setStep(3)}>
                    Continue to feedback →
                  </Button>
                </div>
              ) : null}

              {step === 3 ? (
                <div className="space-y-4">
                  <div className="flex gap-1">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <button
                        key={index}
                        onClick={() => setRating(index + 1)}
                        className={`text-3xl transition ${index < rating ? "text-indigo-400" : "text-white/20"}`}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                  <Textarea
                    className="min-h-28"
                    placeholder="Optional feedback note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <Button
                    className="w-full"
                    disabled={!run?.runId || submitted}
                    onClick={() => void submitFeedback()}
                  >
                    {submitted ? "Committed ✓" : "Submit & Commit Rating"}
                  </Button>
                </div>
              ) : null}
            </Card>
          </div>
        </div>
      </div>

      {completeOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="max-w-md rounded-2xl bg-surface p-8 text-center glow-border">
            <div className="mb-4 text-6xl">🎉</div>
            <h2 className="font-display text-3xl text-white">Task Complete!</h2>
            <p className="mt-2 text-sm text-gray-400">
              Your rating has been committed on-chain.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <Link href="/runs">
                <Button>View run history →</Button>
              </Link>
              <Button variant="outline" onClick={() => setCompleteOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function PlannerPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-page flex items-center justify-center">
          <p className="text-gray-400">Loading planner…</p>
        </div>
      }
    >
      <PlannerInner />
    </Suspense>
  );
}
