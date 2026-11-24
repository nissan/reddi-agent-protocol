"use client";

import Link from "next/link";
import { useState } from "react";
import type { SandboxExchange } from "@/lib/sandbox/client";
import { providerPriceView, triPriceLabel } from "@/lib/sandbox/client";
import { requestInputTokens, sandboxFeeBps, triPriceFromLamports } from "@/lib/sandbox/pricing";
import type { SandboxReceipt } from "@/lib/sandbox/receipt";
import type { SandboxReputation } from "@/lib/sandbox/reputation";
import { runSandboxWriting, writingProviders, type WritingRunResult, type WritingStepRow } from "@/lib/sandbox/writing-run";
import {
  buildWritingSkill,
  countWords,
  DEFAULT_WRITING_SETTINGS,
  JARGON_LEVELS,
  skillFileName,
  WORD_LIMITS,
  WRITING_SAMPLE,
  WRITING_STYLES,
  writingStepPrompt,
  type WritingSettings,
} from "@/lib/sandbox/writing-skill";

const actionButton = "rounded-lg bg-[#14F195] px-4 py-2.5 text-sm font-semibold text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";
const quietButton = "rounded-lg border border-white/20 px-3 py-2 text-sm font-medium text-gray-100 transition hover:border-white/40 disabled:cursor-not-allowed disabled:opacity-40";
const chip = (on: boolean) =>
  `rounded-lg border px-3 py-2 text-left text-sm transition ${on ? "border-brand-green bg-brand-green/10 text-white" : "border-white/15 bg-white/[0.03] text-gray-200 hover:border-white/30"}`;

function Choice<T extends string | number>({ legend, name, options, value, onChange, disabled }: {
  legend: string;
  name: string;
  options: readonly { id: T; label: string; hint?: string }[];
  value: T;
  onChange: (next: T) => void;
  disabled: boolean;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold text-white">{legend}</legend>
      <div role="radiogroup" aria-label={legend} className="grid gap-2 sm:grid-cols-3">
        {options.map((option) => (
          <button
            key={String(option.id)}
            type="button"
            role="radio"
            aria-checked={option.id === value}
            data-testid={`sandbox-writing-${name}-${option.id}`}
            disabled={disabled}
            onClick={() => onChange(option.id)}
            className={chip(option.id === value)}
          >
            <span className="block font-medium">{option.label}</span>
            {option.hint ? <span className="mt-0.5 block text-xs leading-5 text-gray-400">{option.hint}</span> : null}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** The "Help us write better" scenario: two paid calls build a writing skill the visitor keeps. */
export default function SandboxWritingRunner({
  providerReceiptIds,
  reputation,
  onExchange,
  onReceipts,
}: {
  providerReceiptIds: Record<string, string>;
  reputation: Record<string, SandboxReputation>;
  onExchange?: (exchanges: SandboxExchange[]) => void;
  onReceipts?: (receipts: SandboxReceipt[]) => void;
}) {
  const [settings, setSettings] = useState<WritingSettings>(DEFAULT_WRITING_SETTINGS);
  const [rows, setRows] = useState<WritingStepRow[]>([]);
  const [result, setResult] = useState<WritingRunResult | null>(null);
  const [running, setRunning] = useState(false);
  const providers = writingProviders();
  const feePercent = Number(sandboxFeeBps()) / 100;
  // The humaniser's request carries the skill, so its maximum depends on the settings.
  const stepInputs = [writingStepPrompt(0, settings), writingStepPrompt(1, settings, buildWritingSkill(settings))].map((content) => requestInputTokens([{ content }]));

  function change(next: Partial<WritingSettings>) {
    setSettings((current) => ({ ...current, ...next }));
    setRows([]);
    setResult(null);
  }

  async function run() {
    setRunning(true);
    setRows([]);
    setResult(null);
    try {
      const outcome = await runSandboxWriting({ settings, providerReceiptIds, onStep: (row) => setRows((current) => [...current, row]) });
      setResult(outcome);
      onExchange?.(outcome.exchanges);
      if (outcome.ok) onReceipts?.(outcome.receipts);
    } catch {
      setResult({ ok: false, message: "The sandbox could not be reached. Nothing was paid.", rows: [], exchanges: [] });
    } finally {
      setRunning(false);
    }
  }

  function downloadSkill() {
    if (!result?.ok) return;
    const blob = new Blob([result.skill], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = skillFileName(settings);
    link.click();
    URL.revokeObjectURL(url);
  }

  const done = result?.ok ? result : null;
  return (
    <section className="space-y-5 rounded-2xl border border-brand-green/40 bg-white/[0.04] p-5 md:p-6" data-testid="sandbox-writing">
      <div>
        <h3 className="text-lg font-semibold text-white">Teach your agents how you write</h3>
        <p className="mt-2 text-sm leading-6 text-gray-300">
          Tell us how you like things written. Two writing providers turn that into a skill file: plain instructions any agent can follow, whether it drafts your emails, your posts or your team updates. You pay each one per token, with the price up front and a signed receipt after.
        </p>
      </div>

      <ol className="grid gap-3 sm:grid-cols-2" data-testid="sandbox-writing-providers">
        {providers.map((provider, index) => {
          const price = providerPriceView(provider, stepInputs[index]);
          const score = reputation[provider.id];
          return (
            <li key={provider.id} className="rounded-xl border border-white/10 bg-black/25 p-4" data-testid={`sandbox-writing-provider-${provider.id}`}>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-green">Step {index + 1} · {provider.writing?.role}</p>
              <p className="mt-1 font-semibold text-white">{provider.name}</p>
              <p className="mt-1 text-sm leading-6 text-gray-300">{provider.writing?.does}</p>
              <dl className="mt-3 space-y-1 text-xs leading-5 text-gray-300">
                <div><dt className="inline font-semibold text-gray-100">Price: </dt><dd className="inline" data-testid={`sandbox-writing-price-${provider.id}`}>{price.inputPerMillion.usdc} USDC in, {price.outputPerMillion.usdc} USDC out, per million tokens</dd></div>
                <div><dt className="inline font-semibold text-gray-100">Most this call can cost: </dt><dd className="inline" data-testid={`sandbox-writing-max-${provider.id}`}>{triPriceLabel(price.maxPerCall)}</dd></div>
              </dl>
              {score ? <p className="mt-2 text-xs text-amber-200" data-testid={`sandbox-reputation-${provider.id}`}>★ {score.score.toFixed(2)} from {score.receipts} receipts</p> : null}
            </li>
          );
        })}
      </ol>

      <div className="space-y-4" data-testid="sandbox-writing-settings">
        <Choice legend="Voice" name="style" options={WRITING_STYLES} value={settings.style} onChange={(style) => change({ style })} disabled={running} />
        <Choice legend="How much jargon" name="jargon" options={JARGON_LEVELS} value={settings.jargon} onChange={(jargon) => change({ jargon })} disabled={running} />
        <Choice
          legend="Longest a piece can be"
          name="words"
          options={WORD_LIMITS.map((limit) => ({ id: limit, label: `${limit} words` }))}
          value={settings.maxWords}
          onChange={(maxWords) => change({ maxWords })}
          disabled={running}
        />
      </div>

      <div className="rounded-xl border border-white/10 bg-black/25 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">We&apos;ll try your skill on this ({countWords(WRITING_SAMPLE)} words)</p>
        <p className="mt-2 text-sm leading-6 text-gray-200" data-testid="sandbox-writing-sample">{WRITING_SAMPLE}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={actionButton} data-testid="sandbox-writing-run" disabled={running} onClick={run}>
          {running ? `Calling provider ${rows.length + 1} of ${providers.length}…` : result ? "Build it again" : "Build my writing skill"}
        </button>
        <span className="text-xs leading-5 text-gray-400">Simulated payments: nothing moves on devnet. Every receipt says so.</span>
      </div>

      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-sm" data-testid="sandbox-writing-steps">
            <caption className="sr-only">Each provider, the tokens it used, what it cost and whether its receipt checked</caption>
            <thead className="text-xs uppercase tracking-wide text-gray-400">
              <tr><th scope="col" className="py-1 pr-3">Provider</th><th scope="col" className="py-1 pr-3">Tokens</th><th scope="col" className="py-1 pr-3">Cost</th><th scope="col" className="py-1 pr-3">Fee ({feePercent}%)</th><th scope="col" className="py-1">Receipt</th></tr>
            </thead>
            <tbody className="text-gray-100">
              {rows.map((row) => (
                <tr key={row.step} className="border-t border-white/10 align-top" data-testid={`sandbox-writing-step-${row.step}`}>
                  <th scope="row" className="py-2 pr-3 font-normal">
                    <span className="font-semibold">{row.provider.name}</span>
                    <span className="block text-xs text-gray-400">{row.provider.writing?.role}</span>
                  </th>
                  <td className="py-2 pr-3 font-mono">{row.inputTokens} in · {row.outputTokens} out</td>
                  <td className="py-2 pr-3 font-mono">{row.costLamports.toString()} lamports<span className="block text-xs text-gray-400">of {row.maxLamports.toString()} max</span></td>
                  <td className="py-2 pr-3 font-mono">{row.feeLamports.toString()} lamports</td>
                  <td className={`py-2 ${row.checked ? "text-brand-green" : "text-red-300"}`}>{row.checked ? "✓ signed, tokens and fee check" : row.problem}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {result && !result.ok ? (
        <div role="status" className="rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-100" data-testid="sandbox-writing-error">
          <p className="font-semibold">Your agent stopped</p>
          <p className="mt-1 leading-6">{result.message} It does not use an answer whose receipt it cannot check.</p>
        </div>
      ) : null}

      {done ? (
        <div className="space-y-5" data-testid="sandbox-writing-done">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-black/25 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Before · {countWords(WRITING_SAMPLE)} words</p>
              <p className="mt-2 text-sm leading-6 text-gray-300">{WRITING_SAMPLE}</p>
            </div>
            <div className="rounded-xl border border-brand-green/40 bg-brand-green/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-green" data-testid="sandbox-writing-after-count">After · {countWords(done.rewrite)} words</p>
              <p className="mt-2 text-sm leading-6 text-white" data-testid="sandbox-writing-rewrite">{done.rewrite}</p>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-white">Your skill: {skillFileName(settings)}</p>
              <button type="button" className={quietButton} data-testid="sandbox-writing-download" onClick={downloadSkill}>Download the skill</button>
            </div>
            <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-black/40 p-3 text-xs leading-5 text-gray-200" data-testid="sandbox-writing-skill">{done.skill}</pre>
            <ul className="mt-3 space-y-1 text-sm leading-6 text-gray-300">
              <li data-testid="sandbox-writing-total">Paid in all: {triPriceLabel(triPriceFromLamports(done.totalLamports))} (simulated). The unused part of each maximum goes back.</li>
              <li data-testid="sandbox-writing-fee">Protocol fee on every receipt: {feePercent}% of what each call cost, the launch rate until 31 March 2027, then 5%. {done.feeLamports.toString()} lamports across both calls.</li>
            </ul>
          </div>

          <div className="rounded-xl border border-[#9945FF]/40 bg-[#9945FF]/10 p-4" data-testid="sandbox-writing-agent">
            <p className="text-base font-semibold text-white">Now give it to your agent</p>
            <p className="mt-1 text-sm leading-6 text-gray-200">You just did by hand what your agent can do for itself.</p>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-gray-200">
              <li><span className="font-semibold text-white">Add the skill.</span> Drop the file into your agent&apos;s skills folder, or paste it into its instructions. Any agent that reads a skill or a system prompt can use it.</li>
              <li><span className="font-semibold text-white">Let it buy a second pass.</span> Hand your agent the Reddi skill file and it can call Writing Style and Humaniser itself whenever a draft matters, paying per call and checking every receipt.</li>
              <li><span className="font-semibold text-white">Set its budget.</span> You choose the most per call and in total, and your agent stops there.</li>
            </ol>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link href="/agent-setup" className={actionButton} data-testid="sandbox-writing-agent-setup">Set up your agent</Link>
              <Link href="/try" className={quietButton}>Pay for one call yourself first</Link>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
