/**
 * The sandbox provider's own rating of the buyer, for metered escrows it was
 * configured to accept although they are rated (#842). Server-side only.
 *
 * A provider that settles a rated escrow has agreed to be rated: it must then
 * commit and reveal a rating of the buyer within the windows, or lose
 * reputation points. This does both with the devnet key the server already
 * holds for the provider's settle (`settle-signer.ts`), under a fixed policy:
 * every buyer whose payment settled gets the same score (10 unless the
 * operator configures another).
 *
 * The salt is not kept in a separate store that could be lost: it is
 * HMAC-SHA256(provider secret key, rating address), so the server can always
 * recompute it for as long as it holds the key it needs to sign the reveal
 * anyway. It never leaves the server and is different for every job.
 *
 * Off unless the sandbox is run with rated escrows accepted
 * (`SANDBOX_ACCEPT_RATED_ESCROWS=true`, see `runtime.ts`).
 */
import { createHmac } from "node:crypto";
import { Keypair, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import {
  buildCommitRatingInstruction,
  buildRevealRatingInstruction,
  decodeRatingAccount,
  RATING_ACCOUNT_LEN,
  RATING_COMMIT_SLOTS,
  RATING_REVEAL_SLOTS,
  ratingCommitment,
  ratingPda,
  type RatingAccount,
} from "@reddi/x402-solana/rating";

export const SELLER_RATING_DEFAULT_SCORE = 10;
export const SELLER_RATING_SCORE_ENV = "SANDBOX_SELLER_RATING_SCORE";
export const ACCEPT_RATED_ESCROWS_ENV = "SANDBOX_ACCEPT_RATED_ESCROWS";
/** Offset of `specialist` in a rating account: discriminator, escrow, consumer. */
const SPECIALIST_OFFSET = 72;

/** The score the provider gives a buyer whose payment settled: the configured whole number from 1 to 10, else 10. */
export function sellerRatingScore(raw: string | undefined): number {
  const value = Number((raw ?? "").trim());
  return Number.isInteger(value) && value >= 1 && value <= 10 ? value : SELLER_RATING_DEFAULT_SCORE;
}

export function acceptRatedEscrowsConfigured(raw: string | undefined): boolean {
  return (raw ?? "").trim().toLowerCase() === "true";
}

/** The provider's salt for one rating, recomputed from its key. */
export function sellerRatingSalt(secretKey: Uint8Array, rating: PublicKey): Uint8Array {
  return Uint8Array.from(createHmac("sha256", Buffer.from(secretKey)).update("reddi-seller-rating-salt:v1").update(rating.toBuffer()).digest());
}

/** The part of a `Connection` the seller's rating steps use. */
export interface SellerRatingConnection {
  getAccountInfo(address: PublicKey, commitment?: "confirmed"): Promise<{ owner: PublicKey; data: Uint8Array } | null>;
  getSlot(commitment?: "confirmed"): Promise<number>;
  getProgramAccounts(programId: PublicKey, config: { commitment: "confirmed"; filters: ({ dataSize: number } | { memcmp: { offset: number; bytes: string } })[] }): Promise<readonly { pubkey: PublicKey; account: { data: Uint8Array } }[]>;
  getLatestBlockhash(commitment?: "confirmed"): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  sendRawTransaction(raw: Uint8Array | Buffer, options?: { preflightCommitment: "confirmed" }): Promise<string>;
  confirmTransaction(strategy: { signature: string; blockhash: string; lastValidBlockHeight: number }, commitment?: "confirmed"): Promise<{ value: { err: unknown } }>;
}

export type SellerRatingStep =
  | { action: "committed" | "revealed"; rating: string; signature: string }
  | { action: "none"; rating: string; reason: "not_ours" | "not_paid" | "waiting_for_buyer" | "already_done" | "deadline_passed" | "final" | "commitment_unknown" }
  | { action: "failed"; rating: string; message: string };

const equalBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, index) => byte === b[index]);

/**
 * What the provider should do next on a rating, if anything. Pure. For a
 * reveal, the score is the one whose commitment under the provider's salt is
 * on chain, so a change of the configured score between commit and reveal
 * does not break the reveal.
 */
export function sellerRatingPlan(
  rating: RatingAccount,
  input: { programId: PublicKey; keypair: Keypair; score: number; currentSlot: bigint },
): { step: "commit" | "reveal"; instruction: TransactionInstruction } | { step: "none"; reason: Extract<SellerRatingStep, { action: "none" }>["reason"] } {
  const seller = input.keypair.publicKey;
  if (!rating.specialist.equals(seller)) return { step: "none", reason: "not_ours" };
  const address = ratingPda(rating.escrow, input.programId);
  const salt = sellerRatingSalt(input.keypair.secretKey, address);
  switch (rating.state) {
    case "awaiting_settlement":
      return { step: "none", reason: "not_paid" };
    case "open":
      if (rating.specialistCommitment) return { step: "none", reason: "waiting_for_buyer" };
      if (input.currentSlot > rating.settledSlot + RATING_COMMIT_SLOTS) return { step: "none", reason: "deadline_passed" };
      return {
        step: "commit",
        instruction: buildCommitRatingInstruction({ programId: input.programId, escrow: rating.escrow, signer: seller, commitment: ratingCommitment(address, seller, input.score, salt) }),
      };
    case "both_committed": {
      if (rating.specialistScore !== undefined) return { step: "none", reason: "already_done" };
      if (input.currentSlot > rating.committedSlot + RATING_REVEAL_SLOTS) return { step: "none", reason: "deadline_passed" };
      const committed = rating.specialistCommitment;
      const score = committed ? Array.from({ length: 10 }, (_, index) => index + 1).find((candidate) => equalBytes(ratingCommitment(address, seller, candidate, salt), committed)) : undefined;
      // A commitment made with another key or salt: this server cannot open it.
      if (score === undefined) return { step: "none", reason: "commitment_unknown" };
      return {
        step: "reveal",
        instruction: buildRevealRatingInstruction({ programId: input.programId, escrow: rating.escrow, signer: seller, consumer: rating.consumer, specialist: rating.specialist, score, salt }),
      };
    }
    default:
      return { step: "none", reason: "final" };
  }
}

async function signAndSend(connection: SellerRatingConnection, keypair: Keypair, instruction: TransactionInstruction): Promise<string> {
  const latest = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({ feePayer: keypair.publicKey, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }).add(instruction);
  transaction.sign(keypair);
  const signature = await connection.sendRawTransaction(transaction.serialize(), { preflightCommitment: "confirmed" });
  const confirmation = await connection.confirmTransaction({ signature, ...latest }, "confirmed");
  if (confirmation.value.err) throw new Error("the transaction failed on chain");
  return signature;
}

/** Takes the provider's next step on one job's rating: commit after the settle, reveal once the buyer has committed too. Never throws. */
export async function advanceSellerRating(input: { connection: SellerRatingConnection; programId: PublicKey; escrow: PublicKey; keypair: Keypair; score: number }): Promise<SellerRatingStep> {
  const address = ratingPda(input.escrow, input.programId);
  const rating = address.toBase58();
  try {
    const [account, slot] = await Promise.all([input.connection.getAccountInfo(address, "confirmed"), input.connection.getSlot("confirmed")]);
    if (!account || !account.owner.equals(input.programId)) return { action: "none", rating, reason: "final" };
    const decoded = decodeRatingAccount(account.data);
    if (!decoded.escrow.equals(input.escrow)) return { action: "none", rating, reason: "not_ours" };
    const plan = sellerRatingPlan(decoded, { programId: input.programId, keypair: input.keypair, score: input.score, currentSlot: BigInt(slot) });
    if (plan.step === "none") return { action: "none", rating, reason: plan.reason };
    const signature = await signAndSend(input.connection, input.keypair, plan.instruction);
    return { action: plan.step === "commit" ? "committed" : "revealed", rating, signature };
  } catch (error) {
    return { action: "failed", rating, message: error instanceof Error ? error.message : "unknown error" };
  }
}

/**
 * Finds every rating that names one of the provider keys as its specialist
 * and takes the next step on each. Run on a schedule: it commits anything the
 * settle-time commit missed and reveals once the buyer has committed. Ratings
 * that need nothing are left out of the result.
 */
export async function sweepSellerRatings(input: { connection: SellerRatingConnection; programId: PublicKey; keypairs: readonly Keypair[]; score: number }): Promise<SellerRatingStep[]> {
  const steps: SellerRatingStep[] = [];
  for (const keypair of input.keypairs) {
    let accounts: readonly { pubkey: PublicKey; account: { data: Uint8Array } }[];
    try {
      accounts = await input.connection.getProgramAccounts(input.programId, {
        commitment: "confirmed",
        filters: [{ dataSize: RATING_ACCOUNT_LEN }, { memcmp: { offset: SPECIALIST_OFFSET, bytes: keypair.publicKey.toBase58() } }],
      });
    } catch (error) {
      steps.push({ action: "failed", rating: "", message: error instanceof Error ? error.message : "could not list ratings" });
      continue;
    }
    for (const { account } of accounts) {
      let escrow: PublicKey;
      try {
        escrow = decodeRatingAccount(account.data).escrow;
      } catch {
        continue;
      }
      const step = await advanceSellerRating({ connection: input.connection, programId: input.programId, escrow, keypair, score: input.score });
      if (step.action !== "none") steps.push(step);
    }
  }
  return steps;
}
