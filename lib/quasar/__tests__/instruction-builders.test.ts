import {
  buildQuasarAttestQualityData,
  buildQuasarCommitRatingData,
  buildQuasarConfirmAttestationData,
  buildQuasarDeregisterAgentData,
  buildQuasarDisputeAttestationData,
  buildQuasarExpireRatingData,
  buildQuasarRegisterData,
  buildQuasarRevealRatingData,
  buildQuasarUpdateAgentData,
} from "@/lib/quasar/instruction-builders";
import { IX } from "@/lib/program";

describe("Quasar instruction-data builders", () => {
  const jobId = Uint8Array.from(Array.from({ length: 16 }, (_, i) => i + 1));
  const commitment = Uint8Array.from(Array.from({ length: 32 }, (_, i) => 100 + i));
  const consumer = Uint8Array.from(Array.from({ length: 32 }, (_, i) => 10 + i));
  const specialist = Uint8Array.from(Array.from({ length: 32 }, (_, i) => 50 + i));
  const salt = Uint8Array.from(Array.from({ length: 32 }, (_, i) => 200 - i));

  it("builds registry data with one-byte Quasar discriminators, not Anchor discriminators", () => {
    const register = buildQuasarRegisterData(2, "qwen3:8b", 1_000_000n, 3);
    expect(register.length).toBe(76);
    expect(register[0]).toBe(0);
    expect(register.subarray(0, 8).equals(IX.register_agent)).toBe(false);
    expect(register[1]).toBe(2);
    expect(register[2]).toBe("qwen3:8b".length);
    expect(register.subarray(3, 11).toString("utf8")).toBe("qwen3:8b");
    expect(register.readBigUInt64LE(67)).toBe(1_000_000n);
    expect(register[75]).toBe(3);

    const update = buildQuasarUpdateAgentData(2_000_000n, 4, false);
    expect([...update]).toEqual([1, 0x80, 0x84, 0x1e, 0, 0, 0, 0, 0, 4, 0]);
    expect([...buildQuasarDeregisterAgentData()]).toEqual([2]);
  });

  it("builds post-job-binding reputation payloads with no caller-supplied job identity", () => {
    // experiments/quasar-reputation/src/lib.rs: commit(commitment: [u8;32], role: u8) disc 1.
    const commit = buildQuasarCommitRatingData(commitment, 1);
    expect(commit.length).toBe(34);
    expect(commit[0]).toBe(1);
    expect([...commit.subarray(1, 33)]).toEqual([...commitment]);
    expect(commit[33]).toBe(1);

    // reveal(score: u8, salt: [u8;32]) disc 2.
    const reveal = buildQuasarRevealRatingData(9, salt);
    expect(reveal.length).toBe(34);
    expect(reveal[0]).toBe(2);
    expect(reveal[1]).toBe(9);
    expect([...reveal.subarray(2, 34)]).toEqual([...salt]);

    // expire() disc 3 — no arguments.
    expect([...buildQuasarExpireRatingData()]).toEqual([3]);
  });

  it("builds post-job-binding attestation payloads carrying only the scores", () => {
    // experiments/quasar-attestation/src/lib.rs: attest(scores: [u8;5]) disc 1, confirm/dispute no args.
    const scores = Uint8Array.from([8, 9, 10, 7, 6]);
    const attest = buildQuasarAttestQualityData(scores);
    expect(attest.length).toBe(6);
    expect(attest[0]).toBe(1);
    expect([...attest.subarray(1, 6)]).toEqual([...scores]);

    expect([...buildQuasarConfirmAttestationData()]).toEqual([2]);
    expect([...buildQuasarDisputeAttestationData()]).toEqual([3]);
  });

  it("no reputation or attestation payload carries job_id, consumer_pk, or specialist_pk", () => {
    const scores = Uint8Array.from([8, 9, 10, 7, 6]);
    const payloads = [
      buildQuasarCommitRatingData(commitment, 0),
      buildQuasarRevealRatingData(9, salt),
      buildQuasarExpireRatingData(),
      buildQuasarAttestQualityData(scores),
      buildQuasarConfirmAttestationData(),
      buildQuasarDisputeAttestationData(),
    ];
    // The pre-binding layouts were 114/50/17/54/17/17 bytes; the current ones cannot fit a pubkey.
    expect(payloads.map((p) => p.length)).toEqual([34, 34, 1, 6, 1, 1]);
    for (const payload of payloads) {
      expect(payload.includes(Buffer.from(consumer))).toBe(false);
      expect(payload.includes(Buffer.from(specialist))).toBe(false);
      expect(payload.includes(Buffer.from(jobId))).toBe(false);
    }
  });

  it("rejects invalid fixed-size Quasar inputs before transaction construction", () => {
    expect(() => buildQuasarRegisterData(0, "x".repeat(65), 1n, 0)).toThrow("model_too_long");
    expect(() => buildQuasarCommitRatingData(commitment.slice(0, 31), 0)).toThrow("commitment_must_be_32_bytes");
    expect(() => buildQuasarCommitRatingData(commitment, 2 as 0 | 1)).toThrow("invalid_role");
    expect(() => buildQuasarRevealRatingData(0, salt)).toThrow("invalid_score");
    expect(() => buildQuasarRevealRatingData(9, salt.slice(0, 31))).toThrow("salt_must_be_32_bytes");
    expect(() => buildQuasarAttestQualityData(Uint8Array.from([1, 2, 0, 4, 5]))).toThrow("invalid_attestation_score");
});
});
