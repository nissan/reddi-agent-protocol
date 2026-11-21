import { Connection, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { agentPda, buildConfirmAttestationInstruction, buildDisputeAttestationInstruction } from "@reddi/x402-solana/rating";

import { QUASAR_ESCROW_UNAVAILABLE_REASON } from "@/lib/onboarding/quasar-escrow-binding";
import { ESCROW_PROGRAM_ID, IX, PROGRAM_TARGET } from "@/lib/program";

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
 * agent record, and the consumer as signer, with no instruction data. Nothing in the app records
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
  if (request.attestationPda) {
    // A recorded attestation address: the same accounts and selector the builders below produce.
    return new TransactionInstruction({
      programId: ESCROW_PROGRAM_ID,
      keys: [
        { pubkey: new PublicKey(request.attestationPda), isSigner: false, isWritable: true },
        { pubkey: agentPda(operator, ESCROW_PROGRAM_ID), isSigner: false, isWritable: true },
        { pubkey: request.consumer, isSigner: true, isWritable: false },
      ],
      data: request.action === "confirm" ? IX.confirm_attestation : IX.dispute_attestation,
    });
  }
  if (!request.escrow) {
    throw new Error("Attestation resolution needs the escrow the job was paid through.");
  }
  const input = { programId: ESCROW_PROGRAM_ID, escrow: new PublicKey(request.escrow), judge: operator, consumer: request.consumer };
  return request.action === "confirm" ? buildConfirmAttestationInstruction(input) : buildDisputeAttestationInstruction(input);
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
