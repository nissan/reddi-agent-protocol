/**
 * The sandbox "Run a session" scenario (#863): ten small calls paid from one
 * simulated lock, settled once. The visitor's side keeps its own count of
 * every call and checks each signed receipt against it as it arrives: the
 * provider's signature, the sequence, the hash of the previous receipt, the
 * token totals and the running cost. Isomorphic, so the tests drive it against
 * the gateway with the same code the browser runs.
 */

import type { SandboxProvider } from "./catalog";
import { callSandbox, challengeFrom, errorMessageOf, type SandboxExchange } from "./client";
import { countTokens, formatUnits, maxChargeLamports, requestInputTokens, sandboxFeeBps, sessionCallLamports } from "./pricing";
import { encodeReceiptHeader, hashSandboxReceipt, isSandboxReceipt, sandboxReceiptSignatureValid, type SandboxReceipt } from "./receipt";

export const SESSION_PROMPTS: readonly string[] = [
  "Name one risk of retrying a payment without an idempotency key.",
  "Give a one-line definition of a race condition.",
  "Suggest a clearer name for a function called doStuff2.",
  "What does HTTP 402 mean, in one sentence?",
  "One tip for writing a good commit message.",
  "Explain a nonce in one sentence.",
  "Should a log line include a user's password? One sentence.",
  "Name one reason to pin a dependency version.",
  "What is a dead letter queue, in one sentence?",
  "One sentence on why tests should fail before they pass.",
];

/**
 * Network fee comparison from the token cost research (21 November 2026):
 * the median Solana transaction fee, and a typical mid-tier chat call.
 */
export const MEDIAN_NETWORK_FEE_USD = 0.000365;
export const TYPICAL_CHAT_CALL_USD = 0.0065;

/** Share of spend lost to network fees when `calls` chat calls share one lock and one settle. */
export function networkFeeShare(calls: number): number {
  return (2 * MEDIAN_NETWORK_FEE_USD) / (calls * TYPICAL_CHAT_CALL_USD);
}

export type SessionCallRow = {
  sequence: number;
  prompt: string;
  answer: string;
  inputTokens: number;
  outputTokens: number;
  costLamports: bigint;
  cumulativeLamports: bigint;
  /** Every check of this call's receipt against the visitor's own count passed. */
  checked: boolean;
  problem?: string;
};

export type SessionRunResult =
  | {
      ok: true;
      maxLamports: bigint;
      rows: SessionCallRow[];
      totalLamports: bigint;
      feeLamports: bigint;
      refundedLamports: bigint;
      receipts: SandboxReceipt[];
      closing: SandboxReceipt;
      exchanges: SandboxExchange[];
    }
  | { ok: false; message: string; rows: SessionCallRow[]; exchanges: SandboxExchange[] };

/** The session maximum: ten times the worst case of the longest prompt, so every call fits. */
export function sessionMaxLamports(provider: SandboxProvider, prompts: readonly string[] = SESSION_PROMPTS): bigint {
  const worst = prompts.reduce((max, prompt) => {
    const each = maxChargeLamports(provider, requestInputTokens([{ content: prompt }]));
    return each > max ? each : max;
  }, BigInt(0));
  return worst * BigInt(prompts.length);
}

export async function runSandboxSession(input: {
  provider: SandboxProvider;
  prompts?: readonly string[];
  fetchImpl?: typeof fetch;
  providerReceiptId?: string;
  onCall?: (row: SessionCallRow) => void;
}): Promise<SessionRunResult> {
  const { provider } = input;
  const prompts = input.prompts ?? SESSION_PROMPTS;
  const rows: SessionCallRow[] = [];
  const exchanges: SandboxExchange[] = [];
  const fail = (message: string): SessionRunResult => ({ ok: false, message, rows, exchanges });

  // One unpaid request for the challenge: its nonce names the session's lock.
  const first = [{ role: "user", content: prompts[0] }];
  const opened = await callSandbox({ label: "Session: ask for terms", model: provider.model, messages: first, fetchImpl: input.fetchImpl });
  exchanges.push(opened.exchange);
  const challenge = challengeFrom(opened.body);
  if (opened.status !== 402 || !challenge) return fail(errorMessageOf(opened.body));
  const maxLamports = sessionMaxLamports(provider, prompts);
  const lock = JSON.stringify({
    simulated: true,
    settlement: "metered-escrow",
    network: challenge.network,
    payTo: challenge.payTo,
    currency: challenge.currency,
    amount: formatUnits(maxLamports, 9),
    nonce: challenge.nonce,
  });

  const receipts: SandboxReceipt[] = [];
  let previousHash: string | undefined;
  let cumulative = BigInt(0);
  let totals = { inputTokens: 0, outputTokens: 0 };
  let closing: SandboxReceipt | undefined;

  for (const [index, prompt] of prompts.entries()) {
    const sequence = index + 1;
    const last = sequence === prompts.length;
    const messages = [{ role: "user", content: prompt }];
    const headers: Record<string, string> = { "x402-session-sequence": String(sequence) };
    if (receipts.length > 0) headers["x-reddi-session-previous-receipt"] = encodeReceiptHeader(receipts[receipts.length - 1]);
    if (last) headers["x402-session"] = "close";
    const result = await callSandbox({ label: `Session call ${sequence}${last ? " (close)" : ""}`, model: provider.model, messages, paymentHeader: lock, extraHeaders: headers, fetchImpl: input.fetchImpl });
    exchanges.push(result.exchange);
    if (result.status !== 200) return fail(`Call ${sequence} was refused: ${errorMessageOf(result.body)}`);
    const answer = String((result.body.choices as Array<{ message: { content: string } }> | undefined)?.[0]?.message?.content ?? "");

    // The visitor's own count of this call.
    const usage = { inputTokens: requestInputTokens(messages), outputTokens: countTokens(answer) };
    const cost = sessionCallLamports(provider, usage);
    cumulative += cost;
    totals = { inputTokens: totals.inputTokens + usage.inputTokens, outputTokens: totals.outputTokens + usage.outputTokens };

    const receipt = result.receipt;
    let problem: string | undefined;
    if (!isSandboxReceipt(receipt) || !receipt.receipt.session) problem = "The answer came without a session receipt.";
    else {
      const s = receipt.receipt.session;
      if (input.providerReceiptId !== undefined && receipt.receipt.providerId !== input.providerReceiptId) problem = "The receipt is signed by a different key from the listed provider.";
      else if (!(await sandboxReceiptSignatureValid(receipt))) problem = "The provider signature does not verify.";
      else if (s.sequence !== String(sequence)) problem = `The receipt is for call ${s.sequence}.`;
      else if (s.previousReceiptHash !== previousHash) problem = "The receipt does not chain to the previous one.";
      else if (s.inputTokens !== String(usage.inputTokens) || s.outputTokens !== String(usage.outputTokens)) problem = "The receipt's token counts differ from your own count.";
      else if (s.cumulativeCost !== cumulative.toString()) problem = "The running total differs from what your own count comes to.";
    }
    const row: SessionCallRow = { sequence, prompt, answer, ...usage, costLamports: cost, cumulativeLamports: cumulative, checked: problem === undefined, ...(problem ? { problem } : {}) };
    rows.push(row);
    input.onCall?.(row);
    if (problem || !isSandboxReceipt(receipt)) return fail(`Call ${sequence}: ${problem}`);
    receipts.push(receipt);
    previousHash = await hashSandboxReceipt(receipt.receipt);

    if (last) {
      const value = result.sessionReceipt;
      if (!isSandboxReceipt(value) || !value.receipt.session || !value.receipt.payment || !(await sandboxReceiptSignatureValid(value))) return fail("The session closed without a valid closing receipt.");
      const s = value.receipt.session;
      if (!s.closed || s.sequence !== String(sequence + 1) || s.previousReceiptHash !== previousHash || value.receipt.payment.amount !== cumulative.toString()) {
        return fail("The closing receipt does not settle the running total you counted.");
      }
      closing = value;
    }
  }
  if (!closing?.receipt.payment) return fail("The session did not close.");
  const fee = (cumulative * sandboxFeeBps()) / BigInt(10_000);
  if (closing.receipt.payment.fee.amount !== fee.toString()) return fail("The closing receipt states a different fee from the protocol fee on the total.");
  return { ok: true, maxLamports, rows, totalLamports: cumulative, feeLamports: fee, refundedLamports: maxLamports - cumulative, receipts, closing, exchanges };
}
