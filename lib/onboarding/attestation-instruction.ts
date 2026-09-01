import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

import {
  ATTESTATION_SEED,
  buildAttestQualityData,
} from "@/lib/program";
import { quasarAgentPda } from "@/lib/quasar/instructions";

export function onboardingAttestationPda(jobId: Uint8Array, programId: PublicKey): PublicKey {
  if (jobId.length !== 16) throw new Error("job_id_must_be_16_bytes");
  return PublicKey.findProgramAddressSync([ATTESTATION_SEED, Buffer.from(jobId)], programId)[0];
}

export function buildOnboardingAttestQualityInstruction(input: {
  programId: PublicKey;
  jobId: Uint8Array;
  scores: [number, number, number, number, number];
  consumer: PublicKey;
  judge: PublicKey;
}): TransactionInstruction {
  const judgeAgent = quasarAgentPda(input.judge, input.programId);
  const attestation = onboardingAttestationPda(input.jobId, input.programId);

  return new TransactionInstruction({
    programId: input.programId,
    keys: [
      { pubkey: attestation, isSigner: false, isWritable: true },
      { pubkey: judgeAgent, isSigner: false, isWritable: false },
      { pubkey: input.judge, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: buildAttestQualityData(input.jobId, input.scores, input.consumer),
  });
}
