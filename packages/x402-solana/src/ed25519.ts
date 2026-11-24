/** Internal helpers shared by the request-signature checks. Not exported from the package index. */
import { createHash, createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from 'crypto';
import { PublicKey, type Keypair } from '@solana/web3.js';

const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/** Signs with a Keypair's secret key, as `nacl.sign.detached` would. */
export function ed25519Sign(keypair: Keypair, message: Uint8Array): Uint8Array {
  const key = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(keypair.secretKey.subarray(0, 32))]), format: 'der', type: 'pkcs8' });
  return new Uint8Array(edSign(null, Buffer.from(message), key));
}

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function ed25519Verify(publicKey: PublicKey, message: Uint8Array, signature: Uint8Array): boolean {
  if (signature.length !== 64) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, publicKey.toBuffer()]), format: 'der', type: 'spki' });
    return edVerify(null, Buffer.from(message), key, Buffer.from(signature));
  } catch {
    return false;
  }
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function decodeBase64(value: string): Buffer | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 4096 && BASE64.test(trimmed) ? Buffer.from(trimmed, 'base64') : undefined;
}

export function publicKeyOf(value: unknown): PublicKey | undefined {
  if (typeof value !== 'string' || value.length > 64) return undefined;
  try {
    return new PublicKey(value);
  } catch {
    return undefined;
  }
}

const P256_SPKI_COMPRESSED_PREFIX = Buffer.from('3039301306072a8648ce3d020106082a8648ce3d030107032200', 'hex');
const P256_HALF_ORDER = 0x7fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a8n;

/**
 * ES256 verify (ECDSA P-256 over SHA-256) of a 64-byte r || s signature against a 33-byte compressed
 * key. Refuses a high S, as the secp256r1 precompile does.
 */
export function p256Verify(compressedKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  if (compressedKey.length !== 33 || signature.length !== 64) return false;
  if (BigInt('0x' + Buffer.from(signature.subarray(32)).toString('hex')) > P256_HALF_ORDER) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([P256_SPKI_COMPRESSED_PREFIX, Buffer.from(compressedKey)]), format: 'der', type: 'spki' });
    return edVerify('sha256', Buffer.from(message), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature));
  } catch {
    return false;
  }
}

export function sha256(bytes: Uint8Array): Buffer {
  return createHash('sha256').update(bytes).digest();
}
