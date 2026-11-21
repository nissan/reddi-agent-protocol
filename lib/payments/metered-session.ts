/**
 * The buyer's side of session settlement (#863): one metered escrow lock pays
 * for many calls to one provider, and the provider settles once at the end.
 *
 * Wire contract (provider kit, #863):
 * - every call sends the same `x402-payment` metered header plus
 *   `x402-session-sequence: <n>` (1, 2, 3 …, no gaps);
 * - `x402-session: close` on a call asks the provider to settle after it answers;
 * - each answer's signed receipt v2 carries a `session` block with the running
 *   totals and a hash of the previous receipt; only the closing receipt is
 *   `closed` and carries the settle transaction in its `payment` block;
 * - refusals carry `error.code` `session_max_reached`, `session_window_closing`,
 *   `session_sequence_invalid` or `session_closed`.
 *
 * The buyer keeps its own count. If the provider's running total runs ahead of
 * what the buyer was told, the session stops and the buyer keeps the evidence
 * to dispute. Nothing here signs or sends.
 */

import { tokenCostBaseUnits, type PerTokenPrice, type TokenCounts } from "@reddi/x402-solana/metered";

export const SESSION_SEQUENCE_HEADER = "x402-session-sequence";
export const SESSION_HEADER = "x402-session";
export const SESSION_REFUSAL_CODES = ["session_max_reached", "session_window_closing", "session_sequence_invalid", "session_closed"] as const;
export type SessionRefusalCode = (typeof SESSION_REFUSAL_CODES)[number];

/**
 * The `session` block of a signed receipt v2 (provider kit, #863). Amounts and
 * counts are whole smallest units as decimal strings; `previousReceiptHash`
 * is left out on call 1 and is `hashReddiReceiptV2` of the previous receipt
 * after that. Only the closing receipt has `closed: true` and a `payment`
 * block whose txSignature is the settle transaction.
 */
export interface SessionBlock {
  escrow: string;
  sequence: number;
  inputTokens: number;
  outputTokens: number;
  cumulativeInputTokens: number;
  cumulativeOutputTokens: number;
  cumulativeCostBaseUnits: bigint;
  previousReceiptHash?: string;
  closed: boolean;
}

export interface SessionOpenInput {
  /** Who the session is with: the provider's wallet or endpoint. */
  providerKey: string;
  escrow: string;
  /** The metered `x402-payment` header, sent unchanged on every call. */
  paymentHeader: string;
  /** What the lock holds, in base units. */
  lockBaseUnits: bigint;
  /** The per-token price the buyer accepted. */
  price: PerTokenPrice;
  /** The provider's output limit per call. */
  maxOutputTokens: number;
}

export type SessionState = "open" | "closing" | "settled" | "closed" | "disputed";

export interface SessionCall {
  sequence: number;
  usage: TokenCounts;
  cumulativeCostBaseUnits: bigint;
  receiptHash: string;
}

export interface BuyerSession extends SessionOpenInput {
  state: SessionState;
  /** The sequence number the next call sends. */
  nextSequence: number;
  inputTokens: number;
  outputTokens: number;
  /** The provider's running total, as last reported and accepted. */
  costBaseUnits: bigint;
  /** The most the buyer's own count allows the provider to have charged. */
  allowedBaseUnits: bigint;
  lastReceiptHash: string | null;
  calls: SessionCall[];
  settleSignature?: string;
  /** Why the session stopped, when it did. */
  stopReason?: string;
}

export function openBuyerSession(input: SessionOpenInput): BuyerSession {
  if (!Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens <= 0) throw new Error("maxOutputTokens must be a positive integer");
  if (input.lockBaseUnits <= BigInt(0)) throw new Error("lockBaseUnits must be positive");
  return {
    ...input,
    state: "open",
    nextSequence: 1,
    inputTokens: 0,
    outputTokens: 0,
    costBaseUnits: BigInt(0),
    allowedBaseUnits: BigInt(0),
    lastReceiptHash: null,
    calls: [],
  };
}

/** The worst case for the next call: its input plus the full output limit. */
export function worstCaseBaseUnits(session: BuyerSession, inputTokens: number): bigint {
  return tokenCostBaseUnits(session.price, { inputTokens, outputTokens: session.maxOutputTokens });
}

export type SessionCallPlan =
  | { ok: true; sequence: number; headers: Record<string, string> }
  | { ok: false; reason: "session_not_open" | "session_max_reached"; message: string };

/**
 * The headers for the next call. Refused locally, before anything is sent,
 * when the session is not open or the call's worst case would not fit under
 * the lock; the buyer then closes this session and opens a new one.
 */
export function planSessionCall(session: BuyerSession, inputTokens: number, options: { close?: boolean } = {}): SessionCallPlan {
  if (session.state !== "open") return { ok: false, reason: "session_not_open", message: `This session is ${session.state}.` };
  if (session.costBaseUnits + worstCaseBaseUnits(session, inputTokens) > session.lockBaseUnits) {
    return { ok: false, reason: "session_max_reached", message: "This call could take the session past the amount locked." };
  }
  const headers: Record<string, string> = {
    "x402-payment": session.paymentHeader,
    [SESSION_SEQUENCE_HEADER]: String(session.nextSequence),
  };
  if (options.close) headers[SESSION_HEADER] = "close";
  return { ok: true, sequence: session.nextSequence, headers };
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function wholeString(value: unknown): bigint | undefined {
  return typeof value === "string" && /^(0|[1-9]\d*)$/.test(value) ? BigInt(value) : undefined;
}

function wholeCount(value: unknown): number | undefined {
  const n = wholeString(value);
  return n !== undefined && n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : undefined;
}

/** Reads the `session` block of a receipt. Undefined when it is missing or malformed. */
export function parseSessionBlock(value: unknown): SessionBlock | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  const sequence = wholeCount(v.sequence);
  const inputTokens = wholeCount(v.inputTokens);
  const outputTokens = wholeCount(v.outputTokens);
  const cumulativeInputTokens = wholeCount(v.cumulativeInputTokens);
  const cumulativeOutputTokens = wholeCount(v.cumulativeOutputTokens);
  const cumulativeCostBaseUnits = wholeString(v.cumulativeCost);
  if (typeof v.escrow !== "string" || sequence === undefined || sequence < 1) return undefined;
  if (inputTokens === undefined || outputTokens === undefined || cumulativeInputTokens === undefined || cumulativeOutputTokens === undefined) return undefined;
  if (cumulativeCostBaseUnits === undefined || typeof v.closed !== "boolean") return undefined;
  if (v.previousReceiptHash !== undefined && (typeof v.previousReceiptHash !== "string" || !/^[0-9a-f]{64}$/.test(v.previousReceiptHash))) return undefined;
  if ((sequence === 1) !== (v.previousReceiptHash === undefined)) return undefined;
  return {
    escrow: v.escrow,
    sequence,
    inputTokens,
    outputTokens,
    cumulativeInputTokens,
    cumulativeOutputTokens,
    cumulativeCostBaseUnits,
    previousReceiptHash: v.previousReceiptHash as string | undefined,
    closed: v.closed,
  };
}

export type SessionAnswerResult =
  | { ok: true; session: BuyerSession }
  | { ok: false; session: BuyerSession; reason: "session_mismatch" | "session_overcharge"; message: string };

function dispute(session: BuyerSession, reason: "session_mismatch" | "session_overcharge", message: string): SessionAnswerResult {
  return { ok: false, session: { ...session, state: "disputed", stopReason: message }, reason, message };
}

/**
 * Checks a call's signed receipt against the buyer's own count and records it.
 * `receipt` is the receipt v2 body (its `session` block, and on the closing
 * call its `payment` block); `receiptHash` is `hashReddiReceiptV2` of it, which
 * the next receipt must name as its previous receipt. The caller checks the
 * provider's signature first.
 *
 * A mismatch or overcharge stops the session as disputed. The buyer keeps
 * every accepted receipt, and the lock cannot pay out more than it holds.
 */
export function recordSessionAnswer(session: BuyerSession, input: { receipt: unknown; receiptHash: string }): SessionAnswerResult {
  const receipt = input.receipt && typeof input.receipt === "object" ? (input.receipt as Record<string, unknown>) : {};
  const block = parseSessionBlock(receipt.session);
  if (!block) return dispute(session, "session_mismatch", "The receipt has no readable session block.");
  if (block.escrow !== session.escrow) return dispute(session, "session_mismatch", "The receipt names a different escrow.");
  if (block.sequence !== session.nextSequence) return dispute(session, "session_mismatch", `Expected call ${session.nextSequence}, the receipt is for call ${block.sequence}.`);
  if ((block.previousReceiptHash ?? null) !== session.lastReceiptHash) return dispute(session, "session_mismatch", "The receipt does not chain to the last one.");
  if (block.outputTokens > session.maxOutputTokens) return dispute(session, "session_overcharge", "The receipt reports more output than the provider's limit.");

  const inputTokens = session.inputTokens + block.inputTokens;
  const outputTokens = session.outputTokens + block.outputTokens;
  if (block.cumulativeInputTokens !== inputTokens || block.cumulativeOutputTokens !== outputTokens) {
    return dispute(session, "session_mismatch", "The running token totals do not add up to the calls served.");
  }

  // Each call rounds up to the next base unit at most once, so the sum of
  // per-call costs bounds the running total from above.
  const allowed = session.allowedBaseUnits + tokenCostBaseUnits(session.price, { inputTokens: block.inputTokens, outputTokens: block.outputTokens });
  const cost = block.cumulativeCostBaseUnits;
  if (cost < session.costBaseUnits) return dispute(session, "session_mismatch", "The running total went down.");
  if (cost > allowed) return dispute(session, "session_overcharge", "The running total is more than the tokens served cost.");
  if (cost > session.lockBaseUnits) return dispute(session, "session_overcharge", "The running total is more than the lock holds.");

  let settleSignature: string | undefined;
  const payment = receipt.payment && typeof receipt.payment === "object" ? (receipt.payment as Record<string, unknown>) : undefined;
  if (block.closed) {
    if (!payment || payment.settlement !== "metered-escrow" || typeof payment.txSignature !== "string" || payment.amount !== String(cost)) {
      return dispute(session, "session_mismatch", "The closing receipt does not settle the running total.");
    }
    settleSignature = payment.txSignature;
  } else if (payment) {
    return dispute(session, "session_mismatch", "An open session's receipt carries a payment.");
  }

  const usage = { inputTokens: block.inputTokens, outputTokens: block.outputTokens };
  const calls = [...session.calls, { sequence: block.sequence, usage, cumulativeCostBaseUnits: cost, receiptHash: input.receiptHash }];
  return {
    ok: true,
    session: {
      ...session,
      state: block.closed ? "settled" : session.state,
      nextSequence: session.nextSequence + 1,
      inputTokens,
      outputTokens,
      costBaseUnits: cost,
      allowedBaseUnits: allowed,
      lastReceiptHash: input.receiptHash,
      calls,
      settleSignature,
    },
  };
}

/** The refusal code in a provider's 402/409 body, when it is a session refusal. */
export function sessionRefusalCode(body: unknown): SessionRefusalCode | undefined {
  if (!body || typeof body !== "object") return undefined;
  const error = (body as Record<string, unknown>).error;
  if (!error || typeof error !== "object") return undefined;
  const code = (error as Record<string, unknown>).code;
  return SESSION_REFUSAL_CODES.find((c) => c === code);
}

/**
 * What a refusal means for the session. Nothing was charged for the refused
 * call. Every refusal ends this session for new calls; the buyer opens a new
 * one for further work. A window closing or a full lock still leaves the
 * provider to settle what it served.
 */
export function recordSessionRefusal(session: BuyerSession, code: SessionRefusalCode): BuyerSession {
  const messages: Record<SessionRefusalCode, string> = {
    session_max_reached: "The next call could take the session past its lock.",
    session_window_closing: "The escrow's refund window is about to open, so the provider is settling.",
    session_sequence_invalid: "The provider refused the call's sequence number.",
    session_closed: "The provider has already closed this session.",
  };
  return { ...session, state: code === "session_closed" ? "closed" : "closing", stopReason: messages[code] };
}

/**
 * Open sessions per provider, so the planner and the buyer client reuse one
 * lock for many calls. In memory: a buyer that restarts opens a new session,
 * and the provider settles the old one on its idle timeout.
 */
export class BuyerSessionBook {
  private readonly sessions = new Map<string, BuyerSession>();

  /** The open session with this provider in this currency, if any. */
  get(providerKey: string, currency: string): BuyerSession | undefined {
    const s = this.sessions.get(`${providerKey}|${currency}`);
    return s && s.state === "open" ? s : undefined;
  }

  put(session: BuyerSession): void {
    this.sessions.set(`${session.providerKey}|${session.price.currency}`, session);
  }

  /** Every session, open or not, for showing receipts and disputes. */
  all(): BuyerSession[] {
    return [...this.sessions.values()];
  }
}
