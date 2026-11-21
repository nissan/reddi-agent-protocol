"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAYMENT_DELEGATION_HEADER = exports.PAYMENT_PROOF_HEADER = void 0;
exports.directPaymentDelegationMessage = directPaymentDelegationMessage;
exports.directPaymentProofMessage = directPaymentProofMessage;
exports.keypairSigner = keypairSigner;
exports.directPaymentDelegationHeaderValue = directPaymentDelegationHeaderValue;
exports.directPaymentProofHeaders = directPaymentProofHeaders;
exports.verifyDirectPaymentProof = verifyDirectPaymentProof;
exports.directPaymentProofCheck = directPaymentProofCheck;
const ed25519_1 = require("./ed25519");
const session_auth_1 = require("./session-auth");
exports.PAYMENT_PROOF_HEADER = 'x402-payment-proof';
exports.PAYMENT_DELEGATION_HEADER = 'x402-payment-delegation';
/** The text the payer wallet signs to let `sessionKey` prove its direct payments to `provider`. */
function directPaymentDelegationMessage(d) {
    return [
        'Reddi Agent Protocol direct payments',
        'I let this key prove my direct payments to this provider.',
        `provider: ${d.provider}`,
        `session key: ${d.sessionKey}`,
        `expires: ${new Date(d.expiresAt * 1000).toISOString()}`,
    ].join('\n');
}
/** The bytes signed for one request that presents a direct payment. */
function directPaymentProofMessage(input) {
    return ['reddi-direct/1', input.network, input.txSignature, input.payTo, input.bodyHash].join('\n');
}
/** Buyer side: a signer for a server-held Keypair (a browser wallet passes its own `signMessage`). */
function keypairSigner(keypair) {
    return (message) => (0, ed25519_1.ed25519Sign)(keypair, message);
}
/** Buyer side: the delegation header value, signed once by the payer wallet. Keep it with the session key and reuse it until it expires. */
async function directPaymentDelegationHeaderValue(d, signWithPayer) {
    const signature = await signWithPayer(new TextEncoder().encode(directPaymentDelegationMessage(d)));
    return Buffer.from(JSON.stringify({ ...d, signature: Buffer.from(signature).toString('base64') }), 'utf8').toString('base64');
}
/**
 * Buyer side: the headers for one request that presents a direct payment.
 * `sign` is the payer wallet, or the session key named in `delegation`.
 * `body` must be the exact bytes sent.
 */
async function directPaymentProofHeaders(input) {
    const message = directPaymentProofMessage({ network: input.network, txSignature: input.txSignature, payTo: input.payTo, bodyHash: (0, session_auth_1.sessionBodyHash)(input.body) });
    const proof = Buffer.from(await input.sign(new TextEncoder().encode(message))).toString('base64');
    return { [exports.PAYMENT_PROOF_HEADER]: proof, ...(input.delegation ? { [exports.PAYMENT_DELEGATION_HEADER]: input.delegation } : {}) };
}
/**
 * Provider side: checks that the request was signed by the wallet that made
 * the payment (`paid.payer`, which the receipt verifier has already tied to
 * the transaction), or by a key it delegated to this provider. `body` is the
 * raw request body exactly as received.
 */
function verifyDirectPaymentProof(input) {
    const proofValue = input.headers.get(exports.PAYMENT_PROOF_HEADER);
    if (!proofValue) {
        return { ok: false, reason: 'payer_proof_required', message: `A direct payment must be presented with ${exports.PAYMENT_PROOF_HEADER}: a signature over this request by the wallet that paid.` };
    }
    const invalid = (message) => ({ ok: false, reason: 'payer_proof_invalid', message });
    const payer = (0, ed25519_1.publicKeyOf)(input.paid.payer);
    const payTo = (0, ed25519_1.publicKeyOf)(input.paid.payTo);
    if (!payer || !payTo)
        return invalid('The payment does not name a valid payer and payee.');
    let signer = payer;
    const delegationValue = input.headers.get(exports.PAYMENT_DELEGATION_HEADER);
    if (delegationValue) {
        const raw = (0, ed25519_1.decodeBase64)(delegationValue);
        if (!raw)
            return invalid('The payment delegation is not base64.');
        let parsed;
        try {
            const value = JSON.parse(raw.toString('utf8'));
            if (!value || typeof value !== 'object' || Array.isArray(value))
                return invalid('The payment delegation is not an object.');
            parsed = value;
        }
        catch {
            return invalid('The payment delegation is not JSON.');
        }
        const provider = (0, ed25519_1.publicKeyOf)(parsed.provider);
        const sessionKey = (0, ed25519_1.publicKeyOf)(parsed.sessionKey);
        const expiresAt = parsed.expiresAt;
        const signature = typeof parsed.signature === 'string' ? (0, ed25519_1.decodeBase64)(parsed.signature) : undefined;
        if (!provider || !sessionKey || typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt) || !signature) {
            return invalid('The payment delegation needs provider, sessionKey, a whole-second expiresAt and a signature.');
        }
        if (!provider.equals(payTo))
            return invalid('The payment delegation names another provider.');
        const nowSeconds = Math.floor(input.nowMs / 1000);
        if (expiresAt <= nowSeconds)
            return { ok: false, reason: 'payer_proof_expired', message: 'The payment delegation has expired. Sign a new one with the payer wallet.' };
        if (expiresAt > nowSeconds + session_auth_1.MAX_SESSION_DELEGATION_SECONDS)
            return invalid(`A payment delegation may run for at most ${session_auth_1.MAX_SESSION_DELEGATION_SECONDS} seconds.`);
        const delegation = { provider: provider.toBase58(), sessionKey: sessionKey.toBase58(), expiresAt };
        if (!(0, ed25519_1.ed25519Verify)(payer, new TextEncoder().encode(directPaymentDelegationMessage(delegation)), signature)) {
            return invalid('The payment delegation is not signed by the wallet that paid.');
        }
        signer = sessionKey;
    }
    const proof = (0, ed25519_1.decodeBase64)(proofValue);
    const message = directPaymentProofMessage({ network: input.paid.network, txSignature: input.paid.txSignature, payTo: payTo.toBase58(), bodyHash: (0, session_auth_1.sessionBodyHash)(input.body) });
    if (!proof || !(0, ed25519_1.ed25519Verify)(signer, new TextEncoder().encode(message), proof)) {
        return invalid('The request is not signed by the wallet that paid, or was changed after signing.');
    }
    return { ok: true, signer: signer.toBase58() };
}
/**
 * Provider side: the check to pass to `SolanaReceiptVerifier.verifyReceipt`
 * for one request. `body` is the raw request body exactly as received.
 */
function directPaymentProofCheck(input) {
    return (paid) => {
        const result = verifyDirectPaymentProof({ headers: input.headers, paid, body: input.body, nowMs: input.nowMs ?? Date.now() });
        return result.ok ? { ok: true } : result;
    };
}
