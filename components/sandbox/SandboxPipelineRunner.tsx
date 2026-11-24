"use client";

import { useState } from "react";
import type { SandboxExchange } from "@/lib/sandbox/client";
import { triPriceLabel } from "@/lib/sandbox/client";
import { pipelineFeePercent, runSandboxPipeline, studioProviders, type PipelineRunResult, type PipelineStepRow } from "@/lib/sandbox/pipeline-run";
import { maxChargeLamports, mediaCostMicroUsd, requestInputTokens, triPriceFromLamports, triPriceFromMicroUsd } from "@/lib/sandbox/pricing";
import type { SandboxReceipt } from "@/lib/sandbox/receipt";
import { applySandboxRating, type SandboxReputation } from "@/lib/sandbox/reputation";
import { STUDIO_PIPELINE, studioStepPrompt } from "@/lib/sandbox/catalog";

const actionButton = "rounded-lg bg-[#14F195] px-4 py-2.5 text-sm font-semibold text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";
const quietButton = "rounded-lg border border-white/20 px-3 py-2 text-sm font-medium text-gray-100 transition hover:border-white/40 disabled:cursor-not-allowed disabled:opacity-40";

/** A director agent hires five independent studios, one paid call each (the "Make a video" scenario). */
export default function SandboxPipelineRunner({
  providerReceiptIds,
  reputation,
  onRated,
  onExchange,
  onReceipts,
}: {
  providerReceiptIds: Record<string, string>;
  reputation: Record<string, SandboxReputation>;
  onRated: (next: Record<string, SandboxReputation>) => void;
  onExchange?: (exchanges: SandboxExchange[]) => void;
  onReceipts?: (receipts: SandboxReceipt[]) => void;
}) {
  const [rows, setRows] = useState<PipelineStepRow[]>([]);
  const [result, setResult] = useState<PipelineRunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [stars, setStars] = useState<Record<string, number>>({});
  const [rated, setRated] = useState<Record<string, { before: SandboxReputation; after: SandboxReputation }> | null>(null);
  const studios = studioProviders();
  const feePercent = pipelineFeePercent();

  async function run() {
    setRunning(true);
    setRows([]);
    setResult(null);
    setRated(null);
    try {
      const outcome = await runSandboxPipeline({ providerReceiptIds, onStep: (row) => setRows((current) => [...current, row]) });
      setResult(outcome);
      onExchange?.(outcome.exchanges);
      if (outcome.ok) {
        onReceipts?.(outcome.receipts);
        // Five stars for a step whose receipt checked and whose spot check passed; the visitor can change any of them.
        setStars(Object.fromEntries(outcome.rows.map((row) => [row.provider.id, row.checked && row.spotCheck?.passed !== false ? 5 : 1])));
      }
    } catch {
      setResult({ ok: false, message: "The sandbox could not be reached. Nothing was paid.", rows: [], exchanges: [] });
    } finally {
      setRunning(false);
    }
  }

  function submitRatings() {
    if (!result?.ok) return;
    const changes: Record<string, { before: SandboxReputation; after: SandboxReputation }> = {};
    const next = { ...reputation };
    for (const row of result.rows) {
      const before = reputation[row.provider.id];
      const after = applySandboxRating(before, stars[row.provider.id] ?? 5);
      changes[row.provider.id] = { before, after };
      next[row.provider.id] = after;
    }
    setRated(changes);
    onRated(next);
  }

  const done = result?.ok ? result : null;
  return (
    <section className="space-y-5 rounded-2xl border border-brand-green/40 bg-white/[0.04] p-5 md:p-6" data-testid="sandbox-pipeline">
      <div>
        <h3 className="text-lg font-semibold text-white">One brief, five independent studios</h3>
        <p className="mt-2 text-sm leading-6 text-gray-300">
          Each studio is a person or a small team who bought their own GPUs and tuned their own model. They sell what they make by the second, the way media is billed, and keep the file hosted for you to collect. The model, the data it learned from and the prompts stay on their own machines. Your director agent asks each one for terms, pays the quote, checks the signed receipt, and only then moves to the next step.
        </p>
      </div>

      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2" data-testid="sandbox-studios">
        {studios.map((studio, index) => {
          const max = triPriceFromLamports(maxChargeLamports(studio, requestInputTokens([{ content: studioStepPrompt(STUDIO_PIPELINE[index].ask) }])));
          const media = studio.media!;
          const perUnit = triPriceFromMicroUsd(mediaCostMicroUsd(studio, { units: 1, bytes: 0 }));
          const score = reputation[studio.id];
          return (
            <li key={studio.id} className="rounded-xl border border-white/10 bg-black/25 p-4" data-testid={`sandbox-studio-${studio.id}`}>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-green">Step {index + 1} · {studio.studio?.role}</p>
              <p className="mt-1 font-semibold text-white">{studio.name}</p>
              <p className="mt-1 text-sm leading-6 text-gray-300">{studio.studio?.who}</p>
              <dl className="mt-3 space-y-1 text-xs leading-5 text-gray-300">
                <div><dt className="inline font-semibold text-gray-100">Price: </dt><dd className="inline" data-testid={`sandbox-studio-price-${studio.id}`}>{perUnit.usdc} USDC per {media.unitLabel}</dd></div>
                <div><dt className="inline font-semibold text-gray-100">Hosting: </dt><dd className="inline">the file is kept {media.hostingDays} days for you to collect, at {media.hostingPerGbUsd} USDC per GB, inside the quote</dd></div>
                <div><dt className="inline font-semibold text-gray-100">Most this call can cost ({media.maxUnits} s): </dt><dd className="inline" data-testid={`sandbox-studio-max-${studio.id}`}>{triPriceLabel(max)}</dd></div>
                <div><dt className="inline font-semibold text-gray-100">Buyers see: </dt><dd className="inline">{studio.studio?.shows}</dd></div>
                <div><dt className="inline font-semibold text-gray-100">Stays private: </dt><dd className="inline">{studio.studio?.keeps}</dd></div>
              </dl>
              {score ? <p className="mt-2 text-xs text-amber-200" data-testid={`sandbox-reputation-${studio.id}`}>★ {score.score.toFixed(2)} from {score.receipts} receipts</p> : null}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={actionButton} data-testid="sandbox-pipeline-run" disabled={running} onClick={run}>
          {running ? `Hiring studio ${rows.length + 1} of ${studios.length}…` : result ? "Make the video again" : "Hire the studios and make the video"}
        </button>
        <span className="text-xs leading-5 text-gray-400">Simulated payments: nothing moves on devnet. Every receipt says so.</span>
      </div>

      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm" data-testid="sandbox-pipeline-steps">
            <caption className="sr-only">Each studio, what it delivered, what it cost and whether its receipt checked</caption>
            <thead className="text-xs uppercase tracking-wide text-gray-400">
              <tr><th scope="col" className="py-1 pr-3">Studio</th><th scope="col" className="py-1 pr-3">Delivered</th><th scope="col" className="py-1 pr-3">Cost</th><th scope="col" className="py-1 pr-3">Fee ({feePercent}%)</th><th scope="col" className="py-1">Receipt</th></tr>
            </thead>
            <tbody className="text-gray-100">
              {rows.map((row) => (
                <tr key={row.step} className="border-t border-white/10 align-top" data-testid={`sandbox-pipeline-step-${row.step}`}>
                  <th scope="row" className="py-2 pr-3 font-normal">
                    <span className="font-semibold">{row.provider.name}</span>
                    <span className="block text-xs text-gray-400">{row.provider.studio?.role}</span>
                    <span className="mt-1 block max-w-xs text-xs leading-5 text-gray-300">{row.answer}</span>
                  </th>
                  <td className="py-2 pr-3 font-mono" data-testid={`sandbox-pipeline-delivered-${row.step}`}>
                    {row.delivery.units} s · {(row.delivery.bytes / 1_000_000).toFixed(1)} MB
                    <span className="block text-xs text-gray-400">sha256 {row.fileHash.slice(0, 12)}…</span>
                    {row.hostedUntil ? <span className="block text-xs text-gray-400">hosted to {row.hostedUntil.slice(0, 10)}</span> : null}
                  </td>
                  <td className="py-2 pr-3 font-mono">{row.costLamports.toString()} lamports<span className="block text-xs text-gray-400">of {row.maxLamports.toString()} max</span></td>
                  <td className="py-2 pr-3 font-mono">{row.feeLamports.toString()} lamports</td>
                  <td className={`py-2 ${row.checked ? "text-brand-green" : "text-red-300"}`}>{row.checked ? "✓ signed, file and length match, fee checks" : row.problem}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {result && !result.ok ? (
        <div role="status" className="rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-100" data-testid="sandbox-pipeline-error">
          <p className="font-semibold">The director stopped</p>
          <p className="mt-1 leading-6">{result.message} It does not hire the next studio on top of a step it cannot check.</p>
        </div>
      ) : null}

      {done ? (
        <div className="space-y-4 rounded-xl border border-white/10 bg-black/30 p-4" data-testid="sandbox-pipeline-done">
          <p className="text-sm font-semibold text-white">Finished: final/launch-30s.mp4, {done.rows.length} studios, {done.rows.length} receipts</p>
          <ul className="space-y-1 text-sm leading-6 text-gray-300">
            <li data-testid="sandbox-pipeline-total">Paid in all: {triPriceLabel(triPriceFromLamports(done.totalLamports))} (simulated). The unused part of each maximum goes back.</li>
            <li data-testid="sandbox-pipeline-fee">Protocol fee on every receipt: {feePercent}% of what each call cost, the launch rate until 31 March 2027, then 5%. {done.feeLamports.toString()} lamports across the job.</li>
            <li data-testid="sandbox-pipeline-typical">Each studio billed the 30 seconds it delivered plus a week of hosting, and each receipt names the file by its SHA-256 hash, so the file you collect is the one you paid for.</li>
          </ul>

          <fieldset className="space-y-2" data-testid="sandbox-pipeline-ratings">
            <legend className="text-sm font-semibold text-white">Rate each studio</legend>
            <p className="text-xs leading-5 text-gray-400">A rating counts only next to a receipt for a paid job, so nobody can rate a studio they never paid. Here the scores live in this tab.</p>
            {done.rows.map((row) => (
              <div key={row.provider.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-32 text-gray-100">{row.provider.name}</span>
                <div role="radiogroup" aria-label={`Stars for ${row.provider.name}`} className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={stars[row.provider.id] === value}
                      aria-label={`${value} star${value === 1 ? "" : "s"}`}
                      data-testid={`sandbox-pipeline-star-${row.provider.id}-${value}`}
                      disabled={rated !== null}
                      onClick={() => setStars((current) => ({ ...current, [row.provider.id]: value }))}
                      className={`text-lg leading-none ${value <= (stars[row.provider.id] ?? 0) ? "text-amber-300" : "text-gray-600"}`}
                    >
                      ★
                    </button>
                  ))}
                </div>
                {rated?.[row.provider.id] ? (
                  <span className="text-xs text-amber-200" data-testid={`sandbox-pipeline-rated-${row.provider.id}`}>
                    ★ {rated[row.provider.id].before.score.toFixed(2)} → ★ {rated[row.provider.id].after.score.toFixed(2)}
                  </span>
                ) : null}
              </div>
            ))}
            <button type="button" className={quietButton} data-testid="sandbox-pipeline-rate" disabled={rated !== null} onClick={submitRatings}>
              {rated ? "Ratings sent" : "Send ratings"}
            </button>
          </fieldset>
        </div>
      ) : null}
    </section>
  );
}
