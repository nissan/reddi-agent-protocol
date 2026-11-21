/**
 * Metered SOL escrow for the devnet sandbox (#794).
 *
 * The visitor's wallet locks the most a call can cost in an escrow on the
 * devnet program. After the answer, the provider settles the actual cost: the
 * program pays 2.5% to the protocol treasury, the rest to the provider, and
 * returns the unused part of the maximum to the visitor.
 *
 * Pinned to devnet whatever profile the app runs with. Browser-safe: no node
 * crypto, no keys. The server's signing step lives in `settle-signer.ts`.
 */
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import devnetProfile from "@/config/networks/devnet.json";
import { SANDBOX_FEE_TREASURY } from "./pricing";

/** The devnet escrow program, read from the devnet network profile. */
export const SANDBOX_ESCROW_PROGRAM_ID = new PublicKey(devnetProfile.programs.escrowProgramId);

const ESCROW_SEED = new TextEncoder().encode("escrow");

/** Anchor discriminators, sha256("global:<name>")[0..8] and sha256("account:EscrowAccount")[0..8]. Tests check them against lib/program.ts. */
export const SANDBOX_ESCROW_DISCRIMINATORS = {
  lockMeteredEscrow: Uint8Array.from([134, 129, 217, 67, 19, 31, 150, 94]),
  settleEscrow: Uint8Array.from([22, 135, 160, 194, 23, 186, 124, 110]),
  escrowAccount: Uint8Array.from([36, 69, 48, 18, 128, 225, 125, 135]),
} as const;

/**
 * Windows a sandbox lock names, in slots from the lock (about 400 ms each). The provider may claim the whole
 * maximum from the first; the visitor may refund from the second. Mirrors DEFAULT_CLAIM_WINDOW_SLOTS and
 * DEFAULT_CANCEL_WINDOW_SLOTS in programs/pinocchio-escrow/program/src/consts.rs: about 10 and 30 minutes.
 */
export const SANDBOX_CLAIM_WINDOW_SLOTS = BigInt(1_500);
export const SANDBOX_CANCEL_WINDOW_SLOTS = BigInt(4_500);
/**
 * The shortest refund window the sandbox provider serves against: about 10 minutes. With a shorter one the
 * visitor could refund before the provider's settlement lands.
 */
export const SANDBOX_MIN_CANCEL_WINDOW_SLOTS = BigInt(1_500);
/** Size of an escrow account locked before windows were stored on it (fixed 3-day refund, 7-day claim). */
const LEGACY_ESCROW_ACCOUNT_LEN = 149;

const NONCE_HEX = /^[0-9a-f]{32}$/;

/** The 16 escrow nonce bytes for a challenge nonce: the challenge's 32 hex characters. */
export function escrowNonceBytes(challengeNonce: string): Uint8Array {
  if (!NONCE_HEX.test(challengeNonce)) throw new Error("challenge nonce must be 32 lowercase hex characters");
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(challengeNonce.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export function sandboxEscrowAddress(payer: PublicKey, challengeNonce: string, programId: PublicKey = SANDBOX_ESCROW_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([ESCROW_SEED, payer.toBytes(), escrowNonceBytes(challengeNonce)], programId)[0];
}

function u64le(value: bigint): Uint8Array {
  if (value < BigInt(0) || value > BigInt("18446744073709551615")) throw new Error("amount out of u64 range");
  const out = new Uint8Array(8);
  let v = value;
  for (let i = 0; i < 8; i++) {
    out[i] = Number(v & BigInt(0xff));
    v >>= BigInt(8);
  }
  return out;
}

function concat(...parts: Uint8Array[]): Buffer {
  return Buffer.concat(parts.map((part) => Buffer.from(part)));
}

/** The visitor's signed step: lock `maxLamports` for this challenge, payable to the provider. */
export function buildSandboxMeteredLock(input: {
  payer: PublicKey;
  payee: PublicKey;
  maxLamports: bigint;
  challengeNonce: string;
  programId?: PublicKey;
  claimWindowSlots?: bigint;
  cancelWindowSlots?: bigint;
}): {
  instruction: TransactionInstruction;
  escrow: PublicKey;
} {
  const programId = input.programId ?? SANDBOX_ESCROW_PROGRAM_ID;
  const escrow = sandboxEscrowAddress(input.payer, input.challengeNonce, programId);
  const instruction = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: escrow, isSigner: false, isWritable: true },
      { pubkey: input.payer, isSigner: true, isWritable: true },
      { pubkey: input.payee, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: concat(
      SANDBOX_ESCROW_DISCRIMINATORS.lockMeteredEscrow,
      u64le(input.maxLamports),
      escrowNonceBytes(input.challengeNonce),
      u64le(input.claimWindowSlots ?? SANDBOX_CLAIM_WINDOW_SLOTS),
      u64le(input.cancelWindowSlots ?? SANDBOX_CANCEL_WINDOW_SLOTS),
    ),
  });
  return { instruction, escrow };
}

/** The provider's step: settle the actual cost. The payee signs; the payer and treasury are written to. */
export function buildSandboxSettle(input: { escrow: PublicKey; payer: PublicKey; payee: PublicKey; actualLamports: bigint; programId?: PublicKey }): TransactionInstruction {
  return new TransactionInstruction({
    programId: input.programId ?? SANDBOX_ESCROW_PROGRAM_ID,
    keys: [
      { pubkey: input.escrow, isSigner: false, isWritable: true },
      { pubkey: input.payer, isSigner: false, isWritable: true },
      { pubkey: input.payee, isSigner: true, isWritable: true },
      { pubkey: new PublicKey(SANDBOX_FEE_TREASURY), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: concat(SANDBOX_ESCROW_DISCRIMINATORS.settleEscrow, u64le(input.actualLamports)),
  });
}

export type DecodedSandboxEscrow = {
  payer: PublicKey;
  payee: PublicKey;
  amount: bigint;
  nonce: Uint8Array;
  status: "locked" | "released" | "cancelled";
  createdAt: bigint;
  delegatedToPer: boolean;
  metered: boolean;
  /** Slots after the lock from which the payee may claim. Undefined on an account locked before windows were stored. */
  claimWindowSlots?: bigint;
  /** Slots after the lock from which the payer may refund. Undefined on an account locked before windows were stored. */
  cancelWindowSlots?: bigint;
};

/** Reads an `EscrowAccount` (Borsh, as Anchor writes it). Undefined when the bytes are not one. */
export function decodeSandboxEscrow(data: Uint8Array): DecodedSandboxEscrow | undefined {
  const disc = SANDBOX_ESCROW_DISCRIMINATORS.escrowAccount;
  if (data.length < 8 + 32 + 32 + 8 + 16 + 1 + 8 + 8 + 1 + 1 + 1 + 1) return undefined;
  for (let i = 0; i < 8; i++) if (data[i] !== disc[i]) return undefined;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 8;
  const payer = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  const payee = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  const amount = view.getBigUint64(offset, true);
  offset += 8;
  const nonce = data.slice(offset, offset + 16);
  offset += 16;
  const statusByte = data[offset];
  offset += 1;
  const status = statusByte === 0 ? "locked" : statusByte === 1 ? "released" : statusByte === 2 ? "cancelled" : undefined;
  if (!status) return undefined;
  const createdAt = view.getBigInt64(offset, true);
  offset += 8 + 8; // created_at, created_slot
  // The windows follow, except on an account the earlier program wrote, which is 16 bytes shorter.
  let claimWindowSlots: bigint | undefined;
  let cancelWindowSlots: bigint | undefined;
  if (data.length !== LEGACY_ESCROW_ACCOUNT_LEN) {
    if (data.length < offset + 16 + 4) return undefined;
    claimWindowSlots = view.getBigUint64(offset, true);
    cancelWindowSlots = view.getBigUint64(offset + 8, true);
    offset += 16;
  }
  const delegatedToPer = data[offset] === 1;
  offset += 1;
  const sessionTag = data[offset];
  offset += 1;
  if (sessionTag === 1) offset += 32;
  else if (sessionTag !== 0) return undefined;
  if (data.length < offset + 2) return undefined;
  offset += 1; // bump
  const metered = data[offset] === 1;
  return { payer, payee, amount, nonce, status, createdAt, delegatedToPer, metered, claimWindowSlots, cancelWindowSlots };
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
