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
import { tokenCostBaseUnits, type TokenCounts } from './metered';
import type { HeaderReader, MeteredTerms, VerifiedLock } from './provider';
import { SELLER_MIN_CANCEL_WINDOW_SLOTS } from './token-escrow';
import type { NonceReplayStore } from './types';
import { meteredEscrowReplayKey, meteredSettlement } from './provider';

/** Settle a session after this long without a call. */
export const DEFAULT_SESSION_IDLE_SECONDS = 600;
/** The highest call number a session takes. */
export const MAX_SESSION_SEQUENCE = 1_000_000;

export const SESSION_SEQUENCE_HEADER = 'x402-session-sequence';
export const SESSION_HEADER = 'x402-session';

export type SessionHeaders = { sequence: number; close: boolean } | { error: string } | undefined;

/**
 * The session headers of a request: `x402-session-sequence: <n>` makes the
 * call number n of the session its lock pays for, and `x402-session: close`
 * asks the provider to settle after answering. Undefined when the request is
 * not a session call.
 */
export function readSessionHeaders(headers: HeaderReader): SessionHeaders {
  const raw = headers.get(SESSION_SEQUENCE_HEADER);
  const close = headers.get(SESSION_HEADER);
  if (raw === null) return close === null ? undefined : { error: `${SESSION_HEADER} needs ${SESSION_SEQUENCE_HEADER}.` };
  if (close !== null && close.trim().toLowerCase() !== 'close') return { error: `${SESSION_HEADER} takes only "close".` };
  const text = raw.trim();
  if (!/^[1-9]\d{0,6}$/.test(text) || Number(text) > MAX_SESSION_SEQUENCE) return { error: `${SESSION_SEQUENCE_HEADER} must be a whole number from 1 to ${MAX_SESSION_SEQUENCE}.` };
  return { sequence: Number(text), close: close !== null };
}

/** One escrow's session, as the ledger keeps and saves it. Amounts in base units as decimal strings, so it serialises as JSON. */
export interface SessionState {
  escrow: string;
  payer: string;
  /** The lock's 16-byte nonce, hex: with the payer it names the escrow, so the lock can be read back to settle. */
  nonce: string;
  maxBaseUnits: string;
  /** The session key the payer delegated to at call 1 (see `session-auth`). Later calls, the close and reads must be signed by it. */
  sessionKey: string;
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
  status: 'open' | 'closing' | 'settled' | 'declined' | 'refunded_unpaid';
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
  reason: 'session_sequence_invalid' | 'session_call_in_progress' | 'session_closed' | 'session_max_reached' | 'session_lock_mismatch' | 'session_key_mismatch' | 'duplicate_nonce';
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

const clone = (state: SessionState): SessionState => ({ ...state });

export class MeteredSessionLedger {
  private readonly sessions = new Map<string, SessionState>();
  private readonly inFlight = new Set<string>();

  constructor(private readonly terms: MeteredTerms, private readonly store?: SessionStore) {}

  /** Loads saved sessions. Call once at start, before serving. */
  async restore(): Promise<number> {
    const saved = this.store ? await this.store.load() : [];
    for (const state of saved) this.sessions.set(state.escrow, clone(state));
    return saved.length;
  }

  get(escrow: PublicKey | string): SessionState | undefined {
    const state = this.sessions.get(typeof escrow === 'string' ? escrow : escrow.toBase58());
    return state ? clone(state) : undefined;
  }

  /** What the totals so far plus `more` would cost, uncapped. */
  private costOf(state: SessionState, more: TokenCounts): bigint {
    return tokenCostBaseUnits(this.terms.price, { inputTokens: state.inputTokens + more.inputTokens, outputTokens: state.outputTokens + more.outputTokens });
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
  async begin(input: { lock: Extract<VerifiedLock, { ok: true }>; escrow: PublicKey; sequence: number; sessionKey: string; worstCase: TokenCounts; replayStore: NonceReplayStore; nowMs: number }): Promise<{ ok: true; reservation: SessionReservation } | SessionRefusal> {
    const key = input.escrow.toBase58();
    if (this.inFlight.has(key)) return { ok: false, reason: 'session_call_in_progress', message: 'The previous call of this session is still being served. Send the next call when it has answered.' };
    let state = this.sessions.get(key);
    if (!state) {
      if (input.sequence !== 1) return { ok: false, reason: 'session_sequence_invalid', message: 'No session is open on this lock. Start at call 1.' };
      this.inFlight.add(key);
      try {
        if (!(await input.replayStore.checkAndStore(meteredEscrowReplayKey(input.escrow)))) {
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
      } finally {
        this.inFlight.delete(key);
      }
    }
    if (state.sessionKey !== input.sessionKey) return { ok: false, reason: 'session_key_mismatch', message: 'This session was started with another session key. Sign with the key it was started with.' };
    if (state.status !== 'open') return { ok: false, reason: 'session_closed', message: state.status === 'settled' ? 'This session has been settled. Lock a new escrow to go on.' : 'This session is closed and being settled. Lock a new escrow to go on.' };
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
  release(reservation: SessionReservation): void {
    this.inFlight.delete(reservation.escrow);
  }

  /**
   * Records a served call's tokens and saves the session before the answer is
   * sent. `receiptHash` is the hash of the receipt this call is answered with.
   * When the model used more than the worst case allowed and the total would
   * pass the lock, the cost is capped at the lock and the session is full.
   */
  async record(reservation: SessionReservation, usage: TokenCounts, receiptHash: string | undefined, nowMs: number): Promise<SessionCall> {
    const current = this.sessions.get(reservation.escrow);
    if (!current || current.sequence !== reservation.sequence - 1 || !this.inFlight.has(reservation.escrow)) throw new Error('session reservation is stale');
    const max = BigInt(current.maxBaseUnits);
    const cost = this.costOf(current, usage);
    const next: SessionState = {
      ...current,
      sequence: reservation.sequence,
      inputTokens: current.inputTokens + usage.inputTokens,
      outputTokens: current.outputTokens + usage.outputTokens,
      costBaseUnits: (cost > max ? max : cost).toString(),
      ...(receiptHash ? { lastReceiptHash: receiptHash } : {}),
      lastActivityMs: nowMs,
    };
    const full = cost >= max;
    if (full) next.status = 'closing';
    try {
      await this.store?.save(next);
    } finally {
      // Not saved means not recorded: the call stays reserved no longer, and the caller must not answer.
      this.inFlight.delete(reservation.escrow);
    }
    this.sessions.set(reservation.escrow, next);
    return { state: clone(next), usage, full };
  }

  /** The cumulative state this call's receipt would state, before it is recorded. */
  preview(reservation: SessionReservation, usage: TokenCounts): SessionState {
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
  async close(escrow: PublicKey | string): Promise<SessionState | undefined> {
    const key = typeof escrow === 'string' ? escrow : escrow.toBase58();
    const state = this.sessions.get(key);
    if (!state || this.inFlight.has(key)) return undefined;
    if (state.status === 'open') {
      const next = { ...state, status: 'closing' as const };
      await this.store?.save(next);
      this.sessions.set(key, next);
      return clone(next);
    }
    return clone(state);
  }

  /** Records the settle (or, for a session with nothing to charge, the decline) that ended a session. */
  async finish(escrow: string, outcome: { status: 'settled' | 'declined' | 'refunded_unpaid'; signature?: string; closingReceipt?: unknown }): Promise<void> {
    const state = this.sessions.get(escrow);
    if (!state) return;
    const next: SessionState = { ...state, status: outcome.status, ...(outcome.signature ? { settleSignature: outcome.signature } : {}), ...(outcome.closingReceipt !== undefined ? { closingReceipt: outcome.closingReceipt } : {}) };
    await this.store?.save(next);
    this.sessions.set(escrow, next);
  }

  /**
   * Sessions to settle now: closing ones, open ones idle for `idleMs`, and open
   * ones whose refund window has less than the seller's minimum left (no new
   * call is taken then, so the settle has that long to land). A session with a
   * call running is never due.
   */
  due(nowMs: number, currentSlot: bigint, idleMs: number): SessionState[] {
    const out: SessionState[] = [];
    for (const state of this.sessions.values()) {
      if (this.inFlight.has(state.escrow)) continue;
      if (state.status === 'closing') out.push(clone(state));
      else if (state.status === 'open') {
        const refundOpens = BigInt(state.createdSlot) + BigInt(state.cancelWindowSlots);
        if (nowMs - state.lastActivityMs >= idleMs || currentSlot + SELLER_MIN_CANCEL_WINDOW_SLOTS >= refundOpens) out.push(clone(state));
      }
    }
    return out;
  }
}

/** The token totals a session's settle charges for. */
export function sessionUsage(state: SessionState): TokenCounts {
  return { inputTokens: state.inputTokens, outputTokens: state.outputTokens };
}

/**
 * The settle of a session: one `meteredSettlement` for the session's total
 * tokens, which charges exactly the ledger's cumulative cost. Pass the lock
 * as read back with `purpose: 'session-settle'`. Throws when the two
 * disagree, which would mean the receipts and the settle differ.
 */
export function sessionSettlement(terms: MeteredTerms, lock: Extract<VerifiedLock, { ok: true }>, state: SessionState, payout?: Parameters<typeof meteredSettlement>[3]): ReturnType<typeof meteredSettlement> {
  if (lock.maxBaseUnits.toString() !== state.maxBaseUnits || lock.payer.toBase58() !== state.payer || lock.createdSlot.toString() !== state.createdSlot) throw new Error('the lock does not match the session');
  const settled = meteredSettlement(terms, lock, sessionUsage(state), payout);
  if (settled.settlement.chargedBaseUnits.toString() !== state.costBaseUnits) throw new Error('the settle would charge a different amount than the session recorded');
  return settled;
}

/** The payment header a session's lock was presented with, rebuilt from the saved state, for reading the lock back to settle. */
export function sessionPaymentHeader(state: SessionState): { escrow: PublicKey; payer: PublicKey; nonce: Uint8Array } {
  return { escrow: new PublicKey(state.escrow), payer: new PublicKey(state.payer), nonce: Uint8Array.from(Buffer.from(state.nonce, 'hex')) };
}
