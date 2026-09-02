/**
 * Quasar escrow binding for onboarding.
 *
 * A Quasar escrow address is not derivable from a job id. `experiments/quasar-escrow/src/instructions/lock.rs`
 * requires `escrow_id == counter.next_id`, a sequential per-payer counter assigned at lock time, so the
 * only real escrow is the PDA a successful lock created. Anything computed from a job id, or supplied by
 * a client, names an account that does not exist or belongs to another job.
 *
 * The onboarding flow never locks a Quasar escrow, so it has no verified lock record and every Quasar
 * reputation/attestation/confirm/dispute path refuses with the reason below — before any signer
 * material is read, any instruction is built, or any RPC call is made. That refusal is the whole of
 * this module: there is deliberately no resolver here to call, and none of the onboarding surfaces
 * builds a Quasar instruction. The current-source Quasar builders live in `lib/quasar/instructions.ts`
 * for the explicit local-Surfpool lane.
 */

export const QUASAR_ESCROW_UNAVAILABLE_REASON =
  "Quasar reputation and attestation bind to the escrow account a successful lock created, and the onboarding " +
  "flow never locks a Quasar escrow. There is no verified lock record for this job, so the request is refused " +
  "before any instruction is built, any signer is used, or any RPC call is made.";
