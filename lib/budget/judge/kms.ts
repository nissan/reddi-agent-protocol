/**
 * Server only. The RAP judge's key. The program needs an Ed25519 judge, and
 * Vercel KMS offers no Ed25519 keys (RSA and ECDSA only), so the key is a
 * sensitive environment variable on the rap-budget-judge project alone, which
 * Nissan generates and sets himself. A Solana transaction signature is a plain
 * Ed25519 signature over the message bytes.
 *
 * `BUDGET_JUDGE_ADDRESS` pins the judge's address (base58 of its 32-byte
 * public key). The key must match it, and every signature is checked against
 * it before use: a rotated key would be a different judge, which no open
 * Budget names. (The error codes keep their `kms_` names for the judge's log.)
 */

import { createPrivateKey, createPublicKey, sign as edSign, verify as edVerify, type KeyObject } from "crypto";
import { PublicKey } from "@solana/web3.js";

export interface JudgeSigner {
  address: PublicKey;
  /** A raw 64-byte Ed25519 signature over `message`. */
  sign(message: Uint8Array): Promise<Uint8Array>;
}

export type JudgeSignature = { ok: true; signature: Uint8Array } | { ok: false; code: "kms_unavailable" | "kms_key_mismatch"; message: string };

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** True when `signature` is `address`'s Ed25519 signature over `message`. */
export function ed25519Verifies(address: PublicKey, message: Uint8Array, signature: Uint8Array): boolean {
  try {
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, address.toBuffer()]), format: "der", type: "spki" });
    return signature.length === 64 && edVerify(null, Buffer.from(message), key, Buffer.from(signature));
  } catch {
    return false;
  }
}

/** Has the judge's key sign `message` and checks the result against the pinned address. */
export async function signAsJudge(signer: JudgeSigner, message: Uint8Array): Promise<JudgeSignature> {
  let signature: Uint8Array;
  try {
    signature = await signer.sign(message);
  } catch (error) {
    return { ok: false, code: "kms_unavailable", message: `The judge key did not sign: ${error instanceof Error ? error.message.slice(0, 200) : "unknown error"}` };
  }
  if (!ed25519Verifies(signer.address, message, signature)) {
    return { ok: false, code: "kms_key_mismatch", message: "The judge key signed as someone other than the judge's address (was the key rotated?)." };
  }
  return { ok: true, signature };
}

/** The judge's address from `BUDGET_JUDGE_ADDRESS`, or undefined when unset or not an address. */
export function readJudgeAddress(env: Record<string, string | undefined> = process.env): PublicKey | undefined {
  const value = env.BUDGET_JUDGE_ADDRESS?.trim();
  if (!value || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return undefined;
  try {
    return new PublicKey(value);
  } catch {
    return undefined;
  }
}

const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/** A Solana secret key as solana-keygen writes it: a JSON array of 64 bytes. */
function parseSecretKey(value: string): Uint8Array | undefined {
  try {
    const bytes: unknown = JSON.parse(value);
    return Array.isArray(bytes) && bytes.length === 64 && bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255) ? Uint8Array.from(bytes as number[]) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The judge from `BUDGET_JUDGE_SECRET_KEY` (a sensitive env var set only on
 * the rap-budget-judge project) and `BUDGET_JUDGE_ADDRESS`. Undefined when
 * either is missing or the key's public half is not the pinned address: the
 * judge then rules nothing.
 */
export function readJudgeSigner(env: Record<string, string | undefined> = process.env): JudgeSigner | undefined {
  const raw = env.BUDGET_JUDGE_SECRET_KEY?.trim();
  const address = readJudgeAddress(env);
  if (!raw || !address) return undefined;
  const secret = parseSecretKey(raw);
  if (!secret) return undefined;
  let key: KeyObject;
  try {
    key = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(secret.subarray(0, 32))]), format: "der", type: "pkcs8" });
  } catch {
    return undefined;
  } finally {
    secret.fill(0);
  }
  const derived = createPublicKey(key).export({ format: "der", type: "spki" }).subarray(ED25519_SPKI_PREFIX.length);
  if (!Buffer.from(derived).equals(address.toBuffer())) return undefined;
  return {
    address,
    async sign(message) {
      return new Uint8Array(edSign(null, Buffer.from(message), key));
    },
  };
}
