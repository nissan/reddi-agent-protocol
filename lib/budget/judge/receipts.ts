/**
 * Server only. The RAP judge's reading of a provider's receipts for one
 * disputed Budget slice.
 *
 * A receipt is the provider's own signed statement of what its slice owes.
 * Two kinds count:
 *
 * - `reddi.receipt.v2` with `session` and `budget` blocks (the provider kit),
 *   signed by the provider's wallet, which must be the slice's payee. Any
 *   network.
 * - `rap.sandbox.budget-receipt.v1` (the devnet sandbox providers), signed by
 *   a sandbox test key whose derivation is public. Devnet only: anyone can
 *   sign with those keys, so on devnet the call log check (`./rule`) is what
 *   holds such a receipt to calls that were made.
 *
 * Everything else, and every receipt for another Budget, opening, slice,
 * payer or network, is set aside with a reason. Never throws.
 */

import { createHash, createPublicKey, verify as edVerify } from "crypto";
import { hashReddiReceiptV2, verifyReddiReceiptV2 } from "@redditech/agent-protocol/receipt-v2";

export type JudgeNetwork = "solana-devnet" | "solana-mainnet-beta";

/** What the judge needs from one receipt, whatever its kind. */
export type SliceReceipt = {
  kind: "receipt-v2" | "sandbox-budget-v1";
  /** Calls served up to and including this one (1, 2, 3, ...). */
  served: number;
  /** What the slice owes after this call, in base units. */
  cumulativeCost: bigint;
  /** SHA-256 hex of the request body this call answered. */
  requestHash: string;
  /** SHA-256 hex identifying this receipt (its hash for v2, of its JSON for sandbox). */
  receiptHash: string;
};

export type SliceExpectation = {
  network: JudgeNetwork;
  budget: string;
  createdSlot: string;
  reservation: string;
  payee: string;
  payer: string;
};

export type ReceiptReading = { ok: true; receipt: SliceReceipt } | { ok: false; reason: string };

const SANDBOX_VERSION = "rap.sandbox.budget-receipt.v1";
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const HEX64 = /^[0-9a-f]{64}$/;
const COUNT = /^(0|[1-9][0-9]{0,19})$/;
/** A receipt header is at most 4096 characters; a little room for a JSON body sent to the evidence route. */
export const MAX_RECEIPT_CHARS = 8192;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function base58Decode(text: string): Uint8Array | undefined {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text)) return undefined;
  let value = BigInt(0);
  for (const c of text) value = value * BigInt(58) + BigInt(BASE58_ALPHABET.indexOf(c));
  const bytes: number[] = [];
  while (value > BigInt(0)) {
    bytes.unshift(Number(value & BigInt(255)));
    value >>= BigInt(8);
  }
  for (const c of text) {
    if (c !== "1") break;
    bytes.unshift(0);
  }
  return bytes.length === 32 ? Uint8Array.from(bytes) : undefined;
}

function ed25519Valid(publicKey: Uint8Array, signature: Buffer, message: Buffer): boolean {
  try {
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKey)]), format: "der", type: "spki" });
    return signature.length === 64 && edVerify(null, message, key, signature);
  } catch {
    return false;
  }
}

/** A receipt as it travels: base64url JSON (a header value), or the parsed JSON itself. */
export function parseReceipt(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (value.length > MAX_RECEIPT_CHARS || !/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

function readV2(signed: Record<string, unknown>, expect: SliceExpectation): ReceiptReading {
  const verified = verifyReddiReceiptV2(signed, {
    providerId: expect.payee,
    budget: { address: expect.budget, createdSlot: expect.createdSlot, reservation: expect.reservation },
    session: { escrow: expect.reservation, payer: expect.payer, network: expect.network },
  });
  if (!verified.ok) return { ok: false, reason: `receipt_${verified.errors[0]?.code ?? "invalid"}` };
  const session = verified.receipt.session!;
  if (!COUNT.test(session.sequence) || !COUNT.test(session.cumulativeCost)) return { ok: false, reason: "receipt_counts_invalid" };
  const served = Number(session.sequence);
  if (!Number.isSafeInteger(served) || served < 1) return { ok: false, reason: "receipt_counts_invalid" };
  return {
    ok: true,
    receipt: { kind: "receipt-v2", served, cumulativeCost: BigInt(session.cumulativeCost), requestHash: verified.receipt.requestHash, receiptHash: hashReddiReceiptV2(verified.receipt) },
  };
}

function readSandbox(signed: Record<string, unknown>, expect: SliceExpectation): ReceiptReading {
  if (expect.network !== "solana-devnet") return { ok: false, reason: "sandbox_receipt_not_on_mainnet" };
  const receipt = signed.receipt;
  const proof = signed.proof;
  if (!isRecord(receipt) || !isRecord(proof) || proof.type !== "ed25519" || typeof proof.signature !== "string") return { ok: false, reason: "receipt_malformed" };
  const budget = receipt.budget;
  const payment = receipt.payment;
  if (!isRecord(budget) || !isRecord(payment)) return { ok: false, reason: "receipt_malformed" };
  if (typeof receipt.providerId !== "string" || typeof receipt.requestHash !== "string" || !HEX64.test(receipt.requestHash)) return { ok: false, reason: "receipt_malformed" };
  const key = base58Decode(receipt.providerId);
  const signature = Buffer.from(proof.signature, "base64");
  const message = Buffer.from(JSON.stringify(receipt), "utf8");
  if (!key || !ed25519Valid(key, signature, message)) return { ok: false, reason: "receipt_signature_invalid" };
  if (receipt.payee !== expect.payee) return { ok: false, reason: "receipt_provider_mismatch" };
  if (budget.address !== expect.budget || budget.createdSlot !== expect.createdSlot || budget.reservation !== expect.reservation) return { ok: false, reason: "receipt_budget_mismatch" };
  if (payment.network !== expect.network) return { ok: false, reason: "receipt_network_mismatch" };
  if (typeof budget.sequence !== "number" || !Number.isSafeInteger(budget.sequence) || budget.sequence < 1) return { ok: false, reason: "receipt_counts_invalid" };
  if (typeof payment.cumulativeAmount !== "string" || !COUNT.test(payment.cumulativeAmount)) return { ok: false, reason: "receipt_counts_invalid" };
  return {
    ok: true,
    receipt: {
      kind: "sandbox-budget-v1",
      served: budget.sequence,
      cumulativeCost: BigInt(payment.cumulativeAmount),
      requestHash: receipt.requestHash,
      receiptHash: createHash("sha256").update(message).digest("hex"),
    },
  };
}

/** Reads one receipt for the slice `expect` names. */
export function readSliceReceipt(value: unknown, expect: SliceExpectation): ReceiptReading {
  const signed = parseReceipt(value);
  if (!isRecord(signed) || !isRecord(signed.receipt)) return { ok: false, reason: "receipt_malformed" };
  const version = signed.receipt.schemaVersion;
  if (version === "reddi.receipt.v2") return readV2(signed, expect);
  if (version === SANDBOX_VERSION) return readSandbox(signed, expect);
  return { ok: false, reason: "receipt_kind_not_accepted" };
}
