/**
 * Server only. The Budget relay's spender key, held in Vercel KMS.
 *
 * A Budget opened with flag 0x08 (P-256 spender) names the SHA-256 of a P-256
 * public key as its spender, and the program accepts a secp256r1-precompile
 * signature over a 175-byte approval (`budgetApprovalMessage`) in place of a
 * transaction signature. The relay's key is a Vercel KMS issuer with an ES256
 * signing key: its private key never leaves KMS, the relay asks KMS to sign
 * one approval at a time through the deployment's OIDC token, and only
 * deployments the issuer's project grant names (Production) can ask.
 *
 * The public key is pinned in the environment, and every signature KMS
 * returns is checked against the key the Budget was opened with before it is
 * used: after a key rotation, KMS signs with the new key, and the relay
 * refuses rather than send an approval the program would reject.
 */

import { signMessage } from "@vercel/kms";
import { compactLowSP256Signature, compressP256PublicKey } from "@redditech/x402-solana/budget";
import { p256Verify } from "@redditech/x402-solana/ed25519";

export interface SpenderSigner {
  /** The 33-byte compressed public key new Budgets are opened with. */
  publicKey: Uint8Array;
  /** Signs `message` with ES256 (ECDSA P-256 over SHA-256). Any of DER or 64-byte r||s. */
  sign(message: Uint8Array): Promise<Uint8Array>;
}

export type SignedApproval = { ok: true; signature: Uint8Array } | { ok: false; code: "kms_unavailable" | "kms_key_mismatch"; message: string };

/**
 * Has `signer` sign `message`, and checks the result against `expectedKey`
 * (the key the Budget names), normalised to the 64-byte low-S form the
 * precompile takes.
 */
export async function signApproval(signer: SpenderSigner, expectedKey: Uint8Array, message: Uint8Array): Promise<SignedApproval> {
  let raw: Uint8Array;
  try {
    raw = await signer.sign(message);
  } catch (error) {
    return { ok: false, code: "kms_unavailable", message: `KMS did not sign: ${error instanceof Error ? error.message.slice(0, 200) : "unknown error"}` };
  }
  let signature: Uint8Array;
  try {
    signature = compactLowSP256Signature(raw);
  } catch {
    return { ok: false, code: "kms_unavailable", message: "KMS answered with something that is not an ECDSA signature." };
  }
  if (!p256Verify(expectedKey, message, signature)) {
    return { ok: false, code: "kms_key_mismatch", message: "KMS signed with a key this Budget does not name (was the key rotated?)." };
  }
  return { ok: true, signature };
}

/** The DER prefix of a P-256 public key in SubjectPublicKeyInfo form, before its 65 uncompressed bytes. */
const P256_SPKI_PREFIX = Buffer.from("3059301306072a8648ce3d020106082a8648ce3d030107034200", "hex");

/**
 * Reads a P-256 public key: the issuer's `publicKeyPem` as Vercel shows it, or the 33-byte
 * compressed or 65-byte uncompressed point in hex or base64.
 */
export function parseP256PublicKey(value: string | undefined): Uint8Array | undefined {
  const raw = value?.replace(/\\n/g, "\n").trim();
  if (!raw) return undefined;
  const pem = /^-----BEGIN PUBLIC KEY-----([\s\S]+)-----END PUBLIC KEY-----$/.exec(raw);
  let bytes = pem ? Buffer.from(pem[1].replace(/\s+/g, ""), "base64") : /^[0-9a-fA-F]+$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (bytes.length === P256_SPKI_PREFIX.length + 65 && bytes.subarray(0, P256_SPKI_PREFIX.length).equals(P256_SPKI_PREFIX)) bytes = bytes.subarray(P256_SPKI_PREFIX.length);
  else if (pem) return undefined;
  try {
    return compressP256PublicKey(bytes);
  } catch {
    return undefined;
  }
}

/**
 * The KMS signer from `BUDGET_SPENDER_KMS_ISSUER_ID` and
 * `BUDGET_SPENDER_P256_PUBLIC_KEY`. Undefined when either is unset or
 * malformed; then no Budget key is made or used.
 */
export function readKmsSigner(env: Record<string, string | undefined> = process.env): SpenderSigner | undefined {
  const issuerId = env.BUDGET_SPENDER_KMS_ISSUER_ID?.trim();
  const publicKey = parseP256PublicKey(env.BUDGET_SPENDER_P256_PUBLIC_KEY);
  if (!issuerId || !publicKey) return undefined;
  return {
    publicKey,
    async sign(message) {
      const result = await signMessage({ issuerId, message });
      if (result.algorithm && result.algorithm !== "ES256") throw new Error(`issuer signs with ${result.algorithm}, not ES256`);
      return result.signature;
    },
  };
}
