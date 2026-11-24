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
  sessionCallAction,
  verifyDemoPaymentReceipt,
  verifySessionRequest,
  verifyPaidCallRequestWithTransactions,
  type TransactionFactsReader,
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
  sandboxFileStandIn,
  scriptedSandboxAnswer,
  simulatedSpotCheck,
  type SandboxProvider,
  type SandboxSpotCheck,
} from "./catalog";
import { PublicKey } from "@solana/web3.js";
import { decimalToBaseUnits, demoNonceReplayKey } from "@redditech/x402-solana/payment";
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
/** Room for a real review (the try page's pull-request task is about 20,600 characters), inside the route's 32 KiB body limit. */
export const SANDBOX_MAX_PROMPT_CHARS = 24_000;
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
  /**
   * Reads a confirmed lock transaction, for a single call whose delegation is
   * proved by a memo in the lock (Solana Pay transaction requests, #925).
   * Without it such a delegation is refused.
   */
  readTransaction?: TransactionFactsReader;
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
  /**
   * A metered call's retry after `settle_pending`: the settle transaction that answer named
   * (`SETTLE_SIGNATURE_HEADER`). The call is served again only when that settle of this escrow, for
   * this exact request, is confirmed, and the request carries the payer's signature as before.
   */
  settleSignature?: string | null;
};

/** Request header of a retry after `settle_pending`: the settle transaction the earlier answer named. */
export const SETTLE_SIGNATURE_HEADER = "x-reddi-settle-signature";

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
    // The same key a demo receipt for this nonce is recorded under, so one nonce pays once either way.
    if (!(await deps.replayStore.checkAndStore(demoNonceReplayKey(nonce)))) return rejected("duplicate_nonce", "receipt nonce has already been used", undefined, nonce);
    return { ok: true, mode: "simulated", nonce, payerId: SIMULATED_PAYER_ID, proofRef: `simulated:${nonce}` };
  }

  if (provider.simulatedOnly) {
    // Checked before anything is read from chain, so no devnet SOL goes to an address nobody settles from.
    return rejected("unsupported_receipt", `${provider.name} takes simulated payments only in the sandbox. Nothing was taken; pay with a simulated payment.`);
  }

  if (typeof record.payer !== "string" || record.payer.length === 0) return rejected("invalid_receipt", "A devnet payment receipt must name the paying wallet in payer.");
  if (record.settlement === "metered-escrow") {
    // The lock's escrow, payer and nonce are public: only the payer's signature shows who is calling (#866).
    // Checked before anything is read from chain.
    const auth = await verifySingleCallAuth(record, provider, request, deps);
    if (!auth.ok) return auth.outcome;
    return verifyMeteredLock(record, provider, nonce, inputTokens, deps, false, auth.lockSlot);
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
 * as the provider kit requires. When the delegation is proved by a lock
 * transaction, the slot that transaction landed in comes back, so the lock
 * check can hold it to the escrow's created slot.
 */
async function verifySingleCallAuth(record: Record<string, unknown>, provider: SandboxProvider, request: SandboxGatewayRequest | undefined, deps: SandboxGatewayDeps): Promise<{ ok: true; lockSlot?: bigint } | { ok: false; outcome: PaymentOutcome }> {
  let payer: PublicKey;
  let escrow: PublicKey;
  try {
    payer = new PublicKey(record.payer as string);
    escrow = new PublicKey(String(record.escrow));
  } catch {
    return { ok: false, outcome: rejected("invalid_receipt", "A metered payment must name the payer and the escrow address.") };
  }
  const s = request?.session ?? {};
  // A Solana Pay transaction request (try page, #925) proves the delegation
  // with a memo in the lock transaction instead of a signed message.
  const authorised = await verifyPaidCallRequestWithTransactions({
    headers: { get: (name: string) => (name === SESSION_DELEGATION_HEADER ? s.delegation ?? null : name === SESSION_SIGNATURE_HEADER ? s.signature ?? null : null) },
    genesisHash: SOLANA_GENESIS_HASHES[SANDBOX_NETWORK],
    escrow,
    payer,
    provider: new PublicKey(provider.payTo),
    body: request?.rawBody ?? "",
    nowMs: (deps.now ?? Date.now)(),
    ...(deps.readTransaction ? { readTransaction: deps.readTransaction } : {}),
  });
  if (authorised.ok) return { ok: true, ...(authorised.lockSlot !== undefined ? { lockSlot: authorised.lockSlot } : {}) };
  if (authorised.reason === "payment_check_unavailable") return { ok: false, outcome: rejected("unsupported_receipt", "The devnet RPC could not be read. Nothing was accepted; present the same receipt again shortly.") };
  return { ok: false, outcome: sessionRejected(authorised.reason, authorised.message) };
}

/**
 * Checks a metered escrow the visitor's wallet locked: on the devnet program,
 * at the address the payer and challenge nonce give, still locked, metered,
 * payable to this provider, for exactly the challenge's maximum.
 */
async function verifyMeteredLock(record: Record<string, unknown>, provider: SandboxProvider, nonce: string, inputTokens: number, deps: SandboxGatewayDeps, session = false, lockSlot?: bigint): Promise<PaymentOutcome> {
  if (!deps.settler?.canSettle(provider.id) || !deps.readAccount || !deps.readSlot) {
    return rejected("unsupported_receipt", `${provider.name} cannot settle a metered escrow on devnet right now. Nothing was taken; cancel the lock for a full refund, or pay with a simulated payment.`);
  }
  // A settle encoded for another build of the program would be refused after the answer (audit S7-Codex-R2-06).
  const deployment = await deps.settler.deployment();
  if (!deployment.ok) return rejected("unsupported_receipt", `${deployment.message} Nothing was taken; cancel the lock for a full refund once its refund window opens, or pay with a simulated payment.`);
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
  // A delivery-checked escrow (bit 0x04) pays only after a recorded delivery and the buyer's
  // verify window, and its settle must carry the delivery account. The sandbox settles right after
  // the response, so it would leave the work unpaid: refuse it before anything is served.
  if (escrow.deliveryChecked)
    return rejected("unsupported_receipt", "This escrow was opted in to the delivery check, which this provider does not take yet. Nothing was served or taken. Lock a new escrow without the delivery check, and cancel this one for a full refund once its refund window has elapsed.");
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
  // A delegation proved by a lock transaction holds only for the escrow that transaction created,
  // not a later one at the same address.
  if (lockSlot !== undefined && lockSlot !== escrow.createdSlot)
    return sessionRejected("session_auth_invalid", "The lock transaction named by the delegation did not create this escrow. Nothing was served or taken.");
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
  /** What the treasury received in that settle, read from the confirmed transaction. */
  settledFeeLamports?: bigint;
}): Promise<SandboxReceipt> {
  const { provider, payment } = input;
  const maxAmount = maxChargeLamports(provider, input.inputTokens);
  const direct = payment.mode === "devnet-transfer";
  const paid = direct || payment.mode === "metered-escrow";
  // A devnet transfer paid the maximum straight to the provider: the receipt
  // states that, with no fee and no refund, because nothing else happened on
  // chain. A metered escrow settled the actual tokens on devnet, and a
  // simulated call shows the same arithmetic with no transaction.
  const computed = settleSandboxCall(provider, { inputTokens: input.inputTokens, outputTokens: countTokens(input.answer) }, maxAmount);
  // A settled escrow's fee is the one the chain took at payout (audit S7-Codex-R2-05), never the server clock's rate.
  if (payment.mode === "metered-escrow" && input.settledFeeLamports === undefined) throw new Error("a metered receipt needs the fee read from its settle");
  const settled = payment.mode === "metered-escrow" ? { ...computed, fee: input.settledFeeLamports!, provider: computed.amount - input.settledFeeLamports! } : computed;
  // A media provider's receipt also names the unit, the units delivered and the file. Simulated payments only for now:
  // reddi.receipt.v2 has no field for them yet, so a paid receipt never carries them.
  const media = !paid && settled.delivery ? provider.media : undefined;
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
              ...(media ? { unit: media.unit, units: String(settled.delivery!.units) } : {}),
            },
          }),
    },
    ...(media
      ? {
          delivery: {
            name: media.delivered.name,
            mediaType: media.mediaType,
            bytes: String(settled.delivery!.bytes),
            sha256: await sha256Hex(sandboxFileStandIn(provider)!),
            expiresAt: new Date(Date.parse(input.issuedAt) + media.hostingDays * 24 * 3600 * 1000).toISOString(),
          },
        }
      : {}),
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
    // A metered escrow is offered only when this provider can settle and devnet runs a build the sandbox can settle with.
    const meteredOffered = !provider.simulatedOnly && deps.settler?.canSettle(provider.id) === true && (await deps.settler.deployment()).ok;
    const challenge = sandboxChallenge(provider, request.origin, (deps.newNonce ?? randomNonce)(), inputTokens);
    return respond(
      402,
      {
        error: { code: "payment_required", message: "x402 payment is required before the provider answers." },
        x402: challenge,
        sandbox: {
          simulatedPayment: `Resend with header x402-payment: demo:${challenge.nonce}`,
          ...(provider.simulatedOnly
            ? { simulatedOnly: `${provider.name} takes simulated payments only in the sandbox. A devnet transfer or escrow to it is refused before anything is read.` }
            : { devnetPayment: "Or transfer the amount in devnet SOL to payTo from your own wallet and resend with a JSON x402-payment receipt naming txSignature and payer." }),
          ...(meteredOffered
            ? {
                meteredPayment: `Or lock the amount with lock_metered_escrow on ${SANDBOX_ESCROW_PROGRAM_ID.toBase58()} (payee payTo, nonce the challenge nonce as 16 bytes) and resend with a JSON x402-payment naming settlement "metered-escrow", payer, escrow and nonce. The provider settles the actual tokens and the rest comes back to you.`,
              }
            : {}),
          sessionPayment: `Or pay many calls from one lock: lock a session maximum (at least the amount above, up to ${SANDBOX_MAX_SESSION_CALLS} calls), send the same x402-payment with ${SESSION_SEQUENCE_HEADER}: 1, 2, 3 …, pass each previous call's receipt back in ${SESSION_PREVIOUS_RECEIPT_HEADER}, and send ${SESSION_CLOSE_HEADER}: close on the last call. The provider settles the running total once.`,
          pricing: provider.media
            ? `The amount is the most this call can cost: up to ${provider.media.maxUnits} ${provider.media.unitLabel}s at ${provider.media.perUnitUsd} USD each, plus hosting the file for ${provider.media.hostingDays} days at ${provider.media.hostingPerGbUsd} USD per GB, paid in devnet SOL at a demo rate. The provider settles what it delivered and the rest comes back.`
            : `The amount is the most this call can cost: ${inputTokens} input tokens plus ${provider.pricing.maxOutputTokens} output tokens at ${provider.pricing.inputPerMillionUsd} and ${provider.pricing.outputPerMillionUsd} USD per million, paid in devnet SOL at a demo rate.`,
        },
      },
      { "x402-request": JSON.stringify(challenge) },
    );
  }

  if (request.session?.sequence != null && request.session.sequence.trim() !== "") {
    if (provider.media) return sessionRefusal("session_invalid", `${provider.name} bills per file delivered, one job per call, so it does not take session calls.`);
    return handleSessionCall({ request, deps, provider, messages, model, inputTokens, header });
  }

  const retryOf = request.settleSignature?.trim();
  if (retryOf) return recoverSettledCall({ request, deps, provider, messages, model, inputTokens, header, settleSignature: retryOf });

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
  let settledFeeLamports: bigint | undefined;
  if (payment.mode === "metered-escrow") {
    // The provider settles the actual tokens before it answers, so the answer
    // and its receipt name a settle transaction that already happened.
    const settled = settleSandboxCall(provider, { inputTokens, outputTokens: countTokens(answer) }, payment.maxLamports);
    const result = deps.settler
      ? await deps.settler.settle({ providerId: provider.id, escrow: new PublicKey(payment.escrow), payer: new PublicKey(payment.payerAddress), payee: new PublicKey(provider.payTo), actualLamports: settled.amount, rated: payment.rated, createdSlot: payment.createdSlot })
      : { ok: false as const, message: "No settler is configured." };
    if (!result.ok && result.pending) return settlePending(result.signature, result.message, payment.escrow, true);
    if (!result.ok) {
      return failure(502, "settle_failed", `${result.message} Your maximum stays locked in escrow ${payment.escrow}; nothing was charged, and you can cancel it for a full refund once its refund window has elapsed, about 30 minutes after the lock.`, { charged: false, escrow: payment.escrow });
    }
    settleSignature = result.signature;
    settledFeeLamports = result.feeLamports;
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
  const receipt = await writeReceipt({ provider, requestBody: request.rawBody, responseBody: response.bodyText, payment, inputTokens, answer, issuedAt: new Date(nowMs).toISOString(), settleSignature, settledFeeLamports });
  response.headers[payment.mode !== "simulated" ? PROVIDER_RECEIPT_HEADER : SANDBOX_SIMULATED_RECEIPT_HEADER] = encodeReceiptHeader(receipt);
  return response;
}

/**
 * The settle was signed and may have landed, but its outcome is not known (audit S7-Codex-R2-04).
 * The escrow may already be paid out, so the payer is not told nothing was charged nor pointed at a
 * refund. A single call's answer is kept for the payer: the same signed request, sent again with
 * `SETTLE_SIGNATURE_HEADER`, is answered once that settle is confirmed.
 */
function settlePending(signature: string, reason: string, escrow: string, retrievable: boolean): SandboxGatewayResponse {
  const next = retrievable
    ? `Send the same request again with header ${SETTLE_SIGNATURE_HEADER}: ${signature} to collect the answer once it has landed. If it did not land, that retry says so and the escrow stays locked for a full refund after its refund window.`
    : `Look up ${signature} on devnet before you cancel: if it landed, the session was settled; if not, the escrow stays locked for a full refund after its refund window.`;
  return failure(202, "settle_pending", `${reason} You may have been charged, so do not cancel the escrow yet. ${next}`, { charged: "unknown", escrow, settleSignature: signature });
}

/**
 * A single metered call's retry after `settle_pending`: answers when the named settle is confirmed
 * and is the settle of this payer's escrow for exactly this request. The payer's signature over the
 * request is checked as on the first call, so only the payer collects the answer. The sandbox's
 * answers are scripted, so the answer is the one the settle paid for.
 */
async function recoverSettledCall(input: { request: SandboxGatewayRequest; deps: SandboxGatewayDeps; provider: SandboxProvider; messages: SandboxChatMessage[]; model: string; inputTokens: number; header: string; settleSignature: string }): Promise<SandboxGatewayResponse> {
  const { request, deps, provider, inputTokens, settleSignature } = input;
  const refuse = (message: string) => failure(402, "payment_rejected", message, { reason: "invalid_receipt" });
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(settleSignature)) return refuse(`${SETTLE_SIGNATURE_HEADER} must be a transaction signature.`);
  if (!deps.settler) return refuse("No settler is configured.");
  const parsed = parseX402PaymentHeader(input.header);
  const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  const nonce = typeof record?.nonce === "string" ? record.nonce : "";
  if (!record || record.settlement !== "metered-escrow" || !NONCE_PATTERN.test(nonce)) return refuse("A retry after settle_pending carries the same metered x402-payment as the first call.");
  let payer: PublicKey;
  let escrow: PublicKey;
  try {
    payer = new PublicKey(record.payer as string);
    escrow = new PublicKey(String(record.escrow));
  } catch {
    return refuse("A metered payment must name the payer and the escrow address.");
  }
  if (!escrow.equals(sandboxEscrowAddress(payer, nonce))) return refuse("The escrow address is not the one this payer and challenge nonce give.");
  const auth = await verifySingleCallAuth(record, provider, request, deps);
  if (!auth.ok) {
    if (!auth.outcome.ok && auth.outcome.sessionCode?.startsWith("session_auth_")) return sessionRefusal(auth.outcome.sessionCode, auth.outcome.result.message);
    return refuse(auth.outcome.ok ? "The call is not authorised." : auth.outcome.result.message);
  }
  const maxLamports = maxChargeLamports(provider, inputTokens);
  const prompt = [...input.messages].reverse().find((message) => message.role === "user")?.content ?? input.messages[input.messages.length - 1].content;
  const answer = scriptedSandboxAnswer(provider, prompt);
  const settled = settleSandboxCall(provider, { inputTokens, outputTokens: countTokens(answer) }, maxLamports);
  const found = await deps.settler.lookup(settleSignature, { escrow, payer, payee: new PublicKey(provider.payTo), actualLamports: settled.amount });
  if (found.state === "unknown") return settlePending(settleSignature, `Devnet has not confirmed the settle transaction ${settleSignature} yet.`, escrow.toBase58(), true);
  if (found.state === "failed") {
    return failure(502, "settle_failed", `The settle transaction ${settleSignature} is not a landed settle of this call, so this call was not charged by it. If escrow ${escrow.toBase58()} is still locked, send the call without ${SETTLE_SIGNATURE_HEADER}, or cancel it for a full refund once its refund window has elapsed.`, { charged: false, escrow: escrow.toBase58() });
  }
  const nowMs = (deps.now ?? Date.now)();
  const response = respond(200, {
    id: `chatcmpl-sandbox-${nonce}`,
    object: "chat.completion",
    created: Math.floor(nowMs / 1000),
    model: input.model,
    choices: [{ index: 0, message: { role: "assistant", content: answer }, finish_reason: "stop" }],
    rap_sandbox: { scripted: true, paymentMode: "metered-escrow", spotCheck: simulatedSpotCheck(provider), recoveredFromSettle: true },
  });
  const payment: Extract<PaymentOutcome, { ok: true }> = { ok: true, mode: "metered-escrow", nonce, payerId: payer.toBase58(), payerAddress: payer.toBase58(), escrow: escrow.toBase58(), maxLamports, rated: false, createdSlot: BigInt(0), proofRef: escrow.toBase58() };
  const receipt = await writeReceipt({ provider, requestBody: request.rawBody, responseBody: response.bodyText, payment, inputTokens, answer, issuedAt: new Date(nowMs).toISOString(), settleSignature, settledFeeLamports: found.feeLamports });
  response.headers[PROVIDER_RECEIPT_HEADER] = encodeReceiptHeader(receipt);
  return response;
}

function sessionRefusal(code: SessionRefusalCode, message: string): SandboxGatewayResponse {
  const status = code.startsWith("session_auth_") ? 401 : code === "session_max_reached" || code === "session_sequence_invalid" || code === "session_closed" ? 409 : 402;
  return failure(status, code, message, { charged: false });
}

type SessionLock = { mode: "simulated" | "metered-escrow"; escrow: string; payer?: string; maxLamports: bigint; nonce: string; createdSlot?: bigint };

/** The lock a session call presents: a simulated session maximum or a metered escrow on devnet. */
async function verifySessionLock(header: string, provider: SandboxProvider, origin: string, inputTokens: number, deps: SandboxGatewayDeps, auth: { request: SandboxGatewayRequest; sequence: number; close: boolean }): Promise<{ ok: true; lock: SessionLock } | { ok: false; response: SandboxGatewayResponse }> {
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
  if (provider.simulatedOnly) return refuse("session_invalid", `${provider.name} takes simulated payments only in the sandbox.`);
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
    genesisHash: SOLANA_GENESIS_HASHES[SANDBOX_NETWORK],
    // Whether the call asks to settle is signed too, so it cannot be added or removed in transit.
    action: sessionCallAction(auth.close),
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

  const verified = await verifySessionLock(input.header, provider, request.origin, inputTokens, deps, { request, sequence, close });
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
  let sessionFeeLamports: bigint | undefined;
  if (close && lock.mode === "metered-escrow") {
    const result = deps.settler
      ? await deps.settler.settle({ providerId: provider.id, escrow: new PublicKey(lock.escrow), payer: new PublicKey(lock.payer!), payee: new PublicKey(provider.payTo), actualLamports: cumulative, rated: false, createdSlot: lock.createdSlot! })
      : { ok: false as const, message: "No settler is configured." };
    if (!result.ok && result.pending) return settlePending(result.signature, result.message, lock.escrow, false);
    if (!result.ok) {
      return failure(502, "settle_failed", `${result.message} The session's maximum stays locked in escrow ${lock.escrow}; nothing was charged, and you can cancel it for a full refund once its refund window has elapsed.`, { charged: false, escrow: lock.escrow });
    }
    settleSignature = result.signature;
    sessionFeeLamports = result.feeLamports;
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
    // A settled session's fee is what the treasury received in its settle (audit S7-Codex-R2-05); a
    // simulated session shows the arithmetic at today's rate, with no transaction.
    const fee = sessionFeeLamports ?? (cumulative * sandboxFeeBps()) / BigInt(10_000);
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
  const deploymentOk = settler ? (await settler.deployment()).ok : false;
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
        ...(provider.simulatedOnly ? { simulatedPaymentsOnly: true } : {}),
        ...(provider.studio ? { studio: provider.studio } : {}),
        ...(provider.media
          ? { mediaPricing: { unit: provider.media.unit, unitLabel: provider.media.unitLabel, perUnitUsd: provider.media.perUnitUsd, maxUnits: provider.media.maxUnits, mediaType: provider.media.mediaType, hostingDays: provider.media.hostingDays, hostingPerGbUsd: provider.media.hostingPerGbUsd } }
          : {}),
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
        meteredEscrow: { available: provider.behaviour !== "offline" && !provider.simulatedOnly && (settler?.canSettle(provider.id) ?? false) && deploymentOk, programId: SANDBOX_ESCROW_PROGRAM_ID.toBase58(), acceptsRatedEscrows: acceptRatedEscrows === true },
        // The base58 address receipts from this provider name as providerId. A published test key, not a wallet.
        receiptProviderId: await sandboxProviderAddress(provider.id),
      },
    }))),
  };
}
