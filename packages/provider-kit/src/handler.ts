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
 * Order matters for money. The buyer is charged only after the model has
 * answered, and the answer is sent only after the settle has confirmed. If the
 * model fails the lock is declined, which refunds the buyer in full.
 */
import { createHash, randomUUID } from "node:crypto";
import { signReddiReceiptV2, type ReddiReceiptV2 } from "@reddi/agent-protocol/receipt-v2";
import {
  checkProviderCluster,
  decimalToBaseUnits,
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

  async function paidChat(request: Request): Promise<Response> {
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
      return refuse(lock.reason === "payment_check_unavailable" ? 503 : lock.reason === "duplicate_nonce" ? 409 : 402, lock.reason, lock.message, { metered: offer, charged: false });
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
    let settled: ReturnType<typeof meteredSettlement>;
    let settleSignature: string;
    try {
      settled = meteredSettlement(terms, lock, usage);
      settleSignature = await deps.chain.sendInstructions(settled.instructions);
    } catch {
      log({ event: "settle_failed", requestId, escrow });
      return refuse(502, "settle_failed", `The payment could not be settled, so the answer is withheld. Nothing was charged; your maximum stays locked in escrow ${escrow} and you can refund it once its refund window opens.`, { charged: false, escrow });
    }

    const s = settled.settlement;
    const reddi = {
      requestId,
      provider: config.wallet,
      model: config.model,
      metered: { inputTokens: s.inputTokens, outputTokens: s.outputTokens, currency: s.currency, charged: s.charged, fee: s.fee, provider: s.provider, refund: s.refund, capped: s.capped, settleSignature },
    };
    const responseText = JSON.stringify({ ...upstream, reddi });

    let receiptHeader: string | undefined;
    try {
      const decimals = directPaymentCurrency(s.currency)!.decimals;
      const fee = decimalToBaseUnits(s.fee, decimals) ?? BigInt(0);
      const refunded = decimalToBaseUnits(s.refund, decimals) ?? BigInt(0);
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
          amount: s.chargedBaseUnits.toString(),
          fee: fee > BigInt(0) ? { amount: fee.toString(), treasury: ESCROW_PROTOCOL_TREASURY.toBase58() } : { amount: "0" },
          payer: lock.payer.toBase58(),
          settlement: "metered-escrow",
          metered: { inputTokens: String(s.inputTokens), outputTokens: String(s.outputTokens), maxAmount: lock.maxBaseUnits.toString(), refunded: refunded.toString() },
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
    log({ event: "paid_call", requestId, escrow, settleSignature, charged: s.charged, fee: s.fee, currency: s.currency, inputTokens: s.inputTokens, outputTokens: s.outputTokens, receipt: receiptHeader !== undefined });
    return new Response(responseText, { status: 200, headers: receiptHeader ? { ...JSON_HEADERS, [PROVIDER_RECEIPT_HEADER]: receiptHeader } : JSON_HEADERS });
  }

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/healthz") return json(200, { ok: true, name: config.name, network: config.network });
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
