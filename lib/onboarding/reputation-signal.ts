import "server-only";

/**
 * On-chain reputation signal wiring for planner feedback. Fails closed.
 *
 * This used to commit and reveal a rating with a server-held operator key, for a job id derived
 * from the planner run. The V1 program (programs/pinocchio-escrow) accepts a rating only for an
 * escrow the buyer opted in at lock, from the escrow's own payer and payee, and its commitment
 * hash covers the rating address and the signer. An operator key that is neither party, and a run
 * with no opted-in escrow, can do none of that, so both entry points return
 * `RATING_FLOW_UNAVAILABLE_REASON`. The app rating flow (#842) does this from the parties' own
 * wallets instead (`lib/rating`). No key is read, no
 * instruction is built and no RPC is opened. The builders for that flow are in
 * `@reddi/x402-solana/rating`.
 *
 * The refusals keep their order: Quasar target, blocked profile, then this one.
 * `listReputationCommits` still reads commits an earlier build stored.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { PROGRAM_TARGET, SUBMISSION_BLOCKED, SUBMISSION_BLOCKED_REASON } from "@/lib/program";
import { QUASAR_ESCROW_UNAVAILABLE_REASON } from "@/lib/onboarding/quasar-escrow-binding";
import { RATING_FLOW_UNAVAILABLE_REASON } from "@/lib/onboarding/rating-flow-availability";

// ── Commitment store ──────────────────────────────────────────────────────────
// Persists salt + score for later reveal. Keyed by runId.

const COMMIT_STORE_PATH = join(process.cwd(), "data", "onboarding", "rating-commits.json");

type CommitEntry = {
  runId: string;
  jobIdHex: string;
  score: number;
  saltHex: string;
  commitHashHex: string;
  specialistWallet: string;
  ratingPda: string;
  commitTx: string;
  createdAt: string;
  revealed: boolean;
  revealTx?: string;
};

function readCommits(): CommitEntry[] {
  try {
    return JSON.parse(readFileSync(COMMIT_STORE_PATH, "utf8")) as CommitEntry[];
  } catch {
    return [];
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export type ReputationCommitResult =
  | { ok: true; commitHash: string; txSignature: string; ratingPda: string; trace: string[] }
  | { ok: false; error: string; trace: string[] };

export type ReputationRevealResult =
  | { ok: true; txSignature: string; trace: string[] }
  | { ok: false; error: string; trace: string[] };

function refusal(trace: string[]): { ok: false; error: string; trace: string[] } {
  if (PROGRAM_TARGET === "quasar") {
    trace.push(`reputation:quasar_escrow_rejected=${QUASAR_ESCROW_UNAVAILABLE_REASON}`);
    return { ok: false, error: QUASAR_ESCROW_UNAVAILABLE_REASON, trace };
  }
  if (SUBMISSION_BLOCKED) {
    trace.push("reputation:submission_blocked");
    return { ok: false, error: SUBMISSION_BLOCKED_REASON, trace };
  }
  trace.push("reputation:unavailable_until_app_rating_flow");
  return { ok: false, error: RATING_FLOW_UNAVAILABLE_REASON, trace };
}

/** Always refuses; see the note at the top of this file. The buyer commits from its own wallet (`lib/rating/job-rating.ts`). */
export async function commitReputationRating(
  _runId: string,
  _score: number,
  _specialistWallet: string
): Promise<ReputationCommitResult> {
  return refusal([]);
}

/** Always refuses; see the note at the top of this file. The buyer reveals from its own wallet (`lib/rating/job-rating.ts`). */
export async function revealReputationRating(_runId: string): Promise<ReputationRevealResult> {
  return refusal([]);
}

/** List stored commits (for debugging / UI status). */
export function listReputationCommits() {
  return { ok: true, commits: readCommits() };
}
