import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { attestationPda, buildAttestQualityInstruction } from "@reddi/x402-solana/rating";

/** The attestation account of the job paid through `escrow`: ["attestation", escrow]. */
export function onboardingAttestationPda(escrow: PublicKey, programId: PublicKey): PublicKey {
  return attestationPda(escrow, programId);
}

/**
 * `attest_quality` as the V1 program takes it: five scores, for the job paid through `escrow`,
 * signed by the judge that job's rating account names. The consumer and the job come from the
 * rating account, so neither is in the instruction data any more.
 */
export function buildOnboardingAttestQualityInstruction(input: {
  programId: PublicKey;
  escrow: PublicKey;
  scores: [number, number, number, number, number];
  judge: PublicKey;
}): TransactionInstruction {
  return buildAttestQualityInstruction(input);
}
