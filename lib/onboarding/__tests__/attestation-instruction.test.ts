import { PublicKey } from "@solana/web3.js";

import { IX } from "@/lib/program";
import { buildOnboardingAttestQualityInstruction } from "@/lib/onboarding/attestation-instruction";
import { quasarAttestationPda } from "@/lib/quasar/instructions";

describe("target-aware onboarding attest_quality instruction", () => {
  const programId = new PublicKey("VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW");
  const judge = new PublicKey("11111111111111111111111111111112");
  const consumer = new PublicKey("11111111111111111111111111111113");
  const jobId = Uint8Array.from(Array.from({ length: 16 }, (_, i) => i + 1));
  const scores: [number, number, number, number, number] = [8, 8, 9, 9, 10];

  it("keeps Anchor attestation encoding in legacy mode", () => {
    const ix = buildOnboardingAttestQualityInstruction({ target: "legacy-anchor", programId, judge, consumer, jobId, scores });
    expect(ix.data.subarray(0, 8).equals(IX.attest_quality)).toBe(true);
  });

  it("uses the current escrow-bound Quasar attestation encoding in Quasar mode", () => {
    const escrow = new PublicKey("11111111111111111111111111111114");
    const ix = buildOnboardingAttestQualityInstruction({ target: "quasar", programId, judge, consumer, jobId, scores, escrow });
    expect(ix.data[0]).toBe(1);
    expect(ix.data.length).toBe(6);
    expect([...ix.data.subarray(1, 6)]).toEqual(scores);
    expect(ix.data.subarray(0, 8).equals(IX.attest_quality)).toBe(false);
    expect(ix.keys[0].pubkey.toBase58()).toBe(escrow.toBase58());
  });

  it("addresses the Quasar attest instruction to the attestation program, never the escrow program", () => {
    // Quasar splits into four programs: attest is discriminator 1 on the *attestation* program,
    // while discriminator 1 on the escrow program is a settlement instruction. Building under the
    // escrow program id would silently address the wrong program with the same first byte.
    const escrow = new PublicKey("11111111111111111111111111111114");
    const attestationProgramId = new PublicKey("CRGsWWkptdxsH6N6aWAyahLbuMsT58yM624EopEsv1Ex");
    const escrowProgramId = new PublicKey("VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW");

    const ix = buildOnboardingAttestQualityInstruction({
      target: "quasar", programId: attestationProgramId, judge, consumer, jobId, scores, escrow,
    });

    expect(ix.programId.toBase58()).toBe(attestationProgramId.toBase58());
    expect(ix.programId.toBase58()).not.toBe(escrowProgramId.toBase58());

    // The attestation PDA must live under the attestation program too.
    const underAttestation = quasarAttestationPda(escrow, attestationProgramId);
    const underEscrow = quasarAttestationPda(escrow, escrowProgramId);
    expect(ix.keys[1].pubkey.toBase58()).toBe(underAttestation.toBase58());
    expect(ix.keys[1].pubkey.toBase58()).not.toBe(underEscrow.toBase58());
  });

  it("refuses a Quasar attestation with no escrow to bind the job to", () => {
    expect(() =>
      buildOnboardingAttestQualityInstruction({ target: "quasar", programId, judge, consumer, jobId, scores }),
    ).toThrow("quasar_attestation_requires_escrow");
  });
});
