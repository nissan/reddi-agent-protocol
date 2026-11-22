"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_DELEGATION_SECONDS = exports.MAX_SESSION_DELEGATION_SECONDS = exports.SESSION_SIGNATURE_HEADER = exports.SESSION_DELEGATION_HEADER = void 0;
exports.delegationExpiresAt = delegationExpiresAt;
exports.sessionCallAction = sessionCallAction;
exports.sessionDelegationMessage = sessionDelegationMessage;
exports.sessionBodyHash = sessionBodyHash;
exports.sessionRequestMessage = sessionRequestMessage;
exports.sessionDelegationHeaderValue = sessionDelegationHeaderValue;
exports.sessionSignatureHeaderValue = sessionSignatureHeaderValue;
exports.verifySessionRequest = verifySessionRequest;
exports.paidCallAuthHeaders = paidCallAuthHeaders;
exports.verifyPaidCallRequest = verifyPaidCallRequest;
/**
 * Proof that a paid call comes from the buyer that locked the escrow: every
 * call of a session, and a single metered call (action `single`, #866).
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
 * Both messages name the cluster by its genesis hash, so a signature made for
 * one network is refused on every other, even where the program id, escrow
 * address and provider are the same.
 *
 * Headers:
 * - `x402-session-delegation`: base64 of JSON `{network, escrow, provider, sessionKey, expiresAt, signature}`;
 *   `network` is the cluster's genesis hash;
 *   `expiresAt` is whole seconds since the epoch, `signature` base64 of the payer's signature over
 *   `sessionDelegationMessage(...)`.
 * - `x402-session-signature`: base64 of the session key's signature over `sessionRequestMessage(...)`.
 *
 * Verification uses Node's crypto; signing takes a callback, so the buyer can
 * sign with a wallet adapter, a Keypair or anything else.
 */
const crypto_1 = require("crypto");
const ed25519_1 = require("./ed25519");
exports.SESSION_DELEGATION_HEADER = 'x402-session-delegation';
exports.SESSION_SIGNATURE_HEADER = 'x402-session-signature';
/** The longest a delegation may run. A session settles before its refund window anyway. */
exports.MAX_SESSION_DELEGATION_SECONDS = 7 * 24 * 60 * 60;
/**
 * How long a buyer client should let a delegation run unless it has a reason
 * to choose otherwise: a day, well short of the maximum, because anyone holding
 * the session key can sign for the payer until then. Keep the key in memory
 * only (never in localStorage or on disk), and sign a new delegation when it runs out.
 */
exports.DEFAULT_DELEGATION_SECONDS = 24 * 60 * 60;
/** Buyer side: the `expiresAt` for a new delegation, `seconds` (default a day) from `nowMs`. */
function delegationExpiresAt(nowMs = Date.now(), seconds = exports.DEFAULT_DELEGATION_SECONDS) {
    if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > exports.MAX_SESSION_DELEGATION_SECONDS) {
        throw new Error(`a delegation runs for 1 to ${exports.MAX_SESSION_DELEGATION_SECONDS} seconds`);
    }
    return Math.floor(nowMs / 1000) + seconds;
}
/** The action a session call is signed under: `call-close` when it asks to close the session. */
function sessionCallAction(close) {
    return close ? 'call-close' : 'call';
}
/** The text the payer wallet signs to hand a session to `sessionKey`. */
function sessionDelegationMessage(d) {
    return [
        'Reddi Agent Protocol session',
        'I let this session key make paid calls on my escrow lock.',
        `network: ${d.genesisHash}`,
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
/** The bytes the session key signs for one request. `sequence` is the call number for `call` and `call-close`, and 0 for `close`, `read` and `single`. */
function sessionRequestMessage(input) {
    return ['reddi-session/2', input.genesisHash, input.action, input.escrow, String(input.sequence), input.bodyHash].join('\n');
}
/** Buyer side: the delegation header value, signed by the payer wallet. Use `delegationExpiresAt()` for `expiresAt`. */
async function sessionDelegationHeaderValue(d, signWithPayer) {
    const signature = await signWithPayer(new TextEncoder().encode(sessionDelegationMessage(d)));
    const { genesisHash, ...rest } = d;
    return Buffer.from(JSON.stringify({ network: genesisHash, ...rest, signature: Buffer.from(signature).toString('base64') }), 'utf8').toString('base64');
}
/** Buyer side: the signature header value for one request, signed by the session key. */
async function sessionSignatureHeaderValue(input, signWithSessionKey) {
    const message = sessionRequestMessage({ genesisHash: input.genesisHash, action: input.action, escrow: input.escrow, sequence: input.sequence, bodyHash: sessionBodyHash(input.body) });
    return Buffer.from(await signWithSessionKey(new TextEncoder().encode(message))).toString('base64');
}
/**
 * Provider side: checks that a session request is signed by a key the payer
 * handed this session to. Returns the session key on success. `payer` and
 * `escrow` come from the payment header (the lock check then confirms them on
 * chain); `provider` is this provider's payee wallet; `genesisHash` is the
 * genesis hash of the cluster this provider checked it is on; `body` is the raw
 * request body exactly as received.
 */
function verifySessionRequest(input) {
    const delegationValue = input.headers.get(exports.SESSION_DELEGATION_HEADER);
    const signatureValue = input.headers.get(exports.SESSION_SIGNATURE_HEADER);
    if (!delegationValue || !signatureValue) {
        return { ok: false, reason: 'session_auth_required', message: `Paid requests must carry ${exports.SESSION_DELEGATION_HEADER} (the payer wallet's delegation to a session key) and ${exports.SESSION_SIGNATURE_HEADER} (that key's signature over this request).` };
    }
    const invalid = (message) => ({ ok: false, reason: 'session_auth_invalid', message });
    const raw = (0, ed25519_1.decodeBase64)(delegationValue);
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
    if (typeof parsed.network !== 'string' || parsed.network.length === 0)
        return invalid('The session delegation names no network. Sign a new one with this client version.');
    if (parsed.network !== input.genesisHash)
        return invalid('The session delegation was signed for another network.');
    const escrow = (0, ed25519_1.publicKeyOf)(parsed.escrow);
    const provider = (0, ed25519_1.publicKeyOf)(parsed.provider);
    const sessionKey = (0, ed25519_1.publicKeyOf)(parsed.sessionKey);
    const expiresAt = parsed.expiresAt;
    const delegationSignature = typeof parsed.signature === 'string' ? (0, ed25519_1.decodeBase64)(parsed.signature) : undefined;
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
    const delegation = { genesisHash: input.genesisHash, escrow: escrow.toBase58(), provider: provider.toBase58(), sessionKey: sessionKey.toBase58(), expiresAt };
    if (!(0, ed25519_1.ed25519Verify)(input.payer, new TextEncoder().encode(sessionDelegationMessage(delegation)), delegationSignature)) {
        return invalid("The session delegation is not signed by the escrow's payer.");
    }
    const requestSignature = (0, ed25519_1.decodeBase64)(signatureValue);
    const message = sessionRequestMessage({ genesisHash: input.genesisHash, action: input.action, escrow: delegation.escrow, sequence: input.sequence, bodyHash: sessionBodyHash(input.body) });
    if (!requestSignature || !(0, ed25519_1.ed25519Verify)(sessionKey, new TextEncoder().encode(message), requestSignature)) {
        return invalid('The request is not signed by the session key, or was changed after signing.');
    }
    return { ok: true, sessionKey: delegation.sessionKey, expiresAt };
}
/**
 * Buyer side, single metered call: both headers for one call on the lock
 * `escrow`. With no `sessionKey`, the payer signs the request too (fine for a
 * server-held keypair; a browser wallet would then sign twice, so pass a
 * fresh key there and keep it for the call).
 */
async function paidCallAuthHeaders(input) {
    const key = input.sessionKey ?? { publicKey: input.payer, sign: input.signWithPayer };
    const expiresAt = input.expiresAt ?? Math.floor((input.nowMs ?? Date.now()) / 1000) + 600;
    return {
        [exports.SESSION_DELEGATION_HEADER]: await sessionDelegationHeaderValue({ genesisHash: input.genesisHash, escrow: input.escrow, provider: input.provider, sessionKey: key.publicKey, expiresAt }, input.signWithPayer),
        [exports.SESSION_SIGNATURE_HEADER]: await sessionSignatureHeaderValue({ genesisHash: input.genesisHash, action: 'single', escrow: input.escrow, sequence: 0, body: input.body }, key.sign),
    };
}
/** Provider side, single metered call: `verifySessionRequest` with action `single` and sequence 0. */
function verifyPaidCallRequest(input) {
    return verifySessionRequest({ ...input, action: 'single', sequence: 0 });
}
