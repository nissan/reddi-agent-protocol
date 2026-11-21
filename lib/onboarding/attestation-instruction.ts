import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { attestationPda, buildAttestQualityInstruction } from "@redditech/x402-solana/rating";

/** The attestation account of the job paid through `escrow`: ["attestation", escrow]. */
export function onboardingAttestationPda(escrow: PublicKey, programId: PublicKey): PublicKey {
  return attestationPda(escrow, programId);
}

/**
 * `attest_quality` as the V1 program takes it: five scores, for the job paid through `escrow`,
 * signed by the judge that job's rating account names. The consumer comes from the rating
 * account; `openedSlot` is that account's `openedSlot` as the judge read it, which names the job
 * (a later job at the same escrow address has another, and the program refuses a mismatch, 6051).
 */
export function buildOnboardingAttestQualityInstruction(input: {
  programId: PublicKey;
  escrow: PublicKey;
  scores: [number, number, number, number, number];
  judge: PublicKey;
  openedSlot: bigint;
}): TransactionInstruction {
  return buildAttestQualityInstruction(input);
}
