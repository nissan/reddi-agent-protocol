import { Connection, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { buildConfirmAttestationInstruction, buildDisputeAttestationInstruction } from "@reddi/x402-solana/rating";

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
 * agent record, and the consumer as signer, and as data the job's opened slot as the attestation
 * stores it (`openedSlot`, required: the program refuses a decision without it or naming another
 * job, `RatingJobMismatch` 6051). Nothing in the app records
 * such an attestation yet: the operator attest step fails closed until the app rating flow lands
 * (#842), so the onboarding page never reaches this with a recorded attestation.
 */
export type AttestationResolutionAction = "confirm" | "dispute";

export type AttestationResolutionRequest = {
  action: AttestationResolutionAction;
  /** Consumer wallet doing the follow-through; it signs the transaction. */
  consumer: PublicKey;
  /** Operator (judge) wallet named by the attestation, as base58. */
  operator: string;
  /** The escrow the attested job was paid through, as base58. The attestation address is derived from it. */
  escrow?: string;
  /** Attestation address recorded by the attest step, as base58. Used instead of `escrow` when present. */
  attestationPda?: string;
  /**
   * The slot the job's rating was opened in, as the attestation the consumer was shown stores it
   * (`decodeAttestationAccount(...).openedSlot`). Required: without it nothing is built.
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

function buildResolutionInstruction(request: AttestationResolutionRequest, operator: PublicKey): TransactionInstruction {
  const openedSlot = request.openedSlot;
  if (typeof openedSlot !== "bigint") {
    throw new Error("Attestation resolution needs the job's opened slot, read from the attestation. Nothing was signed.");
  }
  const build = request.action === "confirm" ? buildConfirmAttestationInstruction : buildDisputeAttestationInstruction;
  if (request.attestationPda) {
    // A recorded attestation address: the builder's accounts and data, with that address as account 0.
    const built = build({ programId: ESCROW_PROGRAM_ID, escrow: PublicKey.default, judge: operator, consumer: request.consumer, openedSlot });
    return new TransactionInstruction({
      programId: ESCROW_PROGRAM_ID,
      keys: [{ pubkey: new PublicKey(request.attestationPda), isSigner: false, isWritable: true }, ...built.keys.slice(1)],
      data: built.data,
    });
  }
  if (!request.escrow) {
    throw new Error("Attestation resolution needs the escrow the job was paid through.");
  }
  return build({ programId: ESCROW_PROGRAM_ID, escrow: new PublicKey(request.escrow), judge: operator, consumer: request.consumer, openedSlot });
}

export async function submitAttestationResolution(
  request: AttestationResolutionRequest,
  deps: AttestationResolutionDependencies,
): Promise<AttestationResolutionOutcome> {
  const refusal = describeAttestationResolutionRefusal();
  if (refusal) return { ok: false, error: refusal };

  try {
    const connection = deps.getConnection();
    const operator = new PublicKey(request.operator);
    const instruction = buildResolutionInstruction(request, operator);

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
