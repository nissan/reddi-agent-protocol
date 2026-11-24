/**
 * The JSON the main app and the Budget signer project exchange: an approval
 * request going in, the two instructions coming back. Amounts and slots
 * travel as decimal strings, addresses as base58, instruction data as base64.
 * Parsing is strict: anything unexpected is refused, not guessed at.
 */

import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { SECP256R1_PROGRAM_ID } from "@redditech/x402-solana/budget";
import type { ApprovalRequest, Approved } from "./custody";

const U64 = /^(0|[1-9][0-9]{0,19})$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function address(value: unknown): string | undefined {
  if (typeof value !== "string" || !BASE58.test(value)) return undefined;
  try {
    return new PublicKey(value).toBase58() === value ? value : undefined;
  } catch {
    return undefined;
  }
}

function u64(value: unknown): bigint | undefined {
  if (typeof value !== "string" || !U64.test(value)) return undefined;
  const n = BigInt(value);
  return n <= BigInt("18446744073709551615") ? n : undefined;
}

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export type ApprovalRequestWire =
  | { purpose: "reserve"; payee: string; amount: string; payoutAccount?: string }
  | { purpose: "waive"; payee: string; amount: string }
  | { purpose: "close"; token?: { mint: string; refund: string; tokenProgram: string } };

export function encodeApprovalRequest(request: ApprovalRequest): ApprovalRequestWire {
  if (request.purpose === "close") {
    return request.token
      ? { purpose: "close", token: { mint: request.token.mint.toBase58(), refund: request.token.refund.toBase58(), tokenProgram: request.token.tokenProgram.toBase58() } }
      : { purpose: "close" };
  }
  if (request.purpose === "waive") return { purpose: "waive", payee: request.payee, amount: request.amount.toString() };
  return { purpose: "reserve", payee: request.payee, amount: request.amount.toString(), ...(request.payoutAccount ? { payoutAccount: request.payoutAccount } : {}) };
}

/** The request, or undefined when any field is missing, extra in kind, or malformed. */
export function parseApprovalRequest(value: unknown): ApprovalRequest | undefined {
  if (!isObject(value)) return undefined;
  if (value.purpose === "close") {
    if (value.token === undefined) return { purpose: "close" };
    if (!isObject(value.token)) return undefined;
    const mint = address(value.token.mint);
    const refund = address(value.token.refund);
    const tokenProgram = address(value.token.tokenProgram);
    if (!mint || !refund || !tokenProgram) return undefined;
    return { purpose: "close", token: { mint: new PublicKey(mint), refund: new PublicKey(refund), tokenProgram: new PublicKey(tokenProgram) } };
  }
  if (value.purpose !== "reserve" && value.purpose !== "waive") return undefined;
  const payee = address(value.payee);
  const amount = u64(value.amount);
  if (!payee || amount === undefined) return undefined;
  if (value.purpose === "waive") return { purpose: "waive", payee, amount };
  if (value.payoutAccount === undefined) return { purpose: "reserve", payee, amount };
  const payoutAccount = address(value.payoutAccount);
  return payoutAccount ? { purpose: "reserve", payee, amount, payoutAccount } : undefined;
}

type InstructionWire = { programId: string; keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: string };
export type ApprovedWire = { ok: true; purpose: Approved["purpose"]; expiresSlot: string; instructions: [InstructionWire, InstructionWire] };

const encodeInstruction = (ix: TransactionInstruction): InstructionWire => ({
  programId: ix.programId.toBase58(),
  keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })),
  data: Buffer.from(ix.data).toString("base64"),
});

export function encodeApproved(approved: Approved): ApprovedWire {
  return { ok: true, purpose: approved.purpose, expiresSlot: approved.expiresSlot.toString(), instructions: [encodeInstruction(approved.instructions[0]), encodeInstruction(approved.instructions[1])] };
}

function decodeInstruction(value: unknown): TransactionInstruction | undefined {
  if (!isObject(value) || !Array.isArray(value.keys) || value.keys.length > 16 || typeof value.data !== "string" || value.data.length > 2048) return undefined;
  const programId = address(value.programId);
  if (!programId || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data)) return undefined;
  const keys = [];
  for (const key of value.keys) {
    if (!isObject(key) || typeof key.isSigner !== "boolean" || typeof key.isWritable !== "boolean") return undefined;
    const pubkey = address(key.pubkey);
    if (!pubkey) return undefined;
    keys.push({ pubkey: new PublicKey(pubkey), isSigner: key.isSigner, isWritable: key.isWritable });
  }
  return new TransactionInstruction({ programId: new PublicKey(programId), keys, data: Buffer.from(value.data, "base64") });
}

/**
 * The approval the signer sent back, or undefined. With `programId`, also
 * checks the first instruction is the secp256r1 precompile and the second a
 * call to that program, for the purpose asked: the app sends only what it expects.
 */
export function decodeApproved(value: unknown, expect?: { programId: PublicKey; purpose: Approved["purpose"] }): Approved | undefined {
  if (!isObject(value) || value.ok !== true || !Array.isArray(value.instructions) || value.instructions.length !== 2) return undefined;
  if (value.purpose !== "reserve" && value.purpose !== "waive" && value.purpose !== "close") return undefined;
  const expiresSlot = u64(value.expiresSlot);
  const precompile = decodeInstruction(value.instructions[0]);
  const call = decodeInstruction(value.instructions[1]);
  if (expiresSlot === undefined || !precompile || !call) return undefined;
  if (expect) {
    if (value.purpose !== expect.purpose) return undefined;
    if (!precompile.programId.equals(SECP256R1_PROGRAM_ID) || precompile.keys.length !== 0) return undefined;
    if (!call.programId.equals(expect.programId)) return undefined;
  }
  return { ok: true, purpose: value.purpose, expiresSlot, instructions: [precompile, call] };
}
