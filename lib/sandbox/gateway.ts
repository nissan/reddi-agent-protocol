/**
 * Devnet sandbox gateway: an OpenAI-style chat completion endpoint that answers
 * from a script, charges per call with an x402 challenge, and returns a signed
 * sandbox receipt.
 *
 * Server-side only. It is pinned to Solana devnet whatever network profile the
 * app runs with, holds no wallet, and submits no transaction: a visitor either
 * presents a simulated payment or a devnet transfer their own wallet signed.
 */
import {
  buildX402Challenge,
  parseX402PaymentHeader,
  solAmountToLamports,
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
import { sandboxProviderPublicKey, signAsSandboxProvider } from "./keys";
import {
  hashSandboxRequest,
  hashSandboxResponse,
  SANDBOX_RECEIPT_PROTOCOL_VERSION,
  SANDBOX_SIGNATURE_ALGORITHM,
  sandboxSigningPayload,
  type SandboxChatMessage,
  type SandboxReceipt,
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
};

export type SandboxGatewayRequest = {
  body: unknown;
  /** Raw value of the x402-payment (or x-payment) header, if any. */
  paymentHeader?: string | null;
  /** Origin the endpoint is served from, used in the challenge. */
  origin: string;
};

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function failure(status: number, code: string, message: string, extra: Record<string, unknown> = {}): SandboxGatewayResponse {
  return { status, headers: { ...JSON_HEADERS }, body: { error: { code, message }, ...extra } };
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

export function sandboxChallenge(provider: SandboxProvider, origin: string, nonce: string): X402Challenge {
  return buildX402Challenge({
    version: "1",
    network: SANDBOX_NETWORK,
    payTo: provider.payTo,
    amount: provider.priceSol,
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
async function verifySandboxPayment(header: string, provider: SandboxProvider, origin: string, deps: SandboxGatewayDeps): Promise<PaymentOutcome> {
  const parsed = parseX402PaymentHeader(header);

  if (typeof parsed === "string") {
    if (!parsed.startsWith("demo:")) return rejected("invalid_receipt", "x402-payment must be demo:<nonce> or a JSON payment receipt.");
    const nonce = parsed.slice("demo:".length);
    if (!NONCE_PATTERN.test(nonce)) return rejected("invalid_nonce", "Use the nonce from the 402 challenge.");
    const result = await verifyDemoPaymentReceipt({ receipt: parsed, challenge: sandboxChallenge(provider, origin, nonce), allowDemoPayment: true, replayStore: deps.replayStore });
    return result.ok ? { ok: true, mode: "simulated", nonce, payerId: SIMULATED_PAYER_ID, proofRef: `simulated:${nonce}` } : { ok: false, result };
  }

  if (!parsed || typeof parsed !== "object") return rejected("invalid_receipt", "x402-payment is not a payment receipt.");
  const record = parsed as Record<string, unknown>;
  const nonce = typeof record.nonce === "string" ? record.nonce : "";
  if (!NONCE_PATTERN.test(nonce)) return rejected("invalid_nonce", "Use the nonce from the 402 challenge.");
  const challenge = sandboxChallenge(provider, origin, nonce);

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
  model: string;
  messages: SandboxChatMessage[];
  answer: string;
  payment: Extract<PaymentOutcome, { ok: true }>;
  origin: string;
  createdAt: string;
}): Promise<SandboxReceipt> {
  const { provider, payment } = input;
  const lamports = solAmountToLamports(provider.priceSol);
  if (lamports === undefined) throw new Error(`sandbox provider ${provider.id} has an invalid price`);
  const requestHash = await hashSandboxRequest(input.model, input.messages);
  const responseHash = await hashSandboxResponse(input.answer);
  const unsigned = {
    schemaVersion: "reddi.receipt.v1" as const,
    job: { id: `sandbox-${payment.nonce}`, type: "inference.chat-completion" },
    source: { id: "rap-devnet-sandbox", type: "sandbox" },
    payer: payment.mode === "devnet-transfer" ? { id: payment.payerId, address: payment.payerAddress } : { id: payment.payerId },
    specialist: { id: provider.id, endpoint: `${input.origin}${SANDBOX_ENDPOINT_PATH}` },
    protocol: { name: "Reddi Agent Protocol" as const, version: SANDBOX_RECEIPT_PROTOCOL_VERSION },
    payment: { network: SANDBOX_NETWORK, asset: SANDBOX_CURRENCY, amount: lamports.toString(), paymentProofRef: payment.proofRef },
    requestHash,
    responseHash,
    evidenceRef: `sandbox:response-sha256:${responseHash}`,
    policyDecision: {
      schemaVersion: "reddi.policy-decision.v1" as const,
      allowed: true,
      reasonCodes: ["allowed" as const],
      quotedAmount: { amount: lamports.toString(), asset: SANDBOX_CURRENCY, network: SANDBOX_NETWORK, specialist: provider.id },
      asset: SANDBOX_CURRENCY,
      network: SANDBOX_NETWORK,
      approvalState: "approved" as const,
      auditNotes: ["Sandbox call: price and payee come from the sandbox catalog."],
    },
    attestationStatus: "not_requested" as const,
    createdAt: input.createdAt,
    metadata: {
      sandbox: true as const,
      inference: {
        providerId: provider.id,
        providerName: provider.name,
        declaredModel: provider.model,
        paymentMode: payment.mode,
        scripted: true as const,
      },
    },
  };
  const signed = await signAsSandboxProvider(provider.id, sandboxSigningPayload(unsigned));
  return {
    ...unsigned,
    metadata: { ...unsigned.metadata, providerSignature: { algorithm: SANDBOX_SIGNATURE_ALGORITHM, publicKey: signed.publicKey, value: signed.value } },
  };
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

  const header = request.paymentHeader?.trim();
  if (!header) {
    const challenge = sandboxChallenge(provider, request.origin, (deps.newNonce ?? randomNonce)());
    return {
      status: 402,
      headers: { ...JSON_HEADERS, "x402-request": JSON.stringify(challenge) },
      body: {
        error: { code: "payment_required", message: "x402 payment is required before the provider answers." },
        x402: challenge,
        sandbox: {
          simulatedPayment: `Resend with header x402-payment: demo:${challenge.nonce}`,
          devnetPayment: "Or transfer the amount in devnet SOL to payTo from your own wallet and resend with a JSON x402-payment receipt naming txSignature and payer.",
        },
      },
    };
  }

  const payment = await verifySandboxPayment(header, provider, request.origin, deps);
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
  const receipt = await writeReceipt({ provider, model, messages, answer, payment, origin: request.origin, createdAt: new Date(nowMs).toISOString() });
  const spotCheck: SandboxSpotCheck = simulatedSpotCheck(provider);

  return {
    status: 200,
    headers: { ...JSON_HEADERS },
    body: {
      id: `chatcmpl-sandbox-${payment.nonce}`,
      object: "chat.completion",
      created: Math.floor(nowMs / 1000),
      model,
      choices: [{ index: 0, message: { role: "assistant", content: answer }, finish_reason: "stop" }],
      rap_receipt: receipt,
      rap_sandbox: { scripted: true, paymentMode: payment.mode, spotCheck },
    },
  };
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
        price: { amount: provider.priceSol, currency: SANDBOX_CURRENCY, network: SANDBOX_NETWORK },
        payTo: provider.payTo,
        signingKey: { algorithm: SANDBOX_SIGNATURE_ALGORITHM, publicKey: await sandboxProviderPublicKey(provider.id) },
      },
    }))),
  };
}
