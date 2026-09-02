import { PublicKey, SystemProgram } from "@solana/web3.js";

import { AGENT_SEED, IX } from "@/lib/program";
import { buildOnboardingAttestQualityInstruction, onboardingAttestationPda } from "@/lib/onboarding/attestation-instruction";
import { registrationAgentPda } from "@/lib/register/registration-instruction";

describe("onboarding attest_quality instruction", () => {
  const programId = new PublicKey("VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW");
  const judge = new PublicKey("11111111111111111111111111111112");
  const consumer = new PublicKey("11111111111111111111111111111113");
  const jobId = Uint8Array.from(Array.from({ length: 16 }, (_, i) => i + 1));
  const scores: [number, number, number, number, number] = [8, 8, 9, 9, 10];
  const legacyJudgeAgent = PublicKey.findProgramAddressSync([AGENT_SEED, judge.toBytes()], programId)[0];

  it("builds the Anchor attest_quality layout onboarding actually submits", () => {
    const ix = buildOnboardingAttestQualityInstruction({ programId, judge, consumer, jobId, scores });

    expect(ix.programId.toBase58()).toBe(programId.toBase58());
    expect(ix.data.subarray(0, 8).equals(IX.attest_quality)).toBe(true);
    expect(ix.keys.map((key) => key.pubkey.toBase58())).toEqual([
      onboardingAttestationPda(jobId, programId).toBase58(),
      legacyJudgeAgent.toBase58(),
      judge.toBase58(),
      SystemProgram.programId.toBase58(),
    ]);
    expect(ix.keys.map((key) => [key.isSigner, key.isWritable])).toEqual([
      [false, true],
      [false, false],
      [true, true],
      [false, false],
    ]);
  });

  it("derives the judge agent at the same address agent registration creates", () => {
    const ix = buildOnboardingAttestQualityInstruction({ programId, judge, consumer, jobId, scores });

    expect(ix.keys[1].pubkey.toBase58()).toBe(registrationAgentPda(judge, programId).toBase58());
  });

  it("refuses a job id that is not the 16 bytes the attestation PDA is seeded by", () => {
    expect(() => onboardingAttestationPda(Uint8Array.from([1, 2, 3]), programId)).toThrow("job_id_must_be_16_bytes");
  });
});
