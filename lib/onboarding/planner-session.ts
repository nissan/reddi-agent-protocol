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

/** A single metered call's payer auth (#866): the delegation and the key's `single` signature. */
export interface PlannerPaidCallAuth {
  delegation: string;
  signature: string;
}

/** Reads the `paidCallAuth` field of a planner request. Undefined when absent; an error when malformed. */
export function parsePaidCallAuth(value: unknown): PlannerPaidCallAuth | { error: string } | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) return { error: "paidCallAuth must be an object" };
  const v = value as Record<string, unknown>;
  for (const key of ["delegation", "signature"] as const) {
    const text = v[key];
    if (typeof text !== "string" || text.length === 0 || text.length > MAX_HEADER_CHARS || !BASE64.test(text)) return { error: `paidCallAuth.${key} must be base64` };
  }
  return { delegation: v.delegation as string, signature: v.signature as string };
}

/** The headers a single metered call carries to show the payer sent it. */
export function paidCallAuthRequestHeaders(auth: PlannerPaidCallAuth): Record<string, string> {
  return { [SESSION_DELEGATION_HEADER]: auth.delegation, [SESSION_SIGNATURE_HEADER]: auth.signature };
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

/** A request to settle a session now (#863 follow-up), as the browser asks for it. */
export interface PlannerSessionCloseRequest {
  /** The closing receipt's number: one past the last call the buyer counted. */
  sequence: number;
  delegation: string;
  /** The session key's `close` signature, sequence 0, over an empty body. */
  signature: string;
}

/** Reads a settle-now request. An error when malformed. */
export function parsePlannerSessionClose(value: unknown): PlannerSessionCloseRequest | { error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "close must be an object" };
  const v = value as Record<string, unknown>;
  if (typeof v.sequence !== "number" || !Number.isSafeInteger(v.sequence) || v.sequence < 2 || v.sequence > MAX_SEQUENCE + 1) return { error: "close.sequence must be a whole number from 2" };
  const auth = parsePaidCallAuth({ delegation: v.delegation, signature: v.signature });
  if (!auth || "error" in auth) return { error: (auth?.error ?? "close needs delegation and signature").replace("paidCallAuth", "close") };
  return { sequence: v.sequence, ...auth };
}

/** The headers of a settle-now request: the session key's `close` signature. */
export function sessionCloseRequestHeaders(close: PlannerSessionCloseRequest): Record<string, string> {
  return { [SESSION_DELEGATION_HEADER]: close.delegation, [SESSION_SIGNATURE_HEADER]: close.signature };
}

/**
 * Checks what a provider answered to a settle-now request (`POST
 * /v1/session/close`). 200 carries the closing receipt; 202 means the settle
 * is still pending. The closing receipt is passed on only when it is signed by
 * the paid provider and names this escrow, the closing number and `closed`.
 */
export function checkSessionCloseAnswer(input: { status: number; headers: Headers; responseText: string; providerWallet: string; escrow: string; sequence: number }): PlannerSessionOutcome {
  const outcome: PlannerSessionOutcome = { escrow: input.escrow, sequence: input.sequence };
  if (input.status === 202) {
    outcome.state = "pending";
    return outcome;
  }
  if (input.status < 200 || input.status >= 300) {
    const code = refusalCode(input.responseText);
    outcome.refusal = code ?? `http_${input.status}`;
    return outcome;
  }
  const header = input.headers.get(SESSION_RECEIPT_HEADER);
  if (!header) {
    outcome.problem = "closing receipt: none";
    return outcome;
  }
  const verified = verifyReddiReceiptV2(parseProviderReceiptHeader(header), {
    providerId: input.providerWallet,
    session: { escrow: input.escrow, sequence: String(input.sequence), closed: true },
  });
  if (verified.ok) {
    outcome.closing = { receipt: verified.receipt, receiptHash: hashReddiReceiptV2(verified.receipt) };
    outcome.state = "settled";
  } else {
    outcome.problem = `closing receipt: ${verified.errors[0]?.code ?? "invalid"}`;
  }
  return outcome;
}
