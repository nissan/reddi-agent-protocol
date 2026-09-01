/**
 * Quasar instruction-data builders for the hackathon cutover path.
 *
 * These builders intentionally do NOT reuse Anchor's 8-byte SHA256 discriminators.
 * Quasar parity programs use a single-byte discriminator declared via
 * `#[instruction(discriminator = N)]`.
 *
 * Source evidence:
 * - docs/verifiable-agent-protocol/colosseum-frontier-2026-04/QUASAR-REGISTRY-PARITY-REPORT.md
 * - docs/verifiable-agent-protocol/colosseum-frontier-2026-04/QUASAR-REPUTATION-PARITY-REPORT.md
 * - docs/verifiable-agent-protocol/colosseum-frontier-2026-04/QUASAR-ATTESTATION-PARITY-REPORT.md
 */

export const QUASAR_DISC = {
  register: 0,
  update: 1,
  deregister: 2,
  reputationCommit: 1,
  reputationReveal: 2,
  reputationExpire: 3,
  attest: 1,
  confirmAttestation: 2,
  disputeAttestation: 3,
} as const;

export const QUASAR_MODEL_MAX_BYTES = 64;
export const QUASAR_HASH_BYTES = 32;

function writeU64LE(target: Uint8Array, offset: number, value: bigint) {
  let v = value;
  for (let i = 0; i < 8; i += 1) {
    target[offset + i] = Number(v & 0xffn);
    v >>= 8n;
  }
}

function requireFixedBytes(name: string, value: Uint8Array, expected: number) {
  if (value.length !== expected) {
    throw new Error(`${name}_must_be_${expected}_bytes`);
  }
}

function bytesFromUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function buildQuasarRegisterData(
  agentType: number,
  model: string,
  rateLamports: bigint,
  minReputation: number,
): Buffer {
  const modelBytes = bytesFromUtf8(model);
  if (modelBytes.length > QUASAR_MODEL_MAX_BYTES) throw new Error("model_too_long");
  if (agentType < 0 || agentType > 2) throw new Error("invalid_agent_type");

  // disc(1) + agent_type(1) + model_len(1) + model_data(64) + rate_lamports(8) + min_reputation(1)
  const data = new Uint8Array(1 + 1 + 1 + QUASAR_MODEL_MAX_BYTES + 8 + 1);
  let o = 0;
  data[o++] = QUASAR_DISC.register;
  data[o++] = agentType;
  data[o++] = modelBytes.length;
  data.set(modelBytes, o); o += QUASAR_MODEL_MAX_BYTES;
  writeU64LE(data, o, rateLamports); o += 8;
  data[o++] = minReputation;
  return Buffer.from(data);
}

export function buildQuasarUpdateAgentData(rateLamports: bigint, minReputation: number, active: boolean): Buffer {
  const data = new Uint8Array(1 + 8 + 1 + 1);
  let o = 0;
  data[o++] = QUASAR_DISC.update;
  writeU64LE(data, o, rateLamports); o += 8;
  data[o++] = minReputation;
  data[o++] = active ? 1 : 0;
  return Buffer.from(data);
}

export function buildQuasarDeregisterAgentData(): Buffer {
  return Buffer.from([QUASAR_DISC.deregister]);
}

/**
 * Post-job-binding reputation/attestation payloads.
 *
 * Job identity comes from the escrow account (the rating/attestation PDA is seeded by the escrow
 * address and the parties are read from `escrow.payer`/`escrow.payee`), so there is no
 * caller-supplied `job_id`, `consumer_pk`, or `specialist_pk` in any of these instructions.
 * Sources: experiments/quasar-reputation/src/lib.rs (commit=1, reveal=2, expire=3) and
 * experiments/quasar-attestation/src/lib.rs (attest=1, confirm=2, dispute=3).
 */
export function buildQuasarCommitRatingData(commitment: Uint8Array, role: 0 | 1): Buffer {
  requireFixedBytes("commitment", commitment, QUASAR_HASH_BYTES);
  if (role !== 0 && role !== 1) throw new Error("invalid_role");
  const data = new Uint8Array(1 + QUASAR_HASH_BYTES + 1);
  data[0] = QUASAR_DISC.reputationCommit;
  data.set(commitment, 1);
  data[1 + QUASAR_HASH_BYTES] = role;
  return Buffer.from(data);
}

export function buildQuasarRevealRatingData(score: number, salt: Uint8Array): Buffer {
  if (score < 1 || score > 10) throw new Error("invalid_score");
  requireFixedBytes("salt", salt, QUASAR_HASH_BYTES);
  const data = new Uint8Array(1 + 1 + QUASAR_HASH_BYTES);
  data[0] = QUASAR_DISC.reputationReveal;
  data[1] = score;
  data.set(salt, 2);
  return Buffer.from(data);
}

export function buildQuasarExpireRatingData(): Buffer {
  return Buffer.from([QUASAR_DISC.reputationExpire]);
}

export function buildQuasarAttestQualityData(scores: Uint8Array): Buffer {
  requireFixedBytes("scores", scores, 5);
  for (const score of scores) {
    if (score < 1 || score > 10) throw new Error("invalid_attestation_score");
  }
  const data = new Uint8Array(1 + 5);
  data[0] = QUASAR_DISC.attest;
  data.set(scores, 1);
  return Buffer.from(data);
}

export function buildQuasarConfirmAttestationData(): Buffer {
  return Buffer.from([QUASAR_DISC.confirmAttestation]);
}

export function buildQuasarDisputeAttestationData(): Buffer {
  return Buffer.from([QUASAR_DISC.disputeAttestation]);
}
