"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import type { ReddiCircleX402Candidate } from "@/lib/integrations/source-adapter/profiles/circle-x402";

type QuotePreviewResponse = {
  ok: boolean;
  mode: "dry-run-quote-preview";
  task: string;
  candidate: ReddiCircleX402Candidate | null;
  routePreview: {
    routeState: string;
    plannerPolicy: {
      preferredSource: "circle-x402";
      strictSourceMatch: boolean;
      requireAttestationBeforeTrust: boolean;
      livePaymentAllowed: boolean;
    };
  } | null;
  quotePreview: {
    currency: "USDC";
    network: string;
    rail: "circle_gateway" | "vanilla_x402";
    estimatedUsd?: number;
    maxAmountRequired?: string;
  } | null;
  requiredGates: string[];
  trustNotes: string[];
  error?: string;
};

type CatalogResponse = {
  ok: boolean;
  summary: {
    totalResources?: number;
    pricesUsdc?: { median?: number | null; p90?: number | null; max?: number | null };
    categories?: Record<string, number>;
  } | null;
  candidates: ReddiCircleX402Candidate[];
  total: number;
  returned: number;
  boundary: string;
  error?: string;
};

function money(value: number | null | undefined) {
  if (value === null || value === undefined) return "unknown";
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(6)}`;
  return `$${value.toFixed(3)}`;
}

export default function CircleX402Page() {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("All");
  const [quotePreview, setQuotePreview] = useState<QuotePreviewResponse | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const qs = new URLSearchParams({ limit: "36" });
      if (category !== "All") qs.set("category", category);
      const response = await fetch(`/api/source-adapters/circle-x402?${qs.toString()}`);
      const data = (await response.json()) as CatalogResponse;
      if (!cancelled) {
        setCatalog(data);
        setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [category]);

  async function previewQuote(candidate: ReddiCircleX402Candidate) {
    setQuoteLoading(true);
    try {
      const response = await fetch("/api/source-adapters/circle-x402/quote-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          candidateId: candidate.candidateId,
          task: `Preview RAP route for ${candidate.providerName}`,
        }),
      });
      const data = (await response.json()) as QuotePreviewResponse;
      setQuotePreview(data);
    } finally {
      setQuoteLoading(false);
    }
  }

  const categories = useMemo(() => {
    const entries = Object.entries(catalog?.summary?.categories ?? {});
    return ["All", ...entries.sort((a, b) => b[1] - a[1]).map(([name]) => name)];
  }, [catalog?.summary?.categories]);

  return (
    <div className="min-h-screen bg-page">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <PageHeader
          label="Circle x402 source adapter"
          title="Circle-listed paid APIs, ready for RAP trust wrapping"
          subtitle="Dry-run catalog and quote preview. RAP can import Circle x402 resources as external specialist candidates, then add routing, receipt verification, attestation, reputation, and disclosure before any explicitly approved live spend."
          actions={
            <Link href="/agents" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Back to directory
            </Link>
          }
        />

        <section className="mb-8 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-5 text-sm text-amber-100">
          <div className="font-semibold text-amber-50">Boundary: dry-run only</div>
          <p className="mt-2 text-amber-100/80">
            This page never logs into Circle, accepts terms, funds wallets, creates payment headers, pays, or invokes services. Imported resources are marked externally listed and not RAP-attested until RAP attestors verify receipts and evidence.
          </p>
        </section>

        <section className="mb-8 grid gap-4 md:grid-cols-4">
          <div className="rounded-xl bg-surface p-4 glow-border">
            <div className="text-xs uppercase tracking-wide text-gray-500">Ingested resources</div>
            <div className="mt-2 text-2xl font-semibold text-white">{catalog?.summary?.totalResources ?? catalog?.total ?? "—"}</div>
          </div>
          <div className="rounded-xl bg-surface p-4 glow-border">
            <div className="text-xs uppercase tracking-wide text-gray-500">Median price</div>
            <div className="mt-2 text-2xl font-semibold text-white">{money(catalog?.summary?.pricesUsdc?.median)}</div>
          </div>
          <div className="rounded-xl bg-surface p-4 glow-border">
            <div className="text-xs uppercase tracking-wide text-gray-500">P90 price</div>
            <div className="mt-2 text-2xl font-semibold text-white">{money(catalog?.summary?.pricesUsdc?.p90)}</div>
          </div>
          <div className="rounded-xl bg-surface p-4 glow-border">
            <div className="text-xs uppercase tracking-wide text-gray-500">Returned now</div>
            <div className="mt-2 text-2xl font-semibold text-white">{catalog?.returned ?? "—"}</div>
          </div>
        </section>

        {quotePreview ? (
          <section className="mb-8 rounded-2xl bg-surface p-5 glow-border">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-indigo-300">Dry-run route preview</div>
                <h2 className="mt-2 text-xl font-semibold text-white">{quotePreview.candidate?.providerName ?? "Candidate unavailable"}</h2>
                <p className="mt-2 text-sm text-gray-400">{quotePreview.task}</p>
              </div>
              <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs text-amber-100">
                {quotePreview.routePreview?.routeState.replaceAll("_", " ") ?? "not routable"}
              </span>
            </div>
            {quotePreview.ok ? (
              <div className="mt-5 grid gap-4 md:grid-cols-3">
                <div className="rounded-lg border border-gray-800 bg-black/20 p-3 text-sm text-gray-300">
                  <div className="text-gray-500">Source policy</div>
                  <div>preferredSource: circle-x402</div>
                  <div>strictSourceMatch: true</div>
                  <div>livePaymentAllowed: false</div>
                </div>
                <div className="rounded-lg border border-gray-800 bg-black/20 p-3 text-sm text-gray-300">
                  <div className="text-gray-500">Quote preview</div>
                  <div>Rail: {quotePreview.quotePreview?.rail ?? "unknown"}</div>
                  <div>Network: {quotePreview.quotePreview?.network ?? "unknown"}</div>
                  <div>Estimated: {money(quotePreview.quotePreview?.estimatedUsd)}</div>
                </div>
                <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-amber-100">
                  <div className="font-medium">Required before live payment</div>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-amber-100/80">
                    {quotePreview.requiredGates.map((gate) => (
                      <li key={gate}>{gate}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-red-200">{quotePreview.error}</p>
            )}
          </section>
        ) : null}

        <div className="mb-8 flex flex-wrap gap-3">
          {categories.map((name) => (
            <button
              key={name}
              onClick={() => setCategory(name)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                category === name ? "bg-indigo-500 text-white" : "bg-surface text-gray-400 glow-border hover:text-white"
              }`}
            >
              {name.replaceAll("_", " ")}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-48 animate-pulse rounded-xl bg-surface/70 glow-border" />
            ))}
          </div>
        ) : catalog?.ok ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {catalog.candidates.map((candidate) => (
              <article key={candidate.candidateId} className="rounded-xl bg-surface p-5 glow-border">
                <div className="text-xs uppercase tracking-wide text-indigo-300">{candidate.category.replaceAll("_", " ")}</div>
                <h2 className="mt-2 line-clamp-2 text-lg font-semibold text-white">{candidate.providerName}</h2>
                <p className="mt-2 break-all text-xs text-gray-500">{candidate.resource}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {candidate.taskTypes.map((task) => (
                    <span key={task} className="rounded-full bg-indigo-500/10 px-2 py-1 text-xs text-indigo-200">
                      {task}
                    </span>
                  ))}
                </div>
                <div className="mt-4 rounded-lg border border-gray-800 bg-black/20 p-3 text-xs text-gray-300">
                  <div>Rail: {candidate.payment[0]?.rail ?? "unknown"}</div>
                  <div>Network: {candidate.payment[0]?.network ?? "unknown"}</div>
                  <div>Price: {money(candidate.payment[0]?.priceUsdc)}</div>
                </div>
                <div className="mt-4 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-xs text-amber-100">
                  {candidate.attestationState.replaceAll("_", " ")}
                </div>
                <button
                  type="button"
                  onClick={() => void previewQuote(candidate)}
                  disabled={quoteLoading}
                  className="mt-4 w-full rounded-lg bg-indigo-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {quoteLoading ? "Previewing…" : "Preview RAP route — no spend"}
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-red-400/30 bg-red-400/10 p-5 text-red-100">
            {catalog?.error ?? "Circle catalog unavailable."}
          </div>
        )}
      </div>
    </div>
  );
}
