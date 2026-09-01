import { createHash } from "crypto";

import { PublicKey } from "@solana/web3.js";

import { quasarEscrowPda } from "@/lib/quasar/instructions";

/**
 * Canonical onboarding → Quasar escrow binding.
 *
 * Quasar seeds rating and attestation records on the escrow account address and reads both parties
 * from `escrow.payer`/`escrow.payee`, so every rating or attestation is bound to exactly one escrow.
 * The onboarding flow identifies a job by its 16-byte job id, so the escrow it binds to is *derived*
 * from that job identity and the consumer wallet rather than accepted from a caller: an unbound
 * escrow supplied by a client could bind a rating to somebody else's job.
 */

/** Deterministic u64 escrow id for an onboarding job identity. */
export function onboardingEscrowId(jobId: Uint8Array): bigint {
  if (jobId.length !== 16) throw new Error("job_id_must_be_16_bytes");
  const digest = createHash("sha256").update(Buffer.from(jobId)).digest();
  return digest.readBigUInt64LE(0);
}

/**
 * The escrow address this onboarding job binds to: `[b"escrow", consumer, escrow_id(u64 LE)]` under
 * the Quasar escrow program, matching experiments/quasar-escrow/src/state.rs.
 */
export function deriveOnboardingQuasarEscrow(input: {
  consumer: PublicKey;
  jobId: Uint8Array;
  escrowProgramId: PublicKey;
}): PublicKey {
  return quasarEscrowPda(input.consumer, onboardingEscrowId(input.jobId), input.escrowProgramId);
}

/**
 * Resolves the bound escrow for a job, refusing anything that is not the address this job derives
 * to. A supplied value is only ever accepted as a cross-check, never as the source of truth.
 */
export function resolveBoundQuasarEscrow(input: {
  consumer: PublicKey;
  jobId: Uint8Array;
  escrowProgramId: PublicKey;
  supplied?: string;
}): PublicKey {
  const derived = deriveOnboardingQuasarEscrow(input);
  if (input.supplied === undefined || input.supplied === "") return derived;

  let supplied: PublicKey;
  try {
    supplied = new PublicKey(input.supplied);
  } catch {
    throw new Error(`quasar_escrow_not_a_valid_address: ${input.supplied}`);
  }
  if (supplied.toBytes().length !== 32) {
    throw new Error(`quasar_escrow_not_a_valid_address: ${input.supplied}`);
  }
  if (!supplied.equals(derived)) {
    throw new Error(
      `quasar_escrow_not_bound_to_this_job: supplied ${supplied.toBase58()} but this job binds to ${derived.toBase58()}`,
    );
  }
  return derived;
}
