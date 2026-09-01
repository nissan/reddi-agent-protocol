import "server-only";

/**
 * On-chain reputation signal wiring for planner feedback.
 *
 * Commit-reveal lifecycle:
 * 1. commit_rating   — blind commitment
 * 2. reveal_rating   — reveal score + salt to finalise and apply reputation update
 *
 * Legacy Anchor commitment hash: sha256(score_u8 || salt_bytes32)
 * Quasar commitment hash: sha256(score_u8 || salt_bytes32 || job_id_bytes16 || reputation_program_id)
 * Rating PDA seeds: [b"rating", job_id_bytes16]
 */

import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
  SystemProgram, sendAndConfirmTransaction,
} from "@solana/web3.js";
import { createHash, randomBytes } from "crypto";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { DEVNET_RPC, ESCROW_PROGRAM_ID, REPUTATION_PROGRAM_ID, RATING_SEED, AGENT_SEED, IX, PROGRAM_TARGET } from "@/lib/program";
import {
  buildQuasarCommitRatingInstruction,
  buildQuasarRevealRatingInstruction,
  quasarAgentPda,
  quasarRatingCommitment,
  quasarRatingPda,
} from "@/lib/quasar/instructions";
import { resolveOnboardingQuasarEscrow } from "@/lib/onboarding/quasar-escrow-binding";
import { emitTorqueEvent } from "@/lib/torque/client";
import { TORQUE_EVENTS } from "@/lib/torque/events";

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
  escrowAddress?: string;
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

function writeCommits(entries: CommitEntry[]) {
  mkdirSync(join(process.cwd(), "data", "onboarding"), { recursive: true });
  writeFileSync(COMMIT_STORE_PATH, JSON.stringify(entries, null, 2));
}

// ── Key helpers ───────────────────────────────────────────────────────────────

function loadOperatorKeypair(): Keypair | null {
  const raw = process.env.ONBOARDING_ATTEST_OPERATOR_SECRET_KEY;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return Keypair.fromSecretKey(Uint8Array.from(parsed));
  } catch { /* not a JSON byte array */ }
  return null;
}

/** Stable 16-byte job_id derived from runId. */
function jobIdFromRunId(runId: string): Uint8Array {
  return createHash("sha256").update(runId).digest().subarray(0, 16);
}

/**
 * Rating PDA: seeds = [b"rating", job_id(16)]
 * (matches programs/escrow/src/instructions/commit_rating.rs)
 */
function ratingPdaFor(jobId: Uint8Array, escrow?: PublicKey): PublicKey {
  if (PROGRAM_TARGET === "quasar") {
    if (!escrow) throw new Error("quasar_rating_requires_escrow");
    return quasarRatingPda(escrow, REPUTATION_PROGRAM_ID);
  }
  return PublicKey.findProgramAddressSync(
    [Buffer.from(RATING_SEED), Buffer.from(jobId)],
    ESCROW_PROGRAM_ID
  )[0];
}

/**
 * AgentAccount PDA: seeds = [b"agent", agent_pubkey(32)].
 * Quasar reveal constrains specialist_agent/consumer_agent against the *reputation* program's own
 * AgentAccount (experiments/quasar-reputation/src/state.rs), a namespace distinct from the registry's.
 */
function agentPdaFor(agentPubkey: PublicKey): PublicKey {
  if (PROGRAM_TARGET === "quasar") {
    return quasarAgentPda(agentPubkey, REPUTATION_PROGRAM_ID);
  }
  return PublicKey.findProgramAddressSync(
    [Buffer.from(AGENT_SEED), agentPubkey.toBytes()],
    ESCROW_PROGRAM_ID
  )[0];
}

// ── Instruction data builders ─────────────────────────────────────────────────

/**
 * commit_rating ix data:
 * discriminator(8) + job_id(16) + commitment(32) + role(1 borsh enum)
 * + consumer_pk(32) + specialist_pk(32)
 * RatingRole: Consumer=0, Specialist=1
 */
function buildCommitRatingData(
  jobId: Uint8Array,
  commitHash: Uint8Array,
  role: 0 | 1,
  consumerPk: PublicKey,
  specialistPk: PublicKey
): Buffer {
  const buf = Buffer.alloc(8 + 16 + 32 + 1 + 32 + 32);
  let o = 0;
  IX.commit_rating.copy(buf, o); o += 8;
  Buffer.from(jobId).copy(buf, o); o += 16;
  Buffer.from(commitHash).copy(buf, o); o += 32;
  buf.writeUInt8(role, o); o += 1;
  Buffer.from(consumerPk.toBytes()).copy(buf, o); o += 32;
  Buffer.from(specialistPk.toBytes()).copy(buf, o);
  return buf;
}

/**
 * reveal_rating ix data:
 * discriminator(8) + job_id(16) + score(1) + salt(32)
 */
function buildRevealRatingData(
  jobId: Uint8Array,
  score: number,
  salt: Uint8Array
): Buffer {
  const buf = Buffer.alloc(8 + 16 + 1 + 32);
  let o = 0;
  IX.reveal_rating.copy(buf, o); o += 8;
  Buffer.from(jobId).copy(buf, o); o += 16;
  buf.writeUInt8(score, o); o += 1;
  Buffer.from(salt).copy(buf, o);
  return buf;
}

// ── Public API ────────────────────────────────────────────────────────────────

export type ReputationCommitResult =
  | { ok: true; commitHash: string; txSignature: string; ratingPda: string; trace: string[] }
  | { ok: false; error: string; trace: string[] };

export type ReputationRevealResult =
  | { ok: true; txSignature: string; trace: string[] }
  | { ok: false; error: string; trace: string[] };

/**
 * Commit a blind reputation rating on-chain for a completed planner run.
 * Stores salt+score locally for later reveal.
 */
export async function commitReputationRating(
  runId: string,
  score: number,
  specialistWallet: string
): Promise<ReputationCommitResult> {
  const trace: string[] = [];

  const operator = loadOperatorKeypair();
  if (!operator) {
    trace.push("reputation:operator_key_missing");
    return {
      ok: false,
      error: "ONBOARDING_ATTEST_OPERATOR_SECRET_KEY not configured — skipping on-chain reputation commit.",
      trace,
    };
  }

  trace.push(`reputation:operator=${operator.publicKey.toBase58()}`);

  let specialistPubkey: PublicKey;
  try {
    specialistPubkey = new PublicKey(specialistWallet);
  } catch {
    return { ok: false, error: `Invalid specialist wallet: ${specialistWallet}`, trace };
  }

  const jobId = jobIdFromRunId(runId);

  // Quasar binds every rating to the escrow account a lock created: the rating PDA is seeded by the
  // escrow address and both parties are read from escrow.payer/escrow.payee. Onboarding never locks
  // one, so no verified lock record exists and this refuses until canonical lock output is supplied.
  let escrow: PublicKey | undefined;
  if (PROGRAM_TARGET === "quasar") {
    try {
      escrow = resolveOnboardingQuasarEscrow({
        lockRecord: undefined,
        expected: {
          consumer: operator.publicKey,
          specialist: specialistPubkey,
          escrowProgramId: ESCROW_PROGRAM_ID,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      trace.push(`reputation:quasar_escrow_rejected=${message}`);
      return { ok: false, error: message, trace };
    }
    trace.push(`reputation:escrow=${escrow.toBase58()}`);
  }

  // salt: 32 random bytes
  const salt = randomBytes(32);
  const commitHash = PROGRAM_TARGET === "quasar"
    ? Buffer.from(quasarRatingCommitment(score, salt, escrow!, REPUTATION_PROGRAM_ID))
    : createHash("sha256").update(Buffer.from([score])).update(salt).digest();
  const commitHashHex = commitHash.toString("hex");
  const saltHex = salt.toString("hex");

  trace.push(`reputation:job_id=${Buffer.from(jobId).toString("hex")}`);
  trace.push(`reputation:commit_hash=${commitHashHex.slice(0, 16)}...`);

  const rPda = ratingPdaFor(jobId, escrow);
  trace.push(`reputation:rating_pda=${rPda.toBase58()}`);

  // Role 0 = Consumer (orchestrator/operator commits as consumer side)
  const ix = PROGRAM_TARGET === "quasar"
    ? buildQuasarCommitRatingInstruction({
        programId: REPUTATION_PROGRAM_ID,
        escrow: escrow!,
        signer: operator.publicKey,
        commitment: commitHash,
        role: 0,
        ratingPda: rPda,
      })
    : new TransactionInstruction({
        programId: ESCROW_PROGRAM_ID,
        keys: [
          { pubkey: rPda, isSigner: false, isWritable: true },
          { pubkey: operator.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: buildCommitRatingData(
          jobId,
          commitHash,
          0,
          operator.publicKey,
          specialistPubkey
        ),
      });

  try {
    const conn = new Connection(DEVNET_RPC, "confirmed");
    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(conn, tx, [operator], {
      commitment: "confirmed",
      maxRetries: 2,
    });
    trace.push(`reputation:commit_tx=${sig}`);
    console.log(
      `[REPUTATION_EVENT] mint: job=${Buffer.from(jobId).toString("hex")} specialist=${specialistWallet} score=${score} tx=${sig}`
    );

    // Persist commit entry for later reveal
    const entry: CommitEntry = {
      runId,
      jobIdHex: Buffer.from(jobId).toString("hex"),
      score,
      saltHex,
      commitHashHex,
      specialistWallet,
      escrowAddress: escrow?.toBase58(),
      ratingPda: rPda.toBase58(),
      commitTx: sig,
      createdAt: new Date().toISOString(),
      revealed: false,
    };
    const commits = readCommits();
    commits.push(entry);
    writeCommits(commits);

    void emitTorqueEvent({
      userPubkey: operator.publicKey.toBase58(),
      eventName: TORQUE_EVENTS.RATING_SUBMITTED,
      fields: {
        jobId: Buffer.from(jobId).toString("hex"),
        score,
        txSignature: sig,
      },
    });

    return { ok: true, commitHash: commitHashHex, txSignature: sig, ratingPda: rPda.toBase58(), trace };
  } catch (err) {
    trace.push(`reputation:commit_error:${err instanceof Error ? err.message : String(err)}`);
    return {
      ok: false,
      error: `On-chain commit_rating failed: ${err instanceof Error ? err.message : String(err)}`,
      trace,
    };
  }
}

/**
 * Reveal a committed reputation rating on-chain.
 * Requires both parties to have committed first (RatingState::BothCommitted).
 * Reads the stored commit entry for salt + score.
 */
export async function revealReputationRating(runId: string): Promise<ReputationRevealResult> {
  const trace: string[] = [];

  const operator = loadOperatorKeypair();
  if (!operator) {
    trace.push("reputation:operator_key_missing");
    return {
      ok: false,
      error: "ONBOARDING_ATTEST_OPERATOR_SECRET_KEY not configured.",
      trace,
    };
  }

  const commits = readCommits();
  const entry = commits.find((e) => e.runId === runId && !e.revealed);
  if (!entry) {
    return {
      ok: false,
      error: `No unrevealed commit found for runId: ${runId}`,
      trace,
    };
  }

  trace.push(`reputation:reveal:job_id=${entry.jobIdHex}`);
  trace.push(`reputation:reveal:rating_pda=${entry.ratingPda}`);

  const jobId = Buffer.from(entry.jobIdHex, "hex");
  const salt = Buffer.from(entry.saltHex, "hex");
  const score = entry.score;
  const rPda = new PublicKey(entry.ratingPda);

  let specialistPubkey: PublicKey;
  let consumerPubkey: PublicKey;
  try {
    specialistPubkey = new PublicKey(entry.specialistWallet);
    consumerPubkey = operator.publicKey;
  } catch {
    return { ok: false, error: `Invalid stored wallet in commit entry.`, trace };
  }

  let revealEscrow: PublicKey | undefined;
  if (PROGRAM_TARGET === "quasar") {
    try {
      revealEscrow = resolveOnboardingQuasarEscrow({
        lockRecord: undefined,
        expected: {
          consumer: consumerPubkey,
          specialist: specialistPubkey,
          escrowProgramId: ESCROW_PROGRAM_ID,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message, trace };
    }
    trace.push(`reputation:reveal:escrow=${revealEscrow.toBase58()}`);
  }

  const specialistAgentPda = agentPdaFor(specialistPubkey);
  const consumerAgentPda = agentPdaFor(consumerPubkey);

  const ix = PROGRAM_TARGET === "quasar"
    ? buildQuasarRevealRatingInstruction({
        programId: REPUTATION_PROGRAM_ID,
        escrow: revealEscrow!,
        signer: operator.publicKey,
        score,
        salt,
        specialistAgentPda,
        consumerAgentPda,
        ratingPda: rPda,
      })
    : new TransactionInstruction({
        programId: ESCROW_PROGRAM_ID,
        keys: [
          { pubkey: rPda, isSigner: false, isWritable: true },
          { pubkey: operator.publicKey, isSigner: true, isWritable: false },
          { pubkey: specialistAgentPda, isSigner: false, isWritable: true },
          { pubkey: consumerAgentPda, isSigner: false, isWritable: true },
        ],
        data: buildRevealRatingData(jobId, score, salt),
      });

  try {
    const conn = new Connection(DEVNET_RPC, "confirmed");
    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(conn, tx, [operator], {
      commitment: "confirmed",
      maxRetries: 2,
    });
    trace.push(`reputation:reveal_tx=${sig}`);
    const consumerScore = score;
    const specialistScore = "pending";
    const newReputation = "updated";
    console.log(
      `[REPUTATION_EVENT] reveal: job=${entry.jobIdHex} consumer_score=${consumerScore} specialist_score=${specialistScore} new_reputation=${newReputation ?? "updated"}`
    );

    // Mark as revealed
    const idx = commits.findIndex((e) => e.runId === runId && !e.revealed);
    if (idx >= 0) {
      commits[idx].revealed = true;
      commits[idx].revealTx = sig;
      writeCommits(commits);
    }

    return { ok: true, txSignature: sig, trace };
  } catch (err) {
    trace.push(`reputation:reveal_error:${err instanceof Error ? err.message : String(err)}`);
    return {
      ok: false,
      error: `On-chain reveal_rating failed: ${err instanceof Error ? err.message : String(err)}`,
      trace,
    };
  }
}

/** List stored commits (for debugging / UI status). */
export function listReputationCommits() {
  return { ok: true, commits: readCommits() };
}
