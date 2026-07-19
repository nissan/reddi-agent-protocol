"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, FileText, MessageSquare, Play, ShieldCheck } from "lucide-react";

import {
  adlUseCases,
  buildAdlLivePayload,
  getAdlUseCase,
  type AdlPaymentStepState,
} from "@/lib/adl/demo-use-cases";

type DemoMode = "mock" | "live";
type RunState = "idle" | "running" | "complete" | "error";

function stateClass(state: AdlPaymentStepState) {
  if (state === "complete") return "border-[#14F195]/40 bg-[#14F195]/10 text-[#14F195]";
  if (state === "blocked") return "border-red-400/40 bg-red-400/10 text-red-200";
  if (state === "mocked") return "border-accent-purple/40 bg-accent-purple/10 text-accent-purple";
  return "border-white/15 bg-white/5 text-gray-300";
}

export default function AdlPage() {
  const [selectedId, setSelectedId] = useState(adlUseCases[0].id);
  const [mode, setMode] = useState<DemoMode>("mock");
  const [agentApiAddress, setAgentApiAddress] = useState("");
  const [reviewName, setReviewName] = useState("");
  const [reviewFocus, setReviewFocus] = useState("");
  const [runState, setRunState] = useState<RunState>("idle");
  const [runOutput, setRunOutput] = useState("");
  const [error, setError] = useState("");

  const selected = useMemo(() => getAdlUseCase(selectedId), [selectedId]);
  const livePayload = useMemo(
    () => buildAdlLivePayload(selected, agentApiAddress.trim()),
    [agentApiAddress, selected],
  );
  const reviewBody = useMemo(() => {
    const focus = reviewFocus.trim() || "I want to review the ADL whitepaper and payment-flow demo.";
    const name = reviewName.trim() || "Anonymous reviewer";
    return encodeURIComponent(
      [
        "## ADL Whitepaper Review",
        "",
        `Reviewer: ${name}`,
        "",
        "### Focus",
        focus,
        "",
        "### Suggested improvement",
        "",
        "- ",
      ].join("\n"),
    );
  }, [reviewFocus, reviewName]);

  const reviewUrl = `https://github.com/nissan/reddi-agent-protocol/issues/new?title=${encodeURIComponent(
    "[ADL Review] Whitepaper feedback",
  )}&body=${reviewBody}`;

  async function runDemo() {
    setRunState("running");
    setError("");
    setRunOutput("");

    if (mode === "mock") {
      window.setTimeout(() => {
        setRunOutput(selected.mockResponse);
        setRunState("complete");
      }, 350);
      return;
    }

    if (!agentApiAddress.trim()) {
      setError("Enter your agent API address or switch back to mock mode.");
      setRunState("error");
      return;
    }

    try {
      const response = await fetch(agentApiAddress.trim(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(livePayload),
      });
      const text = await response.text();
      setRunOutput(text || `Endpoint returned HTTP ${response.status}.`);
      setRunState(response.ok ? "complete" : "error");
      if (!response.ok) setError(`Endpoint returned HTTP ${response.status}.`);
    } catch (caught) {
      setRunState("error");
      setError(caught instanceof Error ? caught.message : "Live endpoint call failed.");
    }
  }

  return (
    <div className="min-h-screen bg-page text-white">
      <header className="border-b border-white/10">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="max-w-4xl space-y-5">
            <p className="section-label">Agent Definition Language</p>
            <h1 className="font-display text-4xl font-bold sm:text-5xl">
              A specification for agents that can discover, pay, verify, and improve each other
            </h1>
            <p className="max-w-3xl text-base leading-7 text-gray-300">
              ADL is the source-of-truth contract behind Reddi Agent Protocol. It describes agent capability,
              authority, payment intent, receipt requirements, eval gates, runtime posture, and reputation signals
              before any autonomous agent-to-agent payment is trusted.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="https://github.com/nissan/reddi-agent-protocol/blob/main/docs/ADL-WHITEPAPER-v0.1.md"
                className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-page"
              >
                <FileText aria-hidden="true" size={16} />
                Read whitepaper
              </Link>
              <a
                href={reviewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold text-white/90 hover:border-[#14F195]/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-page"
              >
                <MessageSquare aria-hidden="true" size={16} />
                Open review issue
              </a>
              <Link
                href="/economic-demo/paid-workflow"
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold text-white/90 hover:border-[#14F195]/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-page"
              >
                <ExternalLink aria-hidden="true" size={16} />
                Existing payment demo
              </Link>
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl gap-4 px-4 py-10 sm:px-6 md:grid-cols-3 lg:px-8">
        {[
          ["Define", "Model, tools, data, memory, policies, eval gates, runtime, deployment, observability."],
          ["Transact", "Quote, approve, pay, receive work, verify receipts, and decide reputation changes."],
          ["Export", "Map into RAP, x402 wrappers, Agent Spec targets, and framework templates without silent loss."],
        ].map(([title, body]) => (
          <div key={title} className="rounded-lg border border-white/10 bg-card/35 p-5">
            <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[#14F195]/30 bg-[#14F195]/10">
              <ShieldCheck aria-hidden="true" size={18} className="text-[#14F195]" />
            </div>
            <h2 className="font-display text-xl font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-gray-300">{body}</p>
          </div>
        ))}
      </section>

      <section className="border-y border-white/10 bg-surface/35">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="section-label">Use cases</p>
              <h2 className="font-display text-3xl font-bold">ADL payment flows in action</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-300">
                Each scenario is built from the same payment contract: discover a seller agent, quote the work,
                apply buyer policy, capture a receipt, attest the result, and keep reputation changes evidence-bound.
              </p>
            </div>
            <div className="flex rounded-lg border border-white/10 bg-card/60 p-1">
              {(["mock", "live"] as const).map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  onClick={() => setMode(candidate)}
                  className={`min-h-10 rounded-md px-4 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-page ${
                    mode === candidate ? "bg-white text-black" : "text-gray-300 hover:text-white"
                  }`}
                >
                  {candidate === "mock" ? "Mock mode" : "Live endpoint"}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
            <div className="space-y-3">
              {adlUseCases.map((useCase) => (
                <button
                  key={useCase.id}
                  type="button"
                  onClick={() => setSelectedId(useCase.id)}
                  className={`min-h-10 w-full rounded-lg border p-4 text-left transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-page ${
                    selected.id === useCase.id
                      ? "border-[#14F195]/60 bg-[#14F195]/10"
                      : "border-white/10 bg-card/35 hover:border-white/25"
                  }`}
                >
                  <span className="block text-sm font-semibold text-white">{useCase.title}</span>
                  <span className="mt-2 block text-xs leading-5 text-gray-400">{useCase.price} via {useCase.paymentRail}</span>
                </button>
              ))}
            </div>

            <div className="rounded-lg border border-white/10 bg-card/45 p-5">
              <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
                <div>
                  <h3 className="font-display text-2xl font-semibold">{selected.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-gray-300">{selected.summary}</p>

                  <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                    {[
                      ["Buyer", selected.buyerAgent],
                      ["Seller", selected.sellerAgent],
                      ["Attestor", selected.attestorAgent],
                      ["ADL fields", selected.adlRef],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-lg border border-white/10 bg-white/5 p-3">
                        <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
                        <dd className="mt-1 text-sm text-gray-200">{value}</dd>
                      </div>
                    ))}
                  </dl>

                  <div className="mt-5 space-y-3">
                    {selected.steps.map((step) => (
                      <div key={step.id} className="rounded-lg border border-white/10 bg-page/50 p-4">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 aria-hidden="true" size={17} className="text-[#14F195]" />
                            <h4 className="text-sm font-semibold text-white">{step.label}</h4>
                          </div>
                          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${stateClass(step.state)}`}>
                            {step.state}
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-gray-300">{step.detail}</p>
                        <p className="mt-2 break-all font-mono text-xs text-gray-500">{step.evidence}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <aside className="rounded-lg border border-white/10 bg-page/60 p-4">
                  <h4 className="font-display text-xl font-semibold">Run this flow</h4>
                  <p className="mt-2 text-sm leading-6 text-gray-300">
                    Mock mode uses packaged responses. Live mode sends the same ADL request from your browser to
                    your supplied agent API address.
                  </p>

                  {mode === "live" && (
                    <div className="mt-4 space-y-2">
                      <label htmlFor="agent-api-address" className="text-sm font-semibold text-white">
                        Agent API address
                      </label>
                      <input
                        id="agent-api-address"
                        type="url"
                        inputMode="url"
                        autoComplete="url"
                        value={agentApiAddress}
                        onChange={(event) => setAgentApiAddress(event.target.value)}
                        placeholder="https://your-agent.example.com/run"
                        className="min-h-10 w-full rounded-lg border border-white/10 bg-card/70 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-page"
                      />
                      <p className="text-xs leading-5 text-gray-500">
                        The site does not store this address. Your browser makes the request directly.
                      </p>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={runDemo}
                    disabled={runState === "running"}
                    className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#14F195] px-4 py-2 text-sm font-bold text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-page"
                  >
                    <Play aria-hidden="true" size={16} />
                    {runState === "running" ? "Running..." : mode === "mock" ? "Run mock flow" : "Run live endpoint"}
                  </button>

                  <div className="mt-4 rounded-lg border border-white/10 bg-black/30 p-3">
                    <p className="text-xs uppercase tracking-wide text-gray-500">Request</p>
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs text-gray-300">
                      {JSON.stringify(livePayload, null, 2)}
                    </pre>
                  </div>

                  {(runOutput || error) && (
                    <div className="mt-4 rounded-lg border border-white/10 bg-black/30 p-3" role="status">
                      <p className="text-xs uppercase tracking-wide text-gray-500">Result</p>
                      {error && <p className="mt-2 text-sm text-red-200">{error}</p>}
                      {runOutput && <p className="mt-2 text-sm leading-6 text-gray-200">{runOutput}</p>}
                    </div>
                  )}
                </aside>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="rounded-lg border border-white/10 bg-card/35 p-5">
            <p className="section-label">Whitepaper review</p>
            <h2 className="mt-2 font-display text-3xl font-bold">Open ADL for comments and improvements</h2>
            <p className="mt-3 text-sm leading-6 text-gray-300">
              Use the review packet to flag missing ADL fields, ambiguous payment semantics, export loss, or any
              demo copy that could overclaim live settlement.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="review-name" className="text-sm font-semibold text-white">Name or handle</label>
                <input
                  id="review-name"
                  value={reviewName}
                  onChange={(event) => setReviewName(event.target.value)}
                  autoComplete="name"
                  className="mt-2 min-h-10 w-full rounded-lg border border-white/10 bg-card/70 px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-page"
                />
              </div>
              <div>
                <label htmlFor="review-focus" className="text-sm font-semibold text-white">Review focus</label>
                <input
                  id="review-focus"
                  value={reviewFocus}
                  onChange={(event) => setReviewFocus(event.target.value)}
                  placeholder="Payment receipts, schema fields, exports..."
                  className="mt-2 min-h-10 w-full rounded-lg border border-white/10 bg-card/70 px-3 py-2 text-sm placeholder:text-gray-500 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-page"
                />
              </div>
            </div>
            <a
              href={reviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#14F195]/40 bg-[#14F195]/10 px-4 py-2 text-sm font-semibold text-[#14F195] hover:bg-[#14F195]/15 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-page"
            >
              <MessageSquare aria-hidden="true" size={16} />
              Draft GitHub review
            </a>
          </div>

          <div className="rounded-lg border border-white/10 bg-card/35 p-5">
            <h2 className="font-display text-2xl font-semibold">What ADL protects</h2>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-gray-300">
              {selected.adlHighlights.map((highlight) => (
                <li key={highlight} className="flex gap-3">
                  <CheckCircle2 aria-hidden="true" size={16} className="mt-1 shrink-0 text-[#14F195]" />
                  <span>{highlight}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
