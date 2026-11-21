"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ed25519Sign = ed25519Sign;
exports.ed25519Verify = ed25519Verify;
exports.decodeBase64 = decodeBase64;
exports.publicKeyOf = publicKeyOf;
/** Internal helpers shared by the request-signature checks. Not exported from the package index. */
const crypto_1 = require("crypto");
const web3_js_1 = require("@solana/web3.js");
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
/** Signs with a Keypair's secret key, as `nacl.sign.detached` would. */
function ed25519Sign(keypair, message) {
    const key = (0, crypto_1.createPrivateKey)({ key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(keypair.secretKey.subarray(0, 32))]), format: 'der', type: 'pkcs8' });
    return new Uint8Array((0, crypto_1.sign)(null, Buffer.from(message), key));
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
