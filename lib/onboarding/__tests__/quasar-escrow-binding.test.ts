import { PublicKey } from "@solana/web3.js";

import {
  deriveOnboardingQuasarEscrow,
  onboardingEscrowId,
  resolveBoundQuasarEscrow,
} from "@/lib/onboarding/quasar-escrow-binding";
import { quasarEscrowPda } from "@/lib/quasar/instructions";

describe("onboarding Quasar escrow binding", () => {
  const consumer = new PublicKey("11111111111111111111111111111112");
  const escrowProgramId = new PublicKey("VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW");
  const jobId = Uint8Array.from(Array.from({ length: 16 }, (_, i) => i + 1));
  const otherJobId = Uint8Array.from(Array.from({ length: 16 }, (_, i) => i + 2));

  it("derives the escrow from the Quasar escrow seeds, not from a caller value", () => {
    const derived = deriveOnboardingQuasarEscrow({ consumer, jobId, escrowProgramId });

    // experiments/quasar-escrow/src/state.rs: #[seeds(b"escrow", payer: Address, escrow_id: u64)]
    expect(derived.toBase58()).toBe(
      quasarEscrowPda(consumer, onboardingEscrowId(jobId), escrowProgramId).toBase58(),
    );
    expect(derived.toBytes().length).toBe(32);
  });

  it("is deterministic per job and distinct across jobs and consumers", () => {
    const a = deriveOnboardingQuasarEscrow({ consumer, jobId, escrowProgramId });
    const b = deriveOnboardingQuasarEscrow({ consumer, jobId, escrowProgramId });
    const otherJob = deriveOnboardingQuasarEscrow({ consumer, jobId: otherJobId, escrowProgramId });
    const otherConsumer = deriveOnboardingQuasarEscrow({
      consumer: new PublicKey("11111111111111111111111111111113"), jobId, escrowProgramId,
    });

    expect(a.toBase58()).toBe(b.toBase58());
    expect(a.toBase58()).not.toBe(otherJob.toBase58());
    expect(a.toBase58()).not.toBe(otherConsumer.toBase58());
  });

  it("resolves to the derived escrow when nothing is supplied", () => {
    expect(resolveBoundQuasarEscrow({ consumer, jobId, escrowProgramId }).toBase58()).toBe(
      deriveOnboardingQuasarEscrow({ consumer, jobId, escrowProgramId }).toBase58(),
    );
  });

  it("accepts a supplied escrow only when it matches what the job binds to", () => {
    const derived = deriveOnboardingQuasarEscrow({ consumer, jobId, escrowProgramId });
    expect(
      resolveBoundQuasarEscrow({ consumer, jobId, escrowProgramId, supplied: derived.toBase58() }).toBase58(),
    ).toBe(derived.toBase58());
  });

  it("refuses an escrow bound to a different job", () => {
    const foreign = deriveOnboardingQuasarEscrow({ consumer, jobId: otherJobId, escrowProgramId });
    expect(() =>
      resolveBoundQuasarEscrow({ consumer, jobId, escrowProgramId, supplied: foreign.toBase58() }),
    ).toThrow(/quasar_escrow_not_bound_to_this_job/);
  });

  it("refuses a value that is not a 32-byte Solana address", () => {
    for (const bad of ["not-an-address", "1234", "0x" + "11".repeat(32)]) {
      expect(() => resolveBoundQuasarEscrow({ consumer, jobId, escrowProgramId, supplied: bad })).toThrow(
        /quasar_escrow_not_a_valid_address/,
      );
    }
  });

  it("refuses a job identity that is not the canonical 16 bytes", () => {
    expect(() => onboardingEscrowId(jobId.slice(0, 15))).toThrow("job_id_must_be_16_bytes");
  });
});
