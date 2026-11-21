import { PublicKey, SystemProgram } from "@solana/web3.js";
import { decodeRatingAccount, ratingPda } from "@reddi/x402-solana/rating";

import { IX } from "@/lib/program";
import { buildOnboardingAttestQualityInstruction, onboardingAttestationPda } from "@/lib/onboarding/attestation-instruction";
import { registrationAgentPda } from "@/lib/register/registration-instruction";
import vectors from "@/programs/pinocchio-escrow/interface/vectors.json";

describe("onboarding attest_quality instruction", () => {
  const programId = new PublicKey("VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW");
  const judge = new PublicKey("11111111111111111111111111111112");
  const escrow = new PublicKey("11111111111111111111111111111113");
  const scores: [number, number, number, number, number] = [8, 8, 9, 9, 10];

  it("builds attest_quality for the job's escrow: attestation, rating, judge agent, judge, system program", () => {
    const ix = buildOnboardingAttestQualityInstruction({ programId, judge, escrow, scores, openedSlot: BigInt(1040) });

    expect(ix.programId.toBase58()).toBe(programId.toBase58());
    // Five scores, then the rating's opened slot as a u64 little-endian.
    expect(ix.data.equals(Buffer.concat([IX.attest_quality, Buffer.from(scores), Buffer.from([0x10, 0x04, 0, 0, 0, 0, 0, 0])]))).toBe(true);
    expect(ix.keys.map((key) => key.pubkey.toBase58())).toEqual([
      onboardingAttestationPda(escrow, programId).toBase58(),
      ratingPda(escrow, programId).toBase58(),
      registrationAgentPda(judge, programId).toBase58(),
      judge.toBase58(),
      SystemProgram.programId.toBase58(),
    ]);
    expect(ix.keys.map((key) => [key.isSigner, key.isWritable])).toEqual([
      [false, true],
      [false, true],
      [false, false],
      [true, true],
      [false, false],
    ]);
  });

  it("matches the program's interface vector byte for byte", () => {
    const vector = vectors.instructions.find((entry) => entry.name === "attest_quality")!;
    const account = (name: string) => new PublicKey(vector.accounts.find((meta) => meta.name === name)!.address);
    const open = vectors.instructions.find((entry) => entry.name === "open_rating")!;
    const ix = buildOnboardingAttestQualityInstruction({
      programId: new PublicKey(vectors.program_id),
      escrow: new PublicKey(open.accounts.find((meta) => meta.name === "escrow")!.address),
      judge: account("judge"),
      scores: [9, 8, 10, 1, 7],
      // The opened slot of the rating account at that escrow, as the judge reads it.
      openedSlot: decodeRatingAccount(Buffer.from(vectors.accounts.find((entry) => entry.name === "rating_open")!.data_hex, "hex")).openedSlot,
    });

    expect(ix.data.toString("hex")).toBe(vector.data_hex);
    expect(ix.keys.map((key) => ({ address: key.pubkey.toBase58(), signer: key.isSigner, writable: key.isWritable }))).toEqual(
      vector.accounts.map(({ address, signer, writable }) => ({ address, signer, writable })),
    );
  });

  it("refuses a score outside 1 to 10", () => {
    expect(() => buildOnboardingAttestQualityInstruction({ programId, judge, escrow, scores: [8, 8, 9, 9, 11], openedSlot: BigInt(1) })).toThrow("1 to 10");
  });

  it("refuses a missing opened slot", () => {
    expect(() => buildOnboardingAttestQualityInstruction({ programId, judge, escrow, scores, openedSlot: undefined as unknown as bigint })).toThrow("openedSlot");
  });
});
