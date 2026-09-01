import { PublicKey } from "@solana/web3.js";

import { quasarEscrowPda } from "@/lib/quasar/instructions";

/**
 * Quasar escrow binding for onboarding.
 *
 * A Quasar escrow address is not derivable from a job id. `experiments/quasar-escrow/src/instructions/lock.rs`
 * requires `escrow_id == counter.next_id`, a sequential per-payer counter assigned at lock time, so the
 * only real escrow is the PDA a successful lock created. Anything computed from a job id, or supplied by
 * a client, names an account that does not exist or belongs to another job.
 *
 * The onboarding flow never locks a Quasar escrow, so it has no verified lock record and every Quasar
 * reputation/attestation request refuses here — before any instruction, signer, or RPC use.
 */

export const QUASAR_ESCROW_UNAVAILABLE_REASON =
  "Quasar reputation and attestation bind to the escrow account a successful lock created, and the onboarding " +
  "flow never locks a Quasar escrow. There is no verified lock record for this job, so the request is refused " +
  "before any instruction is built, any signer is used, or any RPC call is made.";

export type EscrowStatus = "locked" | "released" | "cancelled";

/**
 * Escrow states that still describe a real job worth rating or attesting.
 *
 * `release.rs` deliberately dropped `close = payer` (CRITICAL-4, 2026-08-26) so the escrow survives
 * settlement as a durable job record and becomes `Released`; the ordering is lock → release →
 * commit → reveal → attest, so a settled job's escrow is `Released` by the time it is rated. Neither
 * `quasar-reputation` nor `quasar-attestation` reads the status — they only need the account. A
 * `Cancelled` escrow (cancel.rs) is a job that never completed, so there is nothing to rate.
 */
const RATEABLE_ESCROW_STATUSES: readonly EscrowStatus[] = ["locked", "released"];

/**
 * A canonical lock result: what a successful `lock` returned, recorded server-side. Every field is
 * needed to prove the address really is the escrow this job locked.
 */
export type VerifiedLockRecord = {
  escrowAddress: string;
  escrowId: bigint;
  payer: string;
  payee: string;
  status: EscrowStatus;
  escrowProgramId: string;
};

export type ExpectedJobBinding = {
  consumer: PublicKey;
  specialist: PublicKey;
  escrowProgramId: PublicKey;
};

/**
 * The escrow PDA a lock creates: `[b"escrow", payer, escrow_id(u64 LE)]`, where `escrow_id` is the
 * payer's sequential counter value at lock time (experiments/quasar-escrow/src/state.rs).
 */
export function lockCreatedEscrowPda(payer: PublicKey, escrowId: bigint, escrowProgramId: PublicKey): PublicKey {
  if (escrowId < 0n) throw new Error("quasar_escrow_id_must_be_a_u64_counter_value");
  return quasarEscrowPda(payer, escrowId, escrowProgramId);
}

/**
 * Validates a recorded lock result against the job it is supposed to bind. Refuses a forged address,
 * an escrow locked by or for the wrong party, a non-usable status, and a program set that is not the
 * one this deployment expects.
 */
export function verifyLockCreatedEscrow(
  record: VerifiedLockRecord,
  expected: ExpectedJobBinding,
): PublicKey {
  let payer: PublicKey;
  let payee: PublicKey;
  let escrowProgramId: PublicKey;
  let claimed: PublicKey;
  try {
    payer = new PublicKey(record.payer);
    payee = new PublicKey(record.payee);
    escrowProgramId = new PublicKey(record.escrowProgramId);
    claimed = new PublicKey(record.escrowAddress);
  } catch {
    throw new Error("quasar_escrow_record_has_a_malformed_address");
  }

  if (!escrowProgramId.equals(expected.escrowProgramId)) {
    throw new Error(
      `quasar_escrow_wrong_program: record names ${escrowProgramId.toBase58()} but this deployment uses ${expected.escrowProgramId.toBase58()}`,
    );
  }
  if (!payer.equals(expected.consumer)) {
    throw new Error(
      `quasar_escrow_wrong_payer: record names ${payer.toBase58()} but this job's consumer is ${expected.consumer.toBase58()}`,
    );
  }
  if (!payee.equals(expected.specialist)) {
    throw new Error(
      `quasar_escrow_wrong_payee: record names ${payee.toBase58()} but this job's specialist is ${expected.specialist.toBase58()}`,
    );
  }
  if (!RATEABLE_ESCROW_STATUSES.includes(record.status)) {
    throw new Error(
      `quasar_escrow_not_rateable: status is ${record.status}; only ${RATEABLE_ESCROW_STATUSES.join(" or ")} escrows describe a real job`,
    );
  }

  const derived = lockCreatedEscrowPda(payer, record.escrowId, escrowProgramId);
  if (!claimed.equals(derived)) {
    throw new Error(
      `quasar_escrow_address_not_lock_derived: ${claimed.toBase58()} is not [b"escrow", ${payer.toBase58()}, ${record.escrowId}]`,
    );
  }
  return derived;
}

/**
 * Resolves the escrow for an onboarding job. Without a verified lock record there is nothing to bind
 * to and the caller must refuse; no escrow is ever synthesized.
 */
export function resolveOnboardingQuasarEscrow(input: {
  lockRecord?: VerifiedLockRecord;
  expected: ExpectedJobBinding;
}): PublicKey {
  if (!input.lockRecord) throw new Error(QUASAR_ESCROW_UNAVAILABLE_REASON);
  return verifyLockCreatedEscrow(input.lockRecord, input.expected);
}
