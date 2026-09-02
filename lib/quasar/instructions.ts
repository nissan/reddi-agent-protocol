import { createHash } from "crypto";

import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

import { assertQuasarProgramTargetUsable } from "@/lib/config/network";
import {
  buildQuasarAttestQualityData,
  buildQuasarConfirmAttestationData,
  buildQuasarCommitRatingData,
  buildQuasarDeregisterAgentData,
  buildQuasarDisputeAttestationData,
  buildQuasarRegisterData,
  buildQuasarExpireRatingData,
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

export const QUASAR_ESCROW_SEED = Buffer.from("escrow");

/**
 * Rating PDA: seeds = [b"rating", escrow_address].
 * experiments/quasar-reputation/src/state.rs: `#[seeds(b"rating", escrow: Address)]`.
 */
export function quasarRatingPda(escrow: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([QUASAR_RATING_SEED, escrow.toBytes()], programId)[0];
}

/**
 * Attestation PDA: seeds = [b"attestation", escrow_address].
 * experiments/quasar-attestation/src/state.rs: `#[seeds(b"attestation", escrow: Address)]`.
 */
export function quasarAttestationPda(escrow: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([QUASAR_ATTESTATION_SEED, escrow.toBytes()], programId)[0];
}

/**
 * Escrow PDA: seeds = [b"escrow", payer, escrow_id(u64 LE)].
 * experiments/quasar-escrow/src/state.rs: `#[seeds(b"escrow", payer: Address, escrow_id: u64)]`.
 */
export function quasarEscrowPda(payer: PublicKey, escrowId: bigint, escrowProgramId: PublicKey): PublicKey {
  const id = Buffer.alloc(8);
  id.writeBigUInt64LE(escrowId);
  return PublicKey.findProgramAddressSync([QUASAR_ESCROW_SEED, payer.toBytes(), id], escrowProgramId)[0];
}

/**
 * Commitment pre-image: sha256(score || salt || escrow_address || program_id).
 * experiments/quasar-reputation/src/instructions/reveal.rs binds the commitment to the escrow
 * address so a commitment cannot be replayed across jobs or against another deployment.
 */
export function quasarRatingCommitment(
  score: number,
  salt: Uint8Array,
  escrow: PublicKey,
  reputationProgramId: PublicKey,
): Uint8Array {
  if (score < 1 || score > 10) throw new Error("invalid_score");
  if (salt.length !== 32) throw new Error("salt_must_be_32_bytes");
  const hash = createHash("sha256");
  hash.update(Buffer.from([score]));
  hash.update(Buffer.from(salt));
  hash.update(Buffer.from(escrow.toBytes()));
  hash.update(Buffer.from(reputationProgramId.toBytes()));
  return new Uint8Array(hash.digest());
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
  assertQuasarProgramTargetUsable();
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
  assertQuasarProgramTargetUsable();
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
  assertQuasarProgramTargetUsable();
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
  escrow: PublicKey;
  signer: PublicKey;
  commitment: Uint8Array;
  role: 0 | 1;
  ratingPda?: PublicKey;
}): TransactionInstruction {
  assertQuasarProgramTargetUsable();
  const rating = input.ratingPda ?? quasarRatingPda(input.escrow, input.programId);
  return new TransactionInstruction({
    programId: input.programId,
    keys: [
      { pubkey: input.escrow, isSigner: false, isWritable: false },
      { pubkey: rating, isSigner: false, isWritable: true },
      { pubkey: input.signer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: buildQuasarCommitRatingData(input.commitment, input.role),
  });
}

export function buildQuasarRevealRatingInstruction(input: {
  programId: PublicKey;
  escrow: PublicKey;
  signer: PublicKey;
  score: number;
  salt: Uint8Array;
  specialistAgentPda: PublicKey;
  consumerAgentPda: PublicKey;
  ratingPda?: PublicKey;
}): TransactionInstruction {
  assertQuasarProgramTargetUsable();
  const rating = input.ratingPda ?? quasarRatingPda(input.escrow, input.programId);
  return new TransactionInstruction({
    programId: input.programId,
    keys: [
      { pubkey: input.escrow, isSigner: false, isWritable: false },
      { pubkey: rating, isSigner: false, isWritable: true },
      { pubkey: input.signer, isSigner: true, isWritable: false },
      { pubkey: input.specialistAgentPda, isSigner: false, isWritable: true },
      { pubkey: input.consumerAgentPda, isSigner: false, isWritable: true },
    ],
    data: buildQuasarRevealRatingData(input.score, input.salt),
  });
}

export function buildQuasarExpireRatingInstruction(input: {
  programId: PublicKey;
  escrow: PublicKey;
  caller: PublicKey;
  specialistAgentPda: PublicKey;
  consumerAgentPda: PublicKey;
  ratingPda?: PublicKey;
}): TransactionInstruction {
  assertQuasarProgramTargetUsable();
  const rating = input.ratingPda ?? quasarRatingPda(input.escrow, input.programId);
  return new TransactionInstruction({
    programId: input.programId,
    keys: [
      { pubkey: input.escrow, isSigner: false, isWritable: false },
      { pubkey: rating, isSigner: false, isWritable: true },
      { pubkey: input.caller, isSigner: true, isWritable: false },
      { pubkey: input.specialistAgentPda, isSigner: false, isWritable: true },
      { pubkey: input.consumerAgentPda, isSigner: false, isWritable: true },
    ],
    data: buildQuasarExpireRatingData(),
  });
}

export function buildQuasarAttestQualityInstruction(input: {
  programId: PublicKey;
  escrow: PublicKey;
  judge: PublicKey;
  scores: Uint8Array;
  attestationPda?: PublicKey;
  judgeAgentPda?: PublicKey;
}): TransactionInstruction {
  assertQuasarProgramTargetUsable();
  const attestation = input.attestationPda ?? quasarAttestationPda(input.escrow, input.programId);
  const judgeAgent = input.judgeAgentPda ?? quasarAgentPda(input.judge, input.programId);
  return new TransactionInstruction({
    programId: input.programId,
    keys: [
      { pubkey: input.escrow, isSigner: false, isWritable: false },
      { pubkey: attestation, isSigner: false, isWritable: true },
      { pubkey: judgeAgent, isSigner: false, isWritable: false },
      { pubkey: input.judge, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: buildQuasarAttestQualityData(input.scores),
  });
}

export function buildQuasarConfirmAttestationInstruction(input: {
  programId: PublicKey;
  escrow: PublicKey;
  consumer: PublicKey;
  judge: PublicKey;
  attestationPda?: PublicKey;
  judgeAgentPda?: PublicKey;
}): TransactionInstruction {
  assertQuasarProgramTargetUsable();
  const attestation = input.attestationPda ?? quasarAttestationPda(input.escrow, input.programId);
  const judgeAgent = input.judgeAgentPda ?? quasarAgentPda(input.judge, input.programId);
  return new TransactionInstruction({
    programId: input.programId,
    keys: [
      { pubkey: input.escrow, isSigner: false, isWritable: false },
      { pubkey: attestation, isSigner: false, isWritable: true },
      { pubkey: judgeAgent, isSigner: false, isWritable: true },
      { pubkey: input.consumer, isSigner: true, isWritable: false },
    ],
    data: buildQuasarConfirmAttestationData(),
  });
}

export function buildQuasarDisputeAttestationInstruction(input: {
  programId: PublicKey;
  escrow: PublicKey;
  consumer: PublicKey;
  judge: PublicKey;
  attestationPda?: PublicKey;
  judgeAgentPda?: PublicKey;
}): TransactionInstruction {
  assertQuasarProgramTargetUsable();
  const attestation = input.attestationPda ?? quasarAttestationPda(input.escrow, input.programId);
  const judgeAgent = input.judgeAgentPda ?? quasarAgentPda(input.judge, input.programId);
  return new TransactionInstruction({
    programId: input.programId,
    keys: [
      { pubkey: input.escrow, isSigner: false, isWritable: false },
      { pubkey: attestation, isSigner: false, isWritable: true },
      { pubkey: judgeAgent, isSigner: false, isWritable: true },
      { pubkey: input.consumer, isSigner: true, isWritable: false },
    ],
    data: buildQuasarDisputeAttestationData(),
  });
}
