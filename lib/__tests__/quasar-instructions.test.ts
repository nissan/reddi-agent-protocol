import { createHash } from "crypto";

import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

import {
  buildQuasarCommitRatingInstruction,
  buildQuasarConfirmAttestationInstruction,
  buildQuasarDisputeAttestationInstruction,
  buildQuasarRegisterAgentInstruction,
  buildQuasarRevealRatingInstruction,
  quasarAgentPda,
  quasarAttestationPda,
  quasarRatingCommitment,
  quasarRatingPda,
} from "@/lib/quasar/instructions";

const programId = new PublicKey("VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW");
const localQuasarEnv = {
  NETWORK_PROFILE: "local-surfpool",
  NEXT_PUBLIC_DEMO_PROGRAM_TARGET: "quasar",
  NEXT_PUBLIC_RPC_ENDPOINT: "http://127.0.0.1:8899",
  NEXT_PUBLIC_RPC_WS_ENDPOINT: "ws://[::1]:8900",
  NEXT_PUBLIC_ESCROW_PROGRAM_ID: "VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW",
  NEXT_PUBLIC_REGISTRY_PROGRAM_ID: "Xk7jczJZ1HHJZuE1ZUWDqFmowxYhnom7mWzrNSGf9FU",
  NEXT_PUBLIC_REPUTATION_PROGRAM_ID: "nb9rLVjoHMibsgfRGgKuPqm6M8GVcH9r6bYNfg7Yiy6",
  NEXT_PUBLIC_ATTESTATION_PROGRAM_ID: "CRGsWWkptdxsH6N6aWAyahLbuMsT58yM624EopEsv1Ex",
};

describe("Quasar instruction wrappers", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, ...localQuasarEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });
  it("builds registration with Quasar account order and one-byte discriminator", () => {
    const owner = Keypair.generate().publicKey;
    const ix = buildQuasarRegisterAgentInstruction({
      programId,
      owner,
      agentType: 0,
      model: "ollama-local",
      rateLamports: 1_000_000n,
      minReputation: 0,
    });

    expect(ix.programId.toBase58()).toBe(programId.toBase58());
    expect([...ix.data.subarray(0, 3)]).toEqual([0, 0, "ollama-local".length]);
    expect(ix.data.length).toBe(76);
    expect(ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable])).toEqual([
      [quasarAgentPda(owner, programId).toBase58(), false, true],
      [owner.toBase58(), true, true],
      ["1nc1nerator11111111111111111111111111111111", false, true],
      [SystemProgram.programId.toBase58(), false, false],
    ]);
  });

  it("builds reputation commit/reveal with escrow-bound accounts and current payloads", () => {
    const escrow = Keypair.generate().publicKey;
    const consumer = Keypair.generate().publicKey;
    const specialist = Keypair.generate().publicKey;
    const commitment = Uint8Array.from(Array(32).fill(7));
    const salt = Uint8Array.from(Array(32).fill(9));

    // experiments/quasar-reputation/src/instructions/commit.rs:
    //   accounts [escrow (ro), rating (mut, seeds=[b"rating", escrow]), signer (mut), system_program]
    const commitIx = buildQuasarCommitRatingInstruction({ programId, escrow, signer: consumer, commitment, role: 0 });
    expect(commitIx.data[0]).toBe(1);
    expect(commitIx.data.length).toBe(34);
    expect(commitIx.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable])).toEqual([
      [escrow.toBase58(), false, false],
      [quasarRatingPda(escrow, programId).toBase58(), false, true],
      [consumer.toBase58(), true, true],
      [SystemProgram.programId.toBase58(), false, false],
    ]);

    // reveal.rs: accounts [escrow (ro), rating (mut), signer (ro), specialist_agent (mut), consumer_agent (mut)]
    const specialistAgent = quasarAgentPda(specialist, programId);
    const consumerAgent = quasarAgentPda(consumer, programId);
    const revealIx = buildQuasarRevealRatingInstruction({
      programId, escrow, signer: consumer, score: 8, salt,
      specialistAgentPda: specialistAgent, consumerAgentPda: consumerAgent,
    });
    expect(revealIx.data[0]).toBe(2);
    expect(revealIx.data.length).toBe(34);
    expect(revealIx.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable])).toEqual([
      [escrow.toBase58(), false, false],
      [quasarRatingPda(escrow, programId).toBase58(), false, true],
      [consumer.toBase58(), true, false],
      [specialistAgent.toBase58(), false, true],
      [consumerAgent.toBase58(), false, true],
    ]);
  });

  it("builds attestation confirm/dispute with escrow-bound accounts and no arguments", () => {
    const escrow = Keypair.generate().publicKey;
    const consumer = Keypair.generate().publicKey;
    const judge = Keypair.generate().publicKey;
    const attestation = quasarAttestationPda(escrow, programId);
    const judgeAgent = quasarAgentPda(judge, programId);

    const confirmIx = buildQuasarConfirmAttestationInstruction({ programId, escrow, consumer, judge });
    const disputeIx = buildQuasarDisputeAttestationInstruction({ programId, escrow, consumer, judge });

    // confirm.rs / dispute.rs: accounts [escrow (ro), attestation (mut), judge_agent (mut), consumer (signer)]
    for (const [ix, disc] of [[confirmIx, 2], [disputeIx, 3]] as const) {
      expect(ix.data[0]).toBe(disc);
      expect(ix.data.length).toBe(1);
      expect(ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable])).toEqual([
        [escrow.toBase58(), false, false],
        [attestation.toBase58(), false, true],
        [judgeAgent.toBase58(), false, true],
        [consumer.toBase58(), true, false],
      ]);
    }
  });

  it("seeds rating and attestation PDAs on the escrow address, not a job id", () => {
    const escrowA = Keypair.generate().publicKey;
    const escrowB = Keypair.generate().publicKey;

    expect(quasarRatingPda(escrowA, programId).toBase58()).toBe(
      PublicKey.findProgramAddressSync([Buffer.from("rating"), escrowA.toBytes()], programId)[0].toBase58(),
    );
    expect(quasarAttestationPda(escrowA, programId).toBase58()).toBe(
      PublicKey.findProgramAddressSync([Buffer.from("attestation"), escrowA.toBytes()], programId)[0].toBase58(),
    );
    expect(quasarRatingPda(escrowA, programId).toBase58()).not.toBe(quasarRatingPda(escrowB, programId).toBase58());
  });

  it("binds the commitment pre-image to score, salt, escrow address, and program id", () => {
    const escrow = Keypair.generate().publicKey;
    const salt = Uint8Array.from(Array(32).fill(5));

    // experiments/quasar-reputation/src/instructions/reveal.rs: sha256(score || salt || escrow || crate::ID)
    const expected = createHash("sha256")
      .update(Buffer.from([8]))
      .update(Buffer.from(salt))
      .update(Buffer.from(escrow.toBytes()))
      .update(Buffer.from(programId.toBytes()))
      .digest();

    expect(Buffer.from(quasarRatingCommitment(8, salt, escrow, programId))).toEqual(expected);
    // The pre-image is job-unique: a different escrow yields a different commitment.
    const other = quasarRatingCommitment(8, salt, Keypair.generate().publicKey, programId);
    expect(Buffer.from(other).equals(expected)).toBe(false);
  });
});
