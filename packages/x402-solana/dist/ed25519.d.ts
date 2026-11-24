import { PublicKey, type Keypair } from '@solana/web3.js';
/** Signs with a Keypair's secret key, as `nacl.sign.detached` would. */
export declare function ed25519Sign(keypair: Keypair, message: Uint8Array): Uint8Array;
export declare function ed25519Verify(publicKey: PublicKey, message: Uint8Array, signature: Uint8Array): boolean;
export declare function decodeBase64(value: string): Buffer | undefined;
export declare function publicKeyOf(value: unknown): PublicKey | undefined;
/**
 * ES256 verify (ECDSA P-256 over SHA-256) of a 64-byte r || s signature against a 33-byte compressed
 * key. Refuses a high S, as the secp256r1 precompile does.
 */
export declare function p256Verify(compressedKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean;
export declare function sha256(bytes: Uint8Array): Buffer;
