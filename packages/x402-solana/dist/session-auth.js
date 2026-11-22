"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SESSION_DELEGATION_MEMO_PREFIX = exports.MEMO_PROGRAM_ID = exports.DEFAULT_DELEGATION_SECONDS = exports.MAX_SESSION_DELEGATION_SECONDS = exports.SESSION_SIGNATURE_HEADER = exports.SESSION_DELEGATION_HEADER = void 0;
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
exports.sessionDelegationMemo = sessionDelegationMemo;
exports.sessionDelegationMemoInstruction = sessionDelegationMemoInstruction;
exports.lockBoundDelegationHeaderValue = lockBoundDelegationHeaderValue;
exports.transactionFactsReader = transactionFactsReader;
exports.verifySessionRequestWithTransactions = verifySessionRequestWithTransactions;
exports.verifyPaidCallRequestWithTransactions = verifyPaidCallRequestWithTransactions;
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
const web3_js_1 = require("@solana/web3.js");
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
    const parsed = parseSessionRequest(input);
    if (!parsed.ok)
        return parsed;
    if (parsed.proof.kind !== 'signature') {
        return { ok: false, reason: 'session_auth_invalid', message: 'This delegation is proved by a lock transaction memo, which this check cannot read. Use verifySessionRequestWithTransactions.' };
    }
    if (!(0, ed25519_1.ed25519Verify)(input.payer, new TextEncoder().encode(sessionDelegationMessage(parsed.delegation)), parsed.proof.signature)) {
        return { ok: false, reason: 'session_auth_invalid', message: "The session delegation is not signed by the escrow's payer." };
    }
    return { ok: true, sessionKey: parsed.delegation.sessionKey, expiresAt: parsed.delegation.expiresAt };
}
/**
 * Everything but the payer's consent: the delegation's shape, network,
 * escrow, provider and expiry, and the session key's signature over this request.
 */
function parseSessionRequest(input) {
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
    let proof;
    if (parsed.signature !== undefined && parsed.lockSignature !== undefined)
        return invalid('A session delegation carries a signature or a lockSignature, not both.');
    if (typeof parsed.signature === 'string') {
        const signature = (0, ed25519_1.decodeBase64)(parsed.signature);
        if (signature)
            proof = { kind: 'signature', signature };
    }
    else if (typeof parsed.lockSignature === 'string' && TX_SIGNATURE.test(parsed.lockSignature)) {
        proof = { kind: 'lock-memo', lockSignature: parsed.lockSignature };
    }
    if (!escrow || !provider || !sessionKey || typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt) || !proof) {
        return invalid('The session delegation needs escrow, provider, sessionKey, a whole-second expiresAt and a signature (or the lockSignature of a lock that carries its memo).');
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
    const requestSignature = (0, ed25519_1.decodeBase64)(signatureValue);
    const message = sessionRequestMessage({ genesisHash: input.genesisHash, action: input.action, escrow: delegation.escrow, sequence: input.sequence, bodyHash: sessionBodyHash(input.body) });
    if (!requestSignature || !(0, ed25519_1.ed25519Verify)(sessionKey, new TextEncoder().encode(message), requestSignature)) {
        return invalid('The request is not signed by the session key, or was changed after signing.');
    }
    return { ok: true, delegation, proof };
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
/*
 * Transaction-bound delegation (#925, Solana Pay transaction requests).
 *
 * A Solana Pay transaction request lets a phone wallet sign a transaction our
 * server builds, but it cannot sign a separate message. So the lock
 * transaction itself carries the delegation: a Memo program instruction whose
 * text is `reddi-session/2 delegate <sha256 hex of sessionDelegationMessage(d)>`
 * (the message names the network's genesis hash, so the memo binds it too)
 * and which names the payer as a required signer. The payer's signature on
 * that transaction is then its consent to exactly that escrow, provider,
 * session key and expiry, as a `signMessage` signature would be. The header
 * carries `lockSignature` (the transaction signature) in place of `signature`.
 *
 * The provider checks: the transaction confirmed without error, the payer
 * signed it, it holds that memo instruction with the payer among the memo's
 * signers, and it touches the escrow account (so the memo travels with this
 * lock and no other).
 */
/** The SPL Memo program (v2), which fails unless every account it names has signed. */
exports.MEMO_PROGRAM_ID = new web3_js_1.PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
exports.SESSION_DELEGATION_MEMO_PREFIX = 'reddi-session/2 delegate ';
const TX_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
/** The memo text that binds a delegation to the transaction that carries it. */
function sessionDelegationMemo(d) {
    return exports.SESSION_DELEGATION_MEMO_PREFIX + (0, crypto_1.createHash)('sha256').update(sessionDelegationMessage(d), 'utf8').digest('hex');
}
/** Buyer side: the memo instruction to add to the lock transaction, signed by the payer. */
function sessionDelegationMemoInstruction(d, payer) {
    return new web3_js_1.TransactionInstruction({
        programId: exports.MEMO_PROGRAM_ID,
        keys: [{ pubkey: payer, isSigner: true, isWritable: false }],
        data: Buffer.from(sessionDelegationMemo(d), 'utf8'),
    });
}
/** Buyer side: the delegation header for a delegation proved by the confirmed lock transaction `lockSignature`. */
function lockBoundDelegationHeaderValue(d, lockSignature) {
    if (!TX_SIGNATURE.test(lockSignature))
        throw new Error('lockSignature must be a base58 transaction signature');
    const { genesisHash, ...rest } = d;
    return Buffer.from(JSON.stringify({ network: genesisHash, ...rest, lockSignature }), 'utf8').toString('base64');
}
/** A `TransactionFactsReader` over `Connection.getTransaction` at `confirmed`. */
function transactionFactsReader(connection, commitment = 'confirmed') {
    return async (signature) => {
        const tx = (await connection.getTransaction(signature, { commitment, maxSupportedTransactionVersion: 0 }));
        if (!tx)
            return null;
        const message = tx.transaction.message;
        const statics = (message.staticAccountKeys ?? message.accountKeys ?? []).map((k) => k.toBase58());
        const loaded = tx.meta?.loadedAddresses ? [...tx.meta.loadedAddresses.writable, ...tx.meta.loadedAddresses.readonly].map((k) => k.toBase58()) : [];
        const accounts = [...statics, ...loaded];
        const compiled = message.compiledInstructions
            ?? (message.instructions ?? []).map((ix) => ({ programIdIndex: ix.programIdIndex, accountKeyIndexes: ix.accounts, data: bs58Decode(ix.data) }));
        const memos = compiled
            .filter((ix) => accounts[ix.programIdIndex] === exports.MEMO_PROGRAM_ID.toBase58())
            .map((ix) => ({ text: Buffer.from(ix.data).toString('utf8'), accounts: ix.accountKeyIndexes.map((i) => accounts[i] ?? '') }));
        return {
            failed: tx.meta === null || tx.meta.err !== null,
            signers: statics.slice(0, message.header.numRequiredSignatures),
            accounts,
            memos,
            ...(typeof tx.slot === 'number' ? { slot: BigInt(tx.slot) } : {}),
        };
    };
}
function bs58Decode(value) {
    // Legacy messages carry instruction data as base58; PublicKey's decoder is not exported, so decode by hand.
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let n = BigInt(0);
    for (const c of value) {
        const i = ALPHABET.indexOf(c);
        if (i < 0)
            return new Uint8Array();
        n = n * BigInt(58) + BigInt(i);
    }
    const bytes = [];
    while (n > BigInt(0)) {
        bytes.unshift(Number(n % BigInt(256)));
        n /= BigInt(256);
    }
    for (const c of value) {
        if (c !== '1')
            break;
        bytes.unshift(0);
    }
    return Uint8Array.from(bytes);
}
/**
 * Provider side: `verifySessionRequest`, and also a delegation proved by the
 * memo in its lock transaction. Without `readTransaction` a lock-bound
 * delegation is refused. It may run before or after the lock check: either
 * way the caller must still check the lock, which is what shows the escrow
 * named here is this payer's lock.
 *
 * An escrow address can be used again once a lock ends. Pass the escrow's
 * `created_slot` as `escrowCreatedSlot` to require that the lock transaction
 * is the one that created this escrow. When the escrow is read later, compare
 * the returned `lockSlot` with its `created_slot` instead.
 */
async function verifySessionRequestWithTransactions(input) {
    const parsed = parseSessionRequest(input);
    if (!parsed.ok)
        return parsed;
    if (parsed.proof.kind === 'signature')
        return verifySessionRequest(input);
    const invalid = (message) => ({ ok: false, reason: 'session_auth_invalid', message });
    if (!input.readTransaction)
        return invalid('This provider does not take delegations proved by a lock transaction. Sign the delegation with the payer wallet.');
    let facts;
    try {
        facts = await input.readTransaction(parsed.proof.lockSignature);
    }
    catch {
        return { ok: false, reason: 'payment_check_unavailable', message: 'The chain could not be read. Nothing was accepted; present the same request again.' };
    }
    if (!facts)
        return invalid('The lock transaction named by the delegation is not confirmed yet.');
    if (facts.failed)
        return invalid('The lock transaction named by the delegation failed.');
    const payer = input.payer.toBase58();
    if (!facts.signers.includes(payer))
        return invalid("The lock transaction was not signed by the escrow's payer.");
    if (!facts.accounts.includes(input.escrow.toBase58()))
        return invalid('The lock transaction does not touch this escrow.');
    const memo = sessionDelegationMemo(parsed.delegation);
    if (!facts.memos.some((m) => m.text === memo && m.accounts.includes(payer))) {
        return invalid('The lock transaction carries no memo for this delegation signed by the payer.');
    }
    if (input.escrowCreatedSlot !== undefined && facts.slot !== input.escrowCreatedSlot) {
        return invalid('The lock transaction did not create this escrow: its slot does not match the escrow\'s created slot.');
    }
    return { ok: true, sessionKey: parsed.delegation.sessionKey, expiresAt: parsed.delegation.expiresAt, ...(facts.slot !== undefined ? { lockSlot: facts.slot } : {}) };
}
/** Provider side, single metered call: `verifySessionRequestWithTransactions` with action `single` and sequence 0. */
function verifyPaidCallRequestWithTransactions(input) {
    return verifySessionRequestWithTransactions({ ...input, action: 'single', sequence: 0 });
}
