import { PublicKey } from '@solana/web3.js';
import type { HeaderReader } from './provider';
export declare const SESSION_DELEGATION_HEADER = "x402-session-delegation";
export declare const SESSION_SIGNATURE_HEADER = "x402-session-signature";
/** The longest a delegation may run. A session settles before its refund window anyway. */
export declare const MAX_SESSION_DELEGATION_SECONDS: number;
/** `call`, `close`, `read`: session requests. `single`: a single metered call, sequence 0. */
export type SessionAction = 'call' | 'close' | 'read' | 'single';
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
/** The bytes the session key signs for one request. `sequence` is the call number for `call`, and 0 for `close`, `read` and `single`. */
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
/**
 * Buyer side, single metered call: both headers for one call on the lock
 * `escrow`. With no `sessionKey`, the payer signs the request too (fine for a
 * server-held keypair; a browser wallet would then sign twice, so pass a
 * fresh key there and keep it for the call).
 */
export declare function paidCallAuthHeaders(input: {
    escrow: string;
    provider: string;
    body: Uint8Array | string;
    payer: string;
    signWithPayer: Signer;
    sessionKey?: {
        publicKey: string;
        sign: Signer;
    };
    expiresAt?: number;
    nowMs?: number;
}): Promise<Record<string, string>>;
/** Provider side, single metered call: `verifySessionRequest` with action `single` and sequence 0. */
export declare function verifyPaidCallRequest(input: Omit<Parameters<typeof verifySessionRequest>[0], 'action' | 'sequence'>): ReturnType<typeof verifySessionRequest>;
export {};
