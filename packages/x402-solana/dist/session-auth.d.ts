import { PublicKey } from '@solana/web3.js';
import type { HeaderReader } from './provider';
export declare const SESSION_DELEGATION_HEADER = "x402-session-delegation";
export declare const SESSION_SIGNATURE_HEADER = "x402-session-signature";
/** The longest a delegation may run. A session settles before its refund window anyway. */
export declare const MAX_SESSION_DELEGATION_SECONDS: number;
export type SessionAction = 'call' | 'close' | 'read';
export interface SessionDelegation {
    escrow: string;
    provider: string;
    sessionKey: string;
    /** Whole seconds since the epoch. */
    expiresAt: number;
}
export type SessionAuthFailure = {
    ok: false;
    reason: 'session_auth_required' | 'session_auth_invalid' | 'session_auth_expired';
    message: string;
};
/** The text the payer wallet signs to hand a session to `sessionKey`. */
export declare function sessionDelegationMessage(d: SessionDelegation): string;
/** SHA-256 of a request body, hex. An empty body hashes as zero bytes. */
export declare function sessionBodyHash(body?: Uint8Array | string): string;
/** The bytes the session key signs for one request. `sequence` is the call number for `call`, and 0 for `close` and `read`. */
export declare function sessionRequestMessage(input: {
    action: SessionAction;
    escrow: string;
    sequence: number;
    bodyHash: string;
}): string;
type Signer = (message: Uint8Array) => Uint8Array | Promise<Uint8Array>;
/** Buyer side: the delegation header value, signed by the payer wallet. */
export declare function sessionDelegationHeaderValue(d: SessionDelegation, signWithPayer: Signer): Promise<string>;
/** Buyer side: the signature header value for one request, signed by the session key. */
export declare function sessionSignatureHeaderValue(input: {
    action: SessionAction;
    escrow: string;
    sequence: number;
    body?: Uint8Array | string;
}, signWithSessionKey: Signer): Promise<string>;
/**
 * Provider side: checks that a session request is signed by a key the payer
 * handed this session to. Returns the session key on success. `payer` and
 * `escrow` come from the payment header (the lock check then confirms them on
 * chain); `provider` is this provider's payee wallet; `body` is the raw
 * request body exactly as received.
 */
export declare function verifySessionRequest(input: {
    headers: HeaderReader;
    action: SessionAction;
    escrow: PublicKey;
    payer: PublicKey;
    provider: PublicKey;
    sequence: number;
    body?: Uint8Array | string;
    nowMs: number;
}): {
    ok: true;
    sessionKey: string;
    expiresAt: number;
} | SessionAuthFailure;
export {};
