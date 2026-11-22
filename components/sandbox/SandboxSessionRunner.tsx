"use client";

import { useState } from "react";
import type { SandboxProvider } from "@/lib/sandbox/catalog";
import type { SandboxExchange } from "@/lib/sandbox/client";
import { triPriceFromLamports } from "@/lib/sandbox/pricing";
import type { SandboxReceipt } from "@/lib/sandbox/receipt";
import { networkFeeShare, runSandboxSession, sessionMaxLamports, SESSION_PROMPTS, type SessionCallRow, type SessionRunResult } from "@/lib/sandbox/session-run";

const actionButton = "rounded-lg bg-[#14F195] px-4 py-2.5 text-sm font-semibold text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";
const percent = (share: number) => `${(share * 100).toFixed(share < 0.01 ? 2 : 1)}%`;

/** Ten small calls, one simulated lock, one settle (#863). */
export default function SandboxSessionRunner({ provider, providerReceiptId, onExchange, onSettled }: { provider: SandboxProvider; providerReceiptId?: string; onExchange?: (exchanges: SandboxExchange[]) => void; onSettled?: (receipts: SandboxReceipt[]) => void }) {
  const [rows, setRows] = useState<SessionCallRow[]>([]);
  const [result, setResult] = useState<SessionRunResult | null>(null);
  const [running, setRunning] = useState(false);
  const max = sessionMaxLamports(provider);
  const maxTri = triPriceFromLamports(max);

  async function run() {
    setRunning(true);
    setRows([]);
    setResult(null);
    try {
      const outcome = await runSandboxSession({ provider, providerReceiptId, onCall: (row) => setRows((current) => [...current, row]) });
      setResult(outcome);
      onExchange?.(outcome.exchanges);
      // The calls' receipts and the closing receipt, which carries the one payment.
      if (outcome.ok) onSettled?.([...outcome.receipts, outcome.closing]);
    } catch {
      setResult({ ok: false, message: "The sandbox could not be reached. Nothing was paid.", rows: [], exchanges: [] });
    } finally {
      setRunning(false);
    }
  }

  const done = result?.ok ? result : null;
  return (
    <section className="space-y-5 rounded-2xl border border-[#14F195]/40 bg-white/[0.04] p-5 md:p-6" data-testid="sandbox-session">
      <div>
        <h3 className="text-lg font-semibold text-white">One lock, {SESSION_PROMPTS.length} calls, one settle</h3>
        <p className="mt-2 text-sm leading-6 text-gray-300">
          Your agent locks a session maximum once with {provider.name}: {maxTri.sol} SOL ({maxTri.usdc} USDC · {maxTri.audd} AUDD at demo rates), enough for every call&apos;s worst case. It then sends {SESSION_PROMPTS.length} small requests on the same lock. Each answer carries a signed receipt with the running total and the hash of the receipt before it, and your side checks each one against its own count of tokens. The last call closes the session, and the provider settles the running total in one payment. The rest of the lock comes back.
        </p>
        <p className="mt-2 text-xs leading-5 text-gray-400">This scenario uses a simulated lock, so nothing moves on devnet. Devnet escrow sessions follow once each call is signed with a session key your wallet delegates.</p>
      </div>
      <button type="button" className={actionButton} data-testid="sandbox-session-run" disabled={running} onClick={run}>
        {running ? `Running call ${rows.length + 1} of ${SESSION_PROMPTS.length}…` : result ? "Run the session again" : `Lock once and run ${SESSION_PROMPTS.length} calls`}
      </button>

      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="sandbox-session-calls">
            <caption className="sr-only">Session calls, their tokens and the running total</caption>
            <thead className="text-xs uppercase tracking-wide text-gray-400">
              <tr><th scope="col" className="py-1 pr-3">Call</th><th scope="col" className="py-1 pr-3">Tokens in / out</th><th scope="col" className="py-1 pr-3">This call</th><th scope="col" className="py-1 pr-3">Running total</th><th scope="col" className="py-1">Receipt</th></tr>
            </thead>
            <tbody className="font-mono text-gray-100">
              {rows.map((row) => (
                <tr key={row.sequence} className="border-t border-white/10" data-testid={`sandbox-session-call-${row.sequence}`}>
                  <th scope="row" className="py-1.5 pr-3 font-normal">{row.sequence}</th>
                  <td className="py-1.5 pr-3">{row.inputTokens} / {row.outputTokens}</td>
                  <td className="py-1.5 pr-3">{row.costLamports.toString()} lamports</td>
                  <td className="py-1.5 pr-3">{row.cumulativeLamports.toString()} lamports</td>
                  <td className={`py-1.5 ${row.checked ? "text-[#14F195]" : "text-red-300"}`}>{row.checked ? "✓ signed, chained, matches your count" : row.problem}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {result && !result.ok ? (
        <div role="status" className="rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-100" data-testid="sandbox-session-error">
          <p className="font-semibold">The session stopped</p>
          <p className="mt-1 leading-6">{result.message} Your side refuses to go on once a receipt disagrees with its own count, and the lock never pays out more than it holds.</p>
        </div>
      ) : null}

      {done ? (
        <div className="space-y-3 rounded-xl border border-white/10 bg-black/30 p-4" data-testid="sandbox-session-settled">
          <p className="text-sm font-semibold text-white">Settled once: {done.totalLamports.toString()} lamports for {done.rows.length} calls</p>
          <ul className="space-y-1 text-sm leading-6 text-gray-300">
            <li>The closing receipt is call {done.rows.length + 1} in the chain: no tokens of its own, the running totals, and the settle.</li>
            <li>Planned protocol fee, 2.5% of the total at the launch rate: {done.feeLamports.toString()} lamports. Returned to you from the lock: {done.refundedLamports.toString()} lamports.</li>
            <li data-testid="sandbox-session-network">Network transactions: 2 (one lock, one settle) instead of {done.rows.length * 2} if each call paid on its own.</li>
          </ul>
          <p className="text-xs leading-5 text-gray-400" data-testid="sandbox-session-fee-share">
            At real prices: a typical chat call costs about $0.0065 on a mid-tier model, and a Solana transaction about $0.000365 at the median fee. Paying each call on its own spends about {percent(networkFeeShare(1))} of the money on network fees. One session of {done.rows.length} calls spends about {percent(networkFeeShare(done.rows.length))}, and fifty calls about {percent(networkFeeShare(50))}. The sandbox answers are tiny, so its own lamport figures are smaller than a real job&apos;s.
          </p>
        </div>
      ) : null}
    </section>
  );
}
