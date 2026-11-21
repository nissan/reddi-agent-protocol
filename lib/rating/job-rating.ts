/**
 * Reading a job's rating from chain and the wallet-signed steps a party takes
 * on it: commit, reveal, expire, reclaim the rent (#842).
 *
 * Every step is signed by the connected wallet. Nothing here holds a key or
 * calls an app server; the only I/O is the RPC connection and the wallet
 * passed in. The commit stores the salt in the browser before it asks the
 * wallet to sign, and refuses to go on if the browser did not keep it.
 */
import { PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import {
  attestationPda,
  buildCloseRatingInstruction,
  buildCommitRatingInstruction,
  buildConfirmAttestationInstruction,
  buildDisputeAttestationInstruction,
  buildExpireRatingInstruction,
  buildRevealRatingInstruction,
  decodeAttestationAccount,
  decodeRatingAccount,
  ratingPda,
  ratingProgramErrorName,
  type AttestationAccount,
  type RatingAccount,
} from "@reddi/x402-solana/rating";
import { ratingView, type RatingView } from "@/lib/rating/rating-state";
import { findRatedJob, matchingRatingSecret, newRatingSalt, RatingStorageError, storeRatingSecret, type KeyValueStorage } from "@/lib/rating/rating-secrets";

/** The part of a web3.js `Connection` these steps use. */
export interface RatingConnection {
  getAccountInfo(address: PublicKey, commitment?: "confirmed"): Promise<{ owner: PublicKey; data: Uint8Array } | null>;
  getSlot(commitment?: "confirmed"): Promise<number>;
  getLatestBlockhash(commitment?: "confirmed"): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  confirmTransaction(strategy: { signature: string; blockhash: string; lastValidBlockHeight: number }, commitment?: "confirmed"): Promise<{ value: { err: unknown } }>;
}

/** The connected wallet: its address and the adapter's `sendTransaction`. */
export interface RatingWallet<C> {
  publicKey: PublicKey;
  sendTransaction(transaction: Transaction, connection: C): Promise<string>;
}

export interface JobRatingSnapshot {
  escrow: string;
  /** Undefined when there is no rating account for this escrow. */
  rating?: RatingAccount;
  /** The judge's attestation, when one exists. */
  attestation?: AttestationAccount;
  currentSlot: bigint;
  /** When the snapshot was read, for turning slots into dates. */
  readAtMs: number;
}

/** Reads the rating account, the attestation if the job has one, and the current slot. Throws on RPC errors and on an account that is not this program's rating. */
export async function readJobRating(connection: RatingConnection, escrow: PublicKey, programId: PublicKey, now: () => number = Date.now): Promise<JobRatingSnapshot> {
  const [account, slot] = await Promise.all([connection.getAccountInfo(ratingPda(escrow, programId), "confirmed"), connection.getSlot("confirmed")]);
  const snapshot: JobRatingSnapshot = { escrow: escrow.toBase58(), currentSlot: BigInt(slot), readAtMs: now() };
  if (!account) return snapshot;
  if (!account.owner.equals(programId)) throw new Error("The rating account is not held by the escrow program.");
  const rating = decodeRatingAccount(account.data);
  if (!rating.escrow.equals(escrow)) throw new Error("The rating account names another escrow.");
  snapshot.rating = rating;
  if (rating.attested) {
    const attested = await connection.getAccountInfo(attestationPda(escrow, programId), "confirmed");
    // Absent once the judge has closed it: the rating still says the job was attested.
    if (attested && attested.owner.equals(programId)) {
      const attestation = decodeAttestationAccount(attested.data);
      // An attestation left over from an earlier job at this escrow address was made before this
      // rating was opened: only one made in or after the opening slot is this job's.
      if (attestationBelongsToJob(attestation, rating)) snapshot.attestation = attestation;
    }
  }
  return snapshot;
}

/**
 * Whether an attestation account is the one of the job this rating names. The attestation
 * address is ["attestation", escrow], which a later job under the same escrow address reuses, and
 * the attestation does not store the job's opened slot; `attest_quality` needs the rating to be
 * paid, so this job's attestation was created at or after the rating's opened slot, and one from an
 * earlier job (whose rating had to be closed before this one could open) was created before it.
 */
export function attestationBelongsToJob(attestation: AttestationAccount, rating: RatingAccount): boolean {
  return attestation.escrow.equals(rating.escrow) && attestation.consumer.equals(rating.consumer) && rating.judge !== undefined && attestation.judge.equals(rating.judge) && attestation.createdSlot >= rating.openedSlot;
}

/** The view for `wallet`, with the stored secret taken into account. */
export function snapshotView(snapshot: JobRatingSnapshot, wallet: string | undefined, storage: KeyValueStorage | undefined): RatingView {
  const rating = snapshot.rating;
  let hasSecret = false;
  if (rating && wallet && storage) {
    const mine = rating.consumer.toBase58() === wallet ? rating.consumerCommitment : rating.specialist.toBase58() === wallet ? rating.specialistCommitment : undefined;
    hasSecret = matchingRatingSecret(findRatedJob(storage, wallet, snapshot.escrow), { openedSlot: rating.openedSlot, commitment: mine }) !== undefined;
  }
  return ratingView(rating, { currentSlot: snapshot.currentSlot, viewer: wallet, hasSecret });
}

export type RatingStepResult = { ok: true; signature: string } | { ok: false; message: string; signed: boolean };

const refuse = (message: string, signed = false): RatingStepResult => ({ ok: false, message, signed });

const PROGRAM_ERROR_TEXT: Partial<Record<string, string>> = {
  AlreadyCommitted: "This wallet has already committed a score for this job.",
  BothMustCommitFirst: "Both sides must commit before either can reveal.",
  CommitmentMismatch: "The score and salt do not match the commitment on chain.",
  NotExpired: "The deadline has not passed yet.",
  AlreadyFinalised: "This rating is already final.",
  JobNotPaid: "This job has not been paid yet, so it cannot be rated.",
  CommitDeadlinePassed: "The deadline to commit has passed.",
  RevealDeadlinePassed: "The deadline to reveal has passed.",
  AlreadyRevealed: "This wallet has already revealed its score.",
  RatingNotFinal: "The rating is not final yet, so the rent cannot be reclaimed.",
  AttestationAlreadyResolved: "This attestation has already been confirmed or disputed.",
};

/** A sentence for a failed send. Wallet refusals and known program errors are named; anything else gets a general message. */
export function describeSendFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/reject|denied|declin|cancel/i.test(message)) return "You declined the request in your wallet. Nothing was sent.";
  const hex = /custom program error: 0x([0-9a-f]+)/i.exec(message)?.[1];
  const decimal = /"Custom"\s*:\s*(\d+)/.exec(message)?.[1];
  const code = hex ? parseInt(hex, 16) : decimal ? Number(decimal) : undefined;
  if (code !== undefined) {
    const name = ratingProgramErrorName(code);
    if (name) return PROGRAM_ERROR_TEXT[name] ?? `The program refused the transaction (${name}).`;
  }
  return "The transaction was not sent. Check your wallet's network and SOL balance, then try again.";
}

async function sendAndConfirm<C extends RatingConnection>(connection: C, wallet: RatingWallet<C>, instructions: TransactionInstruction[]): Promise<RatingStepResult> {
  let latest: { blockhash: string; lastValidBlockHeight: number };
  try {
    latest = await connection.getLatestBlockhash("confirmed");
  } catch {
    return refuse("The network could not be reached. Nothing was signed.");
  }
  let signature: string;
  try {
    const transaction = new Transaction({ feePayer: wallet.publicKey, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }).add(...instructions);
    signature = await wallet.sendTransaction(transaction, connection);
  } catch (error) {
    return refuse(describeSendFailure(error));
  }
  try {
    const confirmation = await connection.confirmTransaction({ signature, ...latest }, "confirmed");
    if (confirmation.value.err) return refuse(describeSendFailure(new Error(JSON.stringify(confirmation.value.err))), true);
  } catch {
    return refuse("The transaction was sent but is not confirmed yet. Refresh in a few seconds before trying again.", true);
  }
  return { ok: true, signature };
}

export interface RatingStepDeps<C extends RatingConnection> {
  connection: C;
  wallet: RatingWallet<C>;
  programId: PublicKey;
  escrow: PublicKey;
  /**
   * The rating's `opened_slot` of the job shown to the signer. When set, a step is refused if the
   * rating now at this escrow is another job's (the shown one ended and a new job took the address).
   */
  expectedOpenedSlot?: bigint;
}

const JOB_CHANGED = "The job at this escrow address has changed since it was shown. Refresh, check the job, then try again. Nothing was signed.";

/** Reads the rating, and refuses when it is no longer the job the signer was shown. */
async function readShownJob<C extends RatingConnection>(deps: RatingStepDeps<C>, unreadable: string): Promise<{ ok: true; snapshot: JobRatingSnapshot } | { ok: false; result: RatingStepResult }> {
  let snapshot: JobRatingSnapshot;
  try {
    snapshot = await readJobRating(deps.connection, deps.escrow, deps.programId);
  } catch {
    return { ok: false, result: refuse(unreadable) };
  }
  if (deps.expectedOpenedSlot !== undefined && snapshot.rating && snapshot.rating.openedSlot !== deps.expectedOpenedSlot) return { ok: false, result: refuse(JOB_CHANGED) };
  return { ok: true, snapshot };
}

/**
 * Commits the wallet's hidden score. The salt is generated here, stored in
 * `storage` and read back before the wallet is asked to sign; if the browser
 * does not keep it, nothing is signed.
 */
export async function commitJobRating<C extends RatingConnection>(
  deps: RatingStepDeps<C> & { storage: KeyValueStorage | undefined; score: number; now?: () => Date; random?: (bytes: Uint8Array) => Uint8Array },
): Promise<RatingStepResult> {
  if (!Number.isInteger(deps.score) || deps.score < 1 || deps.score > 10) return refuse("Choose a score from 1 to 10.");
  if (!deps.storage) return refuse("This browser has no storage for the salt, so the rating could not be revealed later. Nothing was signed.");
  const read = await readShownJob(deps, "The rating could not be read from the network. Nothing was signed.");
  if (!read.ok) return read.result;
  const snapshot = read.snapshot;
  const wallet = deps.wallet.publicKey.toBase58();
  const view = snapshotView(snapshot, wallet, deps.storage);
  if (!view.can.commit) {
    return refuse(
      view.phase === "none"
        ? "This job has no rating. Nothing was signed."
        : view.role === "other"
          ? "Only the buyer and the provider of this job can rate it. Nothing was signed."
          : view.youCommitted
            ? "This wallet has already committed a score for this job."
            : view.deadlinePassed
              ? "The deadline to commit has passed. Nothing was signed."
              : "This job cannot be rated yet. Nothing was signed.",
    );
  }
  let commitment: Uint8Array;
  try {
    const salt = newRatingSalt(deps.random);
    const rating = snapshot.rating!;
    const counterparty = (view.role === "buyer" ? rating.specialist : rating.consumer).toBase58();
    // The job is the escrow and the rating's opened slot, read just now: the salt is stored under both and hashed with both.
    commitment = storeRatingSecret(deps.storage, { wallet, escrow: snapshot.escrow, programId: deps.programId.toBase58(), openedSlot: rating.openedSlot, score: deps.score, salt, now: (deps.now ?? (() => new Date()))(), counterparty }).commitment;
  } catch (error) {
    return refuse(`${error instanceof RatingStorageError ? error.message : "The salt could not be stored."} Without the salt you could not reveal, so nothing was signed.`);
  }
  return sendAndConfirm(deps.connection, deps.wallet, [buildCommitRatingInstruction({ programId: deps.programId, escrow: deps.escrow, signer: deps.wallet.publicKey, commitment })]);
}

/** Reveals the score and salt stored in this browser for the wallet's commitment. */
export async function revealJobRating<C extends RatingConnection>(deps: RatingStepDeps<C> & { storage: KeyValueStorage | undefined }): Promise<RatingStepResult> {
  const read = await readShownJob(deps, "The rating could not be read from the network. Nothing was signed.");
  if (!read.ok) return read.result;
  const snapshot = read.snapshot;
  const wallet = deps.wallet.publicKey.toBase58();
  const view = snapshotView(snapshot, wallet, deps.storage);
  const rating = snapshot.rating;
  if (!rating || !view.can.reveal || !deps.storage) {
    return refuse(
      view.revealBlocked === "salt_missing"
        ? "The salt for this commitment is not stored in this browser. Import your backup file, then reveal. Nothing was signed."
        : view.phase === "commit"
          ? "Both sides must commit before either can reveal. Nothing was signed."
          : view.deadlinePassed
            ? "The deadline to reveal has passed. Nothing was signed."
            : "There is nothing to reveal for this wallet. Nothing was signed.",
    );
  }
  const mine = view.role === "buyer" ? rating.consumerCommitment : rating.specialistCommitment;
  const secret = matchingRatingSecret(findRatedJob(deps.storage, wallet, snapshot.escrow), { openedSlot: rating.openedSlot, commitment: mine })!;
  return sendAndConfirm(deps.connection, deps.wallet, [
    buildRevealRatingInstruction({ programId: deps.programId, escrow: deps.escrow, signer: deps.wallet.publicKey, consumer: rating.consumer, specialist: rating.specialist, score: secret.score, salt: secret.salt }),
  ]);
}

async function finalStep<C extends RatingConnection>(deps: RatingStepDeps<C>, step: "expire" | "close"): Promise<RatingStepResult> {
  const read = await readShownJob(deps, "The rating could not be read from the network. Nothing was signed.");
  if (!read.ok) return read.result;
  const snapshot = read.snapshot;
  const view = snapshotView(snapshot, deps.wallet.publicKey.toBase58(), undefined);
  const rating = snapshot.rating;
  if (!rating || !view.can[step]) {
    return refuse(step === "expire" ? "This rating cannot be expired: its deadline has not passed, or it is already final. Nothing was signed." : "Only the buyer can reclaim the rent, once the rating is final. Nothing was signed.");
  }
  const instruction =
    step === "expire"
      ? buildExpireRatingInstruction({ programId: deps.programId, escrow: deps.escrow, caller: deps.wallet.publicKey, consumer: rating.consumer, specialist: rating.specialist })
      : buildCloseRatingInstruction({ programId: deps.programId, escrow: deps.escrow, consumer: deps.wallet.publicKey });
  return sendAndConfirm(deps.connection, deps.wallet, [instruction]);
}

/** Gives a rating whose deadline has passed its final result. Any wallet may do this. */
export function expireJobRating<C extends RatingConnection>(deps: RatingStepDeps<C>): Promise<RatingStepResult> {
  return finalStep(deps, "expire");
}

/** Closes a final rating and returns its rent to the buyer. */
export function closeJobRating<C extends RatingConnection>(deps: RatingStepDeps<C>): Promise<RatingStepResult> {
  return finalStep(deps, "close");
}

/** The buyer's verdict on the judge's attestation of this job. */
export async function resolveJobAttestation<C extends RatingConnection>(deps: RatingStepDeps<C> & { action: "confirm" | "dispute" }): Promise<RatingStepResult> {
  const read = await readShownJob(deps, "The attestation could not be read from the network. Nothing was signed.");
  if (!read.ok) return read.result;
  const snapshot = read.snapshot;
  const attestation = snapshot.attestation;
  if (!attestation) return refuse("This job has no attestation to resolve. Nothing was signed.");
  if (!attestation.consumer.equals(deps.wallet.publicKey)) return refuse("Only the buyer of this job can confirm or dispute its attestation. Nothing was signed.");
  if (attestation.resolution !== "pending") return refuse(`This attestation was already ${attestation.resolution}. Nothing was signed.`);
  // readJobRating kept the attestation only if it names this rating's escrow, consumer and judge and
  // was made after the rating opened; the shown job's slot was checked in readShownJob.
  const input = { programId: deps.programId, escrow: deps.escrow, judge: attestation.judge, consumer: deps.wallet.publicKey };
  return sendAndConfirm(deps.connection, deps.wallet, [deps.action === "confirm" ? buildConfirmAttestationInstruction(input) : buildDisputeAttestationInstruction(input)]);
}
