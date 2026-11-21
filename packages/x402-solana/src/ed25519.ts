/** Internal helpers shared by the request-signature checks. Not exported from the package index. */
import { createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from 'crypto';
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
