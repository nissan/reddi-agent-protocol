/**
 * Reddi receipt v2 (#739, #740).
 *
 * `reddi.receipt.v2` is a receipt the provider issues and signs. It names the
 * provider, the model the provider declares it served, the hashes of the
 * request and response, and the transaction the call was paid with. The
 * provider signs those fields with its wallet key, so the receipt can be
 * checked offline against the provider's address.
 *
 * It is a new version, not a superset of `reddi.receipt.v1`. v1 stays frozen
 * and is validated by `receipts.ts`; a v1 validator rejects a v2 receipt and
 * this module rejects a v1 receipt. v2 does not carry v1's buyer-side fields
 * (job, source, policy decision, attestation status) or an amount: the amount
 * paid is read from the transaction it names.
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
export const REDDI_RECEIPT_V2_VERSION = 'reddi.receipt.v2';
export const REDDI_RECEIPT_V2_PROOF_TYPE = 'ed25519';
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const HASH = /^[0-9a-f]{64}$/;
const TX_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const RECEIPT_KEYS = ['schemaVersion', 'providerId', 'declaredModel', 'requestHash', 'responseHash', 'payment', 'issuedAt'];
const PAYMENT_KEYS = ['network', 'txSignature'];
function err(code, path, message) {
    return { code, path, message };
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function onlyKeys(value, allowed) {
    return Object.keys(value).every((key) => allowed.includes(key));
}
/** Decodes base58 to bytes, or undefined when the text is not base58. */
function base58Decode(text) {
    if (text.length === 0 || text.length > 128)
        return undefined;
    const bytes = [];
    for (const char of text) {
        let carry = BASE58_ALPHABET.indexOf(char);
        if (carry < 0)
            return undefined;
        for (let i = 0; i < bytes.length; i += 1) {
            carry += bytes[i] * 58;
            bytes[i] = carry & 0xff;
            carry >>= 8;
        }
        while (carry > 0) {
            bytes.push(carry & 0xff);
            carry >>= 8;
        }
    }
    for (const char of text) {
        if (char !== '1')
            break;
        bytes.push(0);
    }
    return Uint8Array.from(bytes.reverse());
}
/** The 32-byte ed25519 public key behind a Solana address, or undefined. */
function publicKeyBytes(address) {
    if (typeof address !== 'string')
        return undefined;
    const decoded = base58Decode(address);
    return decoded && decoded.length === 32 ? decoded : undefined;
}
/** SHA-256 of a body, lowercase hex. Strings are hashed as UTF-8. */
export function hashReddiReceiptV2Body(body) {
    return createHash('sha256').update(typeof body === 'string' ? Buffer.from(body, 'utf8') : body).digest('hex');
}
export function validateReddiReceiptV2(input) {
    if (!isRecord(input))
        return { ok: false, errors: [err('malformed_receipt', '$', 'receipt must be an object')] };
    if (input.schemaVersion !== REDDI_RECEIPT_V2_VERSION) {
        return { ok: false, errors: [err('unsupported_version', '$.schemaVersion', `expected ${REDDI_RECEIPT_V2_VERSION}`)] };
    }
    const errors = [];
    if (!onlyKeys(input, RECEIPT_KEYS))
        errors.push(err('malformed_receipt', '$', 'receipt has fields this version does not define'));
    if (!publicKeyBytes(input.providerId))
        errors.push(err('malformed_receipt', '$.providerId', 'providerId must be a base58 Solana address'));
    if (typeof input.declaredModel !== 'string' || input.declaredModel.length < 1 || input.declaredModel.length > 120 || /[\u0000-\u001f\u007f]/.test(input.declaredModel)) {
        errors.push(err('malformed_receipt', '$.declaredModel', 'declaredModel must be 1 to 120 printable characters'));
    }
    if (typeof input.requestHash !== 'string' || !HASH.test(input.requestHash))
        errors.push(err('malformed_receipt', '$.requestHash', 'requestHash must be lowercase hex SHA-256'));
    if (typeof input.responseHash !== 'string' || !HASH.test(input.responseHash))
        errors.push(err('malformed_receipt', '$.responseHash', 'responseHash must be lowercase hex SHA-256'));
    const payment = input.payment;
    if (!isRecord(payment) || !onlyKeys(payment, PAYMENT_KEYS)) {
        errors.push(err('malformed_receipt', '$.payment', 'payment must be an object with network and txSignature only'));
    }
    else {
        if (payment.network !== 'solana-devnet' && payment.network !== 'solana-mainnet-beta')
            errors.push(err('malformed_receipt', '$.payment.network', 'network must be solana-devnet or solana-mainnet-beta'));
        if (typeof payment.txSignature !== 'string' || !TX_SIGNATURE.test(payment.txSignature))
            errors.push(err('malformed_receipt', '$.payment.txSignature', 'txSignature must be a base58 transaction signature'));
    }
    if (typeof input.issuedAt !== 'string' || !ISO_UTC.test(input.issuedAt) || Number.isNaN(Date.parse(input.issuedAt))) {
        errors.push(err('malformed_receipt', '$.issuedAt', 'issuedAt must be an ISO 8601 UTC time'));
    }
    return errors.length > 0 ? { ok: false, errors } : { ok: true, receipt: input };
}
/**
 * The exact bytes the provider signs: JSON with a fixed field order and no
 * whitespace. The version string is the first field, so a signature for this
 * receipt cannot be replayed as a signature for another kind of message.
 */
export function canonicalizeReddiReceiptV2(receipt) {
    return JSON.stringify({
        schemaVersion: receipt.schemaVersion,
        providerId: receipt.providerId,
        declaredModel: receipt.declaredModel,
        requestHash: receipt.requestHash,
        responseHash: receipt.responseHash,
        payment: { network: receipt.payment.network, txSignature: receipt.payment.txSignature },
        issuedAt: receipt.issuedAt,
    });
}
/** Validates the receipt, asks the signer for a signature, and refuses to return one that does not verify. */
export async function signReddiReceiptV2(receipt, signer) {
    const valid = validateReddiReceiptV2(receipt);
    if (!valid.ok)
        throw new Error(`invalid_reddi_receipt_v2:${valid.errors.map((e) => `${e.code}:${e.path}`).join(',')}`);
    const signature = await signer(Buffer.from(canonicalizeReddiReceiptV2(valid.receipt), 'utf8'));
    const signed = {
        receipt: valid.receipt,
        proof: { type: REDDI_RECEIPT_V2_PROOF_TYPE, signature: Buffer.from(signature).toString('base64') },
    };
    const check = verifyReddiReceiptV2(signed);
    if (!check.ok)
        throw new Error('provider_receipt_signer_mismatch: the signature does not verify against providerId');
    return signed;
}
/**
 * Verifies a signed receipt offline. The signature must verify against the
 * `providerId` inside the receipt, and every field of `expected` that is given
 * must equal the signed value. Pass what you know yourself: the provider you
 * paid, the hashes of the bytes you sent and received, the transaction you paid
 * with. Without `expected`, a pass only says some key signed some statement.
 */
export function verifyReddiReceiptV2(input, expected = {}) {
    if (!isRecord(input) || !onlyKeys(input, ['receipt', 'proof'])) {
        return { ok: false, errors: [err('malformed_proof', '$', 'expected an object with receipt and proof only')] };
    }
    const valid = validateReddiReceiptV2(input.receipt);
    if (!valid.ok)
        return valid;
    const receipt = valid.receipt;
    const proof = input.proof;
    if (!isRecord(proof) || !onlyKeys(proof, ['type', 'signature']) || proof.type !== REDDI_RECEIPT_V2_PROOF_TYPE || typeof proof.signature !== 'string') {
        return { ok: false, errors: [err('malformed_proof', '$.proof', 'proof must be { type: "ed25519", signature }')] };
    }
    if (!/^[A-Za-z0-9+/]{86}==$/.test(proof.signature)) {
        return { ok: false, errors: [err('malformed_proof', '$.proof.signature', 'signature must be base64 of 64 bytes')] };
    }
    const signature = Buffer.from(proof.signature, 'base64');
    const key = publicKeyBytes(receipt.providerId);
    let verified = false;
    try {
        const publicKey = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(key)]), format: 'der', type: 'spki' });
        verified = signature.length === 64 && edVerify(null, Buffer.from(canonicalizeReddiReceiptV2(receipt), 'utf8'), publicKey, signature);
    }
    catch {
        verified = false;
    }
    if (!verified)
        return { ok: false, errors: [err('signature_invalid', '$.proof.signature', 'signature does not verify against providerId over the canonical receipt')] };
    const errors = [];
    if (expected.providerId !== undefined && expected.providerId !== receipt.providerId)
        errors.push(err('provider_mismatch', '$.receipt.providerId', 'signed by a different provider than expected'));
    if (expected.declaredModel !== undefined && expected.declaredModel !== receipt.declaredModel)
        errors.push(err('declared_model_mismatch', '$.receipt.declaredModel', 'declared model differs from the one expected'));
    if (expected.requestHash !== undefined && expected.requestHash !== receipt.requestHash)
        errors.push(err('request_hash_mismatch', '$.receipt.requestHash', 'request hash differs from the request that was sent'));
    if (expected.responseHash !== undefined && expected.responseHash !== receipt.responseHash)
        errors.push(err('response_hash_mismatch', '$.receipt.responseHash', 'response hash differs from the response that was received'));
    if (expected.payment !== undefined && (expected.payment.network !== receipt.payment.network || expected.payment.txSignature !== receipt.payment.txSignature)) {
        errors.push(err('payment_mismatch', '$.receipt.payment', 'payment reference differs from the payment that was made'));
    }
    return errors.length > 0 ? { ok: false, errors } : { ok: true, receipt };
}
