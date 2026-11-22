import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import type { HeaderReader } from './provider';
export declare const SESSION_DELEGATION_HEADER = "x402-session-delegation";
export declare const SESSION_SIGNATURE_HEADER = "x402-session-signature";
/** The longest a delegation may run. A session settles before its refund window anyway. */
export declare const MAX_SESSION_DELEGATION_SECONDS: number;
/**
 * How long a buyer client should let a delegation run unless it has a reason
 * to choose otherwise: a day, well short of the maximum, because anyone holding
 * the session key can sign for the payer until then. Keep the key in memory
 * only (never in localStorage or on disk), and sign a new delegation when it runs out.
 */
export declare const DEFAULT_DELEGATION_SECONDS: number;
/** Buyer side: the `expiresAt` for a new delegation, `seconds` (default a day) from `nowMs`. */
export declare function delegationExpiresAt(nowMs?: number, seconds?: number): number;
/**
 * `call`: a session call. `call-close`: a session call that also asks the
 * provider to settle the session after answering it. `close`, `read`: session
 * requests without a call. `single`: a single metered call, sequence 0.
 */
export type SessionAction = 'call' | 'call-close' | 'close' | 'read' | 'single';
/** The action a session call is signed under: `call-close` when it asks to close the session. */
export declare function sessionCallAction(close: boolean): SessionAction;
export interface SessionDelegation {
    /** The genesis hash of the cluster the escrow is on (`SOLANA_GENESIS_HASHES[network]`). */
    genesisHash: string;
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
/** The bytes the session key signs for one request. `sequence` is the call number for `call` and `call-close`, and 0 for `close`, `read` and `single`. */
export declare function sessionRequestMessage(input: {
    genesisHash: string;
    action: SessionAction;
    escrow: string;
    sequence: number;
    bodyHash: string;
}): string;
export type Signer = (message: Uint8Array) => Uint8Array | Promise<Uint8Array>;
/** Buyer side: the delegation header value, signed by the payer wallet. Use `delegationExpiresAt()` for `expiresAt`. */
export declare function sessionDelegationHeaderValue(d: SessionDelegation, signWithPayer: Signer): Promise<string>;
/** Buyer side: the signature header value for one request, signed by the session key. */
export declare function sessionSignatureHeaderValue(input: {
    genesisHash: string;
    action: SessionAction;
    escrow: string;
    sequence: number;
    body?: Uint8Array | string;
}, signWithSessionKey: Signer): Promise<string>;
/**
 * Provider side: checks that a session request is signed by a key the payer
 * handed this session to. Returns the session key on success. `payer` and
 * `escrow` come from the payment header (the lock check then confirms them on
 * chain); `provider` is this provider's payee wallet; `genesisHash` is the
 * genesis hash of the cluster this provider checked it is on; `body` is the raw
 * request body exactly as received.
 */
export declare function verifySessionRequest(input: SessionRequestInput): {
    ok: true;
    sessionKey: string;
    expiresAt: number;
} | SessionAuthFailure;
export interface SessionRequestInput {
    headers: HeaderReader;
    genesisHash: string;
    action: SessionAction;
    escrow: PublicKey;
    payer: PublicKey;
    provider: PublicKey;
    sequence: number;
    body?: Uint8Array | string;
    nowMs: number;
}
/**
 * Buyer side, single metered call: both headers for one call on the lock
 * `escrow`. With no `sessionKey`, the payer signs the request too (fine for a
 * server-held keypair; a browser wallet would then sign twice, so pass a
 * fresh key there and keep it for the call).
 */
export declare function paidCallAuthHeaders(input: {
    /** The genesis hash of the cluster the escrow is on. */
    genesisHash: string;
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
/** The SPL Memo program (v2), which fails unless every account it names has signed. */
export declare const MEMO_PROGRAM_ID: PublicKey;
export declare const SESSION_DELEGATION_MEMO_PREFIX = "reddi-session/2 delegate ";
/** The memo text that binds a delegation to the transaction that carries it. */
export declare function sessionDelegationMemo(d: SessionDelegation): string;
/** Buyer side: the memo instruction to add to the lock transaction, signed by the payer. */
export declare function sessionDelegationMemoInstruction(d: SessionDelegation, payer: PublicKey): TransactionInstruction;
/** Buyer side: the delegation header for a delegation proved by the confirmed lock transaction `lockSignature`. */
export declare function lockBoundDelegationHeaderValue(d: SessionDelegation, lockSignature: string): string;
/** What the provider needs to know about a confirmed transaction. */
export interface ConfirmedTransactionFacts {
    /** True when the transaction failed. */
    failed: boolean;
    /** Base58 addresses that signed the transaction. */
    signers: string[];
    /** Base58 addresses of every account the transaction names, including loaded lookup-table addresses. */
    accounts: string[];
    /** Each Memo program instruction: its UTF-8 text and the base58 accounts it names. */
    memos: {
        text: string;
        accounts: string[];
    }[];
    /** The slot the transaction landed in, when the reader knows it. */
    slot?: bigint;
}
/** Reads a confirmed transaction by signature, or null when the cluster does not have it (yet). Throws when the chain cannot be read. */
export type TransactionFactsReader = (signature: string) => Promise<ConfirmedTransactionFacts | null>;
/** A `TransactionFactsReader` over `Connection.getTransaction` at `confirmed`. */
export declare function transactionFactsReader(connection: {
    getTransaction: (signature: string, options: {
        commitment: 'confirmed' | 'finalized';
        maxSupportedTransactionVersion: number;
    }) => Promise<unknown>;
}, commitment?: 'confirmed' | 'finalized'): TransactionFactsReader;
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
export declare function verifySessionRequestWithTransactions(input: SessionRequestInput & {
    readTransaction?: TransactionFactsReader;
    escrowCreatedSlot?: bigint;
}): Promise<{
    ok: true;
    sessionKey: string;
    expiresAt: number;
    lockSlot?: bigint;
} | SessionAuthFailure | {
    ok: false;
    reason: 'payment_check_unavailable';
    message: string;
}>;
/** Provider side, single metered call: `verifySessionRequestWithTransactions` with action `single` and sequence 0. */
export declare function verifyPaidCallRequestWithTransactions(input: Omit<Parameters<typeof verifySessionRequestWithTransactions>[0], 'action' | 'sequence'>): ReturnType<typeof verifySessionRequestWithTransactions>;
