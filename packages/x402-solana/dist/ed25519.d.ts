import { PublicKey, type Keypair } from '@solana/web3.js';
/** Signs with a Keypair's secret key, as `nacl.sign.detached` would. */
export declare function ed25519Sign(keypair: Keypair, message: Uint8Array): Uint8Array;
export declare function ed25519Verify(publicKey: PublicKey, message: Uint8Array, signature: Uint8Array): boolean;
export declare function decodeBase64(value: string): Buffer | undefined;
export declare function publicKeyOf(value: unknown): PublicKey | undefined;
