import "server-only";

/**
 * The planner server's part in a session (#863): it forwards a call the
 * buyer's session key signed, and checks the provider's signed receipts
 * before handing them to the browser, whose ledger checks the running totals.
 *
 * The server holds no session key and signs nothing. The provider decides
 * whether the delegation and the signature are good.
 */

import { hashReddiReceiptV2, hashReddiReceiptV2Body, verifyReddiReceiptV2, type ReddiReceiptV2 } from "@redditech/agent-protocol/receipt-v2";
import { parseProviderReceiptHeader, PROVIDER_RECEIPT_HEADER } from "@/lib/jobs/provider-receipt";

export const SESSION_SEQUENCE_HEADER = "x402-session-sequence";
export const SESSION_HEADER = "x402-session";
export const SESSION_DELEGATION_HEADER = "x402-session-delegation";
export const SESSION_SIGNATURE_HEADER = "x402-session-signature";
/** The closing receipt of a session, on the answer that settled it. */
export const SESSION_RECEIPT_HEADER = "x-reddi-session-receipt";
/** On an answer that asked to close: settled, declined, or pending. */
export const SESSION_STATE_HEADER = "x-reddi-session-state";

const MAX_SEQUENCE = 1_000_000;
const MAX_HEADER_CHARS = 4096;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** One session call as the browser asks for it. */
export interface PlannerSessionRequest {
  sequence: number;
  close: boolean;
  /** `x402-session-delegation`, made once per session by the payer wallet. */
  delegation: string;
  /** `x402-session-signature`, the session key's signature over this call. */
  signature: string;
}

/** Reads the `session` field of a planner request. Undefined when absent; an error when malformed. */
export function parsePlannerSessionRequest(value: unknown): PlannerSessionRequest | { error: string } | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) return { error: "session must be an object" };
  const v = value as Record<string, unknown>;
  if (typeof v.sequence !== "number" || !Number.isSafeInteger(v.sequence) || v.sequence < 1 || v.sequence > MAX_SEQUENCE) return { error: "session.sequence must be a whole number from 1" };
  if (v.close !== undefined && typeof v.close !== "boolean") return { error: "session.close must be true or false" };
  for (const key of ["delegation", "signature"] as const) {
    const text = v[key];
    if (typeof text !== "string" || text.length === 0 || text.length > MAX_HEADER_CHARS || !BASE64.test(text)) return { error: `session.${key} must be base64` };
  }
  return { sequence: v.sequence, close: v.close === true, delegation: v.delegation as string, signature: v.signature as string };
}

/** The headers that make a paid call a session call. */
export function sessionRequestHeaders(session: PlannerSessionRequest): Record<string, string> {
  return {
    [SESSION_SEQUENCE_HEADER]: String(session.sequence),
    ...(session.close ? { [SESSION_HEADER]: "close" } : {}),
    [SESSION_DELEGATION_HEADER]: session.delegation,
    [SESSION_SIGNATURE_HEADER]: session.signature,
  };
}

export interface CheckedSessionReceipt {
  receipt: ReddiReceiptV2;
  receiptHash: string;
}

/** What the browser is given about a session call. */
export interface PlannerSessionOutcome {
  escrow: string;
  sequence: number;
  /** The provider's signed receipt for this call, checked here. */
  call?: CheckedSessionReceipt;
  /** The closing receipt, when the provider settled the session on this answer. */
  closing?: CheckedSessionReceipt;
  /** settled, declined or pending, when the call asked to close. */
  state?: string;
  /** The provider's refusal code, when it refused the call. Nothing was charged for it. */
  refusal?: string;
  /** Why a receipt was not passed on, when one was sent but did not check out. */
  problem?: string;
}

function refusalCode(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text) as { error?: { code?: unknown } };
    return typeof parsed?.error?.code === "string" ? parsed.error.code : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Checks what a provider answered to a session call. A receipt is passed on
 * only when its signature verifies against the paid provider's wallet and it
 * names this escrow; a call receipt must also name the call's number and the
 * exact bytes sent and received.
 */
export function checkSessionAnswer(input: {
  status: number;
  headers: Headers;
  responseText: string;
  requestBody: string;
  providerWallet: string;
  escrow: string;
  sequence: number;
}): PlannerSessionOutcome {
  const outcome: PlannerSessionOutcome = { escrow: input.escrow, sequence: input.sequence };
  if (input.status < 200 || input.status >= 300) {
    const code = refusalCode(input.responseText);
    if (code) outcome.refusal = code;
    return outcome;
  }
  const state = input.headers.get(SESSION_STATE_HEADER);
  if (state && /^[a-z_]{1,32}$/.test(state)) outcome.state = state;

  const callHeader = input.headers.get(PROVIDER_RECEIPT_HEADER);
  if (callHeader) {
    const verified = verifyReddiReceiptV2(parseProviderReceiptHeader(callHeader), {
      providerId: input.providerWallet,
      requestHash: hashReddiReceiptV2Body(input.requestBody),
      responseHash: hashReddiReceiptV2Body(input.responseText),
      session: { escrow: input.escrow, sequence: String(input.sequence), closed: false },
    });
    if (verified.ok) outcome.call = { receipt: verified.receipt, receiptHash: hashReddiReceiptV2(verified.receipt) };
    else outcome.problem = `call receipt: ${verified.errors[0]?.code ?? "invalid"}`;
  } else {
    outcome.problem = "call receipt: none";
  }

  const closingHeader = input.headers.get(SESSION_RECEIPT_HEADER);
  if (closingHeader) {
    const verified = verifyReddiReceiptV2(parseProviderReceiptHeader(closingHeader), {
      providerId: input.providerWallet,
      session: { escrow: input.escrow, sequence: String(input.sequence + 1), closed: true },
    });
    if (verified.ok) outcome.closing = { receipt: verified.receipt, receiptHash: hashReddiReceiptV2(verified.receipt) };
    else outcome.problem = `closing receipt: ${verified.errors[0]?.code ?? "invalid"}`;
  }
  return outcome;
}
