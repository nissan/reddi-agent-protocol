/**
 * On-chain program configuration for the Reddi Agent Protocol.
 *
 * Program deployed to Solana devnet.
 * To redeploy after funding blitz-dev wallet:
 *   anchor keys sync && anchor build && anchor deploy --provider.cluster devnet
 */
import { createHash } from "crypto";
import { PublicKey } from "@solana/web3.js";
import { attestationPda as attestationPdaFor, ratingPda as ratingPdaFor } from "@redditech/x402-solana/rating";
import { deliveryPda as deliveryPdaFor } from "@redditech/x402-solana/delivery";
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
 * Profile-wide submission gate: the resolved program set is not ready for signing.
 * Every transaction-signing surface consults it — browser wallet submits and server-side
 * operator signers alike — before wallet, signer, transaction, or RPC side effects.
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

// ── PDA seeds (must match programs/pinocchio-escrow/program/src/consts.rs) ──────────────────

export const ESCROW_SEED = Buffer.from("escrow");
export const TOKEN_ESCROW_SEED = Buffer.from("token-escrow");
export const TOKEN_VAULT_SEED = Buffer.from("token-vault");
export const AGENT_SEED = Buffer.from("agent");
// Both are followed by the escrow address the job was paid through, never by a job id:
// ["rating", escrow], ["attestation", escrow] and ["delivery", escrow] (programs/pinocchio-escrow/README.md).
export const RATING_SEED = Buffer.from("rating");
export const ATTESTATION_SEED = Buffer.from("attestation");
export const DELIVERY_SEED = Buffer.from("delivery");
// Pooled budget (README "Pooled budget"): ["budget", payer, nonce], ["budget-vault", budget],
// ["reservation", budget, payee]. Builders and decoders in @redditech/x402-solana/budget.
export const BUDGET_SEED = Buffer.from("budget");
export const BUDGET_VAULT_SEED = Buffer.from("budget-vault");
export const RESERVATION_SEED = Buffer.from("reservation");

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
  lock_token_escrow: disc("global", "lock_token_escrow"),
  lock_metered_token_escrow: disc("global", "lock_metered_token_escrow"),
  release_token_escrow: disc("global", "release_token_escrow"),
  settle_token_escrow: disc("global", "settle_token_escrow"),
  cancel_token_escrow: disc("global", "cancel_token_escrow"),
  lock_escrow: disc("global", "lock_escrow"),
  lock_metered_escrow: disc("global", "lock_metered_escrow"),
  release_escrow: disc("global", "release_escrow"),
  settle_escrow: disc("global", "settle_escrow"),
  cancel_escrow: disc("global", "cancel_escrow"),
  // Ratings and judge attestations of a job paid through escrow. Not in the Anchor IDL: the
  // interface is programs/pinocchio-escrow/README.md plus interface/vectors.json, and the
  // builders, decoders and address helpers are in @redditech/x402-solana/rating. The PER selectors
  // (delegate_escrow, release_escrow_per) are not mirrored: the V1 build answers neither (#839).
  open_rating: disc("global", "open_rating"),
  accept_rating: disc("global", "accept_rating"),
  commit_rating: disc("global", "commit_rating"),
  reveal_rating: disc("global", "reveal_rating"),
  expire_rating: disc("global", "expire_rating"),
  close_rating: disc("global", "close_rating"),
  attest_quality: disc("global", "attest_quality"),
  confirm_attestation: disc("global", "confirm_attestation"),
  dispute_attestation: disc("global", "dispute_attestation"),
  close_attestation: disc("global", "close_attestation"),
  // The delivery check (README "Delivery check"); builders and decoder in @redditech/x402-solana/delivery.
  open_delivery: disc("global", "open_delivery"),
  record_delivery: disc("global", "record_delivery"),
  accept_delivery: disc("global", "accept_delivery"),
  dispute_delivery: disc("global", "dispute_delivery"),
  resolve_delivery: disc("global", "resolve_delivery"),
  resolve_token_delivery: disc("global", "resolve_token_delivery"),
  // The pooled budget (README "Pooled budget"); builders and decoders in @redditech/x402-solana/budget.
  open_budget: disc("global", "open_budget"),
  open_token_budget: disc("global", "open_token_budget"),
  reserve: disc("global", "reserve"),
  set_payout_account: disc("global", "set_payout_account"),
  post_final: disc("global", "post_final"),
  waive: disc("global", "waive"),
  dispute: disc("global", "dispute"),
  close_budget: disc("global", "close_budget"),
  close_token_budget: disc("global", "close_token_budget"),
  payout_budget: disc("global", "payout_budget"),
  payout_token_budget: disc("global", "payout_token_budget"),
  resolve_budget: disc("global", "resolve_budget"),
  resolve_token_budget: disc("global", "resolve_token_budget"),
} as const;

export const ACCOUNT_DISC = {
  AgentAccount: disc("account", "AgentAccount"),
  TokenEscrowAccount: disc("account", "TokenEscrowAccount"),
  EscrowAccount: disc("account", "EscrowAccount"),
  RatingAccount: disc("account", "RatingAccount"),
  AttestationAccount: disc("account", "AttestationAccount"),
  DeliveryAccount: disc("account", "DeliveryAccount"),
  Budget: disc("account", "Budget"),
  Reservation: disc("account", "Reservation"),
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
// Layout (post-discriminator, from programs/pinocchio-escrow/program/src/state.rs):
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

/** The rating account of the job paid through `escrow`: ["rating", escrow]. */
export function ratingPda(escrow: PublicKey): PublicKey {
  return ratingPdaFor(escrow, ESCROW_PROGRAM_ID);
}

/** The attestation account of the job paid through `escrow`: ["attestation", escrow]. */
export function attestationPda(escrow: PublicKey): PublicKey {
  return attestationPdaFor(escrow, ESCROW_PROGRAM_ID);
}

/** The delivery account of a delivery-checked escrow: ["delivery", escrow]. */
export function deliveryPda(escrow: PublicKey): PublicKey {
  return deliveryPdaFor(escrow, ESCROW_PROGRAM_ID);
}

/** Hardcoded incinerator address (matches on-chain AGENT_FEE_BURN_ADDRESS) */
export const INCINERATOR = new PublicKey("1nc1nerator11111111111111111111111111111111");
