import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

import {
import { assertProgramTargetUsable } from "@/lib/config/network";
  buildQuasarAttestQualityData,
  buildQuasarConfirmAttestationData,
  buildQuasarCommitRatingData,
  buildQuasarDeregisterAgentData,
  buildQuasarDisputeAttestationData,
  buildQuasarRegisterData,
  buildQuasarRevealRatingData,
  buildQuasarUpdateAgentData,
} from "@/lib/quasar/instruction-builders";

export const QUASAR_AGENT_SEED = Buffer.from("agent");
export const QUASAR_ATTESTATION_SEED = Buffer.from("attestation");
export const QUASAR_RATING_SEED = Buffer.from("rating");
export const QUASAR_INCINERATOR = new PublicKey("1nc1nerator11111111111111111111111111111111");

export function quasarAgentPda(owner: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([QUASAR_AGENT_SEED, owner.toBytes()], programId)[0];
}

export function quasarAttestationPda(jobId: Uint8Array, programId: PublicKey): PublicKey {
  if (jobId.length !== 16) throw new Error("job_id_must_be_16_bytes");
  return PublicKey.findProgramAddressSync([QUASAR_ATTESTATION_SEED, Buffer.from(jobId)], programId)[0];
}

export function quasarRatingPda(jobId: Uint8Array, programId: PublicKey): PublicKey {
  if (jobId.length !== 16) throw new Error("job_id_must_be_16_bytes");
  return PublicKey.findProgramAddressSync([QUASAR_RATING_SEED, Buffer.from(jobId)], programId)[0];
}

export function buildQuasarRegisterAgentInstruction(input: {
  programId: PublicKey;
  owner: PublicKey;
  agentType: number;
  model: string;
  rateLamports: bigint;
  minReputation: number;
  agentPda?: PublicKey;
  feeCollector?: PublicKey;
}): TransactionInstruction {
  assertProgramTargetUsable();
  const agent = input.agentPda ?? quasarAgentPda(input.owner, input.programId);
  return new TransactionInstruction({
    programId: input.programId,
    keys: [
      { pubkey: agent, isSigner: false, isWritable: true },
      { pubkey: input.owner, isSigner: true, isWritable: true },
      { pubkey: input.feeCollector ?? QUASAR_INCINERATOR, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: buildQuasarRegisterData(input.agentType, input.model, input.rateLamports, input.minReputation),
  });
}

export function buildQuasarUpdateAgentInstruction(input: {
  programId: PublicKey;
  owner: PublicKey;
  rateLamports: bigint;
  minReputation: number;
  active: boolean;
  agentPda?: PublicKey;
}): TransactionInstruction {
  assertProgramTargetUsable();
  const agent = input.agentPda ?? quasarAgentPda(input.owner, input.programId);
  return new TransactionInstruction({
    programId: input.programId,
    keys: [
      { pubkey: agent, isSigner: false, isWritable: true },
      { pubkey: input.owner, isSigner: true, isWritable: false },
    ],
    data: buildQuasarUpdateAgentData(input.rateLamports, input.minReputation, input.active),
  });
}

export function buildQuasarDeregisterAgentInstruction(input: {
  programId: PublicKey;
  owner: PublicKey;
  agentPda?: PublicKey;
}): TransactionInstruction {
  assertProgramTargetUsable();
  const agent = input.agentPda ?? quasarAgentPda(input.owner, input.programId);
  return new TransactionInstruction({
    programId: input.programId,
    keys: [
      { pubkey: agent, isSigner: false, isWritable: true },
      { pubkey: input.owner, isSigner: true, isWritable: true },
    ],
    data: buildQuasarDeregisterAgentData(),
  });
}

export function buildQuasarCommitRatingInstruction(input: {
  programId: PublicKey;
  signer: PublicKey;
  jobId: Uint8Array;
  commitment: Uint8Array;
  role: 0 | 1;
  consumer: PublicKey;
  specialist: PublicKey;
  ratingPda?: PublicKey;
}): TransactionInstruction {
  assertProgramTargetUsable();
  const rating = input.ratingPda ?? quasarRatingPda(input.jobId, input.programId);
  return new TransactionInstruction({
    programId: input.programId,
    keys: [
      { pubkey: rating, isSigner: false, isWritable: true },
      { pubkey: input.signer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: buildQuasarCommitRatingData(
      input.jobId,
      input.commitment,
      input.role,
      input.consumer.toBytes(),
      input.specialist.toBytes(),
    ),
  });
}

export function buildQuasarRevealRatingInstruction(input: {
  programId: PublicKey;
  signer: PublicKey;
  jobId: Uint8Array;
  score: number;
  salt: Uint8Array;
  specialistAgentPda: PublicKey;
  consumerAgentPda: PublicKey;
  ratingPda?: PublicKey;
}): TransactionInstruction {
  assertProgramTargetUsable();
  const rating = input.ratingPda ?? quasarRatingPda(input.jobId, input.programId);
  return new TransactionInstruction({
    programId: input.programId,
    keys: [
      { pubkey: rating, isSigner: false, isWritable: true },
      { pubkey: input.signer, isSigner: true, isWritable: false },
      { pubkey: input.specialistAgentPda, isSigner: false, isWritable: true },
      { pubkey: input.consumerAgentPda, isSigner: false, isWritable: true },
    ],
    data: buildQuasarRevealRatingData(input.jobId, input.score, input.salt),
  });
}

export function buildQuasarAttestQualityInstruction(input: {
  programId: PublicKey;
  judge: PublicKey;
  jobId: Uint8Array;
  scores: Uint8Array;
  consumer: PublicKey;
  attestationPda?: PublicKey;
  judgeAgentPda?: PublicKey;
}): TransactionInstruction {
  assertProgramTargetUsable();
  const attestation = input.attestationPda ?? quasarAttestationPda(input.jobId, input.programId);
  const judgeAgent = input.judgeAgentPda ?? quasarAgentPda(input.judge, input.programId);
  return new TransactionInstruction({
    programId: input.programId,
    keys: [
      { pubkey: attestation, isSigner: false, isWritable: true },
      { pubkey: judgeAgent, isSigner: false, isWritable: false },
      { pubkey: input.judge, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: buildQuasarAttestQualityData(input.jobId, input.scores, input.consumer.toBytes()),
  });
}

export function buildQuasarConfirmAttestationInstruction(input: {
  programId: PublicKey;
  consumer: PublicKey;
  judge: PublicKey;
  jobId: Uint8Array;
  attestationPda?: PublicKey;
  judgeAgentPda?: PublicKey;
}): TransactionInstruction {
  assertProgramTargetUsable();
  const attestation = input.attestationPda ?? quasarAttestationPda(input.jobId, input.programId);
  const judgeAgent = input.judgeAgentPda ?? quasarAgentPda(input.judge, input.programId);
  return new TransactionInstruction({
    programId: input.programId,
    keys: [
      { pubkey: attestation, isSigner: false, isWritable: true },
      { pubkey: judgeAgent, isSigner: false, isWritable: true },
      { pubkey: input.consumer, isSigner: true, isWritable: false },
    ],
    data: buildQuasarConfirmAttestationData(input.jobId),
  });
}

export function buildQuasarDisputeAttestationInstruction(input: {
  programId: PublicKey;
  consumer: PublicKey;
  judge: PublicKey;
  jobId: Uint8Array;
  attestationPda?: PublicKey;
  judgeAgentPda?: PublicKey;
}): TransactionInstruction {
  assertProgramTargetUsable();
  const attestation = input.attestationPda ?? quasarAttestationPda(input.jobId, input.programId);
  const judgeAgent = input.judgeAgentPda ?? quasarAgentPda(input.judge, input.programId);
  return new TransactionInstruction({
    programId: input.programId,
    keys: [
      { pubkey: attestation, isSigner: false, isWritable: true },
      { pubkey: judgeAgent, isSigner: false, isWritable: true },
      { pubkey: input.consumer, isSigner: true, isWritable: false },
    ],
    data: buildQuasarDisputeAttestationData(input.jobId),
  });
}
