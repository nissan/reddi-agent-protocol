/**
 * Devnet sandbox gateway: an OpenAI-style chat completion endpoint that answers
 * from a script, charges per call with an x402 challenge, and returns a signed
 * receipt in a response header: `reddi.receipt.v2` for a devnet transfer, the
 * sandbox simulated form for a simulated payment.
 *
 * Server-side only. It is pinned to Solana devnet whatever network profile the
 * app runs with. A visitor presents a simulated payment, a devnet transfer
 * their own wallet signed, or a metered escrow their wallet locked. For the
 * escrow, the server settles the actual cost with the provider's devnet-only
 * key (`settle-signer.ts`); it holds no other wallet.
 */
import {
  buildX402Challenge,
  parseX402PaymentHeader,
  directPaymentProofCheck,
  PAYMENT_DELEGATION_HEADER,
  PAYMENT_PROOF_HEADER,
  SolanaReceiptVerifier,
  SOLANA_GENESIS_HASHES,
  verifyDemoPaymentReceipt,
  verifySessionRequest,
  SESSION_DELEGATION_HEADER,
  SESSION_SIGNATURE_HEADER,
  type NonceReplayStore,
  type ParsedTransactionConnection,
  type ReceiptVerificationResult,
  type X402Challenge,
} from "@redditech/x402-solana";
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
import { PublicKey } from "@solana/web3.js";
import { decimalToBaseUnits } from "@redditech/x402-solana/payment";
import { bytesEqual, decodeSandboxEscrow, escrowNonceBytes, SANDBOX_ESCROW_PROGRAM_ID, refundSlotsLeft, SANDBOX_MIN_CANCEL_WINDOW_SLOTS, sandboxEscrowAddress, sandboxRatingAddress, sandboxRatingOpenedSlot } from "./escrow";
import { sandboxProviderAddress, signAsSandboxProvider } from "./keys";
import type { SandboxSettler } from "./settle-signer";
import { countTokens, formatUnits, maxChargeLamports, requestInputTokens, sandboxFeeBps, SANDBOX_FEE_TREASURY, sessionCallLamports, settleSandboxCall } from "./pricing";
import {
  canonicalizeSandboxReceipt,
  decodeReceiptHeader,
  encodeReceiptHeader,
  hashSandboxReceipt,
  isSandboxReceipt,
  PROVIDER_RECEIPT_HEADER,
  REDDI_RECEIPT_V2_VERSION,
  SANDBOX_PROOF_TYPE,
  SANDBOX_SIMULATED_RECEIPT_HEADER,
  SANDBOX_SIMULATED_RECEIPT_VERSION,
  sandboxReceiptSignatureValid,
  sha256Hex,
  type SandboxChatMessage,
  type SandboxReceiptSession,
  type SandboxReceipt,
  type SandboxReceiptBody,
} from "./receipt";

export const SANDBOX_MAX_MESSAGES = 16;
export const SANDBOX_MAX_PROMPT_CHARS = 8000;
export const SANDBOX_MAX_TRANSACTION_AGE_SECONDS = 900;
const NONCE_PATTERN = /^[0-9a-f]{32}$/;
const SIMULATED_PAYER_ID = "sandbox-visitor";

/** Session settlement (#863): the request headers, as the provider kit names them. */
export const SESSION_SEQUENCE_HEADER = "x402-session-sequence";
export const SESSION_CLOSE_HEADER = "x402-session";
/**
 * Sandbox only: the previous call's receipt, as its response header gave it.
 * The sandbox runs on stateless functions and keeps no session ledger, so each
 * call carries the provider's own signed running total forward. A V1 provider
 * keeps the ledger in its store instead.
 */
export const SESSION_PREVIOUS_RECEIPT_HEADER = "x-reddi-session-previous-receipt";
/** Response headers of the call that closes a session: the closing receipt and the session's state. */
export const SESSION_RECEIPT_HEADER = "x-reddi-session-receipt";
export const SESSION_STATE_HEADER = "x-reddi-session-state";
/** Calls a sandbox session may hold. */
export const SANDBOX_MAX_SESSION_CALLS = 50;

export type SessionRefusalCode =
  | "session_max_reached"
  | "session_window_closing"
  | "session_sequence_invalid"
  | "session_closed"
  | "session_invalid"
  | "session_auth_required"
  | "session_auth_invalid"
  | "session_auth_expired";

export type SandboxGatewayDeps = {
  /** Devnet RPC used only to read a visitor's own transfer. */
  connection: ParsedTransactionConnection;
  replayStore: NonceReplayStore;
  /** Devnet account reader, for a metered escrow the visitor locked. */
  readAccount?: (address: PublicKey) => Promise<{ owner: PublicKey; data: Uint8Array } | null>;
  /** The current devnet slot, to tell how long a metered escrow's refund window has left. Without it, metered payments are refused. */
  readSlot?: () => Promise<number | bigint>;
  /** Settles a metered escrow with the provider's devnet key. Without it, metered payments are refused. */
  settler?: SandboxSettler;
  /**
   * Serve metered escrows the visitor opted in to rating. Default false: declined before serving.
   * When true the settle passes the escrow's rating account, and by settling the provider agrees
   * to be rated: turn it on only together with the provider's own commit and reveal
   * (`seller-rating.ts`, wired in `runtime.ts` by SANDBOX_ACCEPT_RATED_ESCROWS).
   */
  acceptRatedEscrows?: boolean;
  /**
   * Serve sessions on a devnet metered escrow. Each call must carry the
   * payer's delegation to a session key and that key's signature over the
   * call (provider kit, #865), so a lock header alone cannot spend the lock.
   */
  acceptMeteredSessions?: boolean;
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
  /** Session headers, when the call is part of a session. */
  session?: { sequence?: string | null; close?: string | null; previousReceipt?: string | null; delegation?: string | null; signature?: string | null };
  /** The payer's proof for a direct payment (#882): x402-payment-proof and, optionally, x402-payment-delegation. */
  paymentProof?: { proof?: string | null; delegation?: string | null };
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
  | { ok: true; mode: "metered-escrow"; nonce: string; payerId: string; payerAddress: string; escrow: string; maxLamports: bigint; rated: boolean; createdSlot: bigint; proofRef: string }
  | { ok: false; result: Extract<ReceiptVerificationResult, { ok: false }>; sessionCode?: SessionRefusalCode };

function rejected(reason: Extract<ReceiptVerificationResult, { ok: false }>["reason"], message: string, expected?: unknown, actual?: unknown): PaymentOutcome {
  return { ok: false, result: { ok: false, reason, message, expected, actual } };
}

function sessionRejected(sessionCode: SessionRefusalCode, message: string): PaymentOutcome {
  return { ok: false, result: { ok: false, reason: "invalid_receipt", message }, sessionCode };
}

/**
 * Checks a presented payment against the terms the catalog sets for the provider.
 * The challenge is rebuilt from the catalog and the presented nonce, so a caller
 * cannot choose its own price or payee.
 */
async function verifySandboxPayment(header: string, provider: SandboxProvider, origin: string, inputTokens: number, deps: SandboxGatewayDeps, request?: SandboxGatewayRequest): Promise<PaymentOutcome> {
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
  if (record.settlement === "metered-escrow") {
    // The lock's escrow, payer and nonce are public: only the payer's signature shows who is calling (#866).
    // Checked before anything is read from chain.
    const auth = verifySingleCallAuth(record, provider, request, deps);
    if (auth) return auth;
    return verifyMeteredLock(record, provider, nonce, inputTokens, deps);
  }
  const verifier = new SolanaReceiptVerifier({
    allowRealPayment: true,
    connection: deps.connection,
    expectedGenesisHash: SOLANA_GENESIS_HASHES[SANDBOX_NETWORK],
    maxTransactionAgeSeconds: SANDBOX_MAX_TRANSACTION_AGE_SECONDS,
    now: deps.now,
  });
  let result: ReceiptVerificationResult;
  try {
    // A confirmed transfer is public: the request must be signed by the wallet that paid,
    // or by a key it delegated to this provider, over the exact body (#882).
    const proof = request?.paymentProof ?? {};
    const payerProof = directPaymentProofCheck({
      headers: { get: (name: string) => (name === PAYMENT_PROOF_HEADER ? proof.proof ?? null : name === PAYMENT_DELEGATION_HEADER ? proof.delegation ?? null : null) },
      body: request?.rawBody ?? "",
      nowMs: (deps.now ?? Date.now)(),
    });
    result = await verifier.verifyReceipt(parsed, challenge, deps.replayStore, payerProof);
  } catch {
    return rejected("unsupported_receipt", "The devnet RPC could not be read. Nothing was accepted; present the same receipt again shortly.");
  }
  if (!result.ok) return { ok: false, result };
  const signature = result.receipt.signature ?? result.receipt.txSignature;
  if (!signature) return rejected("invalid_receipt", "receipt signature is required");
  return { ok: true, mode: "devnet-transfer", nonce, payerId: record.payer, payerAddress: record.payer, proofRef: signature };
}

/**
 * A single metered call must carry the payer's delegation to a key and that
 * key's signature, action `single`, sequence 0, over the exact body (#866),
 * as the provider kit requires. Undefined when it does.
 */
function verifySingleCallAuth(record: Record<string, unknown>, provider: SandboxProvider, request: SandboxGatewayRequest | undefined, deps: SandboxGatewayDeps): PaymentOutcome | undefined {
  let payer: PublicKey;
  let escrow: PublicKey;
  try {
    payer = new PublicKey(record.payer as string);
    escrow = new PublicKey(String(record.escrow));
  } catch {
    return rejected("invalid_receipt", "A metered payment must name the payer and the escrow address.");
  }
  const s = request?.session ?? {};
  const authorised = verifySessionRequest({
    headers: { get: (name: string) => (name === SESSION_DELEGATION_HEADER ? s.delegation ?? null : name === SESSION_SIGNATURE_HEADER ? s.signature ?? null : null) },
    action: "single",
    escrow,
    payer,
    provider: new PublicKey(provider.payTo),
    sequence: 0,
    body: request?.rawBody ?? "",
    nowMs: (deps.now ?? Date.now)(),
  });
  return authorised.ok ? undefined : sessionRejected(authorised.reason, authorised.message);
}

/**
 * Checks a metered escrow the visitor's wallet locked: on the devnet program,
 * at the address the payer and challenge nonce give, still locked, metered,
 * payable to this provider, for exactly the challenge's maximum.
 */
async function verifyMeteredLock(record: Record<string, unknown>, provider: SandboxProvider, nonce: string, inputTokens: number, deps: SandboxGatewayDeps, session = false): Promise<PaymentOutcome> {
  if (!deps.settler?.canSettle(provider.id) || !deps.readAccount || !deps.readSlot) {
    return rejected("unsupported_receipt", `${provider.name} cannot settle a metered escrow on devnet right now. Nothing was taken; cancel the lock for a full refund, or pay with a simulated payment.`);
  }
  let payer: PublicKey;
  let escrowAddress: PublicKey;
  try {
    payer = new PublicKey(record.payer as string);
    escrowAddress = new PublicKey(String(record.escrow));
  } catch {
    return rejected("invalid_receipt", "A metered payment must name the payer and the escrow address.");
  }
  if (!escrowAddress.equals(sandboxEscrowAddress(payer, nonce))) return rejected("invalid_receipt", "The escrow address is not the one this payer and challenge nonce give.");
  let account: { owner: PublicKey; data: Uint8Array } | null;
  try {
    account = await deps.readAccount(escrowAddress);
  } catch {
    return rejected("unsupported_receipt", "The devnet RPC could not be read. Nothing was accepted; present the same receipt again shortly.");
  }
  if (!account) return rejected("invalid_receipt", "No escrow is locked at that address yet. Wait for the lock to confirm, then present it again.");
  if (!account.owner.equals(SANDBOX_ESCROW_PROGRAM_ID)) return rejected("invalid_receipt", "That account is not held by the devnet escrow program.");
  const escrow = decodeSandboxEscrow(account.data);
  if (!escrow) return rejected("invalid_receipt", "That account is not an escrow.");
  if (escrow.status !== "locked") return rejected("duplicate_nonce", "This escrow has already been settled or cancelled.", undefined, nonce);
  if (!escrow.metered) return rejected("invalid_receipt", "This escrow was not locked as a metered escrow.");
  // `metered` is one bit of the flag byte and `rated` another. A provider that settles a rated
  // escrow has agreed to be rated, so one is declined here, before anything is served or
  // remembered, unless this gateway is set to accept them. When it is, the settle has to pass the
  // rating account, so `rated` travels with the payment.
  if (escrow.rated && session) return sessionRejected("session_invalid", "Sessions are not offered on escrows opted in to rating. Nothing was served or taken.");
  if (escrow.rated && deps.acceptRatedEscrows !== true)
    return rejected("unsupported_receipt", "This escrow was opted in to rating, and this provider does not take rated jobs. Nothing was served or taken. Lock a new escrow without rating, and cancel this one for a full refund once its refund window has elapsed.");
  // The payer may refund once its window has elapsed, so the settlement has to
  // land before then. The time left now is what counts, not the window named
  // at lock, and when the slot cannot be read nothing is accepted.
  let currentSlot: bigint;
  try {
    currentSlot = BigInt(await deps.readSlot());
  } catch {
    return rejected("unsupported_receipt", "The devnet RPC could not be read. Nothing was accepted; present the same receipt again shortly.");
  }
  if (refundSlotsLeft(escrow, currentSlot) < SANDBOX_MIN_CANCEL_WINDOW_SLOTS && session)
    return sessionRejected("session_window_closing", "This session's refund window has less than 10 minutes left, so it takes no more calls. Close it to settle what was served, or let the window open and cancel for a full refund.");
  if (refundSlotsLeft(escrow, currentSlot) < SANDBOX_MIN_CANCEL_WINDOW_SLOTS)
    return rejected("invalid_receipt", "This escrow's refund window has less than 10 minutes left. Lock a new one with a longer refund window, then make the call straight away.");
  if (!escrow.payer.equals(payer)) return rejected("invalid_receipt", "The escrow was locked by a different wallet.");
  if (escrow.payee.toBase58() !== provider.payTo) return rejected("wrong_payee", "escrow payee does not match challenge", provider.payTo, escrow.payee.toBase58());
  if (!bytesEqual(escrow.nonce, escrowNonceBytes(nonce))) return rejected("invalid_nonce", "The escrow nonce does not match the challenge.");
  // A session's lock covers many calls; the session path checks its running total against it.
  const maxLamports = session ? escrow.amount : maxChargeLamports(provider, inputTokens);
  if (escrow.amount !== maxLamports) return rejected("wrong_amount", "escrow amount does not match challenge", maxLamports.toString(), escrow.amount.toString());
  // The settle names this escrow by its lock slot, read now with the lock being served, so it
  // cannot end a later escrow at the same address. A rated job's rating opens in that slot.
  if (escrow.rated) {
    let openedSlot: bigint | undefined;
    try {
      openedSlot = sandboxRatingOpenedSlot(escrowAddress, await deps.readAccount(sandboxRatingAddress(escrowAddress)));
    } catch {
      return rejected("unsupported_receipt", "The devnet RPC could not be read. Nothing was accepted; present the same receipt again shortly.");
    }
    if (openedSlot === undefined || openedSlot !== escrow.createdSlot) return rejected("invalid_receipt", "This escrow is opted in to rating, but its rating account could not be read as this job's. Nothing was accepted.");
  }
  if (!session && !(await deps.replayStore.checkAndStore(`escrow:${escrowAddress.toBase58()}`))) return rejected("duplicate_nonce", "receipt nonce has already been used", undefined, nonce);
  return { ok: true, mode: "metered-escrow", nonce, payerId: payer.toBase58(), payerAddress: payer.toBase58(), escrow: escrowAddress.toBase58(), maxLamports, rated: escrow.rated, createdSlot: escrow.createdSlot, proofRef: escrowAddress.toBase58() };
}

async function writeReceipt(input: {
  provider: SandboxProvider;
  requestBody: string;
  responseBody: string;
  payment: Extract<PaymentOutcome, { ok: true }>;
  inputTokens: number;
  answer: string;
  issuedAt: string;
  /** The settle transaction, for a metered escrow. */
  settleSignature?: string;
}): Promise<SandboxReceipt> {
  const { provider, payment } = input;
  const maxAmount = maxChargeLamports(provider, input.inputTokens);
  const direct = payment.mode === "devnet-transfer";
  const paid = direct || payment.mode === "metered-escrow";
  // A devnet transfer paid the maximum straight to the provider: the receipt
  // states that, with no fee and no refund, because nothing else happened on
  // chain. A metered escrow settled the actual tokens on devnet, and a
  // simulated call shows the same arithmetic with no transaction.
  const settled = settleSandboxCall(provider, { inputTokens: input.inputTokens, outputTokens: countTokens(input.answer) }, maxAmount);
  const receipt: SandboxReceiptBody = {
    schemaVersion: paid ? REDDI_RECEIPT_V2_VERSION : SANDBOX_SIMULATED_RECEIPT_VERSION,
    providerId: await sandboxProviderAddress(provider.id),
    declaredModel: provider.model,
    requestHash: await sha256Hex(input.requestBody),
    responseHash: await sha256Hex(input.responseBody),
    payment: {
      network: SANDBOX_NETWORK,
      ...(direct ? { txSignature: payment.proofRef } : {}),
      ...(payment.mode === "metered-escrow" ? { txSignature: input.settleSignature } : {}),
      currency: SANDBOX_CURRENCY,
      ...(direct
        ? { amount: maxAmount.toString(), fee: { amount: "0" }, payer: payment.payerAddress, settlement: "direct" as const }
        : {
            ...(payment.mode === "metered-escrow" ? { payer: payment.payerAddress } : {}),
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
          ...(deps.settler?.canSettle(provider.id)
            ? {
                meteredPayment: `Or lock the amount with lock_metered_escrow on ${SANDBOX_ESCROW_PROGRAM_ID.toBase58()} (payee payTo, nonce the challenge nonce as 16 bytes) and resend with a JSON x402-payment naming settlement "metered-escrow", payer, escrow and nonce. The provider settles the actual tokens and the rest comes back to you.`,
              }
            : {}),
          sessionPayment: `Or pay many calls from one lock: lock a session maximum (at least the amount above, up to ${SANDBOX_MAX_SESSION_CALLS} calls), send the same x402-payment with ${SESSION_SEQUENCE_HEADER}: 1, 2, 3 …, pass each previous call's receipt back in ${SESSION_PREVIOUS_RECEIPT_HEADER}, and send ${SESSION_CLOSE_HEADER}: close on the last call. The provider settles the running total once.`,
          pricing: `The amount is the most this call can cost: ${inputTokens} input tokens plus ${provider.pricing.maxOutputTokens} output tokens at ${provider.pricing.inputPerMillionUsd} and ${provider.pricing.outputPerMillionUsd} USD per million, paid in devnet SOL at a demo rate.`,
        },
      },
      { "x402-request": JSON.stringify(challenge) },
    );
  }

  if (request.session?.sequence != null && request.session.sequence.trim() !== "") {
    return handleSessionCall({ request, deps, provider, messages, model, inputTokens, header });
  }

  const payment = await verifySandboxPayment(header, provider, request.origin, inputTokens, deps, request);
  if (!payment.ok) {
    if (payment.sessionCode?.startsWith("session_auth_")) return sessionRefusal(payment.sessionCode, payment.result.message);
    const duplicate = payment.result.reason === "duplicate_nonce";
    return failure(duplicate ? 409 : 402, duplicate ? "payment_already_used" : "payment_rejected", payment.result.message, {
      reason: payment.result.reason,
      ...(payment.result.expected !== undefined ? { expected: payment.result.expected } : {}),
      ...(payment.result.actual !== undefined ? { actual: payment.result.actual } : {}),
    });
  }

  const prompt = [...messages].reverse().find((message) => message.role === "user")?.content ?? messages[messages.length - 1].content;
  const answer = scriptedSandboxAnswer(provider, prompt);
  let settleSignature: string | undefined;
  if (payment.mode === "metered-escrow") {
    // The provider settles the actual tokens before it answers, so the answer
    // and its receipt name a settle transaction that already happened.
    const settled = settleSandboxCall(provider, { inputTokens, outputTokens: countTokens(answer) }, payment.maxLamports);
    const result = deps.settler
      ? await deps.settler.settle({ providerId: provider.id, escrow: new PublicKey(payment.escrow), payer: new PublicKey(payment.payerAddress), payee: new PublicKey(provider.payTo), actualLamports: settled.amount, rated: payment.rated, createdSlot: payment.createdSlot })
      : { ok: false as const, message: "No settler is configured." };
    if (!result.ok) {
      return failure(502, "settle_failed", `${result.message} Your maximum stays locked in escrow ${payment.escrow}; nothing was charged, and you can cancel it for a full refund once its refund window has elapsed, about 30 minutes after the lock.`, { charged: false, escrow: payment.escrow });
    }
    settleSignature = result.signature;
  }
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
  const receipt = await writeReceipt({ provider, requestBody: request.rawBody, responseBody: response.bodyText, payment, inputTokens, answer, issuedAt: new Date(nowMs).toISOString(), settleSignature });
  response.headers[payment.mode !== "simulated" ? PROVIDER_RECEIPT_HEADER : SANDBOX_SIMULATED_RECEIPT_HEADER] = encodeReceiptHeader(receipt);
  return response;
}

function sessionRefusal(code: SessionRefusalCode, message: string): SandboxGatewayResponse {
  const status = code.startsWith("session_auth_") ? 401 : code === "session_max_reached" || code === "session_sequence_invalid" || code === "session_closed" ? 409 : 402;
  return failure(status, code, message, { charged: false });
}

type SessionLock = { mode: "simulated" | "metered-escrow"; escrow: string; payer?: string; maxLamports: bigint; nonce: string; createdSlot?: bigint };

/** The lock a session call presents: a simulated session maximum or a metered escrow on devnet. */
async function verifySessionLock(header: string, provider: SandboxProvider, origin: string, inputTokens: number, deps: SandboxGatewayDeps, auth: { request: SandboxGatewayRequest; sequence: number }): Promise<{ ok: true; lock: SessionLock } | { ok: false; response: SandboxGatewayResponse }> {
  const parsed = parseX402PaymentHeader(header);
  const refuse = (code: SessionRefusalCode, message: string) => ({ ok: false as const, response: sessionRefusal(code, message) });
  if (!parsed || typeof parsed !== "object") return refuse("session_invalid", "A session is paid by a metered lock: send a JSON x402-payment with settlement \"metered-escrow\".");
  const record = parsed as Record<string, unknown>;
  const nonce = typeof record.nonce === "string" ? record.nonce : "";
  if (!NONCE_PATTERN.test(nonce)) return refuse("session_invalid", "Use the nonce from the 402 challenge.");
  if (record.settlement !== "metered-escrow") return refuse("session_invalid", "A session is paid by a metered lock: send settlement \"metered-escrow\".");
  if (record.simulated === true) {
    const challenge = sandboxChallenge(provider, origin, nonce, inputTokens);
    if (record.network !== challenge.network || record.payTo !== challenge.payTo || record.currency !== challenge.currency) {
      return refuse("session_invalid", "The simulated session lock does not name this provider's network, payee and currency.");
    }
    const lamports = typeof record.amount === "string" ? decimalToBaseUnits(record.amount, 9) : undefined;
    if (lamports === undefined || lamports <= BigInt(0)) return refuse("session_invalid", "The simulated session lock needs an amount in SOL.");
    return { ok: true, lock: { mode: "simulated", escrow: `simulated:${nonce}`, maxLamports: lamports, nonce } };
  }
  if (deps.acceptMeteredSessions !== true) return refuse("session_invalid", "This sandbox runs sessions with a simulated lock only.");
  if (typeof record.payer !== "string" || record.payer.length === 0) return refuse("session_invalid", "A session lock must name the paying wallet in payer.");
  // The lock's escrow, payer and nonce are public, so they cannot show who is calling: the payer's
  // delegation to a session key and that key's signature over this exact call do. Checked before
  // anything is read from chain or reserved.
  let payerKey: PublicKey;
  let escrowKey: PublicKey;
  try {
    payerKey = new PublicKey(record.payer);
    escrowKey = new PublicKey(String(record.escrow));
  } catch {
    return refuse("session_invalid", "A session lock must name the payer and the escrow address.");
  }
  const s = auth.request.session ?? {};
  const authorised = verifySessionRequest({
    headers: { get: (name: string) => (name === SESSION_DELEGATION_HEADER ? s.delegation ?? null : name === SESSION_SIGNATURE_HEADER ? s.signature ?? null : null) },
    action: "call",
    escrow: escrowKey,
    payer: payerKey,
    provider: new PublicKey(provider.payTo),
    sequence: auth.sequence,
    body: auth.request.rawBody,
    nowMs: (deps.now ?? Date.now)(),
  });
  if (!authorised.ok) return refuse(authorised.reason, authorised.message);
  const outcome = await verifyMeteredLock(record, provider, nonce, inputTokens, deps, true);
  if (!outcome.ok) {
    if (outcome.sessionCode) return refuse(outcome.sessionCode, outcome.result.message);
    // A settled or cancelled escrow has no session left to serve.
    if (outcome.result.reason === "duplicate_nonce") return refuse("session_closed", "This session's escrow has already been settled or cancelled.");
    return { ok: false, response: failure(402, "payment_rejected", outcome.result.message, { reason: outcome.result.reason, charged: false }) };
  }
  if (outcome.mode !== "metered-escrow") return refuse("session_invalid", "A session is paid by a metered lock.");
  return { ok: true, lock: { mode: "metered-escrow", escrow: outcome.escrow, payer: outcome.payerAddress, maxLamports: outcome.maxLamports, nonce, createdSlot: outcome.createdSlot } };
}

/**
 * One call of a session (#863): one lock pays for many calls and the provider
 * settles the running total once, on the call that asks to close. Before a
 * call is served: the sequence follows the previous receipt with no gap, that
 * receipt is this provider's and still open, the lock is the same one, and the
 * running total plus this call's worst case fits under the lock.
 */
async function handleSessionCall(input: {
  request: SandboxGatewayRequest;
  deps: SandboxGatewayDeps;
  provider: SandboxProvider;
  messages: SandboxChatMessage[];
  model: string;
  inputTokens: number;
  header: string;
}): Promise<SandboxGatewayResponse> {
  const { request, deps, provider, messages, model, inputTokens } = input;
  const session = request.session!;
  const sequenceText = (session.sequence ?? "").trim();
  if (!/^[1-9]\d{0,5}$/.test(sequenceText) || Number(sequenceText) > SANDBOX_MAX_SESSION_CALLS) {
    return sessionRefusal("session_sequence_invalid", `${SESSION_SEQUENCE_HEADER} must be a whole number from 1 to ${SANDBOX_MAX_SESSION_CALLS}.`);
  }
  const sequence = Number(sequenceText);
  const close = (session.close ?? "").trim().toLowerCase() === "close";
  const providerId = await sandboxProviderAddress(provider.id);

  let previous: SandboxReceiptSession | undefined;
  let previousHash: string | undefined;
  if (sequence > 1) {
    const decoded = decodeReceiptHeader(session.previousReceipt);
    if (!isSandboxReceipt(decoded) || !decoded.receipt.session || decoded.receipt.providerId !== providerId || !(await sandboxReceiptSignatureValid(decoded))) {
      return sessionRefusal("session_sequence_invalid", `Call ${sequence} needs call ${sequence - 1}'s receipt from this provider in ${SESSION_PREVIOUS_RECEIPT_HEADER}.`);
    }
    previous = decoded.receipt.session;
    if (previous.closed) return sessionRefusal("session_closed", "This session has already closed and settled.");
    if (Number(previous.sequence) !== sequence - 1) return sessionRefusal("session_sequence_invalid", `The previous receipt is for call ${previous.sequence}, so this call must be ${Number(previous.sequence) + 1}.`);
    previousHash = await hashSandboxReceipt(decoded.receipt);
  }

  const verified = await verifySessionLock(input.header, provider, request.origin, inputTokens, deps, { request, sequence });
  if (!verified.ok) return verified.response;
  const lock = verified.lock;
  if (previous && (previous.escrow !== lock.escrow || previous.maxAmount !== lock.maxLamports.toString() || previous.payer !== lock.payer)) {
    return sessionRefusal("session_invalid", "The previous receipt belongs to a different lock.");
  }
  const committed = previous ? BigInt(previous.cumulativeCost) : BigInt(0);
  if (committed + maxChargeLamports(provider, inputTokens) > lock.maxLamports) {
    return sessionRefusal("session_max_reached", `This call could take the session past its lock: ${committed} lamports owed so far, up to ${maxChargeLamports(provider, inputTokens)} more for this call, ${lock.maxLamports} locked. Nothing was charged. Close the session to settle what was served.`);
  }
  if (!(await deps.replayStore.checkAndStore(`session:${lock.escrow}:${sequence}`))) {
    return sessionRefusal("session_sequence_invalid", `Call ${sequence} of this session has already been served.`);
  }

  const prompt = [...messages].reverse().find((message) => message.role === "user")?.content ?? messages[messages.length - 1].content;
  const answer = scriptedSandboxAnswer(provider, prompt);
  const usage = { inputTokens, outputTokens: countTokens(answer) };
  const cost = sessionCallLamports(provider, usage);
  const cumulative = committed + cost;
  const totals = {
    inputTokens: (previous ? Number(previous.cumulativeInputTokens) : 0) + usage.inputTokens,
    outputTokens: (previous ? Number(previous.cumulativeOutputTokens) : 0) + usage.outputTokens,
  };

  let settleSignature: string | undefined;
  if (close && lock.mode === "metered-escrow") {
    const result = deps.settler
      ? await deps.settler.settle({ providerId: provider.id, escrow: new PublicKey(lock.escrow), payer: new PublicKey(lock.payer!), payee: new PublicKey(provider.payTo), actualLamports: cumulative, rated: false, createdSlot: lock.createdSlot! })
      : { ok: false as const, message: "No settler is configured." };
    if (!result.ok) {
      return failure(502, "settle_failed", `${result.message} The session's maximum stays locked in escrow ${lock.escrow}; nothing was charged, and you can cancel it for a full refund once its refund window has elapsed.`, { charged: false, escrow: lock.escrow });
    }
    settleSignature = result.signature;
  }

  const nowMs = (deps.now ?? Date.now)();
  const issuedAt = new Date(nowMs).toISOString();
  const response = respond(200, {
    id: `chatcmpl-sandbox-${lock.nonce}-${sequence}`,
    object: "chat.completion",
    created: Math.floor(nowMs / 1000),
    model,
    choices: [{ index: 0, message: { role: "assistant", content: answer }, finish_reason: "stop" }],
    rap_sandbox: {
      scripted: true,
      paymentMode: lock.mode,
      spotCheck: simulatedSpotCheck(provider),
      session: { sequence, callCost: cost.toString(), cumulativeCost: cumulative.toString(), maxAmount: lock.maxLamports.toString(), closeRequested: close },
    },
  });

  const schemaVersion = lock.mode === "metered-escrow" ? REDDI_RECEIPT_V2_VERSION : SANDBOX_SIMULATED_RECEIPT_VERSION;
  const base = {
    schemaVersion,
    providerId,
    declaredModel: provider.model,
    requestHash: await sha256Hex(request.rawBody),
    responseHash: await sha256Hex(response.bodyText),
  } as const;
  const block = (fields: { sequence: number; inputTokens: number; outputTokens: number; previousReceiptHash?: string; closed: boolean }): SandboxReceiptSession => ({
    escrow: lock.escrow,
    ...(lock.payer !== undefined ? { payer: lock.payer } : {}),
    network: SANDBOX_NETWORK,
    currency: SANDBOX_CURRENCY,
    maxAmount: lock.maxLamports.toString(),
    sequence: String(fields.sequence),
    inputTokens: String(fields.inputTokens),
    outputTokens: String(fields.outputTokens),
    cumulativeInputTokens: String(totals.inputTokens),
    cumulativeOutputTokens: String(totals.outputTokens),
    cumulativeCost: cumulative.toString(),
    ...(fields.previousReceiptHash !== undefined ? { previousReceiptHash: fields.previousReceiptHash } : {}),
    closed: fields.closed,
  });
  const sign = async (body: SandboxReceiptBody): Promise<SandboxReceipt> => ({
    receipt: body,
    proof: { type: SANDBOX_PROOF_TYPE, signature: (await signAsSandboxProvider(provider.id, canonicalizeSandboxReceipt(body))).signature },
  });

  const callReceipt = await sign({ ...base, session: block({ sequence, ...usage, previousReceiptHash: previousHash, closed: false }), issuedAt });
  response.headers[lock.mode === "metered-escrow" ? PROVIDER_RECEIPT_HEADER : SANDBOX_SIMULATED_RECEIPT_HEADER] = encodeReceiptHeader(callReceipt);
  response.headers[SESSION_STATE_HEADER] = close ? "settled" : "open";

  if (close) {
    // The closing receipt is its own link in the chain: no tokens of its own, the running totals, and the settle.
    const fee = (cumulative * sandboxFeeBps()) / BigInt(10_000);
    const closing = await sign({
      ...base,
      payment: {
        network: SANDBOX_NETWORK,
        ...(settleSignature !== undefined ? { txSignature: settleSignature } : {}),
        currency: SANDBOX_CURRENCY,
        amount: cumulative.toString(),
        fee: fee > BigInt(0) ? { amount: fee.toString(), treasury: SANDBOX_FEE_TREASURY } : { amount: "0" },
        ...(lock.payer !== undefined ? { payer: lock.payer } : {}),
        settlement: "metered-escrow",
        metered: {
          inputTokens: String(totals.inputTokens),
          outputTokens: String(totals.outputTokens),
          maxAmount: lock.maxLamports.toString(),
          refunded: (lock.maxLamports - cumulative).toString(),
        },
      },
      session: block({ sequence: sequence + 1, inputTokens: 0, outputTokens: 0, previousReceiptHash: await hashSandboxReceipt(callReceipt.receipt), closed: true }),
      issuedAt,
    });
    response.headers[SESSION_RECEIPT_HEADER] = encodeReceiptHeader(closing);
  }
  return response;
}

export async function sandboxModelsListing(settler?: SandboxSettler, acceptRatedEscrows = false): Promise<Record<string, unknown>> {
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
        // Whether a wallet can lock a metered escrow for this provider, which the server then settles.
        // acceptsRatedEscrows: whether an escrow the visitor opted in to rating is served, or declined before serving.
        meteredEscrow: { available: provider.behaviour !== "offline" && (settler?.canSettle(provider.id) ?? false), programId: SANDBOX_ESCROW_PROGRAM_ID.toBase58(), acceptsRatedEscrows: acceptRatedEscrows === true },
        // The base58 address receipts from this provider name as providerId. A published test key, not a wallet.
        receiptProviderId: await sandboxProviderAddress(provider.id),
      },
    }))),
  };
}
