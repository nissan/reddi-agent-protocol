"use client";

import { baseUnitsToDecimal } from "@redditech/x402-solana/payment";
import type { PlannerSessionHandle } from "@/lib/payments/planner-session-client";

/** Per-token prices are in six-decimal US dollar stablecoins. */
const DECIMALS = 6;
const CALL_CHOICES = [5, 10, 20, 50];

export interface SessionOptionProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  calls: number;
  onCallsChange: (calls: number) => void;
  settleAfterNext: boolean;
  onSettleAfterNextChange: (value: boolean) => void;
  /** Settle the open session now, without another call. */
  onSettleNow?: () => void;
  /** True while a settle-now request is in flight. */
  settling?: boolean;
  /** The session with the selected provider, open or ended. */
  session?: PlannerSessionHandle;
  /** Why a session cannot be used for this payment, when it cannot. */
  unavailable?: string;
  disabled?: boolean;
}

/**
 * The buyer's choice to keep a lock open for more calls (#863), and the state
 * of the session with the selected provider. Controlled: the page owns the
 * state and the session key.
 */
export function SessionOption({ enabled, onEnabledChange, calls, onCallsChange, settleAfterNext, onSettleAfterNextChange, onSettleNow, settling, session, unavailable, disabled }: SessionOptionProps) {
  const ledger = session?.ledger;
  const open = ledger?.state === "open" && ledger.calls.length > 0;
  const currency = ledger?.price.currency ?? "";
  const served = ledger ? ledger.calls.filter((call) => call.usage.inputTokens + call.usage.outputTokens > 0).length : 0;

  if (open && ledger) {
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-50" data-testid="planner-session-open">
        <p className="font-medium text-white">Open session with this provider</p>
        <p className="mt-1 text-xs leading-5 text-emerald-100">
          {served} {served === 1 ? "call" : "calls"} so far, {baseUnitsToDecimal(ledger.costBaseUnits, DECIMALS)} {currency} of the{" "}
          {baseUnitsToDecimal(ledger.lockBaseUnits, DECIMALS)} {currency} locked. Your next call goes on the same lock with no wallet prompt; every receipt is checked against your own count.
        </p>
        <label className="mt-3 flex items-start gap-3 text-xs">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={settleAfterNext}
            disabled={disabled}
            onChange={(event) => onSettleAfterNextChange(event.target.checked)}
            data-testid="planner-session-settle"
          />
          <span>Settle after the next call. Otherwise the provider settles once the session is idle, and the rest of the lock comes back to you.</span>
        </label>
        {onSettleNow ? (
          <button
            type="button"
            className="mt-3 rounded-lg border border-emerald-400/40 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500/20 disabled:opacity-50"
            disabled={disabled || settling}
            onClick={onSettleNow}
            data-testid="planner-session-settle-now"
          >
            {settling ? "Settling…" : "Settle now"}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300" data-testid="planner-session-option">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1"
          checked={enabled && !unavailable}
          disabled={disabled || Boolean(unavailable)}
          onChange={(event) => onEnabledChange(event.target.checked)}
          data-testid="planner-session-checkbox"
        />
        <span>
          <span className="font-medium text-white">Keep the lock open for more calls</span>
          <span className="mt-1 block text-xs leading-5 text-gray-400">
            Locks enough for several calls to this provider and settles once at the end, so small calls do not each pay network fees. Your wallet signs one message for this tab; later calls need no wallet prompt. You pay only for the tokens served; the rest comes back.
          </span>
        </span>
      </label>
      {enabled && !unavailable ? (
        <label className="mt-3 flex items-center gap-2 text-xs text-gray-300">
          Calls to cover
          <select
            className="rounded border border-white/10 bg-black/40 px-2 py-1 text-white"
            value={calls}
            disabled={disabled}
            onChange={(event) => onCallsChange(Number(event.target.value))}
            data-testid="planner-session-calls"
          >
            {CALL_CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                {choice}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {unavailable ? <p className="mt-2 text-xs text-gray-400">{unavailable}</p> : null}
      {ledger && ledger.state !== "open" ? (
        <p className="mt-2 text-xs text-amber-200" data-testid="planner-session-ended">
          Your last session with this provider {ledger.state === "settled" ? "is settled" : "has ended"}
          {ledger.stopReason ? `: ${ledger.stopReason}` : "."}
        </p>
      ) : null}
    </div>
  );
}
