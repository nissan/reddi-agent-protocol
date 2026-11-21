/**
 * Sessions: one metered escrow lock pays for many calls, settled once.
 *
 * The escrow program lets the payee settle any amount up to the locked
 * maximum, once, paying the protocol fee and returning the rest in the same
 * instruction. A session is an off-chain rule on top of that. The buyer sends
 * the same lock with every call and numbers the calls 1, 2, 3. The provider
 * keeps a ledger per escrow: calls served, total tokens, total cost. A call is
 * served only when the total so far plus that call's worst case (its input
 * plus its output limit) still fits under the lock, and only one call of a
 * session runs at a time. The provider settles the total once: when the buyer
 * closes the session, when it has been idle for a while, or before the
 * buyer's refund window opens.
 *
 * Money order: a call's tokens are added to the ledger, and the ledger saved,
 * before its answer is sent. A call that fails before that adds nothing. The
 * ledger's total cost is exactly what `meteredSettlement` charges for the
 * total tokens, so the settle equals the last receipt's cumulative cost.
 *
 * Nothing here reads a key or sends a transaction.
 */
import { PublicKey } from '@solana/web3.js';
import { type TokenCounts } from './metered';
import type { HeaderReader, MeteredTerms, VerifiedLock } from './provider';
import type { NonceReplayStore } from './types';
import { meteredSettlement } from './provider';
/** Settle a session after this long without a call. */
export declare const DEFAULT_SESSION_IDLE_SECONDS = 600;
/** The highest call number a session takes. */
export declare const MAX_SESSION_SEQUENCE = 1000000;
export declare const SESSION_SEQUENCE_HEADER = "x402-session-sequence";
export declare const SESSION_HEADER = "x402-session";
export type SessionHeaders = {
    sequence: number;
    close: boolean;
} | {
    error: string;
} | undefined;
/**
 * The session headers of a request: `x402-session-sequence: <n>` makes the
 * call number n of the session its lock pays for, and `x402-session: close`
 * asks the provider to settle after answering. Undefined when the request is
 * not a session call.
 */
export declare function readSessionHeaders(headers: HeaderReader): SessionHeaders;
/** One escrow's session, as the ledger keeps and saves it. Amounts in base units as decimal strings, so it serialises as JSON. */
export interface SessionState {
    escrow: string;
    payer: string;
    /** The lock's 16-byte nonce, hex: with the payer it names the escrow, so the lock can be read back to settle. */
    nonce: string;
    maxBaseUnits: string;
    /** The slot the lock was made in and its refund window: the session is settled before the buyer may refund. */
    createdSlot: string;
    cancelWindowSlots: string;
    /** The last call served and recorded. 0 before the first. */
    sequence: number;
    inputTokens: number;
    outputTokens: number;
    /** What the totals cost at the provider's price, capped at the lock: what the settle charges. */
    costBaseUnits: string;
    /** Hash of the last call's receipt, which the next call's receipt names. */
    lastReceiptHash?: string;
    /** `closing`: no more calls; the settle (or, with nothing to charge, the decline) is due. */
    status: 'open' | 'closing' | 'settled' | 'declined';
    /** When the last call was recorded, in milliseconds since the epoch. */
    lastActivityMs: number;
    settleSignature?: string;
    /** The signed receipt of the settle, kept for a buyer who asks after the session closed. */
    closingReceipt?: unknown;
}
/** Where the ledger saves sessions so a restart can go on or settle them. `save` must be durable before it resolves. */
export interface SessionStore {
    load(): SessionState[] | Promise<SessionState[]>;
    save(state: SessionState): void | Promise<void>;
}
export type SessionRefusal = {
    ok: false;
    reason: 'session_sequence_invalid' | 'session_call_in_progress' | 'session_closed' | 'session_max_reached' | 'session_lock_mismatch' | 'duplicate_nonce';
    message: string;
};
export interface SessionReservation {
    escrow: string;
    sequence: number;
    /** The state before this call, as the receipt's previous totals. */
    before: SessionState;
}
/** A session's state after one more call: what the receipt states. */
export interface SessionCall {
    state: SessionState;
    usage: TokenCounts;
    /** The lock is used up: no further call can fit, so the session settles now. */
    full: boolean;
}
export declare class MeteredSessionLedger {
    private readonly terms;
    private readonly store?;
    private readonly sessions;
    private readonly inFlight;
    constructor(terms: MeteredTerms, store?: SessionStore | undefined);
    /** Loads saved sessions. Call once at start, before serving. */
    restore(): Promise<number>;
    get(escrow: PublicKey | string): SessionState | undefined;
    /** What the totals so far plus `more` would cost, uncapped. */
    private costOf;
    /**
     * Reserves call `sequence` of the session `lock` pays for, after the lock
     * was verified with `purpose: 'session-call'`. Call 1 claims the escrow in
     * the replay store, so a lock that paid for a single call cannot start a
     * session and a session's lock cannot pay for a single call. Refused when
     * the number is not the next one, a call of the session is still running,
     * the session is closed, or the total so far plus `worstCase` would not fit
     * under the lock. Release the reservation if the call fails before its
     * tokens are known; record them with `record` otherwise.
     */
    begin(input: {
        lock: Extract<VerifiedLock, {
            ok: true;
        }>;
        escrow: PublicKey;
        sequence: number;
        worstCase: TokenCounts;
        replayStore: NonceReplayStore;
        nowMs: number;
    }): Promise<{
        ok: true;
        reservation: SessionReservation;
    } | SessionRefusal>;
    /** Gives up a reserved call that produced nothing to charge. The next call reuses its number. */
    release(reservation: SessionReservation): void;
    /**
     * Records a served call's tokens and saves the session before the answer is
     * sent. `receiptHash` is the hash of the receipt this call is answered with.
     * When the model used more than the worst case allowed and the total would
     * pass the lock, the cost is capped at the lock and the session is full.
     */
    record(reservation: SessionReservation, usage: TokenCounts, receiptHash: string | undefined, nowMs: number): Promise<SessionCall>;
    /** The cumulative state this call's receipt would state, before it is recorded. */
    preview(reservation: SessionReservation, usage: TokenCounts): SessionState;
    /** Stops new calls on a session, so it can be settled. Refused while a call of it is running. */
    close(escrow: PublicKey | string): Promise<SessionState | undefined>;
    /** Records the settle (or, for a session with nothing to charge, the decline) that ended a session. */
    finish(escrow: string, outcome: {
        status: 'settled' | 'declined';
        signature?: string;
        closingReceipt?: unknown;
    }): Promise<void>;
    /**
     * Sessions to settle now: closing ones, open ones idle for `idleMs`, and open
     * ones whose refund window has less than the seller's minimum left (no new
     * call is taken then, so the settle has that long to land). A session with a
     * call running is never due.
     */
    due(nowMs: number, currentSlot: bigint, idleMs: number): SessionState[];
}
/** The token totals a session's settle charges for. */
export declare function sessionUsage(state: SessionState): TokenCounts;
/**
 * The settle of a session: one `meteredSettlement` for the session's total
 * tokens, which charges exactly the ledger's cumulative cost. Pass the lock
 * as read back with `purpose: 'session-settle'`. Throws when the two
 * disagree, which would mean the receipts and the settle differ.
 */
export declare function sessionSettlement(terms: MeteredTerms, lock: Extract<VerifiedLock, {
    ok: true;
}>, state: SessionState, payout?: Parameters<typeof meteredSettlement>[3]): ReturnType<typeof meteredSettlement>;
/** The payment header a session's lock was presented with, rebuilt from the saved state, for reading the lock back to settle. */
export declare function sessionPaymentHeader(state: SessionState): {
    escrow: PublicKey;
    payer: PublicKey;
    nonce: Uint8Array;
};
