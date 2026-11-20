/**
 * Provider receipt extension (#739, #740).
 *
 * A separately signed block that rides next to a `reddi.receipt.v1` receipt and
 * leaves that contract untouched. The provider states which model it declares
 * it served, the hashes of the request and response, and the payment the call
 * was paid with, then signs those fields with its wallet key.
 *
 * What a valid signature shows: the holder of the provider key stated these
 * fields. It does not show which model actually ran. "Declared model" is a
 * declaration, not verified execution.
 *
 * Everything here is offline: no network, no clock unless a caller passes one,
 * and no private key is ever accepted. Signing goes through a caller-supplied
 * signer function.
 */

import { createHash, createPublicKey, verify as edVerify } from 'node:crypto';

export const PROVIDER_RECEIPT_EXTENSION_VERSION = 'reddi.receipt.provider-extension.v1' as const;
export const PROVIDER_RECEIPT_PROOF_TYPE = 'ed25519' as const;

export type ProviderReceiptNetwork = 'solana-devnet' | 'solana-mainnet-beta';

export type ProviderReceiptExtension = {
  schemaVersion: typeof PROVIDER_RECEIPT_EXTENSION_VERSION;
  /** The provider's Solana wallet address (base58). The signature must verify against it. */
  providerId: string;
  /** The model the provider says it served. A declaration, not proof of execution. */
  declaredModel: string;
  /** SHA-256 of the request body bytes, lowercase hex. */
  requestHash: string;
  /** SHA-256 of the response body bytes, lowercase hex. */
  responseHash: string;
  payment: {
    network: ProviderReceiptNetwork;
    /** Signature of the transaction that paid for this call (base58). */
    txSignature: string;
  };
  /** ISO 8601 UTC time the provider issued this block. */
  issuedAt: string;
};

export type SignedProviderReceiptExtension = {
  extension: ProviderReceiptExtension;
  proof: {
    type: typeof PROVIDER_RECEIPT_PROOF_TYPE;
    /** Base64 of the 64-byte ed25519 signature over the canonical extension bytes. */
    signature: string;
  };
};

export type ProviderReceiptErrorCode =
  | 'malformed_extension'
  | 'unsupported_version'
  | 'malformed_proof'
  | 'signature_invalid'
  | 'provider_mismatch'
  | 'declared_model_mismatch'
  | 'request_hash_mismatch'
  | 'response_hash_mismatch'
  | 'payment_mismatch';

export type ProviderReceiptError = { code: ProviderReceiptErrorCode; path: string; message: string };

export type ProviderReceiptVerification =
  | { ok: true; extension: ProviderReceiptExtension }
  | { ok: false; errors: ProviderReceiptError[] };

/** What the verifier itself knows about the call. Every field given must match the signed block. */
export type ProviderReceiptExpectation = {
  providerId?: string;
  declaredModel?: string;
  requestHash?: string;
  responseHash?: string;
  payment?: { network: ProviderReceiptNetwork; txSignature: string };
};

/** Signs the canonical bytes with the provider's key and returns the 64-byte signature. The key never enters this module. */
export type ProviderReceiptSigner = (message: Uint8Array) => Uint8Array | Promise<Uint8Array>;

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const HASH = /^[0-9a-f]{64}$/;
const TX_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const EXTENSION_KEYS = ['schemaVersion', 'providerId', 'declaredModel', 'requestHash', 'responseHash', 'payment', 'issuedAt'];
const PAYMENT_KEYS = ['network', 'txSignature'];

function err(code: ProviderReceiptErrorCode, path: string, message: string): ProviderReceiptError {
  return { code, path, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

/** Decodes base58 to bytes, or undefined when the text is not base58. */
function base58Decode(text: string): Uint8Array | undefined {
  if (text.length === 0 || text.length > 128) return undefined;
  const bytes: number[] = [];
  for (const char of text) {
    let carry = BASE58_ALPHABET.indexOf(char);
    if (carry < 0) return undefined;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i]! * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const char of text) {
    if (char !== '1') break;
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

/** The 32-byte ed25519 public key behind a Solana address, or undefined. */
function publicKeyBytes(address: unknown): Uint8Array | undefined {
  if (typeof address !== 'string') return undefined;
  const decoded = base58Decode(address);
  return decoded && decoded.length === 32 ? decoded : undefined;
}

/** SHA-256 of a body, lowercase hex. Strings are hashed as UTF-8. */
export function hashProviderReceiptBody(body: string | Uint8Array): string {
  return createHash('sha256').update(typeof body === 'string' ? Buffer.from(body, 'utf8') : body).digest('hex');
}

export function validateProviderReceiptExtension(input: unknown): ProviderReceiptVerification {
  if (!isRecord(input)) return { ok: false, errors: [err('malformed_extension', '$', 'extension must be an object')] };
  if (input.schemaVersion !== PROVIDER_RECEIPT_EXTENSION_VERSION) {
    return { ok: false, errors: [err('unsupported_version', '$.schemaVersion', `expected ${PROVIDER_RECEIPT_EXTENSION_VERSION}`)] };
  }
  const errors: ProviderReceiptError[] = [];
  if (!onlyKeys(input, EXTENSION_KEYS)) errors.push(err('malformed_extension', '$', 'extension has fields this version does not define'));
  if (!publicKeyBytes(input.providerId)) errors.push(err('malformed_extension', '$.providerId', 'providerId must be a base58 Solana address'));
  if (typeof input.declaredModel !== 'string' || input.declaredModel.length < 1 || input.declaredModel.length > 120 || /[\u0000-\u001f\u007f]/.test(input.declaredModel)) {
    errors.push(err('malformed_extension', '$.declaredModel', 'declaredModel must be 1 to 120 printable characters'));
  }
  if (typeof input.requestHash !== 'string' || !HASH.test(input.requestHash)) errors.push(err('malformed_extension', '$.requestHash', 'requestHash must be lowercase hex SHA-256'));
  if (typeof input.responseHash !== 'string' || !HASH.test(input.responseHash)) errors.push(err('malformed_extension', '$.responseHash', 'responseHash must be lowercase hex SHA-256'));
  const payment = input.payment;
  if (!isRecord(payment) || !onlyKeys(payment, PAYMENT_KEYS)) {
    errors.push(err('malformed_extension', '$.payment', 'payment must be an object with network and txSignature only'));
  } else {
    if (payment.network !== 'solana-devnet' && payment.network !== 'solana-mainnet-beta') errors.push(err('malformed_extension', '$.payment.network', 'network must be solana-devnet or solana-mainnet-beta'));
    if (typeof payment.txSignature !== 'string' || !TX_SIGNATURE.test(payment.txSignature)) errors.push(err('malformed_extension', '$.payment.txSignature', 'txSignature must be a base58 transaction signature'));
  }
  if (typeof input.issuedAt !== 'string' || !ISO_UTC.test(input.issuedAt) || Number.isNaN(Date.parse(input.issuedAt))) {
    errors.push(err('malformed_extension', '$.issuedAt', 'issuedAt must be an ISO 8601 UTC time'));
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, extension: input as ProviderReceiptExtension };
}

/**
 * The exact bytes the provider signs: JSON with a fixed field order and no
 * whitespace. The version string is the first field, so a signature for this
 * block cannot be replayed as a signature for another kind of message.
 */
export function canonicalizeProviderReceiptExtension(extension: ProviderReceiptExtension): string {
  return JSON.stringify({
    schemaVersion: extension.schemaVersion,
    providerId: extension.providerId,
    declaredModel: extension.declaredModel,
    requestHash: extension.requestHash,
    responseHash: extension.responseHash,
    payment: { network: extension.payment.network, txSignature: extension.payment.txSignature },
    issuedAt: extension.issuedAt,
  });
}

/** Validates the block, asks the signer for a signature, and refuses to return one that does not verify. */
export async function signProviderReceiptExtension(extension: ProviderReceiptExtension, signer: ProviderReceiptSigner): Promise<SignedProviderReceiptExtension> {
  const valid = validateProviderReceiptExtension(extension);
  if (!valid.ok) throw new Error(`invalid_provider_receipt_extension:${valid.errors.map((e) => `${e.code}:${e.path}`).join(',')}`);
  const signature = await signer(Buffer.from(canonicalizeProviderReceiptExtension(valid.extension), 'utf8'));
  const signed: SignedProviderReceiptExtension = {
    extension: valid.extension,
    proof: { type: PROVIDER_RECEIPT_PROOF_TYPE, signature: Buffer.from(signature).toString('base64') },
  };
  const check = verifyProviderReceiptExtension(signed);
  if (!check.ok) throw new Error('provider_receipt_signer_mismatch: the signature does not verify against providerId');
  return signed;
}

/**
 * Verifies a signed block offline. The signature must verify against the
 * `providerId` inside the block, and every field of `expected` that is given
 * must equal the signed value. Pass what you know yourself: the provider you
 * paid, the hashes of the bytes you sent and received, the transaction you paid
 * with. Without `expected`, a pass only says some key signed some statement.
 */
export function verifyProviderReceiptExtension(input: unknown, expected: ProviderReceiptExpectation = {}): ProviderReceiptVerification {
  if (!isRecord(input) || !onlyKeys(input, ['extension', 'proof'])) {
    return { ok: false, errors: [err('malformed_proof', '$', 'expected an object with extension and proof only')] };
  }
  const valid = validateProviderReceiptExtension(input.extension);
  if (!valid.ok) return valid;
  const extension = valid.extension;
  const proof = input.proof;
  if (!isRecord(proof) || !onlyKeys(proof, ['type', 'signature']) || proof.type !== PROVIDER_RECEIPT_PROOF_TYPE || typeof proof.signature !== 'string') {
    return { ok: false, errors: [err('malformed_proof', '$.proof', 'proof must be { type: "ed25519", signature }')] };
  }
  if (!/^[A-Za-z0-9+/]{86}==$/.test(proof.signature)) {
    return { ok: false, errors: [err('malformed_proof', '$.proof.signature', 'signature must be base64 of 64 bytes')] };
  }
  const signature = Buffer.from(proof.signature, 'base64');
  const key = publicKeyBytes(extension.providerId)!;
  let verified = false;
  try {
    const publicKey = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(key)]), format: 'der', type: 'spki' });
    verified = signature.length === 64 && edVerify(null, Buffer.from(canonicalizeProviderReceiptExtension(extension), 'utf8'), publicKey, signature);
  } catch {
    verified = false;
  }
  if (!verified) return { ok: false, errors: [err('signature_invalid', '$.proof.signature', 'signature does not verify against providerId over the canonical extension')] };

  const errors: ProviderReceiptError[] = [];
  if (expected.providerId !== undefined && expected.providerId !== extension.providerId) errors.push(err('provider_mismatch', '$.extension.providerId', 'signed by a different provider than expected'));
  if (expected.declaredModel !== undefined && expected.declaredModel !== extension.declaredModel) errors.push(err('declared_model_mismatch', '$.extension.declaredModel', 'declared model differs from the one expected'));
  if (expected.requestHash !== undefined && expected.requestHash !== extension.requestHash) errors.push(err('request_hash_mismatch', '$.extension.requestHash', 'request hash differs from the request that was sent'));
  if (expected.responseHash !== undefined && expected.responseHash !== extension.responseHash) errors.push(err('response_hash_mismatch', '$.extension.responseHash', 'response hash differs from the response that was received'));
  if (expected.payment !== undefined && (expected.payment.network !== extension.payment.network || expected.payment.txSignature !== extension.payment.txSignature)) {
    errors.push(err('payment_mismatch', '$.extension.payment', 'payment reference differs from the payment that was made'));
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, extension };
}
