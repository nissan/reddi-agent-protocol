/**
 * The provider's HTTP surface.
 *
 *   GET  /healthz                       liveness
 *   GET  /v1/models                     the declared model
 *   GET  /.well-known/reddi-agent.json  name, wallet, network and per-token price
 *   POST /v1/chat/completions           OpenAI-compatible, paid per token
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
 * when that cannot be read, no receipt is issued.
 */
import { createHash, randomUUID } from "node:crypto";
import { signReddiReceiptV2, type ReddiReceiptV2 } from "@reddi/agent-protocol/receipt-v2";
import {
  baseUnitsToDecimal,
  checkMeteredPayout,
  checkProviderCluster,
  confirmMeteredSettlement,
  directPaymentCurrency,
  ESCROW_PROTOCOL_TREASURY,
  estimateInputTokens,
  meteredDecline,
  meteredOffer,
  meteredSettlement,
  outputLimit,
  readMeteredPaymentHeader,
  tokenCostBaseUnits,
  usageFrom,
  verifyMeteredLock,
  type NonceReplayStore,
} from "@reddi/x402-solana";
import type { ProviderChain } from "./chain.js";
import type { ProviderConfig } from "./config.js";
import type { Upstream, UpstreamMessage } from "./upstream.js";

export const PROVIDER_RECEIPT_HEADER = "x-reddi-provider-receipt";
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const MAX_BODY_BYTES = 1_000_000;
const MAX_RECEIPT_HEADER_CHARS = 4096;

export interface ProviderDeps {
  chain: ProviderChain;
  upstream: Upstream;
  replayStore: NonceReplayStore;
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

export function createProviderHandler(config: ProviderConfig, deps: ProviderDeps): (request: Request) => Promise<Response> {
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
    let payout = lock.payout;
    let settled: ReturnType<typeof meteredSettlement> | undefined;
    let settleSignature: string | undefined;
    try {
      settled = meteredSettlement(terms, lock, usage, payout);
      settleSignature = await deps.chain.sendInstructions(settled.instructions);
    } catch {
      // An account may have gone since the lock was checked. Look once more:
      // the buyer's associated token account will do for the unused part, and
      // the provider pays to create one only inside the operator's daily bound.
      settleSignature = undefined;
      // One place in today's bound is held across the reads and the send, so calls in flight together cannot pass it.
      const reserved = subsidyLeft();
      if (reserved) subsidy.used += 1;
      let created = false;
      try {
        const again = await checkMeteredPayout({ terms, escrow: lock.terms, readAccount: (address) => deps.chain.readAccount(address), allowPayerAssociatedAccount: true, createRefundAccount: reserved });
        if (again.ok) {
          payout = again.payout;
          settled = meteredSettlement(terms, lock, usage, payout);
          settleSignature = await deps.chain.sendInstructions(settled.instructions);
          created = payout.createRefundAccount === true;
          if (created) log({ event: "refund_account_created", requestId, escrow, account: payout.refundTo.toBase58() });
        }
      } catch {
        settleSignature = undefined;
      }
      if (reserved && !created) subsidy.used = Math.max(0, subsidy.used - 1);
    }
    if (!settled || !settleSignature) {
      log({ event: "settle_failed", requestId, escrow });
      return refuse(502, "settle_failed", `The payment could not be settled, so the answer is withheld. Nothing was charged; your maximum stays locked in escrow ${escrow} and you can refund it once its refund window opens.`, { charged: false, escrow });
    }

    // What the settle actually moved, from the confirmed transaction on the cluster checked above.
    let confirmed: ReturnType<typeof confirmMeteredSettlement> = { ok: false, reason: "not_found" };
    try {
      confirmed = confirmMeteredSettlement(await deps.chain.readSettlement(settleSignature), {
        programId: terms.programId,
        escrow: header.escrow,
        mint: terms.mint,
        destination: payout.payTo ?? lock.terms.recipient,
        treasuryToken: payout.treasuryToken,
        refundTo: payout.refundTo,
        maxBaseUnits: lock.maxBaseUnits,
      });
    } catch {
      confirmed = { ok: false, reason: "not_found" };
    }

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
      metered: { inputTokens: s.inputTokens, outputTokens: s.outputTokens, currency: s.currency, ...amounts, capped: s.capped, settleSignature, confirmed: confirmed.ok },
    };
    const responseText = JSON.stringify({ ...upstream, reddi });

    let receiptHeader: string | undefined;
    if (confirmed.ok) {
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
      log({ event: "receipt_withheld", requestId, escrow, settleSignature, reason: confirmed.reason });
    }
    log({ event: "paid_call", requestId, escrow, settleSignature, charged: amounts.charged, fee: amounts.fee, confirmed: confirmed.ok, currency: s.currency, inputTokens: s.inputTokens, outputTokens: s.outputTokens, receipt: receiptHeader !== undefined });
    return new Response(responseText, { status: 200, headers: receiptHeader ? { ...JSON_HEADERS, [PROVIDER_RECEIPT_HEADER]: receiptHeader } : JSON_HEADERS });
  }

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
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
  };
}
