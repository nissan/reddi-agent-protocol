/**
 * On-chain program configuration for the Reddi Agent Protocol.
 *
 * Program deployed to Solana devnet.
 * To redeploy after funding blitz-dev wallet:
 *   anchor keys sync && anchor build && anchor deploy --provider.cluster devnet
 */
import { createHash } from "crypto";
import { PublicKey } from "@solana/web3.js";

/** Deployed program address on devnet */
export const ESCROW_PROGRAM_ID = new PublicKey(
  "77rkRQxe4GRzHU56H6JuWPFe27g4NoRBz4GGftuUZXmX"
);

/** Solana devnet RPC */
export const DEVNET_RPC = "https://api.devnet.solana.com";

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

export function decodeAgentAccount(data: Buffer): OnchainAgent | null {
  try {
    let off = 8; // skip discriminator
    const owner = new PublicKey(data.subarray(off, off + 32)).toBase58(); off += 32;
    const agentTypeRaw = data.readUInt8(off); off += 1;
    const agentType: AgentTypeEnum =
      agentTypeRaw === 0 ? "Primary" : agentTypeRaw === 1 ? "Attestation" : "Both";
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

// ── register_agent instruction builder ───────────────────────────────────────

export function buildRegisterAgentData(
  agentType: number,
  model: string,
  rateLamports: bigint,
  minReputation: number
): Buffer {
  const modelBytes = Buffer.from(model, "utf-8");
  const buf = Buffer.alloc(8 + 1 + 4 + modelBytes.length + 8 + 1);
  let o = 0;
  IX.register_agent.copy(buf, o); o += 8;
  buf.writeUInt8(agentType, o); o += 1;
  buf.writeUInt32LE(modelBytes.length, o); o += 4;
  modelBytes.copy(buf, o); o += modelBytes.length;
  buf.writeBigUInt64LE(rateLamports, o); o += 8;
  buf.writeUInt8(minReputation, o);
  return buf;
}

/** Derive the AgentAccount PDA for a given owner. */
export function agentPda(ownerPubkey: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [AGENT_SEED, ownerPubkey.toBytes()],
    ESCROW_PROGRAM_ID
  )[0];
}

/** Hardcoded incinerator address (matches on-chain AGENT_FEE_BURN_ADDRESS) */
export const INCINERATOR = new PublicKey("1nc1nerator11111111111111111111111111111111");
