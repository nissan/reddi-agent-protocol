"use client";

import { RATINGS_DOC_PATH } from "@/lib/rating/reputation-display";
import type { RatedJobStance } from "@/lib/rating/rated-pay";
import { RATING_RENT_SOL } from "@/lib/rating/rating-state";
import { LimitNotice } from "@/components/ui/limit-notice";

export interface RateJobOptionProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** The optional judge address, as typed. */
  judge: string;
  onJudgeChange: (judge: string) => void;
  /** Why the typed judge address cannot be used. */
  judgeError?: string;
  /** What is known about whether the chosen provider serves rated jobs. */
  stance: RatedJobStance;
  disabled?: boolean;
}

/**
 * The buyer's "Rate this job" choice in a pay flow. Off unless the buyer
 * turns it on. Controlled: the page owns the state and builds the transaction.
 */
export function RateJobOption({ checked, onCheckedChange, judge, onJudgeChange, judgeError, stance, disabled }: RateJobOptionProps) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300" data-testid="rate-job-option">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onCheckedChange(event.target.checked)}
          data-testid="rate-job-checkbox"
        />
        <span>
          <span className="font-medium text-white">Rate this job</span>
          <span className="mt-1 block text-xs leading-5 text-gray-400">
            Adds a rating to this payment. After the job is paid, you and the provider each give the other a score from 1 to 10, and both scores go on the public record.
          </span>
        </span>
      </label>

      {checked ? (
        <div className="mt-3 space-y-3 border-t border-white/10 pt-3 text-xs leading-5" data-testid="rate-job-details">
          <ul className="list-disc space-y-1 pl-5 text-gray-300">
            <li>
              Your wallet also pays about <span className="font-mono text-white">{RATING_RENT_SOL} SOL</span> of rent for the rating record. You get it back when you close the rating, or if the job is refunded.
            </li>
            <li>The provider has to agree to be rated. A provider that does not take rated jobs refuses before it does any work, and you can then refund the lock.</li>
            <li>
              You have about 7 days after payment to submit your score, then about 7 days to reveal it. Missing a step costs you reputation points.{" "}
              <a href={RATINGS_DOC_PATH} target="_blank" rel="noopener noreferrer" className="text-indigo-300 hover:text-indigo-200">
                How ratings work
              </a>
            </li>
          </ul>

          {stance === "declines" ? (
            <LimitNotice as="p" tone="warning" role="alert" data-testid="rate-job-declines">
              This provider does not take rated jobs. If you pay with rating on, it will refuse the job and you will have to wait for the refund window. Turn rating off to use this provider, or choose another one.
            </LimitNotice>
          ) : null}
          {stance === "unknown" ? (
            <p className="rounded-lg border border-white/10 bg-black/30 p-3 text-gray-300" data-testid="rate-job-unknown">
              This provider has not said whether it takes rated jobs. If it refuses, nothing is charged, but your maximum stays locked until the refund window opens.
            </p>
          ) : null}
          {stance === "accepts" ? (
            <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-200" data-testid="rate-job-accepts">
              This provider says it takes rated jobs.
            </p>
          ) : null}

          <details className="rounded-lg border border-white/10 bg-black/20 p-3">
            <summary className="cursor-pointer text-gray-200">Advanced: name a judge (optional)</summary>
            <div className="mt-2 space-y-2">
              <p className="text-gray-400">
                A judge is a registered attestation agent that may score this job on five measures after it is paid. Only the address you name here can do so, and you confirm or dispute what it records. Leave empty for no judge.
              </p>
              <input
                className="w-full rounded-lg border border-border bg-page px-3 py-2 font-mono text-xs text-white"
                placeholder="Judge wallet address"
                value={judge}
                disabled={disabled}
                onChange={(event) => onJudgeChange(event.target.value)}
                aria-invalid={judgeError ? true : undefined}
                aria-label="Judge wallet address"
                data-testid="rate-job-judge"
              />
              {judgeError ? (
                <p className="text-red-300" role="alert">
                  {judgeError}
                </p>
              ) : null}
            </div>
          </details>
        </div>
      ) : null}
    </div>
  );
}
