"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ed25519Sign = ed25519Sign;
exports.ed25519Verify = ed25519Verify;
exports.decodeBase64 = decodeBase64;
exports.publicKeyOf = publicKeyOf;
exports.p256Verify = p256Verify;
exports.sha256 = sha256;
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
const P256_SPKI_COMPRESSED_PREFIX = Buffer.from('3039301306072a8648ce3d020106082a8648ce3d030107032200', 'hex');
const P256_HALF_ORDER = 0x7fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a8n;
/**
 * ES256 verify (ECDSA P-256 over SHA-256) of a 64-byte r || s signature against a 33-byte compressed
 * key. Refuses a high S, as the secp256r1 precompile does.
 */
function p256Verify(compressedKey, message, signature) {
    if (compressedKey.length !== 33 || signature.length !== 64)
        return false;
    if (BigInt('0x' + Buffer.from(signature.subarray(32)).toString('hex')) > P256_HALF_ORDER)
        return false;
    try {
        const key = (0, crypto_1.createPublicKey)({ key: Buffer.concat([P256_SPKI_COMPRESSED_PREFIX, Buffer.from(compressedKey)]), format: 'der', type: 'spki' });
        return (0, crypto_1.verify)('sha256', Buffer.from(message), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature));
    }
    catch {
        return false;
    }
}
function sha256(bytes) {
    return (0, crypto_1.createHash)('sha256').update(bytes).digest();
}
