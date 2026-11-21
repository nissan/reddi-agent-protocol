/**
 * Devnet sandbox gateway: an OpenAI-style chat completion endpoint that answers
 * from a script, charges per call with an x402 challenge, and returns a signed
 * receipt in a response header: `reddi.receipt.v2` for a devnet transfer, the
 * sandbox simulated form for a simulated payment.
 *
 * Server-side only. It is pinned to Solana devnet whatever network profile the
 * app runs with, holds no wallet, and submits no transaction: a visitor either
 * presents a simulated payment or a devnet transfer their own wallet signed.
 */
import {
  buildX402Challenge,
  parseX402PaymentHeader,
  SolanaReceiptVerifier,
  SOLANA_GENESIS_HASHES,
  verifyDemoPaymentReceipt,
  type NonceReplayStore,
  type ParsedTransactionConnection,
  type ReceiptVerificationResult,
  type X402Challenge,
} from "@reddi/x402-solana";
import {
  findSandboxProviderByModel,
  SANDBOX_CURRENCY,
  SANDBOX_ENDPOINT_PATH,
  SANDBOX_NETWORK,
  SANDBOX_PROVIDERS,
  scriptedSandboxAnswer,
  simulatedSpotCheck,
  type SandboxProvider,
  type SandboxSpotCheck,
} from "./catalog";
import { sandboxProviderAddress, signAsSandboxProvider } from "./keys";
import { countTokens, formatUnits, maxChargeLamports, requestInputTokens, SANDBOX_FEE_TREASURY, settleSandboxCall } from "./pricing";
import {
  canonicalizeSandboxReceipt,
  encodeReceiptHeader,
  PROVIDER_RECEIPT_HEADER,
  REDDI_RECEIPT_V2_VERSION,
  SANDBOX_PROOF_TYPE,
  SANDBOX_SIMULATED_RECEIPT_HEADER,
  SANDBOX_SIMULATED_RECEIPT_VERSION,
  sha256Hex,
  type SandboxChatMessage,
  type SandboxReceipt,
  type SandboxReceiptBody,
} from "./receipt";

export const SANDBOX_MAX_MESSAGES = 16;
export const SANDBOX_MAX_PROMPT_CHARS = 8000;
export const SANDBOX_MAX_TRANSACTION_AGE_SECONDS = 900;
const NONCE_PATTERN = /^[0-9a-f]{32}$/;
const SIMULATED_PAYER_ID = "sandbox-visitor";

export type SandboxGatewayDeps = {
  /** Devnet RPC used only to read a visitor's own transfer. */
  connection: ParsedTransactionConnection;
  replayStore: NonceReplayStore;
  now?: () => number;
  newNonce?: () => string;
};

export type SandboxGatewayResponse = {
  status: number;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  /** The exact response body bytes, as text. A receipt's responseHash covers these. */
  bodyText: string;
};

export type SandboxGatewayRequest = {
  body: unknown;
  /** The request body bytes as received, as text. A receipt's requestHash covers these. */
  rawBody: string;
  /** Raw value of the x402-payment (or x-payment) header, if any. */
  paymentHeader?: string | null;
  /** Origin the endpoint is served from, used in the challenge. */
  origin: string;
};

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function respond(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}): SandboxGatewayResponse {
  return { status, headers: { ...JSON_HEADERS, ...headers }, body, bodyText: JSON.stringify(body) };
}

function failure(status: number, code: string, message: string, extra: Record<string, unknown> = {}): SandboxGatewayResponse {
  return respond(status, { error: { code, message }, ...extra });
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type ParsedBody = { provider: SandboxProvider; messages: SandboxChatMessage[]; model: string };

function parseBody(body: unknown): ParsedBody | SandboxGatewayResponse {
  if (!body || typeof body !== "object" || Array.isArray(body)) return failure(400, "invalid_request", "Request body must be a JSON object with model and messages.");
  const record = body as Record<string, unknown>;
  if (record.stream === true) return failure(400, "invalid_request", "The sandbox does not stream. Send the request without stream.");
  if (typeof record.model !== "string") return failure(400, "invalid_request", "model is required.");
  const provider = findSandboxProviderByModel(record.model);
  if (!provider) {
    return failure(404, "model_not_found", `Unknown sandbox model. Listed models: ${SANDBOX_PROVIDERS.map((entry) => entry.model).join(", ")}.`);
  }
  if (!Array.isArray(record.messages) || record.messages.length === 0 || record.messages.length > SANDBOX_MAX_MESSAGES) {
    return failure(400, "invalid_request", `messages must hold between 1 and ${SANDBOX_MAX_MESSAGES} entries.`);
  }
  const messages: SandboxChatMessage[] = [];
  let total = 0;
  for (const entry of record.messages) {
    const message = entry as { role?: unknown; content?: unknown } | null;
    if (!message || typeof message.role !== "string" || typeof message.content !== "string") {
      return failure(400, "invalid_request", "Each message needs a string role and string content.");
    }
    total += message.content.length + message.role.length;
    messages.push({ role: message.role, content: message.content });
  }
  if (total > SANDBOX_MAX_PROMPT_CHARS) return failure(400, "invalid_request", `Messages are limited to ${SANDBOX_MAX_PROMPT_CHARS} characters in the sandbox.`);
  return { provider, messages, model: record.model };
}

/**
 * The challenge asks for the most this call can cost: the request's input
 * tokens plus the provider's full output limit, at the listed per-token price.
 */
export function sandboxChallenge(provider: SandboxProvider, origin: string, nonce: string, inputTokens: number): X402Challenge {
  return buildX402Challenge({
    version: "1",
    network: SANDBOX_NETWORK,
    payTo: provider.payTo,
    amount: formatUnits(maxChargeLamports(provider, inputTokens), 9),
    currency: SANDBOX_CURRENCY,
    endpoint: `${origin}${SANDBOX_ENDPOINT_PATH}`,
    nonce,
    memo: `rap-sandbox:${provider.id}`,
  });
}

type PaymentOutcome =
  | { ok: true; mode: "simulated"; nonce: string; payerId: string; proofRef: string }
  | { ok: true; mode: "devnet-transfer"; nonce: string; payerId: string; payerAddress: string; proofRef: string }
  | { ok: false; result: Extract<ReceiptVerificationResult, { ok: false }> };

function rejected(reason: Extract<ReceiptVerificationResult, { ok: false }>["reason"], message: string, expected?: unknown, actual?: unknown): PaymentOutcome {
  return { ok: false, result: { ok: false, reason, message, expected, actual } };
}

/**
 * Checks a presented payment against the terms the catalog sets for the provider.
 * The challenge is rebuilt from the catalog and the presented nonce, so a caller
 * cannot choose its own price or payee.
 */
async function verifySandboxPayment(header: string, provider: SandboxProvider, origin: string, inputTokens: number, deps: SandboxGatewayDeps): Promise<PaymentOutcome> {
  const parsed = parseX402PaymentHeader(header);

  if (typeof parsed === "string") {
    if (!parsed.startsWith("demo:")) return rejected("invalid_receipt", "x402-payment must be demo:<nonce> or a JSON payment receipt.");
    const nonce = parsed.slice("demo:".length);
    if (!NONCE_PATTERN.test(nonce)) return rejected("invalid_nonce", "Use the nonce from the 402 challenge.");
    const result = await verifyDemoPaymentReceipt({ receipt: parsed, challenge: sandboxChallenge(provider, origin, nonce, inputTokens), allowDemoPayment: true, replayStore: deps.replayStore });
    return result.ok ? { ok: true, mode: "simulated", nonce, payerId: SIMULATED_PAYER_ID, proofRef: `simulated:${nonce}` } : { ok: false, result };
  }

  if (!parsed || typeof parsed !== "object") return rejected("invalid_receipt", "x402-payment is not a payment receipt.");
  const record = parsed as Record<string, unknown>;
  const nonce = typeof record.nonce === "string" ? record.nonce : "";
  if (!NONCE_PATTERN.test(nonce)) return rejected("invalid_nonce", "Use the nonce from the 402 challenge.");
  const challenge = sandboxChallenge(provider, origin, nonce, inputTokens);

  if (record.simulated === true) {
    // A simulated payment states its own terms so the sandbox can show what a
    // wrong amount or payee runs into. No transaction exists behind it.
    if (record.network !== challenge.network) return rejected("wrong_network", "receipt network does not match challenge", challenge.network, record.network);
    if (record.payTo !== challenge.payTo) return rejected("wrong_payee", "receipt payee does not match challenge", challenge.payTo, record.payTo);
    if (String(record.amount) !== String(challenge.amount)) return rejected("wrong_amount", "receipt amount does not match challenge", challenge.amount, record.amount);
    if (record.currency !== challenge.currency) return rejected("wrong_currency", "receipt currency does not match challenge", challenge.currency, record.currency);
    if (!(await deps.replayStore.checkAndStore(nonce))) return rejected("duplicate_nonce", "receipt nonce has already been used", undefined, nonce);
    return { ok: true, mode: "simulated", nonce, payerId: SIMULATED_PAYER_ID, proofRef: `simulated:${nonce}` };
  }

  if (typeof record.payer !== "string" || record.payer.length === 0) return rejected("invalid_receipt", "A devnet payment receipt must name the paying wallet in payer.");
  const verifier = new SolanaReceiptVerifier({
    allowRealPayment: true,
    connection: deps.connection,
    expectedGenesisHash: SOLANA_GENESIS_HASHES[SANDBOX_NETWORK],
    maxTransactionAgeSeconds: SANDBOX_MAX_TRANSACTION_AGE_SECONDS,
    now: deps.now,
  });
  let result: ReceiptVerificationResult;
  try {
    result = await verifier.verifyReceipt(parsed, challenge, deps.replayStore);
  } catch {
    return rejected("unsupported_receipt", "The devnet RPC could not be read. Nothing was accepted; present the same receipt again shortly.");
  }
  if (!result.ok) return { ok: false, result };
  const signature = result.receipt.signature ?? result.receipt.txSignature;
  if (!signature) return rejected("invalid_receipt", "receipt signature is required");
  return { ok: true, mode: "devnet-transfer", nonce, payerId: record.payer, payerAddress: record.payer, proofRef: signature };
}

async function writeReceipt(input: {
  provider: SandboxProvider;
  requestBody: string;
  responseBody: string;
  payment: Extract<PaymentOutcome, { ok: true }>;
  inputTokens: number;
  answer: string;
  issuedAt: string;
}): Promise<SandboxReceipt> {
  const { provider, payment } = input;
  const maxAmount = maxChargeLamports(provider, input.inputTokens);
  const paid = payment.mode === "devnet-transfer";
  // A devnet transfer paid the maximum straight to the provider: the receipt
  // states that, with no fee and no refund, because nothing else happened on
  // chain. A simulated call shows what the metered escrow does on V1: settle
  // the actual tokens, take the 2.5% fee, return the rest of the maximum.
  const settled = settleSandboxCall(provider, { inputTokens: input.inputTokens, outputTokens: countTokens(input.answer) }, maxAmount);
  const receipt: SandboxReceiptBody = {
    schemaVersion: paid ? REDDI_RECEIPT_V2_VERSION : SANDBOX_SIMULATED_RECEIPT_VERSION,
    providerId: await sandboxProviderAddress(provider.id),
    declaredModel: provider.model,
    requestHash: await sha256Hex(input.requestBody),
    responseHash: await sha256Hex(input.responseBody),
    payment: {
      network: SANDBOX_NETWORK,
      ...(paid ? { txSignature: payment.proofRef } : {}),
      currency: SANDBOX_CURRENCY,
      ...(paid
        ? { amount: maxAmount.toString(), fee: { amount: "0" }, payer: payment.payerAddress, settlement: "direct" as const }
        : {
            amount: settled.amount.toString(),
            fee: settled.fee > BigInt(0) ? { amount: settled.fee.toString(), treasury: SANDBOX_FEE_TREASURY } : { amount: "0" },
            settlement: "metered-escrow" as const,
            metered: {
              inputTokens: String(settled.usage.inputTokens),
              outputTokens: String(settled.usage.outputTokens),
              maxAmount: settled.maxAmount.toString(),
              refunded: settled.refunded.toString(),
            },
          }),
    },
    issuedAt: input.issuedAt,
  };
  const signed = await signAsSandboxProvider(provider.id, canonicalizeSandboxReceipt(receipt));
  return { receipt, proof: { type: SANDBOX_PROOF_TYPE, signature: signed.signature } };
}

export async function handleSandboxChatCompletion(request: SandboxGatewayRequest, deps: SandboxGatewayDeps): Promise<SandboxGatewayResponse> {
  const parsed = parseBody(request.body);
  if ("status" in parsed) return parsed;
  const { provider, messages, model } = parsed;

  if (provider.behaviour === "offline") {
    // Checked before any challenge is issued or payment read, so a caller is
    // never asked to pay a provider that cannot answer.
    return failure(503, "provider_unavailable", `${provider.name} is not answering. No payment was requested or accepted.`, { charged: false, provider: provider.id });
  }

  const inputTokens = requestInputTokens(messages);
  const header = request.paymentHeader?.trim();
  if (!header) {
    const challenge = sandboxChallenge(provider, request.origin, (deps.newNonce ?? randomNonce)(), inputTokens);
    return respond(
      402,
      {
        error: { code: "payment_required", message: "x402 payment is required before the provider answers." },
        x402: challenge,
        sandbox: {
          simulatedPayment: `Resend with header x402-payment: demo:${challenge.nonce}`,
          devnetPayment: "Or transfer the amount in devnet SOL to payTo from your own wallet and resend with a JSON x402-payment receipt naming txSignature and payer.",
          pricing: `The amount is the most this call can cost: ${inputTokens} input tokens plus ${provider.pricing.maxOutputTokens} output tokens at ${provider.pricing.inputPerMillionUsd} and ${provider.pricing.outputPerMillionUsd} USD per million, paid in devnet SOL at a demo rate.`,
        },
      },
      { "x402-request": JSON.stringify(challenge) },
    );
  }

  const payment = await verifySandboxPayment(header, provider, request.origin, inputTokens, deps);
  if (!payment.ok) {
    const duplicate = payment.result.reason === "duplicate_nonce";
    return failure(duplicate ? 409 : 402, duplicate ? "payment_already_used" : "payment_rejected", payment.result.message, {
      reason: payment.result.reason,
      ...(payment.result.expected !== undefined ? { expected: payment.result.expected } : {}),
      ...(payment.result.actual !== undefined ? { actual: payment.result.actual } : {}),
    });
  }

  const prompt = [...messages].reverse().find((message) => message.role === "user")?.content ?? messages[messages.length - 1].content;
  const answer = scriptedSandboxAnswer(provider, prompt);
  const nowMs = (deps.now ?? Date.now)();
  const spotCheck: SandboxSpotCheck = simulatedSpotCheck(provider);
  const response = respond(200, {
    id: `chatcmpl-sandbox-${payment.nonce}`,
    object: "chat.completion",
    created: Math.floor(nowMs / 1000),
    model,
    choices: [{ index: 0, message: { role: "assistant", content: answer }, finish_reason: "stop" }],
    rap_sandbox: { scripted: true, paymentMode: payment.mode, spotCheck },
  });
  // The receipt travels in a header, as in V1, because it commits to the hash of the whole response body.
  const receipt = await writeReceipt({ provider, requestBody: request.rawBody, responseBody: response.bodyText, payment, inputTokens, answer, issuedAt: new Date(nowMs).toISOString() });
  response.headers[payment.mode === "devnet-transfer" ? PROVIDER_RECEIPT_HEADER : SANDBOX_SIMULATED_RECEIPT_HEADER] = encodeReceiptHeader(receipt);
  return response;
}

export async function sandboxModelsListing(): Promise<Record<string, unknown>> {
  return {
    object: "list",
    sandbox: true,
    network: SANDBOX_NETWORK,
    data: await Promise.all(SANDBOX_PROVIDERS.map(async (provider) => ({
      id: provider.model,
      object: "model",
      owned_by: provider.id,
      rap: {
        providerId: provider.id,
        providerName: provider.name,
        declaredModel: provider.model,
        scripted: true,
        available: provider.behaviour !== "offline",
        pricing: {
          currency: "USD",
          inputPerMillion: provider.pricing.inputPerMillionUsd,
          outputPerMillion: provider.pricing.outputPerMillionUsd,
          maxOutputTokens: provider.pricing.maxOutputTokens,
          paidIn: { currency: SANDBOX_CURRENCY, network: SANDBOX_NETWORK, rate: "demo" },
        },
        payTo: provider.payTo,
        // The base58 address receipts from this provider name as providerId. A published test key, not a wallet.
        receiptProviderId: await sandboxProviderAddress(provider.id),
      },
    }))),
  };
}
