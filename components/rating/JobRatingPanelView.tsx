"use client";

import type { AttestationAccount, RatingAccount } from "@redditech/x402-solana/rating";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RATINGS_DOC_PATH } from "@/lib/rating/reputation-display";
import { estimatedSlotDate, expiredOutcomeText, MISSED_STEP_PENALTY_POINTS, RATING_RENT_SOL, timeLeftLabel, type RatingView } from "@/lib/rating/rating-state";

export const ATTESTATION_SCORE_LABELS = ["Accuracy", "Completeness", "Relevance", "Format", "Latency"] as const;

export type RatingBusy = "commit" | "reveal" | "expire" | "close" | "confirm" | "dispute";

export interface JobRatingPanelViewProps {
  escrow: string;
  /** The on-chain rating account, or undefined when the escrow has none. */
  rating?: RatingAccount;
  attestation?: AttestationAccount;
  view: RatingView;
  currentSlot: bigint;
  /** When `currentSlot` was read, in ms. Deadline dates are estimated from it. */
  readAtMs: number;
  /** The score picked but not yet committed; 0 while none is picked. */
  score: number;
  onScoreChange?: (score: number) => void;
  /** A salt backup can be downloaded for this job. */
  backupAvailable?: boolean;
  busy?: RatingBusy;
  /** The result of the last step, or why it did not happen. */
  notice?: { tone: "ok" | "error"; text: string };
  onCommit?: () => void;
  onReveal?: () => void;
  onExpire?: () => void;
  onClose?: () => void;
  onDownloadBackup?: () => void;
  onImportBackup?: () => void;
  onResolveAttestation?: (action: "confirm" | "dispute") => void;
  onRefresh?: () => void;
  formatDate?: (date: Date) => string;
}

function short(address: string): string {
  return address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

const PHASE_LABEL: Record<RatingView["phase"], string> = {
  none: "No rating",
  awaiting_payment: "Waiting for payment",
  commit: "Submit scores",
  reveal: "Reveal scores",
  revealed: "Rated",
  expired: "Expired",
};

function Deadline({ label, slot, currentSlot, readAtMs, formatDate }: { label: string; slot: bigint; currentSlot: bigint; readAtMs: number; formatDate: (date: Date) => string }) {
  return (
    <p className="text-xs text-gray-400" data-testid="rating-deadline">
      {label}: <span className="text-gray-200">{formatDate(estimatedSlotDate(slot, currentSlot, readAtMs))}</span> ({timeLeftLabel(slot, currentSlot)}; estimated from slot {slot.toString()})
    </p>
  );
}

function Step({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <span aria-hidden className={done ? "text-emerald-300" : "text-gray-500"}>
        {done ? "●" : "○"}
      </span>
      <span className={done ? "text-gray-200" : "text-gray-400"}>{children}</span>
    </li>
  );
}

/** The state of one job's rating and the steps open to the connected wallet. Presentation only. */
export function JobRatingPanelView(props: JobRatingPanelViewProps) {
  const { view, rating, attestation, currentSlot, readAtMs, busy } = props;
  const formatDate = props.formatDate ?? ((date: Date) => date.toLocaleString());
  const you = view.role === "buyer" ? "buyer" : view.role === "seller" ? "provider" : undefined;
  const other = view.role === "seller" ? "buyer" : "provider";
  const otherCommitted = view.role === "seller" ? view.buyerCommitted : view.sellerCommitted;
  const otherRevealed = view.role === "seller" ? view.buyerRevealed : view.sellerRevealed;

  return (
    <div className="space-y-4 rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-gray-300" data-testid="job-rating-panel" data-phase={view.phase}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium text-white">Job rating</h3>
          <Badge variant="outline" className={view.phase === "revealed" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : view.phase === "expired" ? "border-amber-500/30 bg-amber-500/10 text-amber-200" : "border-white/10 bg-white/5 text-gray-200"}>
            {PHASE_LABEL[view.phase]}
          </Badge>
          {you ? (
            <Badge variant="outline" className="border-white/10 bg-white/5 text-gray-300">
              You are the {you}
            </Badge>
          ) : null}
        </div>
        {props.onRefresh ? (
          <Button size="xs" variant="ghost" onClick={props.onRefresh}>
            Refresh
          </Button>
        ) : null}
      </div>

      <p className="font-mono text-xs text-gray-500">
        escrow {short(props.escrow)}
        {rating ? ` · provider ${short(rating.specialist.toBase58())}` : ""}
        {rating?.judge ? ` · judge ${short(rating.judge.toBase58())}` : ""}
      </p>

      {view.phase === "none" ? (
        <p data-testid="rating-none">
          There is no rating for this job. It was paid without rating, was refunded, was released before the provider agreed to be rated, or its rating has been closed and the rent returned.
        </p>
      ) : null}

      {view.phase === "awaiting_payment" ? (
        <div className="space-y-2" data-testid="rating-awaiting">
          <p>
            Provider agreed to be rated:{" "}
            <span className={view.accepted ? "text-emerald-300" : "text-amber-200"} data-testid="rating-accepted">
              {view.accepted ? "yes" : "not yet"}
            </span>
          </p>
          <p className="text-xs leading-5 text-gray-400">The rating opens when the job is paid. A provider that settles or claims the payment itself has agreed by doing so.</p>
          {!view.releaseOpensRating ? (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100" role="alert" data-testid="rating-release-warning">
              If you release this payment yourself now, the provider is paid in full but the job closes without a rating, and your rent comes back. To keep the rating, wait until the provider has agreed, or leave the provider to collect the payment.
            </p>
          ) : (
            <p className="text-xs leading-5 text-emerald-200">The provider has agreed, so the rating opens whoever pays out the escrow.</p>
          )}
        </div>
      ) : null}

      {view.phase === "commit" && rating ? (
        <div className="space-y-3" data-testid="rating-commit">
          <ul className="space-y-1 text-xs">
            <Step done={view.role === "seller" ? view.sellerCommitted : view.buyerCommitted}>{you ? "Your score submitted (hidden)" : "Buyer's score submitted (hidden)"}</Step>
            <Step done={otherCommitted}>{you ? `The ${other}'s score submitted (hidden)` : "Provider's score submitted (hidden)"}</Step>
          </ul>
          {view.deadlineSlot !== undefined ? <Deadline label="Submit by" slot={view.deadlineSlot} currentSlot={currentSlot} readAtMs={readAtMs} formatDate={formatDate} /> : null}
          {view.can.commit ? (
            <div className="space-y-3">
              <fieldset>
                <legend className="text-xs text-gray-400">Your score for the {other} (1 is worst, 10 is best)</legend>
                <div className="mt-2 flex flex-wrap gap-1" role="radiogroup" aria-label="Score from 1 to 10">
                  {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={props.score === value}
                      disabled={busy !== undefined}
                      onClick={() => props.onScoreChange?.(value)}
                      className={`h-8 w-8 rounded-lg border text-sm transition ${props.score === value ? "border-indigo-400 bg-indigo-500/30 text-white" : "border-white/10 bg-white/5 text-gray-300 hover:border-white/30"}`}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </fieldset>
              <p className="text-xs leading-5 text-gray-400">
                Your score stays hidden until both sides have submitted. This browser stores a secret value (the salt) that you need to reveal it later. It never leaves this browser. If it is lost you cannot reveal, and you lose {MISSED_STEP_PENALTY_POINTS} reputation points: download the backup after you submit.
              </p>
              <Button size="sm" disabled={busy !== undefined || props.score < 1} onClick={props.onCommit} data-testid="rating-commit-button">
                {busy === "commit" ? "Waiting for your wallet…" : props.score < 1 ? "Choose a score" : `Submit score ${props.score}`}
              </Button>
            </div>
          ) : null}
          {view.youCommitted && !view.deadlinePassed ? <p className="text-xs leading-5 text-gray-400">Your score is in. Waiting for the {other} to submit theirs; then both of you reveal.</p> : null}
          {view.deadlinePassed ? <p className="text-xs leading-5 text-amber-200">The deadline to submit has passed. The rating can now be expired, which gives it its final result.</p> : null}
        </div>
      ) : null}

      {view.phase === "reveal" && rating ? (
        <div className="space-y-3" data-testid="rating-reveal">
          <ul className="space-y-1 text-xs">
            <Step done={view.role === "seller" ? view.sellerRevealed : view.buyerRevealed}>{you ? "Your score revealed" : "Buyer's score revealed"}</Step>
            <Step done={otherRevealed}>{you ? `The ${other}'s score revealed` : "Provider's score revealed"}</Step>
          </ul>
          {view.deadlineSlot !== undefined ? <Deadline label="Reveal by" slot={view.deadlineSlot} currentSlot={currentSlot} readAtMs={readAtMs} formatDate={formatDate} /> : null}
          {view.can.reveal ? (
            <Button size="sm" disabled={busy !== undefined} onClick={props.onReveal} data-testid="rating-reveal-button">
              {busy === "reveal" ? "Waiting for your wallet…" : "Reveal my score"}
            </Button>
          ) : null}
          {view.revealBlocked === "salt_missing" ? (
            <div className="space-y-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs leading-5 text-red-200" role="alert" data-testid="rating-salt-missing">
              <p>
                This browser does not hold the salt for your commitment, so it cannot reveal your score. Import the backup file you downloaded when you submitted. Without it you cannot reveal, and at the deadline you lose {MISSED_STEP_PENALTY_POINTS} reputation points.
              </p>
              {props.onImportBackup ? (
                <Button size="xs" variant="outline" onClick={props.onImportBackup}>
                  Import backup file
                </Button>
              ) : null}
            </div>
          ) : null}
          {view.youRevealed && !view.deadlinePassed ? <p className="text-xs leading-5 text-gray-400">Your score is revealed. Waiting for the {other} to reveal theirs.</p> : null}
          {view.deadlinePassed ? <p className="text-xs leading-5 text-amber-200">The deadline to reveal has passed. The rating can now be expired, which gives it its final result.</p> : null}
        </div>
      ) : null}

      {view.phase === "revealed" ? (
        <div className="grid gap-3 sm:grid-cols-2" data-testid="rating-final">
          <div className="rounded-lg border border-white/10 bg-white/5 p-3">
            <p className="text-xs text-gray-500">Buyer rated the provider</p>
            <p className="mt-1 text-lg text-white">{view.buyerScore ?? "–"} / 10</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-3">
            <p className="text-xs text-gray-500">Provider rated the buyer</p>
            <p className="mt-1 text-lg text-white">{view.sellerScore ?? "–"} / 10</p>
          </div>
        </div>
      ) : null}

      {view.phase === "expired" && view.expiredOutcome ? (
        <div className="space-y-2" data-testid="rating-expired">
          <p>{expiredOutcomeText(view.expiredOutcome, view.role)}</p>
          {view.buyerScore !== undefined || view.sellerScore !== undefined ? (
            <p className="text-xs text-gray-400">
              Revealed: {view.buyerScore !== undefined ? `buyer gave ${view.buyerScore} / 10` : ""}
              {view.sellerScore !== undefined ? `provider gave ${view.sellerScore} / 10` : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      {view.can.expire ? (
        <Button size="sm" variant="outline" disabled={busy !== undefined} onClick={props.onExpire} data-testid="rating-expire-button">
          {busy === "expire" ? "Waiting for your wallet…" : "Expire rating"}
        </Button>
      ) : null}

      {view.can.close ? (
        <div className="space-y-2">
          <p className="text-xs leading-5 text-gray-400">
            The rating is final. Reclaiming the rent closes the record and returns about {RATING_RENT_SOL} SOL to your wallet.
            {rating?.judge && !rating.attested ? " The judge you named has not attested this job, and cannot once the record is closed." : ""}
          </p>
          <Button size="sm" variant="outline" disabled={busy !== undefined} onClick={props.onClose} data-testid="rating-close-button">
            {busy === "close" ? "Waiting for your wallet…" : "Reclaim rent"}
          </Button>
        </div>
      ) : null}

      {props.backupAvailable && (view.phase === "commit" || view.phase === "reveal") ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400" data-testid="rating-backup">
          <Button size="xs" variant="outline" onClick={props.onDownloadBackup}>
            Download salt backup
          </Button>
          <span>Keep it private until you have revealed.</span>
        </div>
      ) : null}

      {rating?.judge ? (
        <div className="space-y-3 border-t border-white/10 pt-3" data-testid="rating-attestation">
          <h4 className="text-xs font-medium uppercase tracking-wider text-gray-500">Judge attestation</h4>
          {attestation ? (
            <>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {ATTESTATION_SCORE_LABELS.map((label, index) => (
                  <div key={label} className="rounded-lg border border-white/10 bg-white/5 p-2 text-center">
                    <dt className="text-[11px] text-gray-500">{label}</dt>
                    <dd className="mt-1 text-base text-white">{attestation.scores[index]} / 10</dd>
                  </div>
                ))}
              </dl>
              {attestation.resolution === "pending" ? (
                view.role === "buyer" ? (
                  <div className="space-y-2">
                    <p className="text-xs leading-5 text-gray-400">
                      Do these scores match what you received? Confirming raises the judge&apos;s accuracy record; disputing lowers its reputation. Either choice is final.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" disabled={busy !== undefined} onClick={() => props.onResolveAttestation?.("confirm")} data-testid="attestation-confirm-button">
                        {busy === "confirm" ? "Waiting for your wallet…" : "Confirm attestation"}
                      </Button>
                      <Button size="sm" variant="destructive" disabled={busy !== undefined} onClick={() => props.onResolveAttestation?.("dispute")} data-testid="attestation-dispute-button">
                        {busy === "dispute" ? "Waiting for your wallet…" : "Dispute attestation"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">Waiting for the buyer to confirm or dispute.</p>
                )
              ) : (
                <p className="text-xs text-gray-300" data-testid="attestation-resolution">
                  The buyer {attestation.resolution} this attestation.
                </p>
              )}
            </>
          ) : (
            <p className="text-xs leading-5 text-gray-400">
              {rating.attested
                ? "The judge attested this job and has since closed the record."
                : view.phase === "awaiting_payment"
                  ? "The judge can attest once the job is paid."
                  : "The judge has not attested this job yet."}
            </p>
          )}
        </div>
      ) : null}

      {props.notice ? (
        <p className={`rounded-lg border p-3 text-xs ${props.notice.tone === "ok" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-red-500/30 bg-red-500/10 text-red-200"}`} role="status" data-testid="rating-notice">
          {props.notice.text}
        </p>
      ) : null}

      <p className="text-[11px] leading-4 text-gray-500">
        Read from the rating account on chain. Dates are estimates: deadlines are counted in slots.{" "}
        <a href={RATINGS_DOC_PATH} target="_blank" rel="noopener noreferrer" className="text-indigo-300 hover:text-indigo-200">
          How ratings work
        </a>
      </p>
    </div>
  );
}
