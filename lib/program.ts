/**
 * On-chain program configuration for the Reddi Agent Protocol.
 *
 * Program deployed to Solana devnet.
 * To redeploy after funding blitz-dev wallet:
 *   anchor keys sync && anchor build && anchor deploy --provider.cluster devnet
 */
import { createHash } from "crypto";
import { PublicKey } from "@solana/web3.js";
import { getNetworkProfile } from "@/lib/config/network";

const network = getNetworkProfile();

/** Deployed program addresses (resolved from active network profile / env) */
export const ESCROW_PROGRAM_ID = new PublicKey(network.programs.escrowProgramId);
export const REGISTRY_PROGRAM_ID = new PublicKey(network.programs.registryProgramId ?? network.programs.escrowProgramId);
export const REPUTATION_PROGRAM_ID = new PublicKey(network.programs.reputationProgramId ?? network.programs.escrowProgramId);
export const ATTESTATION_PROGRAM_ID = new PublicKey(network.programs.attestationProgramId ?? network.programs.escrowProgramId);

/** Active on-chain implementation target. Quasar target selection does not imply Anchor layout compatibility. */
export const PROGRAM_TARGET = network.programs.target;
export const PROGRAM_FRAMEWORK = network.programs.framework;
export const PROGRAM_COMPATIBILITY = network.programs.compatibility;
export const PROGRAM_SUBMISSION_READY = network.programs.submissionReady;
export const PROGRAM_KNOWN_GAPS = network.programs.knownGaps;
export const PROGRAM_KNOWN_LIMITATIONS = network.programs.knownLimitations ?? [];
export const PROGRAM_DEPLOYMENT_STATUS = network.programs.deploymentStatus;

/**
 * Profile-wide submission gate: no audited deployment exists for the resolved profile.
 * Every transaction-signing surface consults it — browser wallet submits and server-side
 * operator signers alike — because the cost it prevents is the same on both.
 */
export const SUBMISSION_BLOCKED = !network.programs.submissionReady;
export const SUBMISSION_BLOCKED_REASON = network.programs.submissionReadyReason
  ? `Transaction submission is blocked on this network profile: ${network.programs.submissionReadyReason}${
      network.programs.deploymentStatus === "mainnet-not-deployed"
        ? " Submitting would spend real mainnet fees on a transaction against a program that is not executable on this cluster."
        : ""
    }`
  : "Transaction submission is blocked on this network profile because the resolved program set is not ready for transaction submission.";

/** Short button-sized label for the same gate, accurate on every profile it can block. */
export const SUBMISSION_BLOCKED_LABEL =
  network.programs.deploymentStatus === "mainnet-not-deployed"
    ? "Blocked: no audited mainnet deployment"
    : "Blocked: profile not submission-ready";

/** Solana RPC endpoint from active network profile */
export const DEVNET_RPC = network.solana.rpcHttp;

// ── PDA seeds (must match programs/escrow/src/constants.rs) ──────────────────

export const ESCROW_SEED = Buffer.from("escrow");
export const AGENT_SEED = Buffer.from("agent");
export const RATING_SEED = Buffer.from("rating");
export const ATTESTATION_SEED = Buffer.from("attestation");

// ── IDL-derived Anchor discriminators ────────────────────────────────────────
// Formula: SHA256("global:<ix_name>")[0..8]  (instructions)
//          SHA256("account:<AccountName>")[0..8]  (account discriminators)

function disc(prefix: "global" | "account", name: string): Buffer {
  return createHash("sha256")
    .update(`${prefix}:${name}`)
    .digest()
    .subarray(0, 8);
}

export const IX = {
  register_agent: disc("global", "register_agent"),
  update_agent: disc("global", "update_agent"),
  deregister_agent: disc("global", "deregister_agent"),
  lock_escrow: disc("global", "lock_escrow"),
  release_escrow: disc("global", "release_escrow"),
  release_escrow_per: disc("global", "release_escrow_per"),
  delegate_escrow: disc("global", "delegate_escrow"),
  commit_rating: disc("global", "commit_rating"),
  reveal_rating: disc("global", "reveal_rating"),
  attest_quality: disc("global", "attest_quality"),
  confirm_attestation: disc("global", "confirm_attestation"),
  dispute_attestation: disc("global", "dispute_attestation"),
} as const;

export const ACCOUNT_DISC = {
  AgentAccount: disc("account", "AgentAccount"),
  EscrowAccount: disc("account", "EscrowAccount"),
  RatingAccount: disc("account", "RatingAccount"),
  AttestationAccount: disc("account", "AttestationAccount"),
} as const;

export const QUASAR_ACCOUNT_DISC = {
  AgentAccount: Buffer.from([20]),
} as const;

export const ANCHOR_AGENT_ACCOUNT_DATA_SIZE = 150;
export const QUASAR_AGENT_ACCOUNT_DATA_SIZE = 153;
export const ACTIVE_AGENT_ACCOUNT_DISC = PROGRAM_TARGET === "quasar" ? QUASAR_ACCOUNT_DISC.AgentAccount : ACCOUNT_DISC.AgentAccount;
export const ACTIVE_AGENT_ACCOUNT_DATA_SIZE = PROGRAM_TARGET === "quasar" ? QUASAR_AGENT_ACCOUNT_DATA_SIZE : ANCHOR_AGENT_ACCOUNT_DATA_SIZE;

// ── Agent type encoding (matches Anchor borsh enum) ───────────────────────────

export const AGENT_TYPE_ENUM = {
  Primary: 0,
  Attestation: 1,
  Both: 2,
} as const;

export type AgentTypeEnum = keyof typeof AGENT_TYPE_ENUM;

// ── On-chain AgentAccount decoder ─────────────────────────────────────────────
// Layout (post-discriminator, from programs/escrow/src/state.rs):
//   32  owner (Pubkey)
//   1   agent_type (u8 enum: 0=Primary, 1=Attestation, 2=Both)
//   4   model string length (u32 le)
//   N   model string (UTF-8)
//   8   rate_lamports (u64 le)
//   1   min_reputation (u8)
//   2   reputation_score (u16 le)
//   8   jobs_completed (u64 le)
//   8   jobs_failed (u64 le)
//   8   created_at (i64 le)
//   1   active (bool)
//   2   attestation_accuracy (u16 le)
//   1   bump

export interface OnchainAgent {
  owner: string;
  agentType: AgentTypeEnum;
  model: string;
  rateLamports: bigint;
  minReputation: number;
  reputationScore: number;
  jobsCompleted: bigint;
  jobsFailed: bigint;
  createdAt: bigint;
  active: boolean;
  attestationAccuracy: number;
}

function agentTypeFromRaw(agentTypeRaw: number): AgentTypeEnum | null {
  if (agentTypeRaw === 0) return "Primary";
  if (agentTypeRaw === 1) return "Attestation";
  if (agentTypeRaw === 2) return "Both";
  return null;
}

export function decodeAgentAccount(data: Buffer): OnchainAgent | null {
  try {
    let off = 8; // skip Anchor discriminator
    const owner = new PublicKey(data.subarray(off, off + 32)).toBase58(); off += 32;
    const agentType = agentTypeFromRaw(data.readUInt8(off)); off += 1;
    if (!agentType) return null;
    const modelLen = data.readUInt32LE(off); off += 4;
    const model = data.subarray(off, off + modelLen).toString("utf-8"); off += modelLen;
    const rateLamports = data.readBigUInt64LE(off); off += 8;
    const minReputation = data.readUInt8(off); off += 1;
    const reputationScore = data.readUInt16LE(off); off += 2;
    const jobsCompleted = data.readBigUInt64LE(off); off += 8;
    const jobsFailed = data.readBigUInt64LE(off); off += 8;
    const createdAt = data.readBigInt64LE(off); off += 8;
    const active = data.readUInt8(off) !== 0; off += 1;
    const attestationAccuracy = off < data.length ? data.readUInt16LE(off) : 0;
    return {
      owner, agentType, model, rateLamports, minReputation,
      reputationScore, jobsCompleted, jobsFailed, createdAt, active, attestationAccuracy,
    };
  } catch {
    return null;
  }
}

export function decodeQuasarAgentAccount(data: Buffer): OnchainAgent | null {
  try {
    if (data.length < QUASAR_AGENT_ACCOUNT_DATA_SIZE) return null;
    if (data.readUInt8(0) !== QUASAR_ACCOUNT_DISC.AgentAccount[0]) return null;
    let off = 1; // skip Quasar one-byte account discriminator
    const owner = new PublicKey(data.subarray(off, off + 32)).toBase58(); off += 32;
    const agentType = agentTypeFromRaw(data.readUInt8(off)); off += 1;
    if (!agentType) return null;
    const modelLen = data.readUInt8(off); off += 1;
    if (modelLen > 64) return null;
    off += 6; // alignment padding
    const rateLamports = data.readBigUInt64LE(off); off += 8;
    const minReputation = data.readUInt8(off); off += 1;
    off += 1; // alignment padding
    const reputationScore = data.readUInt16LE(off); off += 2;
    off += 4; // alignment padding
    const jobsCompleted = data.readBigUInt64LE(off); off += 8;
    const jobsFailed = data.readBigUInt64LE(off); off += 8;
    const createdAt = data.readBigInt64LE(off); off += 8;
    const active = data.readUInt8(off) !== 0; off += 1;
    off += 1; // bump
    const attestationAccuracy = data.readUInt16LE(off); off += 2;
    off += 4; // alignment padding
    const model = data.subarray(off, off + modelLen).toString("utf-8");
    return {
      owner, agentType, model, rateLamports, minReputation,
      reputationScore, jobsCompleted, jobsFailed, createdAt, active, attestationAccuracy,
    };
  } catch {
    return null;
  }
}

export function decodeActiveAgentAccount(data: Buffer): OnchainAgent | null {
  return PROGRAM_TARGET === "quasar" ? decodeQuasarAgentAccount(data) : decodeAgentAccount(data);
}

// ── register_agent instruction builder ───────────────────────────────────────

export function buildRegisterAgentData(
  agentType: number,
  model: string,
  rateLamports: bigint,
  minReputation: number
): Buffer {
  const writeU64LE = (target: Uint8Array, offset: number, value: bigint) => {
    let v = value;
    for (let i = 0; i < 8; i += 1) {
      target[offset + i] = Number(v & 0xffn);
      v >>= 8n;
    }
  };

  const modelBytes = Buffer.from(model, "utf-8");
  const buf = Buffer.alloc(8 + 1 + 4 + modelBytes.length + 8 + 1);
  let o = 0;
  IX.register_agent.copy(buf, o); o += 8;
  buf.writeUInt8(agentType, o); o += 1;
  buf.writeUInt32LE(modelBytes.length, o); o += 4;
  modelBytes.copy(buf, o); o += modelBytes.length;
  writeU64LE(buf, o, rateLamports); o += 8;
  buf.writeUInt8(minReputation, o);
  return buf;
}

/** Derive the AgentAccount PDA for a given owner. */
export function agentPda(ownerPubkey: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [AGENT_SEED, ownerPubkey.toBytes()],
    REGISTRY_PROGRAM_ID
  )[0];
}

/** Derive the AttestationAccount PDA for a given 16-byte job id. */
export function attestationPda(jobId: Uint8Array): PublicKey {
  if (jobId.length !== 16) {
    throw new Error("jobId must be 16 bytes");
  }
  return PublicKey.findProgramAddressSync(
    [ATTESTATION_SEED, Buffer.from(jobId)],
    ESCROW_PROGRAM_ID
  )[0];
}

/**
 * Build `attest_quality` instruction data:
 * discriminator(8) + job_id(16) + scores[5] + consumer_pubkey(32)
 */
export function buildAttestQualityData(
  jobId: Uint8Array,
  scores: [number, number, number, number, number],
  consumerPubkey: PublicKey
): Buffer {
  if (jobId.length !== 16) {
    throw new Error("jobId must be 16 bytes");
  }

  const buf = Buffer.alloc(8 + 16 + 5 + 32);
  let o = 0;
  IX.attest_quality.copy(buf, o); o += 8;
  Buffer.from(jobId).copy(buf, o); o += 16;
  for (const s of scores) {
    if (!Number.isInteger(s) || s < 0 || s > 255) {
      throw new Error("scores must be integers between 0 and 255");
    }
    buf.writeUInt8(s, o);
    o += 1;
  }
  Buffer.from(consumerPubkey.toBytes()).copy(buf, o);
  return buf;
}

/**
 * Build `confirm_attestation` instruction data:
 * discriminator(8) + job_id(16)
 */
export function buildConfirmAttestationData(jobId: Uint8Array): Buffer {
  if (jobId.length !== 16) {
    throw new Error("jobId must be 16 bytes");
  }

  const buf = Buffer.alloc(8 + 16);
  let o = 0;
  IX.confirm_attestation.copy(buf, o); o += 8;
  Buffer.from(jobId).copy(buf, o);
  return buf;
}

/**
 * Build `dispute_attestation` instruction data:
 * discriminator(8) + job_id(16)
 */
export function buildDisputeAttestationData(jobId: Uint8Array): Buffer {
  if (jobId.length !== 16) {
    throw new Error("jobId must be 16 bytes");
  }

  const buf = Buffer.alloc(8 + 16);
  let o = 0;
  IX.dispute_attestation.copy(buf, o); o += 8;
  Buffer.from(jobId).copy(buf, o);
  return buf;
}

/** Hardcoded incinerator address (matches on-chain AGENT_FEE_BURN_ADDRESS) */
export const INCINERATOR = new PublicKey("1nc1nerator11111111111111111111111111111111");
