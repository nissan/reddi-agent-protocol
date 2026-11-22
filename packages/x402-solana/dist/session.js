"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MeteredSessionLedger = exports.SESSION_HEADER = exports.SESSION_SEQUENCE_HEADER = exports.MAX_SESSION_SEQUENCE = exports.DEFAULT_SESSION_IDLE_SECONDS = void 0;
exports.readSessionHeaders = readSessionHeaders;
exports.sessionUsage = sessionUsage;
exports.sessionSettlement = sessionSettlement;
exports.sessionPaymentHeader = sessionPaymentHeader;
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
const web3_js_1 = require("@solana/web3.js");
const metered_1 = require("./metered");
const token_escrow_1 = require("./token-escrow");
const provider_1 = require("./provider");
/** Settle a session after this long without a call. */
exports.DEFAULT_SESSION_IDLE_SECONDS = 600;
/** The highest call number a session takes. */
exports.MAX_SESSION_SEQUENCE = 1000000;
exports.SESSION_SEQUENCE_HEADER = 'x402-session-sequence';
exports.SESSION_HEADER = 'x402-session';
/**
 * The session headers of a request: `x402-session-sequence: <n>` makes the
 * call number n of the session its lock pays for, and `x402-session: close`
 * asks the provider to settle after answering. Undefined when the request is
 * not a session call.
 */
function readSessionHeaders(headers) {
    const raw = headers.get(exports.SESSION_SEQUENCE_HEADER);
    const close = headers.get(exports.SESSION_HEADER);
    if (raw === null)
        return close === null ? undefined : { error: `${exports.SESSION_HEADER} needs ${exports.SESSION_SEQUENCE_HEADER}.` };
    if (close !== null && close.trim().toLowerCase() !== 'close')
        return { error: `${exports.SESSION_HEADER} takes only "close".` };
    const text = raw.trim();
    if (!/^[1-9]\d{0,6}$/.test(text) || Number(text) > exports.MAX_SESSION_SEQUENCE)
        return { error: `${exports.SESSION_SEQUENCE_HEADER} must be a whole number from 1 to ${exports.MAX_SESSION_SEQUENCE}.` };
    return { sequence: Number(text), close: close !== null };
}
const clone = (state) => ({ ...state });
class MeteredSessionLedger {
    constructor(terms, store) {
        this.terms = terms;
        this.store = store;
        this.sessions = new Map();
        this.inFlight = new Set();
    }
    /** Loads saved sessions. Call once at start, before serving. */
    async restore() {
        const saved = this.store ? await this.store.load() : [];
        for (const state of saved)
            this.sessions.set(state.escrow, clone(state));
        return saved.length;
    }
    get(escrow) {
        const state = this.sessions.get(typeof escrow === 'string' ? escrow : escrow.toBase58());
        return state ? clone(state) : undefined;
    }
    /** What the totals so far plus `more` would cost, uncapped. */
    costOf(state, more) {
        return (0, metered_1.tokenCostBaseUnits)(this.terms.price, { inputTokens: state.inputTokens + more.inputTokens, outputTokens: state.outputTokens + more.outputTokens });
    }
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
    async begin(input) {
        const key = input.escrow.toBase58();
        if (this.inFlight.has(key))
            return { ok: false, reason: 'session_call_in_progress', message: 'The previous call of this session is still being served. Send the next call when it has answered.' };
        let state = this.sessions.get(key);
        if (!state) {
            if (input.sequence !== 1)
                return { ok: false, reason: 'session_sequence_invalid', message: 'No session is open on this lock. Start at call 1.' };
            this.inFlight.add(key);
            try {
                if (!(await input.replayStore.checkAndStore((0, provider_1.meteredEscrowReplayKey)(input.escrow)))) {
                    return { ok: false, reason: 'duplicate_nonce', message: 'This escrow has already paid for a call. A session needs a lock of its own.' };
                }
                state = {
                    escrow: key,
                    payer: input.lock.payer.toBase58(),
                    nonce: Buffer.from(input.lock.terms.nonce).toString('hex'),
                    maxBaseUnits: input.lock.maxBaseUnits.toString(),
                    sessionKey: input.sessionKey,
                    createdSlot: input.lock.createdSlot.toString(),
                    cancelWindowSlots: (input.lock.terms.cancelWindowSlots ?? 0n).toString(),
                    sequence: 0,
                    inputTokens: 0,
                    outputTokens: 0,
                    costBaseUnits: '0',
                    status: 'open',
                    lastActivityMs: input.nowMs,
                };
                // Saved before any work, so a restart knows this lock belongs to a session even if no call was recorded.
                await this.store?.save(state);
                this.sessions.set(key, state);
            }
            finally {
                this.inFlight.delete(key);
            }
        }
        if (state.sessionKey !== input.sessionKey)
            return { ok: false, reason: 'session_key_mismatch', message: 'This session was started with another session key. Sign with the key it was started with.' };
        if (state.status !== 'open')
            return { ok: false, reason: 'session_closed', message: state.status === 'settled' ? 'This session has been settled. Lock a new escrow to go on.' : 'This session is closed and being settled. Lock a new escrow to go on.' };
        // The lock slot tells this session's escrow from a later one locked at the same address.
        if (state.payer !== input.lock.payer.toBase58() || state.maxBaseUnits !== input.lock.maxBaseUnits.toString() || state.createdSlot !== input.lock.createdSlot.toString()) {
            return { ok: false, reason: 'session_lock_mismatch', message: 'This lock no longer matches the session opened on it.' };
        }
        if (input.sequence !== state.sequence + 1) {
            return { ok: false, reason: 'session_sequence_invalid', message: input.sequence <= state.sequence ? `Call ${input.sequence} of this session was already served. The next is ${state.sequence + 1}.` : `The next call of this session is ${state.sequence + 1}; calls cannot be skipped.` };
        }
        if (this.costOf(state, input.worstCase) > BigInt(state.maxBaseUnits)) {
            return { ok: false, reason: 'session_max_reached', message: `This call could take the session past the ${state.maxBaseUnits} base units locked, so it was not served and nothing more was charged. Close the session, or send a shorter call or a lower max_tokens.` };
        }
        this.inFlight.add(key);
        return { ok: true, reservation: { escrow: key, sequence: input.sequence, before: clone(state) } };
    }
    /** Gives up a reserved call that produced nothing to charge. The next call reuses its number. */
    release(reservation) {
        this.inFlight.delete(reservation.escrow);
    }
    /**
     * Records a served call's tokens and saves the session before the answer is
     * sent. `receiptHash` is the hash of the receipt this call is answered with.
     * When the model used more than the worst case allowed and the total would
     * pass the lock, the cost is capped at the lock and the session is full.
     */
    async record(reservation, usage, receiptHash, nowMs) {
        const current = this.sessions.get(reservation.escrow);
        if (!current || current.sequence !== reservation.sequence - 1 || !this.inFlight.has(reservation.escrow))
            throw new Error('session reservation is stale');
        const max = BigInt(current.maxBaseUnits);
        const cost = this.costOf(current, usage);
        const next = {
            ...current,
            sequence: reservation.sequence,
            inputTokens: current.inputTokens + usage.inputTokens,
            outputTokens: current.outputTokens + usage.outputTokens,
            costBaseUnits: (cost > max ? max : cost).toString(),
            ...(receiptHash ? { lastReceiptHash: receiptHash } : {}),
            lastActivityMs: nowMs,
        };
        const full = cost >= max;
        if (full)
            next.status = 'closing';
        try {
            await this.store?.save(next);
        }
        finally {
            // Not saved means not recorded: the call stays reserved no longer, and the caller must not answer.
            this.inFlight.delete(reservation.escrow);
        }
        this.sessions.set(reservation.escrow, next);
        return { state: clone(next), usage, full };
    }
    /** The cumulative state this call's receipt would state, before it is recorded. */
    preview(reservation, usage) {
        const max = BigInt(reservation.before.maxBaseUnits);
        const cost = this.costOf(reservation.before, usage);
        return {
            ...reservation.before,
            sequence: reservation.sequence,
            inputTokens: reservation.before.inputTokens + usage.inputTokens,
            outputTokens: reservation.before.outputTokens + usage.outputTokens,
            costBaseUnits: (cost > max ? max : cost).toString(),
        };
    }
    /** Stops new calls on a session, so it can be settled. Refused while a call of it is running. */
    async close(escrow) {
        const key = typeof escrow === 'string' ? escrow : escrow.toBase58();
        const state = this.sessions.get(key);
        if (!state || this.inFlight.has(key))
            return undefined;
        if (state.status === 'open') {
            const next = { ...state, status: 'closing' };
            await this.store?.save(next);
            this.sessions.set(key, next);
            return clone(next);
        }
        return clone(state);
    }
    /** Records the settle (or, for a session with nothing to charge, the decline) that ended a session. */
    async finish(escrow, outcome) {
        const state = this.sessions.get(escrow);
        if (!state)
            return;
        const next = { ...state, status: outcome.status, ...(outcome.signature ? { settleSignature: outcome.signature } : {}), ...(outcome.closingReceipt !== undefined ? { closingReceipt: outcome.closingReceipt } : {}) };
        await this.store?.save(next);
        this.sessions.set(escrow, next);
    }
    /**
     * Sessions to settle now: closing ones, open ones idle for `idleMs`, and open
     * ones whose refund window has less than the seller's minimum left (no new
     * call is taken then, so the settle has that long to land). A session with a
     * call running is never due.
     */
    due(nowMs, currentSlot, idleMs) {
        const out = [];
        for (const state of this.sessions.values()) {
            if (this.inFlight.has(state.escrow))
                continue;
            if (state.status === 'closing')
                out.push(clone(state));
            else if (state.status === 'open') {
                const refundOpens = BigInt(state.createdSlot) + BigInt(state.cancelWindowSlots);
                if (nowMs - state.lastActivityMs >= idleMs || currentSlot + token_escrow_1.SELLER_MIN_CANCEL_WINDOW_SLOTS >= refundOpens)
                    out.push(clone(state));
            }
        }
        return out;
    }
}
exports.MeteredSessionLedger = MeteredSessionLedger;
/** The token totals a session's settle charges for. */
function sessionUsage(state) {
    return { inputTokens: state.inputTokens, outputTokens: state.outputTokens };
}
/**
 * The settle of a session: one `meteredSettlement` for the session's total
 * tokens, which charges exactly the ledger's cumulative cost. Pass the lock
 * as read back with `purpose: 'session-settle'`. Throws when the two
 * disagree, which would mean the receipts and the settle differ.
 */
function sessionSettlement(terms, lock, state, payout) {
    if (lock.maxBaseUnits.toString() !== state.maxBaseUnits || lock.payer.toBase58() !== state.payer || lock.createdSlot.toString() !== state.createdSlot)
        throw new Error('the lock does not match the session');
    const settled = (0, provider_1.meteredSettlement)(terms, lock, sessionUsage(state), payout);
    if (settled.settlement.chargedBaseUnits.toString() !== state.costBaseUnits)
        throw new Error('the settle would charge a different amount than the session recorded');
    return settled;
}
/** The payment header a session's lock was presented with, rebuilt from the saved state, for reading the lock back to settle. */
function sessionPaymentHeader(state) {
    return { escrow: new web3_js_1.PublicKey(state.escrow), payer: new web3_js_1.PublicKey(state.payer), nonce: Uint8Array.from(Buffer.from(state.nonce, 'hex')) };
}
