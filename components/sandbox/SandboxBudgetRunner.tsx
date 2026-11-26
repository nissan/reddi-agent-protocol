"use client";

import { useEffect, useState } from "react";
import {
  BUDGET_DEFAULTS,
  BUDGET_PROVIDERS,
  budgetAmountInUsd,
  formatBudgetAmount,
  maskAgentKey,
  newSandboxAgentKey,
  runSandboxBudget,
  SPLICE_FILM_FUN,
  TOLCA_PAYMENT_CHECK,
  AWARELAND_AGENT_CHECK,
  type BudgetEvent,
  type BudgetRunResult,
  type BudgetToken,
} from "@/lib/sandbox/budget-run";
import { SANDBOX_DEMO_RATES_NOTE } from "@/lib/sandbox/pricing";

const actionButton = "rounded-lg bg-[#14F195] px-4 py-2.5 text-sm font-semibold text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";
const quietButton = "rounded-lg border border-white/20 px-3 py-2 text-sm font-medium text-gray-100 transition hover:border-white/40 disabled:cursor-not-allowed disabled:opacity-40";

type Stage = "setup" | "locked" | "working" | "closed" | "paid";
const STAGE_PHASES: Record<Stage, readonly BudgetEvent["phase"][]> = {
  setup: [],
  locked: ["open", "key"],
  working: ["open", "key", "reserve", "call"],
  closed: ["open", "key", "reserve", "call", "close", "post"],
  paid: ["open", "key", "reserve", "call", "close", "post", "window", "payout"],
};
const STEP_DELAY_MS = 450;

function when(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}

/** Set a budget, give your agent a key, get back what it didn't spend (simulated pooled Budget). */
export default function SandboxBudgetRunner() {
  const [token, setToken] = useState<BudgetToken>("USDC");
  const [stage, setStage] = useState<Stage>("setup");
  const [run, setRun] = useState<BudgetRunResult | null>(null);
  const [shown, setShown] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const visible = run ? run.events.filter((event) => STAGE_PHASES[stage].includes(event.phase)) : [];
  const animating = shown < visible.length;
  useEffect(() => {
    if (!animating) return;
    const next = setTimeout(() => setShown((n) => n + 1), STEP_DELAY_MS);
    return () => clearTimeout(next);
  }, [animating, shown]);

  const fmt = (units: bigint) => (run ? formatBudgetAmount(units, run.token) : "");
  const usd = (units: bigint) => (run && run.token !== "USDC" ? ` (about $${budgetAmountInUsd(units, run.token)})` : "");

  async function lock() {
    setError(null);
    try {
      const outcome = await runSandboxBudget({ token, agentKey: newSandboxAgentKey() });
      setRun(outcome);
      setShown(0);
      setStage("locked");
    } catch {
      setError("The simulation could not run in this browser. Nothing was locked.");
    }
  }

  function advance(next: Stage) {
    setStage(next);
  }

  function reset() {
    setRun(null);
    setShown(0);
    setStage("setup");
  }

  function downloadReceipts() {
    if (!run) return;
    const body = JSON.stringify({ budget: run.budgetId, token: run.token, simulated: true, receipts: run.calls.map((c) => ({ ...c.receipt, hash: c.hash })) }, null, 2);
    const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "rap-sandbox-budget-receipts.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  const ready = run !== null && !animating;
  return (
    <section className="space-y-5 rounded-2xl border border-[#14F195]/40 bg-white/[0.04] p-5 md:p-6" data-testid="sandbox-budget" data-stage={stage} data-ready={ready ? "true" : "false"}>
      <div>
        <h3 className="text-lg font-semibold text-white">Set a budget, give your agent a key</h3>
        <p className="mt-2 text-sm leading-6 text-gray-300">
          Your agent is making a 30-second launch video. You lock one Budget for it in one token. The agent reserves a slice with each provider that takes that token, pays for each call from its slice with a receipt. When the job is done you close the Budget. After a 24-hour window to dispute, each provider is paid what its receipts add up to, and the rest comes back to you.
        </p>
        <div className="mt-3 rounded-xl border border-[#9945FF]/30 bg-[#9945FF]/10 p-4 text-sm leading-6 text-gray-200" data-testid="sandbox-budget-featured">
          <p className="font-semibold text-white">
            Featured launch provider: <a href={SPLICE_FILM_FUN.featured.url} className="underline" target="_blank" rel="noreferrer">Splice by film.fun</a>
          </p>
          <p className="mt-1">
            A real AI filmmaking studio: it generates shots, edits them on a timeline and renders motion graphics. Its prices here are the ones it publishes for agents ({SPLICE_FILM_FUN.featured.pricingSource.summary}; read {SPLICE_FILM_FUN.featured.pricingSource.readOn}). Splice already sells to agents, which top up credits with USDC, SOL or AUDD through Solana Pay. Splice is joining Reddi Agent Protocol as a launch provider: on RAP, each call is paid from your agent&apos;s Budget as it happens, with a receipt.
          </p>
          <p className="mt-3 font-semibold text-white" data-testid="sandbox-budget-featured-tolca">
            Also featured: <a href={TOLCA_PAYMENT_CHECK.featured.url} className="underline" target="_blank" rel="noreferrer">Tolca payment-check</a>
          </p>
          <p className="mt-1">
            A real pay-per-call check for agents. Before your agent reserves a slice for a provider, it asks Tolca whether to pay that provider and gets back allow, review or block. Tolca says it screens the payout wallet against the US sanctions list, Circle&apos;s USDC freeze list and a list of scam addresses. Its price here is the one it publishes ({TOLCA_PAYMENT_CHECK.featured.pricingSource.summary}; read {TOLCA_PAYMENT_CHECK.featured.pricingSource.readOn}), so it joins USDC Budgets only. It is not a RAP provider yet, and this sandbox doesn&apos;t call it: every check here is a simulated &quot;allow&quot;. On RAP, each check would be paid from your agent&apos;s Budget, with a receipt.
          </p>
          <p className="mt-3 font-semibold text-white" data-testid="sandbox-budget-featured-awareland">
            Also featured: <a href={AWARELAND_AGENT_CHECK.featured.url} className="underline" target="_blank" rel="noreferrer">Awareland</a>
          </p>
          <p className="mt-1">
            Agentic anti-fraud that banks already use: know-your-agent, mandates, policy and counterparty checks. Before your agent reserves anything, it asks Awareland to confirm who runs the agent and that its key matches your mandate. Awareland has {AWARELAND_AGENT_CHECK.featured.pricingSource.summary}. It is not a RAP provider yet, and this sandbox doesn&apos;t call it: its check here is a simulated &quot;pass&quot;. On RAP, the check would be paid from your agent&apos;s Budget, with a receipt.
          </p>
        </div>
        <p className="mt-2 text-xs leading-5 text-gray-400">This scenario is a simulation of the Budget design: nothing is locked or paid on devnet, and the receipts are unsigned stand-ins. Every figure is worked out from the calls in this run.</p>
      </div>

      {stage === "setup" ? (
        <div className="space-y-4 rounded-xl border border-white/10 bg-black/30 p-4">
          <fieldset>
            <legend className="text-sm font-semibold text-white">1. Pick the Budget&apos;s token</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {(["USDC", "AUDD", "SOL"] as const).map((entry) => (
                <button key={entry} type="button" aria-pressed={token === entry} data-testid={`sandbox-budget-token-${entry}`} onClick={() => setToken(entry)} className={`${quietButton} ${token === entry ? "border-brand-green bg-brand-green/10" : ""}`}>
                  {entry}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs leading-5 text-gray-400">
              One token per Budget. Providers that take it can join: {BUDGET_PROVIDERS.filter((p) => p.accepts.includes(token)).length} of the {BUDGET_PROVIDERS.length} your agent will ask.
            </p>
          </fieldset>
          <ul className="space-y-1 text-sm leading-6 text-gray-300">
            <li>Amount: $5{token !== "USDC" ? ` in ${token} at demo rates` : " USDC"}</li>
            <li>Open for: {BUDGET_DEFAULTS.openSlots / 9_000} hours. The agent can close it sooner.</li>
            <li>Most any one provider can get: half the Budget</li>
            <li>Dispute window after close: {BUDGET_DEFAULTS.disputeSlots / 9_000} hours, with the RAP judge</li>
          </ul>
          <button type="button" className={actionButton} data-testid="sandbox-budget-lock" onClick={lock}>
            Lock the Budget and make an agent key
          </button>
          {error ? <p role="status" className="text-sm text-red-200">{error}</p> : null}
        </div>
      ) : null}

      {run ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2" data-testid="sandbox-budget-summary">
            <div className="rounded-xl border border-white/10 bg-black/30 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-400">Budget</p>
              <p className="mt-1 font-mono text-lg text-white" data-testid="sandbox-budget-total">{fmt(run.budget.total)}{usd(run.budget.total)}</p>
              <p className="mt-1 text-xs leading-5 text-gray-400">Opened {when(run.times.openedAtMs)}. Expires {when(run.times.expiresAtMs)} if nobody closes it.</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/30 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-400">Your agent&apos;s key</p>
              <p className="mt-1 font-mono text-lg text-white" data-testid="sandbox-budget-key">{maskAgentKey(run.agentKey)}</p>
              <p className="mt-1 text-xs leading-5 text-gray-400">Can reserve and close. Cannot withdraw.</p>
            </div>
          </div>

          <ol className="space-y-2" data-testid="sandbox-budget-events" aria-live="polite">
            {visible.slice(0, shown).map((event, index) => (
              <li key={index} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm leading-6 text-gray-200" data-phase={event.phase}>
                {event.text}
              </li>
            ))}
          </ol>

          {ready && stage === "locked" ? (
            <button type="button" className={actionButton} data-testid="sandbox-budget-work" onClick={() => advance("working")}>
              Let your agent work
            </button>
          ) : null}
          {ready && stage === "working" ? (
            <button type="button" className={actionButton} data-testid="sandbox-budget-close" onClick={() => advance("closed")}>
              The job is done: close the Budget
            </button>
          ) : null}
          {ready && stage === "closed" ? (
            <div className="space-y-2">
              <p className="text-sm text-gray-300" data-testid="sandbox-budget-window">
                Dispute window: closed {when(run.times.closedAtMs)}, ends {when(run.times.disputeEndsAtMs)}.
              </p>
              <button type="button" className={actionButton} data-testid="sandbox-budget-skip" onClick={() => advance("paid")}>
                Skip ahead 24 hours
              </button>
            </div>
          ) : null}

          {stage !== "locked" && stage !== "setup" && run.calls.length > 0 && (stage !== "working" || ready) ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="sandbox-budget-receipts">
                <caption className="sr-only">Receipts for each call paid from the Budget</caption>
                <thead className="text-xs uppercase tracking-wide text-gray-400">
                  <tr><th scope="col" className="py-1 pr-3">Provider</th><th scope="col" className="py-1 pr-3">#</th><th scope="col" className="py-1 pr-3">Delivered</th><th scope="col" className="py-1 pr-3">This call</th><th scope="col" className="py-1 pr-3">Running total</th><th scope="col" className="py-1">Receipt</th></tr>
                </thead>
                <tbody className="font-mono text-gray-100">
                  {run.calls.map((row) => (
                    <tr key={`${row.providerId}-${row.receipt.sequence}`} className="border-t border-white/10">
                      <th scope="row" className="py-1.5 pr-3 font-normal">{row.providerName}</th>
                      <td className="py-1.5 pr-3">{row.receipt.sequence}</td>
                      <td className="py-1.5 pr-3">{row.receipt.file} · {row.receipt.unit === "render" ? "1 render" : row.receipt.unit === "check" ? "1 check" : `${row.receipt.units} s`}</td>
                      <td className="py-1.5 pr-3">{fmt(BigInt(row.receipt.amount))}</td>
                      <td className="py-1.5 pr-3">{fmt(BigInt(row.receipt.cumulative))} / {fmt(BigInt(row.receipt.reserved))}</td>
                      <td className={`py-1.5 ${row.checked ? "text-[#14F195]" : "text-red-300"}`} title={row.hash}>{row.checked ? `✓ ${row.hash.slice(0, 8)}` : "does not match"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {stage === "paid" && ready ? (
            <div className="space-y-3 rounded-xl border border-white/10 bg-black/30 p-4" data-testid="sandbox-budget-settled">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm" data-testid="sandbox-budget-payouts">
                  <caption className="sr-only">What each provider was paid and what came back to you</caption>
                  <thead className="text-xs uppercase tracking-wide text-gray-400">
                    <tr><th scope="col" className="py-1 pr-3">Provider</th><th scope="col" className="py-1 pr-3">Reserved</th><th scope="col" className="py-1 pr-3">Used</th><th scope="col" className="py-1 pr-3">Fee</th><th scope="col" className="py-1 pr-3">Provider gets</th><th scope="col" className="py-1">Back to you</th></tr>
                  </thead>
                  <tbody className="font-mono text-gray-100">
                    {run.payouts.map((p) => (
                      <tr key={p.providerId} className="border-t border-white/10">
                        <th scope="row" className="py-1.5 pr-3 font-normal">{p.providerName}</th>
                        <td className="py-1.5 pr-3">{fmt(p.reserved)}</td>
                        <td className="py-1.5 pr-3">{fmt(p.finalAmount)}</td>
                        <td className="py-1.5 pr-3">{fmt(p.fee)}</td>
                        <td className="py-1.5 pr-3">{fmt(p.toProvider)}</td>
                        <td className="py-1.5">{fmt(p.returned)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-white/10">
                      <th scope="row" className="py-1.5 pr-3 font-normal">Never reserved</th>
                      <td className="py-1.5 pr-3" colSpan={4}>returned at close</td>
                      <td className="py-1.5">{fmt(run.returnedAtClose)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <ul className="space-y-1 text-sm leading-6 text-gray-300">
                <li data-testid="sandbox-budget-spent">Spent: {fmt(run.totals.spent)}{usd(run.totals.spent)} across {run.calls.length} calls to {run.payouts.length} providers.</li>
                <li data-testid="sandbox-budget-fee">Planned protocol fee: {fmt(run.totals.fee)}, {Number(run.feeBps) / 100}% of what each provider was paid{run.feeBps === BigInt(250) ? " (the launch rate until 31 March 2027, then 5%)" : ""}, taken from the provider&apos;s share.</li>
                <li data-testid="sandbox-budget-returned">Back to you: {fmt(run.totals.returned)}{usd(run.totals.returned)} of {fmt(run.budget.total)}, with nothing to claim.</li>
                <li data-testid="sandbox-budget-invariant" className={run.invariantHeldThroughout ? "text-[#14F195]" : "text-red-300"}>
                  {run.invariantHeldThroughout ? "✓ At every step, unreserved + reserved + paid + returned equalled the Budget." : "The Budget's books did not balance at some step."}
                </li>
              </ul>
              {run.refused.length > 0 ? (
                <p className="text-xs leading-5 text-gray-400">
                  {run.refused.map((r) => r.providerName).join(" and ")} couldn&apos;t join because {run.refused.length > 1 ? "they don't" : "it doesn't"} take {run.token}. Each Budget holds one token, and a provider joins only if it takes that token.
                </p>
              ) : null}
              {run.token !== "USDC" ? <p className="text-xs leading-5 text-gray-400">{SANDBOX_DEMO_RATES_NOTE}</p> : null}
              <div className="flex flex-wrap gap-2">
                <button type="button" className={quietButton} data-testid="sandbox-budget-download" onClick={downloadReceipts}>Download the receipts</button>
                <button type="button" className={quietButton} data-testid="sandbox-budget-again" onClick={reset}>Set another budget</button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
