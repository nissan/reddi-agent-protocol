/**
 * Reddi receipt v2 (#739, #740).
 *
 * `reddi.receipt.v2` is a receipt the provider issues and signs. It names the
 * provider, the model the provider declares it served, the hashes of the
 * request and response, and the transaction the call was paid with. The
 * provider signs those fields with its wallet key, so the receipt can be
 * checked offline against the provider's address.
 *
 * It is the receipt for every paid call in V1 (#776). It also states what was
 * paid: the currency and mint, the listed price, the protocol fee and where it
 * went, and whether the call was paid directly or through escrow. A v1
 * validator rejects a v2 receipt and this module rejects a v1 receipt.
 *
 * The payment fields are the provider's statement. A verifier that needs to
 * rely on them checks the named transaction on chain; this module does not.
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

export const REDDI_RECEIPT_V2_VERSION = 'reddi.receipt.v2' as const;
export const REDDI_RECEIPT_V2_PROOF_TYPE = 'ed25519' as const;

export type ReddiReceiptV2Network = 'solana-devnet' | 'solana-mainnet-beta';
export const REDDI_RECEIPT_V2_CURRENCIES = ['SOL', 'USDC', 'PYUSD', 'USDG', 'AUDD'] as const;
export type ReddiReceiptV2Currency = (typeof REDDI_RECEIPT_V2_CURRENCIES)[number];
export type ReddiReceiptV2Settlement = 'direct' | 'escrow' | 'metered-escrow';

/**
 * What a per-token call used and settled. Present exactly when `settlement`
 * is 'metered-escrow'. Token counts are the provider's report; `maxAmount` is
 * what the buyer authorised and locked, `amount` is the actual cost paid, and
 * `refunded` is the rest, returned to the buyer.
 */
export type ReddiReceiptV2Metered = {
  inputTokens: string;
  outputTokens: string;
  maxAmount: string;
  refunded: string;
};

export type ReddiReceiptV2Payment = {
  network: ReddiReceiptV2Network;
  /** Signature of the transaction that paid for this call (base58). */
  txSignature: string;
  currency: ReddiReceiptV2Currency;
  /** Token mint address (base58). Required for every currency except SOL, which has none. */
  mint?: string;
  /** What the buyer paid in total, in the currency's smallest unit, as a decimal string. For a metered call, the actual cost. */
  amount: string;
  /**
   * Protocol fee taken out of `amount`, in the smallest unit. "0" when no fee
   * applied. `treasury` is the address that received it and is required when
   * the fee is above zero.
   */
  fee: { amount: string; treasury?: string };
  /** Paying wallet (base58). Present only when the provider checked it against the transaction. */
  payer?: string;
  settlement: ReddiReceiptV2Settlement;
  /** Token counts and the authorised maximum of a per-token call. */
  metered?: ReddiReceiptV2Metered;
};

export type ReddiReceiptV2 = {
  schemaVersion: typeof REDDI_RECEIPT_V2_VERSION;
  /** The provider's Solana wallet address (base58). The signature must verify against it. */
  providerId: string;
  /** The model the provider says it served. A declaration, not proof of execution. */
  declaredModel: string;
  /** SHA-256 of the request body bytes, lowercase hex. */
  requestHash: string;
  /** SHA-256 of the response body bytes, lowercase hex. */
  responseHash: string;
  payment: ReddiReceiptV2Payment;
  /** The job this call was recorded as, when the provider knows it. */
  jobId?: string;
  /** ISO 8601 UTC time the provider issued this receipt. */
  issuedAt: string;
};

export type SignedReddiReceiptV2 = {
  receipt: ReddiReceiptV2;
  proof: {
    type: typeof REDDI_RECEIPT_V2_PROOF_TYPE;
    /** Base64 of the 64-byte ed25519 signature over the canonical receipt bytes. */
    signature: string;
  };
};

export type ReddiReceiptV2ErrorCode =
  | 'malformed_receipt'
  | 'unsupported_version'
  | 'malformed_proof'
  | 'signature_invalid'
  | 'provider_mismatch'
  | 'declared_model_mismatch'
  | 'request_hash_mismatch'
  | 'response_hash_mismatch'
  | 'payment_mismatch';

export type ReddiReceiptV2Error = { code: ReddiReceiptV2ErrorCode; path: string; message: string };

export type ReddiReceiptV2Verification =
  | { ok: true; receipt: ReddiReceiptV2 }
  | { ok: false; errors: ReddiReceiptV2Error[] };

/** What the verifier itself knows about the call. Every field given must match the signed receipt. */
export type ReddiReceiptV2Expectation = {
  providerId?: string;
  declaredModel?: string;
  requestHash?: string;
  responseHash?: string;
  /** `network` and `txSignature` always compare; each other field compares when given. */
  payment?: { network: ReddiReceiptV2Network; txSignature: string } & Partial<Omit<ReddiReceiptV2Payment, 'network' | 'txSignature' | 'fee'>> & { fee?: { amount: string; treasury?: string } };
};

/** Signs the canonical bytes with the provider's key and returns the 64-byte signature. The key never enters this module. */
export type ReddiReceiptV2Signer = (message: Uint8Array) => Uint8Array | Promise<Uint8Array>;

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const HASH = /^[0-9a-f]{64}$/;
const TX_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const RECEIPT_KEYS = ['schemaVersion', 'providerId', 'declaredModel', 'requestHash', 'responseHash', 'payment', 'jobId', 'issuedAt'];
const PAYMENT_KEYS = ['network', 'txSignature', 'currency', 'mint', 'amount', 'fee', 'payer', 'settlement', 'metered'];
const METERED_KEYS = ['inputTokens', 'outputTokens', 'maxAmount', 'refunded'];
/** Smallest-unit amount: digits only, no leading zero, at most 30 digits. */
const BASE_UNITS = /^(0|[1-9]\d{0,29})$/;
const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;

function err(code: ReddiReceiptV2ErrorCode, path: string, message: string): ReddiReceiptV2Error {
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
export function hashReddiReceiptV2Body(body: string | Uint8Array): string {
  return createHash('sha256').update(typeof body === 'string' ? Buffer.from(body, 'utf8') : body).digest('hex');
}

export function validateReddiReceiptV2(input: unknown): ReddiReceiptV2Verification {
  if (!isRecord(input)) return { ok: false, errors: [err('malformed_receipt', '$', 'receipt must be an object')] };
  if (input.schemaVersion !== REDDI_RECEIPT_V2_VERSION) {
    return { ok: false, errors: [err('unsupported_version', '$.schemaVersion', `expected ${REDDI_RECEIPT_V2_VERSION}`)] };
  }
  const errors: ReddiReceiptV2Error[] = [];
  if (!onlyKeys(input, RECEIPT_KEYS)) errors.push(err('malformed_receipt', '$', 'receipt has fields this version does not define'));
  if (!publicKeyBytes(input.providerId)) errors.push(err('malformed_receipt', '$.providerId', 'providerId must be a base58 Solana address'));
  if (typeof input.declaredModel !== 'string' || input.declaredModel.length < 1 || input.declaredModel.length > 120 || /[\u0000-\u001f\u007f]/.test(input.declaredModel)) {
    errors.push(err('malformed_receipt', '$.declaredModel', 'declaredModel must be 1 to 120 printable characters'));
  }
  if (typeof input.requestHash !== 'string' || !HASH.test(input.requestHash)) errors.push(err('malformed_receipt', '$.requestHash', 'requestHash must be lowercase hex SHA-256'));
  if (typeof input.responseHash !== 'string' || !HASH.test(input.responseHash)) errors.push(err('malformed_receipt', '$.responseHash', 'responseHash must be lowercase hex SHA-256'));
  const payment = input.payment;
  if (!isRecord(payment) || !onlyKeys(payment, PAYMENT_KEYS)) {
    errors.push(err('malformed_receipt', '$.payment', 'payment must be an object with only the fields this version defines'));
  } else {
    const isSol = payment.currency === 'SOL';
    if (!(REDDI_RECEIPT_V2_CURRENCIES as readonly unknown[]).includes(payment.currency)) errors.push(err('malformed_receipt', '$.payment.currency', 'currency must be SOL, USDC, PYUSD, USDG or AUDD'));
    else if (isSol && payment.mint !== undefined) errors.push(err('malformed_receipt', '$.payment.mint', 'SOL has no mint'));
    else if (!isSol && !publicKeyBytes(payment.mint)) errors.push(err('malformed_receipt', '$.payment.mint', 'mint must be a base58 address for a token currency'));
    if (typeof payment.amount !== 'string' || !BASE_UNITS.test(payment.amount) || payment.amount === '0') errors.push(err('malformed_receipt', '$.payment.amount', 'amount must be a positive whole number of smallest units, as a string'));
    const fee = payment.fee;
    if (!isRecord(fee) || !onlyKeys(fee, ['amount', 'treasury']) || typeof fee.amount !== 'string' || !BASE_UNITS.test(fee.amount)) {
      errors.push(err('malformed_receipt', '$.payment.fee', 'fee must be { amount, treasury? } with amount in smallest units'));
    } else {
      if (fee.treasury !== undefined && !publicKeyBytes(fee.treasury)) errors.push(err('malformed_receipt', '$.payment.fee.treasury', 'treasury must be a base58 address'));
      if (fee.amount !== '0' && fee.treasury === undefined) errors.push(err('malformed_receipt', '$.payment.fee.treasury', 'a fee above zero must name the treasury that received it'));
      if (typeof payment.amount === 'string' && BASE_UNITS.test(payment.amount) && BigInt(fee.amount) >= BigInt(payment.amount)) errors.push(err('malformed_receipt', '$.payment.fee.amount', 'fee must be less than the amount'));
    }
    if (payment.payer !== undefined && !publicKeyBytes(payment.payer)) errors.push(err('malformed_receipt', '$.payment.payer', 'payer must be a base58 address'));
    if (payment.settlement !== 'direct' && payment.settlement !== 'escrow' && payment.settlement !== 'metered-escrow') {
      errors.push(err('malformed_receipt', '$.payment.settlement', 'settlement must be direct, escrow or metered-escrow'));
    }
    const metered = payment.metered;
    if (payment.settlement === 'metered-escrow') {
      if (!isRecord(metered) || !onlyKeys(metered, METERED_KEYS) || !METERED_KEYS.every((key) => typeof metered[key] === 'string' && BASE_UNITS.test(metered[key] as string))) {
        errors.push(err('malformed_receipt', '$.payment.metered', 'a metered-escrow payment must state { inputTokens, outputTokens, maxAmount, refunded } as whole numbers'));
      } else if (typeof payment.amount === 'string' && BASE_UNITS.test(payment.amount)) {
        const max = BigInt(metered.maxAmount as string);
        const paid = BigInt(payment.amount);
        if (paid > max) errors.push(err('malformed_receipt', '$.payment.amount', 'a metered payment cannot exceed the authorised maximum'));
        else if (BigInt(metered.refunded as string) !== max - paid) errors.push(err('malformed_receipt', '$.payment.metered.refunded', 'refunded must be the maximum less the amount paid'));
      }
    } else if (metered !== undefined) {
      errors.push(err('malformed_receipt', '$.payment.metered', 'only a metered-escrow payment states token counts'));
    }
    if (payment.network !== 'solana-devnet' && payment.network !== 'solana-mainnet-beta') errors.push(err('malformed_receipt', '$.payment.network', 'network must be solana-devnet or solana-mainnet-beta'));
    if (typeof payment.txSignature !== 'string' || !TX_SIGNATURE.test(payment.txSignature)) errors.push(err('malformed_receipt', '$.payment.txSignature', 'txSignature must be a base58 transaction signature'));
  }
  if (input.jobId !== undefined && (typeof input.jobId !== 'string' || !JOB_ID.test(input.jobId))) errors.push(err('malformed_receipt', '$.jobId', 'jobId must be 1 to 120 characters of letters, digits, dot, underscore, colon or hyphen'));
  if (typeof input.issuedAt !== 'string' || !ISO_UTC.test(input.issuedAt) || Number.isNaN(Date.parse(input.issuedAt))) {
    errors.push(err('malformed_receipt', '$.issuedAt', 'issuedAt must be an ISO 8601 UTC time'));
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, receipt: input as ReddiReceiptV2 };
}

/**
 * The exact bytes the provider signs: JSON with a fixed field order and no
 * whitespace. The version string is the first field, so a signature for this
 * receipt cannot be replayed as a signature for another kind of message.
 */
export function canonicalizeReddiReceiptV2(receipt: ReddiReceiptV2): string {
  const p = receipt.payment;
  return JSON.stringify({
    schemaVersion: receipt.schemaVersion,
    providerId: receipt.providerId,
    declaredModel: receipt.declaredModel,
    requestHash: receipt.requestHash,
    responseHash: receipt.responseHash,
    payment: {
      network: p.network,
      txSignature: p.txSignature,
      currency: p.currency,
      ...(p.mint !== undefined ? { mint: p.mint } : {}),
      amount: p.amount,
      fee: { amount: p.fee.amount, ...(p.fee.treasury !== undefined ? { treasury: p.fee.treasury } : {}) },
      ...(p.payer !== undefined ? { payer: p.payer } : {}),
      settlement: p.settlement,
      ...(p.metered !== undefined
        ? { metered: { inputTokens: p.metered.inputTokens, outputTokens: p.metered.outputTokens, maxAmount: p.metered.maxAmount, refunded: p.metered.refunded } }
        : {}),
    },
    ...(receipt.jobId !== undefined ? { jobId: receipt.jobId } : {}),
    issuedAt: receipt.issuedAt,
  });
}

/** Validates the receipt, asks the signer for a signature, and refuses to return one that does not verify. */
export async function signReddiReceiptV2(receipt: ReddiReceiptV2, signer: ReddiReceiptV2Signer): Promise<SignedReddiReceiptV2> {
  const valid = validateReddiReceiptV2(receipt);
  if (!valid.ok) throw new Error(`invalid_reddi_receipt_v2:${valid.errors.map((e) => `${e.code}:${e.path}`).join(',')}`);
  const signature = await signer(Buffer.from(canonicalizeReddiReceiptV2(valid.receipt), 'utf8'));
  const signed: SignedReddiReceiptV2 = {
    receipt: valid.receipt,
    proof: { type: REDDI_RECEIPT_V2_PROOF_TYPE, signature: Buffer.from(signature).toString('base64') },
  };
  const check = verifyReddiReceiptV2(signed);
  if (!check.ok) throw new Error('provider_receipt_signer_mismatch: the signature does not verify against providerId');
  return signed;
}

/**
 * Verifies a signed receipt offline. The signature must verify against the
 * `providerId` inside the receipt, and every field of `expected` that is given
 * must equal the signed value. Pass what you know yourself: the provider you
 * paid, the hashes of the bytes you sent and received, the transaction you paid
 * with. Without `expected`, a pass only says some key signed some statement.
 */
export function verifyReddiReceiptV2(input: unknown, expected: ReddiReceiptV2Expectation = {}): ReddiReceiptV2Verification {
  if (!isRecord(input) || !onlyKeys(input, ['receipt', 'proof'])) {
    return { ok: false, errors: [err('malformed_proof', '$', 'expected an object with receipt and proof only')] };
  }
  const valid = validateReddiReceiptV2(input.receipt);
  if (!valid.ok) return valid;
  const receipt = valid.receipt;
  const proof = input.proof;
  if (!isRecord(proof) || !onlyKeys(proof, ['type', 'signature']) || proof.type !== REDDI_RECEIPT_V2_PROOF_TYPE || typeof proof.signature !== 'string') {
    return { ok: false, errors: [err('malformed_proof', '$.proof', 'proof must be { type: "ed25519", signature }')] };
  }
  if (!/^[A-Za-z0-9+/]{86}==$/.test(proof.signature)) {
    return { ok: false, errors: [err('malformed_proof', '$.proof.signature', 'signature must be base64 of 64 bytes')] };
  }
  const signature = Buffer.from(proof.signature, 'base64');
  const key = publicKeyBytes(receipt.providerId)!;
  let verified = false;
  try {
    const publicKey = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(key)]), format: 'der', type: 'spki' });
    verified = signature.length === 64 && edVerify(null, Buffer.from(canonicalizeReddiReceiptV2(receipt), 'utf8'), publicKey, signature);
  } catch {
    verified = false;
  }
  if (!verified) return { ok: false, errors: [err('signature_invalid', '$.proof.signature', 'signature does not verify against providerId over the canonical receipt')] };

  const errors: ReddiReceiptV2Error[] = [];
  if (expected.providerId !== undefined && expected.providerId !== receipt.providerId) errors.push(err('provider_mismatch', '$.receipt.providerId', 'signed by a different provider than expected'));
  if (expected.declaredModel !== undefined && expected.declaredModel !== receipt.declaredModel) errors.push(err('declared_model_mismatch', '$.receipt.declaredModel', 'declared model differs from the one expected'));
  if (expected.requestHash !== undefined && expected.requestHash !== receipt.requestHash) errors.push(err('request_hash_mismatch', '$.receipt.requestHash', 'request hash differs from the request that was sent'));
  if (expected.responseHash !== undefined && expected.responseHash !== receipt.responseHash) errors.push(err('response_hash_mismatch', '$.receipt.responseHash', 'response hash differs from the response that was received'));
  if (expected.payment !== undefined) {
    const want = expected.payment;
    const got = receipt.payment;
    const differs =
      want.network !== got.network
      || want.txSignature !== got.txSignature
      || (want.currency !== undefined && want.currency !== got.currency)
      || (want.mint !== undefined && want.mint !== got.mint)
      || (want.amount !== undefined && want.amount !== got.amount)
      || (want.payer !== undefined && want.payer !== got.payer)
      || (want.settlement !== undefined && want.settlement !== got.settlement)
      || (want.metered !== undefined && (got.metered === undefined || METERED_KEYS.some((key) => want.metered![key as keyof ReddiReceiptV2Metered] !== got.metered![key as keyof ReddiReceiptV2Metered])))
      || (want.fee !== undefined && (want.fee.amount !== got.fee.amount || (want.fee.treasury !== undefined && want.fee.treasury !== got.fee.treasury)));
    if (differs) errors.push(err('payment_mismatch', '$.receipt.payment', 'payment differs from the payment that was made'));
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, receipt };
}
