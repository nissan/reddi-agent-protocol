/**
 * The provider's HTTP surface.
 *
 *   GET  /healthz                       liveness
 *   GET  /v1/models                     the declared model
 *   GET  /.well-known/reddi-agent.json  name, wallet, network and per-token price
 *   POST /v1/chat/completions           OpenAI-compatible, paid per token
 *   POST /v1/session/close              settle a session now (payment header only)
 *   GET  /v1/session/<escrow>           a session's totals, and its closing receipt once settled
 *
 * A paid call goes: no payment, so 402 with the price, the estimate and the
 * maximum to lock; then the same request with the lock named in `x402-payment`;
 * the lock is checked on chain; the model answers; the provider settles the
 * actual cost; the answer returns with a signed receipt.
 *
 * Order matters for money. A lock is accepted only when every account its
 * payout needs can receive. The buyer is charged only after the model has
 * answered, and the answer is sent only after the settle has confirmed. If the
 * model fails the lock is declined, which refunds the buyer in full. The
 * receipt states what the confirmed settle moved, read back from the chain;
 * when that cannot be read, no receipt is issued. A buyer is told nothing was
 * charged only when its escrow is read back as still locked.
 *
 * Sessions (`x402-session-sequence: n` with the same lock on every call): one
 * lock pays for many calls. Each call is checked against the session's
 * ledger, answered with a receipt that carries the running totals and the
 * previous receipt's hash, and recorded before the answer is sent. Nothing is
 * charged per call. The session settles once, for the ledger's total, when the
 * buyer closes it, after it has been idle, or before its refund window opens,
 * and that settle has a closing receipt of its own.
 */
import { createHash, randomUUID } from "node:crypto";
import { hashReddiReceiptV2, signReddiReceiptV2, type ReddiReceiptV2, type ReddiReceiptV2Session } from "@reddi/agent-protocol/receipt-v2";
import { PublicKey } from "@solana/web3.js";
import {
  baseUnitsToDecimal,
  checkMeteredPayout,
  checkProviderCluster,
  confirmMeteredSettlement,
  decodeTokenEscrowAccount,
  directPaymentCurrency,
  ESCROW_PROTOCOL_TREASURY,
  estimateInputTokens,
  meteredDecline,
  meteredOffer,
  meteredSettlement,
  outputLimit,
  readMeteredPaymentHeader,
  readSessionHeaders,
  sessionPaymentHeader,
  sessionSettlement,
  tokenCostBaseUnits,
  tokenEscrowAddresses,
  usageFrom,
  verifyMeteredLock,
  type MeteredPaymentHeader,
  type MeteredSessionLedger,
  type NonceReplayStore,
  type PayoutAccounts,
  type SessionState,
  type TokenCounts,
  type VerifiedLock,
} from "@reddi/x402-solana";
import type { ProviderChain } from "./chain.js";
import type { ProviderConfig } from "./config.js";
import type { Upstream, UpstreamMessage } from "./upstream.js";

export const PROVIDER_RECEIPT_HEADER = "x-reddi-provider-receipt";
/** The closing receipt of a session, on the answer that settled it. */
export const SESSION_RECEIPT_HEADER = "x-reddi-session-receipt";
/** On an answer that asked to close the session: settled, declined, or pending (tried again shortly). */
export const SESSION_STATE_HEADER = "x-reddi-session-state";
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const MAX_BODY_BYTES = 1_000_000;
const MAX_RECEIPT_HEADER_CHARS = 4096;

export interface ProviderDeps {
  chain: ProviderChain;
  upstream: Upstream;
  replayStore: NonceReplayStore;
  /** The session ledger. Without it, session calls are refused. */
  sessions?: MeteredSessionLedger;
  /** Ed25519 signature by the provider wallet, for receipts. */
  signMessage: (message: Uint8Array) => Uint8Array | Promise<Uint8Array>;
  now?: () => Date;
  log?: (event: Record<string, unknown>) => void;
}

const sha256Hex = (text: string) => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");

function json(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

function refuse(status: number, code: string, message: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Response {
  return json(status, { error: { code, message }, ...extra }, headers);
}

function readMessages(value: unknown): UpstreamMessage[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const messages: UpstreamMessage[] = [];
  for (const item of value) {
    const role = (item as { role?: unknown } | null)?.role;
    const content = (item as { content?: unknown } | null)?.content;
    if (typeof role !== "string" || typeof content !== "string") return undefined;
    messages.push({ role, content });
  }
  return messages;
}

/** What the listing and buyers read about this provider. No secrets. */
export function providerMetadata(config: ProviderConfig): Record<string, unknown> {
  const { terms } = config;
  return {
    protocol: "reddi-agent-protocol",
    name: config.name,
    description: config.description,
    walletAddress: config.wallet,
    network: config.network,
    endpoint: `${config.publicUrl}/v1/chat/completions`,
    model: config.model,
    acceptingPayments: !config.paused,
    pricing: {
      settlement: "metered-escrow",
      currency: terms.price.currency,
      mint: terms.mint.toBase58(),
      inputPerMillion: terms.price.inputPerMillion,
      outputPerMillion: terms.price.outputPerMillion,
      maxOutputTokens: terms.maxOutputTokens,
      escrowProgramId: terms.programId.toBase58(),
    },
  };
}

export type ProviderHandler = ((request: Request) => Promise<Response>) & {
  /** Settles sessions that are closing, idle, or near their refund window. */
  settleDueSessions(): Promise<{ status: string }[]>;
};

export function createProviderHandler(config: ProviderConfig, deps: ProviderDeps): ProviderHandler {
  const { terms } = config;
  const log = deps.log ?? (() => undefined);
  // The cluster is checked before the first lock is trusted, and again after any failure.
  let clusterConfirmed = false;
  // Buyer token accounts this provider paid to create today (UTC), against the operator's daily bound.
  const subsidy = { day: "", used: 0 };
  const today = () => (deps.now?.() ?? new Date()).toISOString().slice(0, 10);
  const subsidyLeft = () => {
    if (subsidy.day !== today()) Object.assign(subsidy, { day: today(), used: 0 });
    return config.refundAccountsPerDay - subsidy.used > 0;
  };


  type Settled = ReturnType<typeof meteredSettlement>;
  type SettleOutcome = { ok: true; settled: Settled; settleSignature?: string; confirmed: ReturnType<typeof confirmMeteredSettlement>; payout: PayoutAccounts } | { ok: false };
  type Lock = Extract<VerifiedLock, { ok: true }>;

  // "locked": the buyer's maximum is still in escrow. "closed": a settle landed. "unknown": the chain could not say.
  const escrowState = async (address: PublicKey): Promise<"locked" | "closed" | "unknown"> => {
    try {
      const account = await deps.chain.readAccount(address);
      if (!account) return "closed";
      if (!account.owner.equals(terms.programId)) return "unknown";
      return decodeTokenEscrowAccount(Buffer.from(account.data)).status === 0 ? "locked" : "closed";
    } catch {
      return "unknown";
    }
  };

  /**
   * Sends the settle `build` makes and reads back what it moved. `ok: false`
   * only when nothing was charged: the escrow was read back as still locked,
   * or no settle could be built at all.
   */
  async function settleLock(lock: Lock, escrowAddress: PublicKey, requestId: string, build: (payout: PayoutAccounts) => Settled): Promise<SettleOutcome> {
    const escrow = escrowAddress.toBase58();
    let payout = lock.payout;
    let settled: Settled | undefined;
    let settleSignature: string | undefined;
    try {
      settled = build(payout);
      settleSignature = await deps.chain.sendInstructions(settled.instructions);
    } catch {
      settleSignature = undefined;
      // A send can report failure and still land. Only an escrow read back as
      // still locked means nothing was charged; only then is the settle sent again.
      let state = await escrowState(escrowAddress);
      if (state === "locked") {
        // An account may have gone since the lock was checked. Look once more:
        // the buyer's associated token account will do for the unused part, and
        // the provider pays to create one only inside the operator's daily bound.
        // One place in today's bound is held across the reads and the send, so calls in flight together cannot pass it.
        const reserved = subsidyLeft();
        if (reserved) subsidy.used += 1;
        let created = false;
        try {
          const again = await checkMeteredPayout({ terms, escrow: lock.terms, readAccount: (address) => deps.chain.readAccount(address), allowPayerAssociatedAccount: true, createRefundAccount: reserved });
          if (again.ok) {
            payout = again.payout;
            settled = build(payout);
            settleSignature = await deps.chain.sendInstructions(settled.instructions);
            created = payout.createRefundAccount === true;
            if (created) log({ event: "refund_account_created", requestId, escrow, account: payout.refundTo.toBase58() });
          }
        } catch {
          settleSignature = undefined;
        }
        if (reserved && !created) subsidy.used = Math.max(0, subsidy.used - 1);
        if (!settleSignature) state = await escrowState(escrowAddress);
      }
      if (!settleSignature) {
        if (state === "locked" || !settled) {
          log({ event: "settle_failed", requestId, escrow });
          return { ok: false };
        }
        // The escrow is closed, so a settle landed (only this provider could close it inside the buyer's
        // refund window), or the chain cannot say. Either way the buyer may have paid, so it gets its answer.
        if (state === "closed") settleSignature = (await deps.chain.latestSuccess(escrowAddress).catch(() => null)) ?? undefined;
        log({ event: "settle_unconfirmed", requestId, escrow, state, found: settleSignature !== undefined });
      }
    }
    if (!settled) return { ok: false };

    // What the settle actually moved, from the confirmed transaction on the cluster checked before the lock was trusted.
    let confirmed: ReturnType<typeof confirmMeteredSettlement> = { ok: false, reason: "not_found" };
    if (settleSignature) {
      try {
        confirmed = confirmMeteredSettlement(await deps.chain.readSettlement(settleSignature), {
          programId: terms.programId,
          escrow: escrowAddress,
          mint: terms.mint,
          destination: payout.payTo ?? lock.terms.recipient,
          treasuryToken: payout.treasuryToken,
          refundTo: payout.refundTo,
          maxBaseUnits: lock.maxBaseUnits,
        });
      } catch {
        confirmed = { ok: false, reason: "not_found" };
      }
    }
    return { ok: true, settled, ...(settleSignature ? { settleSignature } : {}), confirmed, payout };
  }


  const nowMs = () => (deps.now?.() ?? new Date()).getTime();
  const issuedAt = () => (deps.now?.() ?? new Date()).toISOString();
  const decimals = directPaymentCurrency(terms.price.currency)!.decimals;
  const readAccount = (address: PublicKey) => deps.chain.readAccount(address);
  const readSlot = () => deps.chain.readSlot();
  const encodeReceipt = (signed: unknown): string | undefined => {
    const encoded = Buffer.from(JSON.stringify(signed), "utf8").toString("base64url");
    return encoded.length <= MAX_RECEIPT_HEADER_CHARS ? encoded : undefined;
  };

  /** The receipt's session block for `state`, the totals after this call. */
  function receiptSession(state: SessionState, call: TokenCounts, previousReceiptHash: string | undefined, closed: boolean): ReddiReceiptV2Session {
    return {
      escrow: state.escrow,
      payer: state.payer,
      network: config.network,
      currency: terms.price.currency as ReddiReceiptV2Session["currency"],
      mint: terms.mint.toBase58(),
      maxAmount: state.maxBaseUnits,
      sequence: String(state.sequence),
      inputTokens: String(call.inputTokens),
      outputTokens: String(call.outputTokens),
      cumulativeInputTokens: String(state.inputTokens),
      cumulativeOutputTokens: String(state.outputTokens),
      cumulativeCost: state.costBaseUnits,
      ...(previousReceiptHash ? { previousReceiptHash } : {}),
      closed,
    };
  }

  /** What a buyer is told about a session. */
  function sessionSummary(state: SessionState): Record<string, unknown> {
    return {
      escrow: state.escrow,
      sequence: state.sequence,
      cumulativeInputTokens: state.inputTokens,
      cumulativeOutputTokens: state.outputTokens,
      cumulativeCost: baseUnitsToDecimal(BigInt(state.costBaseUnits), decimals),
      cumulativeCostBaseUnits: state.costBaseUnits,
      maxCharge: baseUnitsToDecimal(BigInt(state.maxBaseUnits), decimals),
      maxChargeBaseUnits: state.maxBaseUnits,
      currency: terms.price.currency,
      status: state.status,
      settled: state.status === "settled",
      ...(state.settleSignature ? { settleSignature: state.settleSignature } : {}),
    };
  }

  async function sessionCall(c: { header: MeteredPaymentHeader; sequence: number; close: boolean; requestText: string; upstreamMessages: UpstreamMessage[]; temperature?: number; worstCase: TokenCounts; minimum: bigint }): Promise<Response> {
    const ledger = deps.sessions!;
    const escrow = c.header.escrow.toBase58();
    let lock: VerifiedLock;
    try {
      lock = await verifyMeteredLock({ header: c.header, terms, minimum: c.minimum, readAccount, readSlot, replayStore: deps.replayStore, purpose: "session-call" });
    } catch {
      return refuse(503, "payment_check_unavailable", "The lock could not be checked. Nothing was charged for this call; send it again.", { charged: false });
    }
    if (!lock.ok) {
      if (lock.reason === "payment_check_unavailable") clusterConfirmed = false;
      // No more calls fit before the refund window opens: settle what was served while there is time.
      if (lock.reason === "session_window_closing" && ledger.get(escrow)) void settleSession(escrow).catch(() => undefined);
      const status = lock.reason === "payment_check_unavailable" || lock.reason === "provider_not_ready" ? 503 : lock.reason === "duplicate_nonce" || lock.reason === "session_window_closing" ? 409 : 402;
      return refuse(status, lock.reason, lock.message, { charged: false });
    }
    let begun: Awaited<ReturnType<MeteredSessionLedger["begin"]>>;
    try {
      begun = await ledger.begin({ lock, escrow: c.header.escrow, sequence: c.sequence, worstCase: c.worstCase, replayStore: deps.replayStore, nowMs: nowMs() });
    } catch {
      return refuse(503, "payment_check_unavailable", "The session could not be recorded. Nothing was charged for this call; send it again.", { charged: false });
    }
    if (!begun.ok) {
      const current = ledger.get(escrow);
      return refuse(begun.reason === "session_max_reached" ? 402 : 409, begun.reason, begun.message, { charged: false, ...(current ? { session: sessionSummary(current) } : {}) });
    }
    const reservation = begun.reservation;
    const requestId = randomUUID();
    let upstream: Record<string, unknown>;
    try {
      upstream = await deps.upstream.createChatCompletion({ model: config.upstream.model, messages: c.upstreamMessages, ...(c.temperature === undefined ? {} : { temperature: c.temperature }), max_tokens: c.worstCase.outputTokens });
    } catch (error) {
      ledger.release(reservation);
      log({ event: "upstream_failed", requestId, escrow, sequence: c.sequence, detail: error instanceof Error ? error.message : "unknown" });
      return refuse(502, "model_unavailable", `The model did not answer. Nothing was charged for this call; the session stays open and call ${c.sequence} can be sent again.`, { charged: false, escrow });
    }

    const usage = usageFrom(upstream, c.worstCase.inputTokens);
    const next = ledger.preview(reservation, usage);
    const reddi = {
      requestId,
      provider: config.wallet,
      model: config.model,
      metered: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        currency: terms.price.currency,
        session: { ...sessionSummary({ ...next, status: "open" }), ...(reservation.before.lastReceiptHash ? { previousReceiptHash: reservation.before.lastReceiptHash } : {}), closeRequested: c.close },
      },
    };
    const responseText = JSON.stringify({ ...upstream, reddi });
    let encoded: string | undefined;
    let receiptHash: string | undefined;
    try {
      const signed = await signReddiReceiptV2({
        schemaVersion: "reddi.receipt.v2",
        providerId: config.wallet,
        declaredModel: config.model,
        requestHash: sha256Hex(c.requestText),
        responseHash: sha256Hex(responseText),
        session: receiptSession(next, usage, reservation.before.lastReceiptHash, false),
        issuedAt: issuedAt(),
      } as ReddiReceiptV2, deps.signMessage);
      encoded = encodeReceipt(signed);
      receiptHash = hashReddiReceiptV2(signed.receipt);
    } catch {
      encoded = undefined;
    }
    if (!encoded || !receiptHash) {
      // A session call is billed through its receipt chain, so a call without a receipt is not billed or answered.
      ledger.release(reservation);
      log({ event: "receipt_failed", requestId, escrow, sequence: c.sequence });
      return refuse(500, "receipt_failed", `This call's receipt could not be signed, so its answer is withheld. Nothing was charged for it; call ${c.sequence} can be sent again.`, { charged: false, escrow });
    }
    let recorded: Awaited<ReturnType<MeteredSessionLedger["record"]>>;
    try {
      recorded = await ledger.record(reservation, usage, receiptHash, nowMs());
    } catch {
      log({ event: "session_record_failed", requestId, escrow, sequence: c.sequence });
      return refuse(503, "session_record_failed", `This call could not be recorded, so its answer is withheld. Nothing was charged for it; call ${c.sequence} can be sent again.`, { charged: false, escrow });
    }
    log({ event: "session_call", requestId, escrow, sequence: c.sequence, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cumulativeCost: recorded.state.costBaseUnits, full: recorded.full });
    const headers: Record<string, string> = { ...JSON_HEADERS, [PROVIDER_RECEIPT_HEADER]: encoded };
    if (c.close || recorded.full) {
      const closing = await settleSession(escrow, requestId);
      headers[SESSION_STATE_HEADER] = closing.status;
      if (closing.receipt) headers[SESSION_RECEIPT_HEADER] = closing.receipt;
    }
    return new Response(responseText, { status: 200, headers });
  }

  type SessionEnd = { status: "settled" | "declined" | "pending" | "none"; receipt?: string; state?: SessionState };
  const settling = new Set<string>();

  /** The signed closing receipt of a settled session and the summary its response hash covers. */
  async function closingReceipt(state: SessionState, outcome: Extract<SettleOutcome, { ok: true }>): Promise<{ receipt: string; summary: string } | undefined> {
    if (!outcome.confirmed.ok || !outcome.settleSignature) return undefined;
    const confirmed = outcome.confirmed;
    const closingState: SessionState = { ...state, sequence: state.sequence + 1 };
    const summary = JSON.stringify({
      escrow: state.escrow,
      settleSignature: outcome.settleSignature,
      charged: baseUnitsToDecimal(confirmed.paidBaseUnits, decimals),
      fee: baseUnitsToDecimal(confirmed.feeBaseUnits, decimals),
      provider: baseUnitsToDecimal(confirmed.providerBaseUnits, decimals),
      refund: baseUnitsToDecimal(confirmed.refundedBaseUnits, decimals),
      currency: terms.price.currency,
      cumulativeInputTokens: state.inputTokens,
      cumulativeOutputTokens: state.outputTokens,
      calls: state.sequence,
    });
    try {
      const signed = await signReddiReceiptV2({
        schemaVersion: "reddi.receipt.v2",
        providerId: config.wallet,
        declaredModel: config.model,
        requestHash: sha256Hex(`session-close:${state.escrow}:${closingState.sequence}`),
        responseHash: sha256Hex(summary),
        payment: {
          network: config.network,
          txSignature: outcome.settleSignature,
          currency: terms.price.currency,
          mint: terms.mint.toBase58(),
          amount: confirmed.paidBaseUnits.toString(),
          fee: confirmed.feeBaseUnits > 0n ? { amount: confirmed.feeBaseUnits.toString(), treasury: ESCROW_PROTOCOL_TREASURY.toBase58() } : { amount: "0" },
          payer: state.payer,
          settlement: "metered-escrow",
          metered: { inputTokens: String(state.inputTokens), outputTokens: String(state.outputTokens), maxAmount: state.maxBaseUnits, refunded: confirmed.refundedBaseUnits.toString() },
        },
        session: receiptSession(closingState, { inputTokens: 0, outputTokens: 0 }, state.lastReceiptHash, true),
        issuedAt: issuedAt(),
      } as ReddiReceiptV2, deps.signMessage);
      const receipt = encodeReceipt(signed);
      return receipt ? { receipt, summary } : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Ends a session: stops new calls, then settles the ledger's total (or, when
   * no call was recorded, declines the lock so the buyer gets it all back).
   * `pending` means nothing was charged yet and it will be tried again: a call
   * is running, the chain could not be read, or the settle did not land.
   */
  async function settleSession(escrow: string, requestId: string = randomUUID()): Promise<SessionEnd> {
    const ledger = deps.sessions;
    if (!ledger) return { status: "none" };
    if (settling.has(escrow)) return { status: "pending" };
    settling.add(escrow);
    try {
      const state = await ledger.close(escrow).catch(() => undefined);
      if (!state) return { status: ledger.get(escrow) ? "pending" : "none" };
      const kept = state.closingReceipt as { receipt?: string } | undefined;
      if (state.status === "settled" || state.status === "declined") return { status: state.status, state, ...(kept?.receipt ? { receipt: kept.receipt } : {}) };
      if (!clusterConfirmed) {
        const cluster = await checkProviderCluster(() => deps.chain.readGenesisHash(), config.network, config.genesisHash);
        if (!cluster.ok) return { status: "pending", state };
        clusterConfirmed = true;
      }
      const header = sessionPaymentHeader(state);
      let lock: VerifiedLock;
      try {
        lock = await verifyMeteredLock({ header, terms, minimum: 0n, readAccount, readSlot, replayStore: deps.replayStore, purpose: "session-settle" });
      } catch {
        return { status: "pending", state };
      }
      if (!lock.ok) {
        // The escrow is no longer locked: settled before a restart could record it, or refunded by the buyer.
        if ((await escrowState(header.escrow)) === "closed") {
          const signature = (await deps.chain.latestSuccess(header.escrow).catch(() => null)) ?? undefined;
          log({ event: "session_lock_gone", escrow, ...(signature ? { signature } : {}), cumulativeCost: state.costBaseUnits });
          await ledger.finish(escrow, { status: signature ? "settled" : "declined", ...(signature ? { signature } : {}) }).catch(() => undefined);
          return { status: signature ? "settled" : "declined", state };
        }
        if (lock.reason === "payment_check_unavailable") clusterConfirmed = false;
        log({ event: "session_settle_waiting", escrow, reason: lock.reason });
        return { status: "pending", state };
      }
      if (BigInt(state.costBaseUnits) === 0n) {
        try {
          const signature = await deps.chain.sendInstructions([meteredDecline(terms, lock)]);
          await ledger.finish(escrow, { status: "declined", signature });
          log({ event: "session_declined", escrow, signature });
          return { status: "declined", state };
        } catch {
          return { status: "pending", state };
        }
      }
      const outcome = await settleLock(lock, header.escrow, requestId, (payout) => sessionSettlement(terms, lock as Lock, state, payout));
      if (!outcome.ok) {
        log({ event: "session_settle_failed", escrow });
        return { status: "pending", state };
      }
      const closing = await closingReceipt(state, outcome);
      if (!closing) log({ event: "receipt_withheld", requestId, escrow, ...(outcome.settleSignature ? { settleSignature: outcome.settleSignature } : {}), reason: outcome.confirmed.ok ? "not_signed" : outcome.confirmed.reason });
      await ledger.finish(escrow, { status: "settled", ...(outcome.settleSignature ? { signature: outcome.settleSignature } : {}), ...(closing ? { closingReceipt: closing } : {}) }).catch(() => undefined);
      log({ event: "session_settled", requestId, escrow, calls: state.sequence, charged: state.costBaseUnits, ...(outcome.settleSignature ? { settleSignature: outcome.settleSignature } : {}), confirmed: outcome.confirmed.ok, receipt: closing !== undefined });
      return { status: "settled", state, ...(closing ? { receipt: closing.receipt } : {}) };
    } finally {
      settling.delete(escrow);
    }
  }

  /** Settles every session that is closing, idle, or near its refund window. The server calls this on a timer. */
  async function settleDueSessions(): Promise<SessionEnd[]> {
    const ledger = deps.sessions;
    if (!ledger) return [];
    let slot = 0n;
    try {
      slot = BigInt(await deps.chain.readSlot());
    } catch {
      // Without the slot, only closing and idle sessions are found; a near window is caught next time.
    }
    const ended: SessionEnd[] = [];
    for (const state of ledger.due(nowMs(), slot, config.sessions.idleMs)) ended.push(await settleSession(state.escrow));
    return ended;
  }

  async function closeRequest(request: Request): Promise<Response> {
    const header = readMeteredPaymentHeader(request.headers);
    if (!header || "error" in header) return refuse(400, "invalid_receipt", "Name the session's lock in x402-payment.");
    if (!deps.sessions) return refuse(400, "sessions_not_offered", "This provider settles each call on its own.");
    if (!tokenEscrowAddresses({ programId: terms.programId, payer: header.payer, nonce: header.nonce }).escrow.equals(header.escrow)) {
      return refuse(400, "invalid_receipt", "The escrow address is not the one this payer and nonce give.");
    }
    const escrow = header.escrow.toBase58();
    const end = await settleSession(escrow);
    if (end.status === "none") return refuse(404, "session_not_found", "No session is open on this lock.");
    const state = deps.sessions.get(escrow);
    return json(end.status === "pending" ? 202 : 200, { ok: end.status !== "pending", status: end.status, session: state ? sessionSummary(state) : undefined }, end.receipt ? { [SESSION_RECEIPT_HEADER]: end.receipt } : {});
  }

  function sessionRead(escrowText: string): Response {
    if (!deps.sessions) return refuse(404, "session_not_found", "This provider has no sessions.");
    let escrow: string;
    try {
      escrow = new PublicKey(escrowText).toBase58();
    } catch {
      return refuse(400, "invalid_request", "Name the escrow by its address.");
    }
    const state = deps.sessions.get(escrow);
    if (!state) return refuse(404, "session_not_found", "No session on that escrow.");
    const kept = state.closingReceipt as { receipt?: string; summary?: string } | undefined;
    return json(200, { session: sessionSummary(state), ...(kept?.receipt ? { closing: { summary: kept.summary, receipt: kept.receipt } } : {}) });
  }

  async function paidChat(request: Request): Promise<Response> {
    if (config.paused) {
      return refuse(503, "currency_paused", `This provider is not taking new payments in ${terms.price.currency} for now. Nothing was accepted; a lock you already made can be refunded once its refund window opens.`, { charged: false });
    }
    const lengthHeader = Number(request.headers.get("content-length") ?? "0");
    if (lengthHeader > MAX_BODY_BYTES) return refuse(413, "request_too_large", "The request body is too large.");
    const requestText = await request.text().catch(() => "");
    if (Buffer.byteLength(requestText, "utf8") > MAX_BODY_BYTES) return refuse(413, "request_too_large", "The request body is too large.");
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(requestText);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
      body = parsed as Record<string, unknown>;
    } catch {
      return refuse(400, "invalid_request", "Send the request as a JSON object.");
    }
    const messages = readMessages(body.messages);
    if (!messages) return refuse(400, "invalid_request", "messages must be a list of { role, content } with text content.");
    if (body.stream === true) return refuse(400, "streaming_not_supported", "This provider does not stream. Send the request without stream.");
    const requestedMax = typeof body.max_tokens === "number" ? body.max_tokens : typeof body.max_completion_tokens === "number" ? body.max_completion_tokens : undefined;
    const temperature = typeof body.temperature === "number" && Number.isFinite(body.temperature) ? body.temperature : undefined;

    // What the model will actually be sent. The quote and the minimum lock are
    // worked out on this, so a system prompt's tokens are priced in up front.
    const upstreamMessages = config.systemPrompt ? [{ role: "system", content: config.systemPrompt }, ...messages.filter((m) => m.role !== "system")] : messages;
    const offer = meteredOffer(terms, upstreamMessages, requestedMax, config.network);
    const header = readMeteredPaymentHeader(request.headers);
    if (header === undefined) {
      return refuse(402, "payment_required", "Lock at least the minimum in a metered escrow payable to this provider, then repeat the request with the lock in x402-payment.", { metered: offer }, { "x402-request": JSON.stringify(offer) });
    }
    if ("error" in header) return refuse(402, "invalid_receipt", header.error, { metered: offer });

    if (!clusterConfirmed) {
      const cluster = await checkProviderCluster(() => deps.chain.readGenesisHash(), config.network, config.genesisHash);
      if (!cluster.ok) {
        log({ event: "cluster_check_failed", reason: cluster.reason });
        return refuse(503, cluster.reason, cluster.reason === "wrong_cluster" ? "This provider's chain connection is misconfigured. Nothing was accepted." : cluster.message, { charged: false });
      }
      clusterConfirmed = true;
    }

    const outputTokens = outputLimit(terms, requestedMax);
    const inputEstimate = estimateInputTokens(upstreamMessages);
    const minimum = tokenCostBaseUnits(terms.price, { inputTokens: inputEstimate, outputTokens });
    const sessionHeaders = readSessionHeaders(request.headers);
    if (sessionHeaders !== undefined) {
      if ("error" in sessionHeaders) return refuse(400, "session_invalid", sessionHeaders.error, { charged: false });
      if (!deps.sessions) return refuse(400, "sessions_not_offered", "This provider settles each call on its own. Send the call without x402-session-sequence.", { charged: false });
      return sessionCall({ header, sequence: sessionHeaders.sequence, close: sessionHeaders.close, requestText, upstreamMessages, temperature, worstCase: { inputTokens: inputEstimate, outputTokens }, minimum });
    }
    let lock: Awaited<ReturnType<typeof verifyMeteredLock>>;
    try {
      lock = await verifyMeteredLock({ header, terms, minimum, readAccount: (address) => deps.chain.readAccount(address), readSlot: () => deps.chain.readSlot(), replayStore: deps.replayStore });
    } catch {
      // The replay store could not record the escrow, so it cannot be accepted.
      return refuse(503, "payment_check_unavailable", "The payment could not be recorded. Nothing was accepted; present the same lock again.", { charged: false });
    }
    if (!lock.ok) {
      if (lock.reason === "payment_check_unavailable") clusterConfirmed = false;
      const status = lock.reason === "payment_check_unavailable" || lock.reason === "provider_not_ready" ? 503 : lock.reason === "duplicate_nonce" ? 409 : 402;
      if (lock.reason === "provider_not_ready") log({ event: "payout_not_ready", escrow: header.escrow.toBase58() });
      return refuse(status, lock.reason, lock.message, { metered: offer, charged: false });
    }
    const escrow = header.escrow.toBase58();
    const requestId = randomUUID();

    let upstream: Record<string, unknown>;
    try {
      upstream = await deps.upstream.createChatCompletion({ model: config.upstream.model, messages: upstreamMessages, ...(temperature === undefined ? {} : { temperature }), max_tokens: outputTokens });
    } catch (error) {
      // No work was delivered, so the provider gives the whole lock back.
      let declineSignature: string | undefined;
      try {
        declineSignature = await deps.chain.sendInstructions([meteredDecline(terms, lock)]);
      } catch {
        declineSignature = undefined;
      }
      log({ event: "upstream_failed", requestId, escrow, declined: declineSignature !== undefined, detail: error instanceof Error ? error.message : "unknown" });
      return refuse(502, "model_unavailable", declineSignature
        ? "The model did not answer. Nothing was charged and your lock was refunded in full."
        : `The model did not answer. Nothing was charged; your maximum stays locked in escrow ${escrow} and you can refund it once its refund window opens.`,
        { charged: false, escrow, ...(declineSignature ? { refundSignature: declineSignature } : {}) });
    }

    const usage = usageFrom(upstream, inputEstimate);
    const outcome = await settleLock(lock, header.escrow, requestId, (payout) => meteredSettlement(terms, lock, usage, payout));
    if (!outcome.ok) return refuse(502, "settle_failed", `The payment could not be settled, so the answer is withheld. Nothing was charged; your maximum stays locked in escrow ${escrow} and you can refund it once its refund window opens.`, { charged: false, escrow });
    const { settled, settleSignature, confirmed, payout } = outcome;
    const s = settled.settlement;
    const decimals = directPaymentCurrency(s.currency)!.decimals;
    const amounts = confirmed.ok
      ? {
          charged: baseUnitsToDecimal(confirmed.paidBaseUnits, decimals),
          fee: baseUnitsToDecimal(confirmed.feeBaseUnits, decimals),
          provider: baseUnitsToDecimal(confirmed.providerBaseUnits, decimals),
          refund: baseUnitsToDecimal(confirmed.refundedBaseUnits, decimals),
        }
      : { charged: s.charged, fee: s.fee, provider: s.provider, refund: s.refund };
    const reddi = {
      requestId,
      provider: config.wallet,
      model: config.model,
      // Token counts are the model's report. The amounts are the confirmed settle's when `confirmed` is true, and otherwise what the settle asked for.
      metered: { inputTokens: s.inputTokens, outputTokens: s.outputTokens, currency: s.currency, ...amounts, capped: s.capped, ...(settleSignature ? { settleSignature } : {}), confirmed: confirmed.ok },
    };
    const responseText = JSON.stringify({ ...upstream, reddi });

    let receiptHeader: string | undefined;
    if (confirmed.ok && settleSignature) {
      try {
        const statement = {
          schemaVersion: "reddi.receipt.v2",
          providerId: config.wallet,
          declaredModel: config.model,
          requestHash: sha256Hex(requestText),
          responseHash: sha256Hex(responseText),
          payment: {
            network: config.network,
            txSignature: settleSignature,
            currency: s.currency,
            mint: terms.mint.toBase58(),
            amount: confirmed.paidBaseUnits.toString(),
            fee: confirmed.feeBaseUnits > 0n ? { amount: confirmed.feeBaseUnits.toString(), treasury: ESCROW_PROTOCOL_TREASURY.toBase58() } : { amount: "0" },
            payer: lock.payer.toBase58(),
            settlement: "metered-escrow",
            metered: { inputTokens: String(s.inputTokens), outputTokens: String(s.outputTokens), maxAmount: lock.maxBaseUnits.toString(), refunded: confirmed.refundedBaseUnits.toString() },
          },
          issuedAt: (deps.now?.() ?? new Date()).toISOString(),
        } as ReddiReceiptV2;
        const signed = await signReddiReceiptV2(statement, deps.signMessage);
        const encoded = Buffer.from(JSON.stringify(signed), "utf8").toString("base64url");
        if (encoded.length <= MAX_RECEIPT_HEADER_CHARS) receiptHeader = encoded;
      } catch {
        // The buyer still gets the answer the settle paid for.
        log({ event: "receipt_failed", requestId, escrow });
      }
    } else {
      // The settle confirmed, but what it moved could not be read back. No financial statement is signed on a guess.
      log({ event: "receipt_withheld", requestId, escrow, ...(settleSignature ? { settleSignature } : {}), reason: confirmed.ok ? "not_found" : confirmed.reason });
    }
    log({ event: "paid_call", requestId, escrow, ...(settleSignature ? { settleSignature } : {}), charged: amounts.charged, fee: amounts.fee, confirmed: confirmed.ok, currency: s.currency, inputTokens: s.inputTokens, outputTokens: s.outputTokens, receipt: receiptHeader !== undefined });
    return new Response(responseText, { status: 200, headers: receiptHeader ? { ...JSON_HEADERS, [PROVIDER_RECEIPT_HEADER]: receiptHeader } : JSON_HEADERS });
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/v1/session/close") {
      try {
        return await closeRequest(request);
      } catch {
        log({ event: "unexpected_error" });
        return refuse(500, "internal_error", "The provider hit an unexpected error.");
      }
    }
    if (request.method === "GET" && url.pathname.startsWith("/v1/session/")) return sessionRead(decodeURIComponent(url.pathname.slice("/v1/session/".length)));
    if (request.method === "GET" && url.pathname === "/healthz") return json(200, { ok: true, name: config.name, network: config.network, acceptingPayments: !config.paused });
    if (request.method === "GET" && url.pathname === "/v1/models") return json(200, { object: "list", data: [{ id: config.model, object: "model", owned_by: config.wallet }] });
    if (request.method === "GET" && url.pathname === "/.well-known/reddi-agent.json") return json(200, providerMetadata(config));
    if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
      try {
        return await paidChat(request);
      } catch {
        log({ event: "unexpected_error" });
        return refuse(500, "internal_error", "The provider hit an unexpected error.");
      }
    }
    return refuse(404, "not_found", "No such route.");
  }
  return Object.assign(handle, { settleDueSessions });
}
