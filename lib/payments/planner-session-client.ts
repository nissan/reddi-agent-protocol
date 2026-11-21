/**
 * The planner's browser side of a session (#863): one metered lock pays for
 * many calls to one provider. The payer wallet signs one delegation to a
 * session key kept in memory; the session key signs each call, so later calls
 * need no wallet prompt. The provider settles once, when asked to or when the
 * session goes idle.
 *
 * Every call's signed receipt is checked against the buyer's own count
 * (`recordSessionAnswer`). A receipt that does not add up stops the session.
 */

import { receiptHeaderForProvider } from "@/lib/payments/wallet-direct-payment";
import { estimateTokens } from "@/lib/payments/metered-quote";
import {
  openBuyerSession,
  planSessionCall,
  recordSessionAnswer,
  recordSessionRefusal,
  SESSION_REFUSAL_CODES,
  type BuyerSession,
} from "@/lib/payments/metered-session";
import { createSessionKey, sessionDelegationHeaderValue, sessionSignatureHeaderValue, type MessageSigner } from "@/lib/payments/session-auth";
import { plannerChatBody } from "@/lib/onboarding/planner-payload";
import type { PerTokenPrice } from "@redditech/x402-solana/metered";

/** How long the wallet's delegation to the session key lasts. Providers accept at most 7 days. */
export const SESSION_DELEGATION_SECONDS = 24 * 60 * 60;

export interface PlannerSessionHandle {
  ledger: BuyerSession;
  /** The lock's receipt, presented unchanged with every call. Empty until the lock is sent. */
  receipt: Record<string, unknown>;
  /** `x402-session-delegation`, signed once by the payer wallet. */
  delegation: string;
  sessionKey: { publicKey: string; sign: MessageSigner };
}

/** What the planner server sends back about a session call (`PlannerSessionOutcome`). Untrusted shape. */
export interface PlannerSessionOutcomeView {
  call?: { receipt: unknown; receiptHash: string };
  closing?: { receipt: unknown; receiptHash: string };
  state?: string;
  refusal?: string;
  problem?: string;
}

/**
 * Makes a session key and asks the payer wallet to delegate to it. Call it
 * before the lock is sent, so a buyer who declines the message locks for one
 * call only. Throws when the wallet refuses to sign.
 */
export async function openPlannerSession(input: {
  escrow: string;
  providerWallet: string;
  lockBaseUnits: bigint;
  price: PerTokenPrice;
  maxOutputTokens: number;
  signWithPayer: MessageSigner;
  nowMs?: number;
  /** For tests: a session key made elsewhere. */
  sessionKey?: { publicKey: string; sign: MessageSigner };
}): Promise<PlannerSessionHandle> {
  const sessionKey = input.sessionKey ?? (await createSessionKey());
  const expiresAt = Math.floor((input.nowMs ?? Date.now()) / 1000) + SESSION_DELEGATION_SECONDS;
  const delegation = await sessionDelegationHeaderValue(
    { escrow: input.escrow, provider: input.providerWallet, sessionKey: sessionKey.publicKey, expiresAt },
    input.signWithPayer,
  );
  const ledger = openBuyerSession({
    providerKey: input.providerWallet,
    escrow: input.escrow,
    paymentHeader: "",
    lockBaseUnits: input.lockBaseUnits,
    price: input.price,
    maxOutputTokens: input.maxOutputTokens,
  });
  return { ledger, receipt: {}, delegation, sessionKey };
}

/** Attaches the lock's receipt once the lock transaction is sent. */
export function attachLockReceipt(handle: PlannerSessionHandle, receipt: Record<string, unknown>): PlannerSessionHandle {
  const header = receiptHeaderForProvider(receipt);
  if (!header.ok) throw new Error(header.message);
  if (receipt.escrow !== handle.ledger.escrow) throw new Error("The receipt is for a different escrow from the session's.");
  return { ...handle, receipt, ledger: { ...handle.ledger, paymentHeader: header.header } };
}

export type PreparedSessionCall =
  | { ok: true; request: { sequence: number; close: boolean; delegation: string; signature: string } }
  | { ok: false; handle: PlannerSessionHandle; reason: string; message: string };

/**
 * Signs the next call with the session key, over the exact body the server
 * sends. Refused here, before anything is sent, when the session is not open
 * or the call's worst case would not fit in what is left of the lock.
 */
export async function prepareSessionCall(handle: PlannerSessionHandle, prompt: string, close: boolean): Promise<PreparedSessionCall> {
  const plan = planSessionCall(handle.ledger, estimateTokens(prompt).inputTokens, { close });
  if (!plan.ok) {
    const ledger = plan.reason === "session_max_reached" ? recordSessionRefusal(handle.ledger, "session_max_reached") : handle.ledger;
    return { ok: false, handle: { ...handle, ledger }, reason: plan.reason, message: plan.message };
  }
  const signature = await sessionSignatureHeaderValue(
    { action: "call", escrow: handle.ledger.escrow, sequence: plan.sequence, body: plannerChatBody(prompt) },
    handle.sessionKey.sign,
  );
  return { ok: true, request: { sequence: plan.sequence, close, delegation: handle.delegation, signature } };
}

function stopped(handle: PlannerSessionHandle, state: BuyerSession["state"], reason: string): PlannerSessionHandle {
  return { ...handle, ledger: { ...handle.ledger, state, stopReason: reason } };
}

/**
 * Records what the provider answered. `ok` is whether the planner's call
 * succeeded. Returns the updated session and a line for the buyer.
 */
export function applySessionOutcome(handle: PlannerSessionHandle, ok: boolean, outcome: PlannerSessionOutcomeView | undefined): { handle: PlannerSessionHandle; note: string } {
  if (!ok) {
    const code = SESSION_REFUSAL_CODES.find((c) => c === outcome?.refusal);
    if (code) {
      const ledger = recordSessionRefusal(handle.ledger, code);
      return { handle: { ...handle, ledger }, note: `${ledger.stopReason} Nothing was charged for this call. Run it again to lock a new maximum.` };
    }
    if (outcome?.refusal) {
      // Any other refusal (for example the provider not offering sessions, or the
      // session key not accepted) means this lock cannot carry more session calls.
      return { handle: stopped(handle, "closing", `The provider refused the session call (${outcome.refusal}).`), note: `The provider refused the session call (${outcome.refusal}). Nothing was charged for it. Run it again to lock a new maximum; the provider settles any calls it already served.` };
    }
    return { handle, note: `Session call ${handle.ledger.nextSequence} did not go through. Nothing was charged for it; run it again to send the same call.` };
  }
  if (!outcome?.call) {
    return {
      handle: stopped(handle, "disputed", `The provider answered without a receipt that checks out (${outcome?.problem ?? "none"}).`),
      note: "The provider answered, but its receipt for this call did not check out, so this session takes no more calls. Keep the run record; the lock cannot pay out more than it holds.",
    };
  }
  const recorded = recordSessionAnswer(handle.ledger, { receipt: outcome.call.receipt, receiptHash: outcome.call.receiptHash });
  if (!recorded.ok) {
    return { handle: { ...handle, ledger: recorded.session }, note: `The provider's running total does not match your own count (${recorded.message}), so this session takes no more calls.` };
  }
  let next: PlannerSessionHandle = { ...handle, ledger: recorded.session };
  if (outcome.closing) {
    const closed = recordSessionAnswer(next.ledger, { receipt: outcome.closing.receipt, receiptHash: outcome.closing.receiptHash });
    next = { ...next, ledger: closed.session };
    if (!closed.ok) return { handle: next, note: `The closing receipt does not match your own count (${closed.message}).` };
    return { handle: next, note: `Session settled: ${next.ledger.calls.length - 1} calls for one lock and one settle.` };
  }
  if (outcome.state === "pending" || outcome.state === "declined") {
    next = stopped(next, "closing", `The provider is settling this session (${outcome.state}).`);
    return { handle: next, note: "The provider is settling this session. Run again to lock a new maximum." };
  }
  return { handle: next, note: `Call ${recorded.session.nextSequence - 1} of this session. No wallet prompt was needed.` };
}
