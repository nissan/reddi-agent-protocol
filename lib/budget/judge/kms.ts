/**
 * Server only. The RAP judge's key: a Vercel KMS issuer with algorithm EdDSA
 * (Ed25519), granted only to the rap-budget-judge project's Production
 * deployments (owner decision, 26 November 2026). The private key never
 * leaves KMS. A Solana transaction signature is a plain Ed25519 signature
 * over the message bytes, so KMS signs a ruling's transaction directly.
 *
 * `BUDGET_JUDGE_ADDRESS` pins the judge's address (base58 of its 32-byte
 * public key). Every signature KMS returns is checked against it before it is
 * used: a rotated key would be a different judge, which no open Budget names.
 */

import { createPublicKey, verify as edVerify } from "crypto";
import { PublicKey } from "@solana/web3.js";
import { signMessage } from "@vercel/kms";

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
    return { ok: false, code: "kms_unavailable", message: `KMS did not sign: ${error instanceof Error ? error.message.slice(0, 200) : "unknown error"}` };
  }
  if (!ed25519Verifies(signer.address, message, signature)) {
    return { ok: false, code: "kms_key_mismatch", message: "KMS signed with a key other than the judge's address (was the key rotated?)." };
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

/**
 * The KMS judge from `BUDGET_JUDGE_KMS_ISSUER_ID` and `BUDGET_JUDGE_ADDRESS`.
 * Undefined when either is missing: the judge then rules nothing.
 */
export function readJudgeSigner(env: Record<string, string | undefined> = process.env): JudgeSigner | undefined {
  const issuerId = env.BUDGET_JUDGE_KMS_ISSUER_ID?.trim();
  const address = readJudgeAddress(env);
  if (!issuerId || !address) return undefined;
  return {
    address,
    async sign(message) {
      const result = await signMessage({ issuerId, message });
      if (result.algorithm && result.algorithm !== "EdDSA" && result.algorithm !== "Ed25519") throw new Error(`issuer signs with ${result.algorithm}, not EdDSA`);
      return result.signature;
    },
  };
}
