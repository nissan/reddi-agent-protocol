import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import {
  attestationPda,
  buildConfirmAttestationInstruction,
  buildDisputeAttestationInstruction,
  decodeAttestationAccount,
  decodeRatingAccount,
  ratingPda,
  type AttestationAccount,
  type RatingAccount,
} from "@reddi/x402-solana/rating";

import { QUASAR_ESCROW_UNAVAILABLE_REASON } from "@/lib/onboarding/quasar-escrow-binding";
import { ESCROW_PROGRAM_ID, PROGRAM_TARGET } from "@/lib/program";

/**
 * Consumer follow-through on an operator attestation: confirm or dispute.
 *
 * The two actions differ only in their instruction selector, so they share one path here rather than
 * in two copies of a click handler where the Quasar refusal cannot be exercised. The refusal is the
 * first thing `submitAttestationResolution` does, so it holds before any connection is opened, any
 * base58 string is parsed into a `PublicKey`, any instruction is built, and any signer is used.
 *
 * What is built below is the V1 program's `confirm_attestation` / `dispute_attestation`
 * (`@reddi/x402-solana/rating`): the attestation of the job paid through an escrow, the judge's
 * agent record, and the consumer as signer, with no instruction data. The program does not check
 * that the attestation is the one of the job the signer was shown, so before anything is built the
 * attestation is read and checked against that job (`readAttestationForShownJob`), and a recorded
 * attestation address is accepted only when it is the one derived from the shown escrow. The job rating panel
 * (`components/rating`, #842) resolves a judge's attestation through `lib/rating/job-rating.ts`
 * and uses the refusal check here; the onboarding wizard no longer has an attest step.
 */
export type AttestationResolutionAction = "confirm" | "dispute";

export type AttestationResolutionRequest = {
  action: AttestationResolutionAction;
  /** Consumer wallet doing the follow-through; it signs the transaction. It must be the consumer the attestation names. */
  consumer: PublicKey;
  /** The judge shown to the signer for this job, as base58. It must be the judge the attestation names. */
  operator: string;
  /** The escrow the job shown to the signer was paid through, as base58. The attestation address is derived from it. */
  escrow: string;
  /**
   * An attestation address the caller recorded, as base58. Optional, and only accepted when it is
   * the address derived from `escrow`: any other address is refused, never used.
   */
  attestationPda?: string;
  /**
   * The rating account's `opened_slot` of the job shown to the signer, when the caller has it. With
   * it, the rating at this escrow must still be that job's, and the attestation must have been made
   * at or after that slot (an attestation from an earlier job at the same escrow address is refused).
   */
  openedSlot?: bigint;
};

export type AttestationResolutionDependencies = {
  getConnection: () => Connection;
  sendTransaction: (transaction: Transaction, connection: Connection) => Promise<string>;
};

export type AttestationResolutionOutcome =
  | { ok: true; signature: string }
  | { ok: false; error: string };

/**
 * The canonical reason consumer resolution is unavailable, or undefined when it can run. Onboarding
 * never locks a Quasar escrow, so there is no verified lock record to bind confirm/dispute to.
 */
export function describeAttestationResolutionRefusal(): string | undefined {
  return PROGRAM_TARGET === "quasar" ? QUASAR_ESCROW_UNAVAILABLE_REASON : undefined;
}

/** Thrown, and returned as the outcome's error, when the attestation on chain is not the one of the job shown to the signer. */
export class AttestationJobMismatchError extends Error {}

/** The part of a `Connection` the job check reads with. */
type AccountReader = Pick<Connection, "getAccountInfo">;

/**
 * Reads the attestation at ["attestation", escrow] and returns it only when it is the attestation of
 * the job shown to the signer: same escrow, same judge, same consumer, still pending, held by the
 * escrow program; and, when `openedSlot` is given, the rating at this escrow is that job's and the
 * attestation was made at or after its opening slot. Throws `AttestationJobMismatchError` otherwise.
 * The program checks only the consumer and the judge's agent address, not which job the signer was
 * shown, so this check is what keeps a click on one job from resolving another's attestation.
 */
export async function readAttestationForShownJob(
  connection: AccountReader,
  shown: { escrow: PublicKey; judge: PublicKey; consumer: PublicKey; openedSlot?: bigint; attestationAddress?: PublicKey },
  programId: PublicKey = ESCROW_PROGRAM_ID,
): Promise<AttestationAccount> {
  const derived = attestationPda(shown.escrow, programId);
  if (shown.attestationAddress && !shown.attestationAddress.equals(derived)) {
    throw new AttestationJobMismatchError("The attestation address given is not the attestation of the job shown. Nothing was signed.");
  }
  const info = await connection.getAccountInfo(derived, "confirmed");
  if (!info || !info.owner.equals(programId)) throw new AttestationJobMismatchError("There is no attestation for the job shown. Nothing was signed.");
  let attestation: AttestationAccount;
  try {
    attestation = decodeAttestationAccount(new Uint8Array(info.data));
  } catch {
    throw new AttestationJobMismatchError("The account at the attestation address is not an attestation. Nothing was signed.");
  }
  if (!attestation.escrow.equals(shown.escrow)) throw new AttestationJobMismatchError("The attestation names another escrow than the job shown. Nothing was signed.");
  if (!attestation.judge.equals(shown.judge)) throw new AttestationJobMismatchError("The attestation was made by another judge than the one shown. Nothing was signed.");
  if (!attestation.consumer.equals(shown.consumer)) throw new AttestationJobMismatchError("The attestation names another buyer than the connected wallet. Nothing was signed.");
  if (attestation.resolution !== "pending") throw new AttestationJobMismatchError(`This attestation was already ${attestation.resolution}. Nothing was signed.`);
  if (shown.openedSlot !== undefined) {
    const ratingInfo = await connection.getAccountInfo(ratingPda(shown.escrow, programId), "confirmed");
    let rating: RatingAccount | undefined;
    try {
      rating = ratingInfo && ratingInfo.owner.equals(programId) ? decodeRatingAccount(new Uint8Array(ratingInfo.data)) : undefined;
    } catch {
      rating = undefined;
    }
    if (!rating || rating.openedSlot !== shown.openedSlot || !rating.escrow.equals(shown.escrow)) {
      throw new AttestationJobMismatchError("The job shown is no longer the job at this escrow address. Refresh before confirming or disputing. Nothing was signed.");
    }
    if (attestation.createdSlot < shown.openedSlot) throw new AttestationJobMismatchError("This attestation belongs to an earlier job at the same escrow address. Nothing was signed.");
  }
  return attestation;
}

export async function submitAttestationResolution(
  request: AttestationResolutionRequest,
  deps: AttestationResolutionDependencies,
): Promise<AttestationResolutionOutcome> {
  const refusal = describeAttestationResolutionRefusal();
  if (refusal) return { ok: false, error: refusal };

  try {
    const connection = deps.getConnection();
    if (!request.escrow) throw new AttestationJobMismatchError("Attestation resolution needs the escrow the job was paid through.");
    const escrow = new PublicKey(request.escrow);
    const judge = new PublicKey(request.operator);
    const attestationAddress = request.attestationPda ? new PublicKey(request.attestationPda) : undefined;
    await readAttestationForShownJob(connection, { escrow, judge, consumer: request.consumer, openedSlot: request.openedSlot, attestationAddress });

    // Built only from the shown job: the attestation address is always derived from its escrow.
    const input = { programId: ESCROW_PROGRAM_ID, escrow, judge, consumer: request.consumer };
    const instruction = request.action === "confirm" ? buildConfirmAttestationInstruction(input) : buildDisputeAttestationInstruction(input);

    const { blockhash } = await connection.getLatestBlockhash();
    const transaction = new Transaction();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = request.consumer;
    transaction.add(instruction);

    const signature = await deps.sendTransaction(transaction, connection);
    await connection.confirmTransaction(signature, "confirmed");
    return { ok: true, signature };
  } catch (error: unknown) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : `${request.action === "confirm" ? "Confirm" : "Dispute"} attestation failed`,
    };
  }
}
