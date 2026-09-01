import { Connection, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";

import { QUASAR_ESCROW_UNAVAILABLE_REASON } from "@/lib/onboarding/quasar-escrow-binding";
import {
  agentPda,
  attestationPda,
  buildConfirmAttestationData,
  buildDisputeAttestationData,
  ATTESTATION_PROGRAM_ID,
  ESCROW_PROGRAM_ID,
  PROGRAM_TARGET,
} from "@/lib/program";
import {
  buildQuasarConfirmAttestationInstruction,
  buildQuasarDisputeAttestationInstruction,
  quasarAgentPda,
  quasarAttestationPda,
} from "@/lib/quasar/instructions";

/**
 * Consumer follow-through on an operator attestation: confirm or dispute.
 *
 * The two actions differ only in their instruction data, so they share one path here rather than in
 * two copies of a click handler where the Quasar refusal cannot be exercised. The refusal is the
 * first thing this function does, so it holds before any connection is opened, any base58 string is
 * parsed into a `PublicKey`, any instruction is built, and any signer is used.
 */
export type AttestationResolutionAction = "confirm" | "dispute";

export type AttestationResolutionRequest = {
  action: AttestationResolutionAction;
  /** Consumer wallet doing the follow-through; it signs the transaction. */
  consumer: PublicKey;
  /** Operator (judge) wallet named by the attestation, as base58. */
  operator: string;
  /** 16-byte job id, hex encoded. */
  jobIdHex: string;
  /** Quasar escrow the attestation binds to, as base58; empty when there is none. */
  escrow: string;
  /** Attestation PDA recorded by the attest step, as base58; derived when absent. */
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

export function hexToJobId(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
    throw new Error("Invalid attestation job id.");
  }
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function buildResolutionInstruction(
  request: AttestationResolutionRequest,
  jobId: Uint8Array,
  operator: PublicKey,
): TransactionInstruction {
  if (PROGRAM_TARGET === "quasar") {
    const refusal = describeAttestationResolutionRefusal();
    if (refusal) throw new Error(refusal);
    const escrow = new PublicKey(request.escrow);
    const build =
      request.action === "confirm"
        ? buildQuasarConfirmAttestationInstruction
        : buildQuasarDisputeAttestationInstruction;
    return build({
      programId: ATTESTATION_PROGRAM_ID,
      escrow,
      consumer: request.consumer,
      judge: operator,
      attestationPda: request.attestationPda
        ? new PublicKey(request.attestationPda)
        : quasarAttestationPda(escrow, ATTESTATION_PROGRAM_ID),
      judgeAgentPda: quasarAgentPda(operator, ATTESTATION_PROGRAM_ID),
    });
  }

  return new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [
      {
        pubkey: request.attestationPda ? new PublicKey(request.attestationPda) : attestationPda(jobId),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: agentPda(operator), isSigner: false, isWritable: true },
      { pubkey: request.consumer, isSigner: true, isWritable: false },
    ],
    data:
      request.action === "confirm" ? buildConfirmAttestationData(jobId) : buildDisputeAttestationData(jobId),
  });
}

export async function submitAttestationResolution(
  request: AttestationResolutionRequest,
  deps: AttestationResolutionDependencies,
): Promise<AttestationResolutionOutcome> {
  const refusal = describeAttestationResolutionRefusal();
  if (refusal) return { ok: false, error: refusal };

  try {
    const connection = deps.getConnection();
    const jobId = hexToJobId(request.jobIdHex);
    const operator = new PublicKey(request.operator);
    const instruction = buildResolutionInstruction(request, jobId, operator);

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
