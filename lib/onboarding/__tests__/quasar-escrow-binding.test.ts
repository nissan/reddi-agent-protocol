import { PublicKey } from "@solana/web3.js";
import { createHash } from "crypto";

import {
  QUASAR_ESCROW_UNAVAILABLE_REASON,
  lockCreatedEscrowPda,
  resolveOnboardingQuasarEscrow,
  verifyLockCreatedEscrow,
  type VerifiedLockRecord,
} from "@/lib/onboarding/quasar-escrow-binding";

describe("Quasar escrow binding", () => {
  const consumer = new PublicKey("11111111111111111111111111111112");
  const specialist = new PublicKey("11111111111111111111111111111113");
  const escrowProgramId = new PublicKey("VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW");
  const expected = { consumer, specialist, escrowProgramId };

  function lockRecord(overrides: Partial<VerifiedLockRecord> = {}): VerifiedLockRecord {
    const escrowId = overrides.escrowId ?? 0n;
    const payer = overrides.payer ? new PublicKey(overrides.payer) : consumer;
    return {
      escrowAddress: lockCreatedEscrowPda(payer, escrowId, escrowProgramId).toBase58(),
      escrowId,
      payer: payer.toBase58(),
      payee: specialist.toBase58(),
      status: "locked",
      escrowProgramId: escrowProgramId.toBase58(),
      ...overrides,
    };
  }

  it("derives the escrow from the payer's sequential counter value, matching lock.rs", () => {
    // experiments/quasar-escrow/src/state.rs: #[seeds(b"escrow", payer: Address, escrow_id: u64)]
    // and lock.rs enforces escrow_id == counter.next_id, so ids are 0, 1, 2, ... per payer.
    for (const escrowId of [0n, 1n, 2n, 7n]) {
      const id = Buffer.alloc(8);
      id.writeBigUInt64LE(escrowId);
      expect(lockCreatedEscrowPda(consumer, escrowId, escrowProgramId).toBase58()).toBe(
        PublicKey.findProgramAddressSync(
          [Buffer.from("escrow"), consumer.toBytes(), id],
          escrowProgramId,
        )[0].toBase58(),
      );
    }
  });

  it("gives each sequential counter value a distinct escrow", () => {
    const addresses = [0n, 1n, 2n].map((id) => lockCreatedEscrowPda(consumer, id, escrowProgramId).toBase58());
    expect(new Set(addresses).size).toBe(3);
  });

  it("accepts a lock record whose address really is the lock-derived PDA", () => {
    const record = lockRecord({ escrowId: 3n });
    expect(verifyLockCreatedEscrow(record, expected).toBase58()).toBe(record.escrowAddress);
  });

  it("refuses a hash-derived escrow id, which no lock can ever produce", () => {
    // The scheme this replaced used sha256(jobId) as the escrow id; lock.rs would reject it because
    // it is not the payer's next counter value, so the PDA names an account that cannot exist.
    const jobId = Uint8Array.from(Array.from({ length: 16 }, (_, i) => i + 1));
    const hashedId = createHash("sha256").update(Buffer.from(jobId)).digest().readBigUInt64LE(0);
    const forged = lockCreatedEscrowPda(consumer, hashedId, escrowProgramId);

    expect(() =>
      verifyLockCreatedEscrow(lockRecord({ escrowId: 0n, escrowAddress: forged.toBase58() }), expected),
    ).toThrow(/quasar_escrow_address_not_lock_derived/);
  });

  it("refuses an address that is not derived from the recorded payer and id", () => {
    const foreign = lockCreatedEscrowPda(specialist, 0n, escrowProgramId);
    expect(() =>
      verifyLockCreatedEscrow(lockRecord({ escrowAddress: foreign.toBase58() }), expected),
    ).toThrow(/quasar_escrow_address_not_lock_derived/);
  });

  it("refuses an escrow locked under a different escrow program", () => {
    const otherProgram = new PublicKey("Xk7jczJZ1HHJZuE1ZUWDqFmowxYhnom7mWzrNSGf9FU");
    const record = lockRecord();
    expect(() =>
      verifyLockCreatedEscrow(
        { ...record, escrowProgramId: otherProgram.toBase58(), escrowAddress: lockCreatedEscrowPda(consumer, 0n, otherProgram).toBase58() },
        expected,
      ),
    ).toThrow(/quasar_escrow_wrong_program/);
  });

  it("refuses an escrow whose payer or payee is not this job's parties", () => {
    const stranger = new PublicKey("11111111111111111111111111111114");
    expect(() => verifyLockCreatedEscrow(lockRecord({ payer: stranger.toBase58() }), expected)).toThrow(
      /quasar_escrow_wrong_payer/,
    );
    expect(() => verifyLockCreatedEscrow(lockRecord({ payee: stranger.toBase58() }), expected)).toThrow(
      /quasar_escrow_wrong_payee/,
    );
  });

  it("accepts a released escrow, which is the state a settled job is rated in", () => {
    // release.rs dropped `close = payer` (CRITICAL-4) so the escrow survives settlement as a durable
    // job record; the ordering is lock -> release -> commit -> reveal -> attest, so by rating time
    // the escrow is Released. Neither reputation nor attestation reads the status.
    const record = lockRecord({ escrowId: 2n, status: "released" });
    expect(verifyLockCreatedEscrow(record, expected).toBase58()).toBe(record.escrowAddress);
  });

  it("accepts a still-locked escrow", () => {
    const record = lockRecord({ status: "locked" });
    expect(verifyLockCreatedEscrow(record, expected).toBase58()).toBe(record.escrowAddress);
  });

  it("refuses a cancelled escrow, which is a job that never completed", () => {
    expect(() => verifyLockCreatedEscrow(lockRecord({ status: "cancelled" }), expected)).toThrow(
      /quasar_escrow_not_rateable/,
    );
  });

  it("refuses a malformed address in the record", () => {
    expect(() => verifyLockCreatedEscrow(lockRecord({ escrowAddress: "not-an-address" }), expected)).toThrow(
      /quasar_escrow_record_has_a_malformed_address/,
    );
  });

  it("refuses with the canonical reason when there is no verified lock record at all", () => {
    expect(() => resolveOnboardingQuasarEscrow({ expected })).toThrow(QUASAR_ESCROW_UNAVAILABLE_REASON);
    expect(QUASAR_ESCROW_UNAVAILABLE_REASON).toMatch(/never locks a Quasar escrow/);
  });

  it("resolves a verified lock record through the same entry point", () => {
    const record = lockRecord({ escrowId: 1n });
    expect(resolveOnboardingQuasarEscrow({ lockRecord: record, expected }).toBase58()).toBe(record.escrowAddress);
  });
});

describe("participant resolution order", () => {
  const consumer = new PublicKey("11111111111111111111111111111112");
  const specialist = new PublicKey("11111111111111111111111111111113");
  const escrowProgramId = new PublicKey("VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW");
  const expected = { consumer, specialist, escrowProgramId };

  // Reading a not-yet-resolved participant into the `expected` literal produced a ReferenceError
  // instead of the canonical refusal, so both participants must be real keys before this is called.
  it("refuses with the canonical reason, not an internal error, when no lock record exists", () => {
    let thrown: unknown;
    try {
      resolveOnboardingQuasarEscrow({ expected });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(QUASAR_ESCROW_UNAVAILABLE_REASON);
    expect((thrown as Error).message).not.toMatch(/before initialization/);
  });

  it("verifies a fully resolved participant pair against a released record", () => {
    const record = {
      escrowAddress: lockCreatedEscrowPda(consumer, 0n, escrowProgramId).toBase58(),
      escrowId: 0n,
      payer: consumer.toBase58(),
      payee: specialist.toBase58(),
      status: "released" as const,
      escrowProgramId: escrowProgramId.toBase58(),
    };

    expect(resolveOnboardingQuasarEscrow({ lockRecord: record, expected }).toBase58()).toBe(record.escrowAddress);
  });
});
