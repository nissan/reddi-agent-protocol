"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_SESSION_DELEGATION_SECONDS = exports.SESSION_SIGNATURE_HEADER = exports.SESSION_DELEGATION_HEADER = void 0;
exports.sessionDelegationMessage = sessionDelegationMessage;
exports.sessionBodyHash = sessionBodyHash;
exports.sessionRequestMessage = sessionRequestMessage;
exports.sessionDelegationHeaderValue = sessionDelegationHeaderValue;
exports.sessionSignatureHeaderValue = sessionSignatureHeaderValue;
exports.verifySessionRequest = verifySessionRequest;
/**
 * Proof that a session call comes from the buyer that locked the escrow.
 *
 * The lock's escrow, payer and nonce are public once it confirms, so they
 * cannot show who is calling. The buyer makes a fresh ed25519 key for the
 * session and has its payer wallet sign, once, a delegation naming the
 * escrow, the provider, that key and an expiry (a plain-text message, so a
 * browser wallet can sign it with `signMessage`). Every call, close and read
 * then carries a signature by the session key over the action, the escrow,
 * the call number and the SHA-256 of the request body. The provider checks
 * both before it reserves a call, and the session keeps the first key it saw,
 * so a second delegation cannot take over a session already started.
 *
 * Headers:
 * - `x402-session-delegation`: base64 of JSON `{escrow, provider, sessionKey, expiresAt, signature}`;
 *   `expiresAt` is whole seconds since the epoch, `signature` base64 of the payer's signature over
 *   `sessionDelegationMessage(...)`.
 * - `x402-session-signature`: base64 of the session key's signature over `sessionRequestMessage(...)`.
 *
 * Verification uses Node's crypto; signing takes a callback, so the buyer can
 * sign with a wallet adapter, a Keypair or anything else.
 */
const crypto_1 = require("crypto");
const web3_js_1 = require("@solana/web3.js");
exports.SESSION_DELEGATION_HEADER = 'x402-session-delegation';
exports.SESSION_SIGNATURE_HEADER = 'x402-session-signature';
/** The longest a delegation may run. A session settles before its refund window anyway. */
exports.MAX_SESSION_DELEGATION_SECONDS = 7 * 24 * 60 * 60;
/** The text the payer wallet signs to hand a session to `sessionKey`. */
function sessionDelegationMessage(d) {
    return [
        'Reddi Agent Protocol session',
        'I let this session key make paid calls on my escrow lock.',
        `escrow: ${d.escrow}`,
        `provider: ${d.provider}`,
        `session key: ${d.sessionKey}`,
        `expires: ${new Date(d.expiresAt * 1000).toISOString()}`,
    ].join('\n');
}
/** SHA-256 of a request body, hex. An empty body hashes as zero bytes. */
function sessionBodyHash(body = '') {
    return (0, crypto_1.createHash)('sha256').update(typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body)).digest('hex');
}
/** The bytes the session key signs for one request. `sequence` is the call number for `call`, and 0 for `close` and `read`. */
function sessionRequestMessage(input) {
    return ['reddi-session/1', input.action, input.escrow, String(input.sequence), input.bodyHash].join('\n');
}
/** Buyer side: the delegation header value, signed by the payer wallet. */
async function sessionDelegationHeaderValue(d, signWithPayer) {
    const signature = await signWithPayer(new TextEncoder().encode(sessionDelegationMessage(d)));
    return Buffer.from(JSON.stringify({ ...d, signature: Buffer.from(signature).toString('base64') }), 'utf8').toString('base64');
}
/** Buyer side: the signature header value for one request, signed by the session key. */
async function sessionSignatureHeaderValue(input, signWithSessionKey) {
    const message = sessionRequestMessage({ action: input.action, escrow: input.escrow, sequence: input.sequence, bodyHash: sessionBodyHash(input.body) });
    return Buffer.from(await signWithSessionKey(new TextEncoder().encode(message))).toString('base64');
}
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
function ed25519Verify(publicKey, message, signature) {
    if (signature.length !== 64)
        return false;
    try {
        const key = (0, crypto_1.createPublicKey)({ key: Buffer.concat([ED25519_SPKI_PREFIX, publicKey.toBuffer()]), format: 'der', type: 'spki' });
        return (0, crypto_1.verify)(null, Buffer.from(message), key, Buffer.from(signature));
    }
    catch {
        return false;
    }
}
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
function decodeBase64(value) {
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= 4096 && BASE64.test(trimmed) ? Buffer.from(trimmed, 'base64') : undefined;
}
function publicKeyOf(value) {
    if (typeof value !== 'string' || value.length > 64)
        return undefined;
    try {
        return new web3_js_1.PublicKey(value);
    }
    catch {
        return undefined;
    }
}
/**
 * Provider side: checks that a session request is signed by a key the payer
 * handed this session to. Returns the session key on success. `payer` and
 * `escrow` come from the payment header (the lock check then confirms them on
 * chain); `provider` is this provider's payee wallet; `body` is the raw
 * request body exactly as received.
 */
function verifySessionRequest(input) {
    const delegationValue = input.headers.get(exports.SESSION_DELEGATION_HEADER);
    const signatureValue = input.headers.get(exports.SESSION_SIGNATURE_HEADER);
    if (!delegationValue || !signatureValue) {
        return { ok: false, reason: 'session_auth_required', message: `Session requests must carry ${exports.SESSION_DELEGATION_HEADER} (the payer wallet's delegation to a session key) and ${exports.SESSION_SIGNATURE_HEADER} (that key's signature over this request).` };
    }
    const invalid = (message) => ({ ok: false, reason: 'session_auth_invalid', message });
    const raw = decodeBase64(delegationValue);
    if (!raw)
        return invalid('The session delegation is not base64.');
    let parsed;
    try {
        const value = JSON.parse(raw.toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value))
            return invalid('The session delegation is not an object.');
        parsed = value;
    }
    catch {
        return invalid('The session delegation is not JSON.');
    }
    const escrow = publicKeyOf(parsed.escrow);
    const provider = publicKeyOf(parsed.provider);
    const sessionKey = publicKeyOf(parsed.sessionKey);
    const expiresAt = parsed.expiresAt;
    const delegationSignature = typeof parsed.signature === 'string' ? decodeBase64(parsed.signature) : undefined;
    if (!escrow || !provider || !sessionKey || typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt) || !delegationSignature) {
        return invalid('The session delegation needs escrow, provider, sessionKey, a whole-second expiresAt and a signature.');
    }
    if (!escrow.equals(input.escrow))
        return invalid('The session delegation names another escrow.');
    if (!provider.equals(input.provider))
        return invalid('The session delegation names another provider.');
    const nowSeconds = Math.floor(input.nowMs / 1000);
    if (expiresAt <= nowSeconds)
        return { ok: false, reason: 'session_auth_expired', message: 'The session delegation has expired. Sign a new one with the payer wallet.' };
    if (expiresAt > nowSeconds + exports.MAX_SESSION_DELEGATION_SECONDS)
        return invalid(`A session delegation may run for at most ${exports.MAX_SESSION_DELEGATION_SECONDS} seconds.`);
    const delegation = { escrow: escrow.toBase58(), provider: provider.toBase58(), sessionKey: sessionKey.toBase58(), expiresAt };
    if (!ed25519Verify(input.payer, new TextEncoder().encode(sessionDelegationMessage(delegation)), delegationSignature)) {
        return invalid("The session delegation is not signed by the escrow's payer.");
    }
    const requestSignature = decodeBase64(signatureValue);
    const message = sessionRequestMessage({ action: input.action, escrow: delegation.escrow, sequence: input.sequence, bodyHash: sessionBodyHash(input.body) });
    if (!requestSignature || !ed25519Verify(sessionKey, new TextEncoder().encode(message), requestSignature)) {
        return invalid('The request is not signed by the session key, or was changed after signing.');
    }
    return { ok: true, sessionKey: delegation.sessionKey, expiresAt };
}
