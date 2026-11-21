/**
 * Sandbox inference receipts.
 *
 * A call paid with a real devnet transfer returns a signed `reddi.receipt.v2`
 * receipt (packages/agent-protocol/src/receipt-v2.ts): the same fields, the
 * same signed bytes and the same response header a V1 provider uses.
 *
 * A simulated payment has no transaction, and v2 requires one, so a simulated
 * call returns a sandbox-only receipt instead. It has the v2 field layout
 * without `payment.txSignature`, carries its own version string as the first
 * signed field, and is refused by every v2 validator. It exists so a visitor
 * without a wallet can still see what a receipt check looks like.
 *
 * The provider signature shows what the provider declared. The model named in
 * a receipt is a declaration, not proof of which model ran.
 *
 * This module is isomorphic: it uses only WebCrypto, so the browser verifies a
 * receipt with the same code the gateway tests hold to the package verifier.
 */

export const REDDI_RECEIPT_V2_VERSION = "reddi.receipt.v2" as const;
export const SANDBOX_SIMULATED_RECEIPT_VERSION = "reddi.sandbox.simulated-receipt.v1" as const;
export const SANDBOX_PROOF_TYPE = "ed25519" as const;
/** Response header for a signed v2 receipt: base64url of the JSON. Same name the V1 runtime uses. */
export const PROVIDER_RECEIPT_HEADER = "x-reddi-provider-receipt";
/** Response header for a simulated sandbox receipt: base64url of the JSON. */
export const SANDBOX_SIMULATED_RECEIPT_HEADER = "x-reddi-sandbox-simulated-receipt";

export type SandboxReceiptPayment = {
  network: "solana-devnet";
  /** Present on a v2 receipt. A simulated receipt has no transaction. */
  txSignature?: string;
  currency: "SOL";
  /** Lamports paid, as a decimal string. For a metered call, the actual cost. */
  amount: string;
  /** Protocol fee taken out of `amount`; `treasury` is named when it is above zero. */
  fee: { amount: string; treasury?: string };
  payer?: string;
  settlement: "direct" | "metered-escrow";
  /** Tokens used and the maximum the buyer authorised, on a metered call. */
  metered?: { inputTokens: string; outputTokens: string; maxAmount: string; refunded: string };
};

/**
 * One call of a session (#863): many calls paid from one metered escrow lock
 * and settled once. Field order and meaning match `ReddiReceiptV2Session` in
 * the package. A simulated session has no escrow on chain, so its `escrow` is
 * `simulated:<nonce>` and it names no payer.
 */
export type SandboxReceiptSession = {
  escrow: string;
  payer?: string;
  network: "solana-devnet";
  currency: "SOL";
  maxAmount: string;
  sequence: string;
  inputTokens: string;
  outputTokens: string;
  cumulativeInputTokens: string;
  cumulativeOutputTokens: string;
  cumulativeCost: string;
  previousReceiptHash?: string;
  closed: boolean;
};

export type SandboxReceiptBody = {
  schemaVersion: typeof REDDI_RECEIPT_V2_VERSION | typeof SANDBOX_SIMULATED_RECEIPT_VERSION;
  /** Base58 address of the sandbox provider's test key. The signature verifies against it. */
  providerId: string;
  /** The model the provider says it served. Declared, not proven. */
  declaredModel: string;
  /** SHA-256 of the request body bytes, lowercase hex. */
  requestHash: string;
  /** SHA-256 of the response body bytes, lowercase hex. */
  responseHash: string;
  /** Absent only on a session call before the session settles. */
  payment?: SandboxReceiptPayment;
  /** Present on every call of a session. */
  session?: SandboxReceiptSession;
  issuedAt: string;
};

export type SandboxReceipt = {
  receipt: SandboxReceiptBody;
  proof: { type: typeof SANDBOX_PROOF_TYPE; /** Base64 of the 64-byte signature. */ signature: string };
};

export type SandboxChatMessage = { role: string; content: string };

function subtle(): SubtleCrypto {
  const api = globalThis.crypto?.subtle;
  if (!api) throw new Error("WebCrypto is not available in this environment");
  return api;
}

/** UTF-8 bytes in a plain ArrayBuffer, the form WebCrypto accepts. */
export function utf8Bytes(text: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(text);
  const bytes = new Uint8Array(new ArrayBuffer(encoded.length));
  bytes.set(encoded);
  return bytes;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function fromHex(text: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[0-9a-f]{2})*$/.test(text)) throw new Error("not lowercase hex");
  const bytes = new Uint8Array(new ArrayBuffer(text.length / 2));
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(text.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

/** SHA-256 of the UTF-8 bytes of a body, lowercase hex. The hash a receipt commits to. */
export async function sha256Hex(text: string): Promise<string> {
  return toHex(new Uint8Array(await subtle().digest("SHA-256", utf8Bytes(text))));
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Encode(bytes: Uint8Array): string {
  let value = BigInt(0);
  for (const byte of bytes) value = value * BigInt(256) + BigInt(byte);
  let out = "";
  while (value > BigInt(0)) {
    out = BASE58[Number(value % BigInt(58))] + out;
    value /= BigInt(58);
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

/** Decodes a base58 address to exactly 32 bytes, or undefined. */
export function base58Decode32(text: string): Uint8Array<ArrayBuffer> | undefined {
  if (text.length < 32 || text.length > 44) return undefined;
  let value = BigInt(0);
  for (const char of text) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) return undefined;
    value = value * BigInt(58) + BigInt(digit);
  }
  const bytes = new Uint8Array(new ArrayBuffer(32));
  for (let index = 31; index >= 0; index -= 1) {
    bytes[index] = Number(value & BigInt(0xff));
    value >>= BigInt(8);
  }
  if (value !== BigInt(0)) return undefined;
  return base58Encode(bytes) === text ? bytes : undefined;
}

function base64ToBytes(text: string): Uint8Array<ArrayBuffer> | undefined {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return undefined;
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return undefined;
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * The exact bytes the provider signs: JSON with a fixed field order and no
 * whitespace. For a v2 receipt this is byte for byte what
 * `canonicalizeReddiReceiptV2` in the package produces; the gateway tests hold
 * the two together.
 */
export function canonicalizeSandboxReceipt(receipt: SandboxReceiptBody): string {
  const p = receipt.payment;
  const s = receipt.session;
  return JSON.stringify({
    schemaVersion: receipt.schemaVersion,
    providerId: receipt.providerId,
    declaredModel: receipt.declaredModel,
    requestHash: receipt.requestHash,
    responseHash: receipt.responseHash,
    ...(p !== undefined ? { payment: {
      network: p.network,
      ...(p.txSignature !== undefined ? { txSignature: p.txSignature } : {}),
      currency: p.currency,
      amount: p.amount,
      fee: { amount: p.fee.amount, ...(p.fee.treasury !== undefined ? { treasury: p.fee.treasury } : {}) },
      ...(p.payer !== undefined ? { payer: p.payer } : {}),
      settlement: p.settlement,
      ...(p.metered !== undefined
        ? { metered: { inputTokens: p.metered.inputTokens, outputTokens: p.metered.outputTokens, maxAmount: p.metered.maxAmount, refunded: p.metered.refunded } }
        : {}),
    } } : {}),
    ...(s !== undefined
      ? {
          session: {
            escrow: s.escrow,
            ...(s.payer !== undefined ? { payer: s.payer } : {}),
            network: s.network,
            currency: s.currency,
            maxAmount: s.maxAmount,
            sequence: s.sequence,
            inputTokens: s.inputTokens,
            outputTokens: s.outputTokens,
            cumulativeInputTokens: s.cumulativeInputTokens,
            cumulativeOutputTokens: s.cumulativeOutputTokens,
            cumulativeCost: s.cumulativeCost,
            ...(s.previousReceiptHash !== undefined ? { previousReceiptHash: s.previousReceiptHash } : {}),
            closed: s.closed,
          },
        }
      : {}),
    issuedAt: receipt.issuedAt,
  });
}

/** SHA-256 of a receipt's signed bytes: what the next call of a session names as `previousReceiptHash`. */
export async function hashSandboxReceipt(receipt: SandboxReceiptBody): Promise<string> {
  return sha256Hex(canonicalizeSandboxReceipt(receipt));
}

export function encodeReceiptHeader(receipt: SandboxReceipt): string {
  return bytesToBase64(utf8Bytes(JSON.stringify(receipt))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Reads a receipt header value. Returns undefined for anything that is not base64url JSON. */
export function decodeReceiptHeader(value: string | null | undefined): unknown {
  if (!value || value.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const bytes = base64ToBytes(padded);
  if (!bytes) return undefined;
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return undefined;
  }
}

/**
 * The response body with the answer text replaced. With the original answer it
 * returns the body unchanged, byte for byte, so its hash still matches.
 */
export function responseBodyWithAnswer(responseBody: string, originalAnswer: string, answer: string): string {
  if (answer === originalAnswer) return responseBody;
  try {
    const parsed = JSON.parse(responseBody) as { choices?: Array<{ message?: { content?: unknown } }> };
    const message = parsed.choices?.[0]?.message;
    if (!message) return `${responseBody}\n${answer}`;
    message.content = answer;
    return JSON.stringify(parsed);
  } catch {
    return `${responseBody}\n${answer}`;
  }
}

export type SandboxVerificationCheck = {
  id: "shape" | "request-hash" | "response-hash" | "provider-key" | "signature" | "payment";
  label: string;
  passed: boolean;
  detail: string;
};

export type SandboxVerification = {
  ok: boolean;
  /** "v2" for a signed reddi.receipt.v2, "simulated" for the sandbox-only form. */
  kind?: "v2" | "simulated";
  checks: SandboxVerificationCheck[];
};

export type VerifySandboxReceiptInput = {
  receipt: unknown;
  /** The request body bytes the buyer sent, as text. */
  requestBody: string;
  /** The response body bytes the buyer holds, as text. */
  responseBody: string;
  /** The model the buyer asked for. */
  model: string;
  /** Provider address the buyer expects, from the models listing. */
  expectedProviderId?: string;
  /** What the buyer knows it paid. Each field given is compared. */
  /** `amount` is what the buyer paid or, on a metered call, the maximum it locked. */
  expectedPayment?: { amount?: string; txSignature?: string; payer?: string };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const HASH = /^[0-9a-f]{64}$/;
const TX_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const BASE_UNITS = /^(0|[1-9]\d{0,29})$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const RECEIPT_KEYS = ["schemaVersion", "providerId", "declaredModel", "requestHash", "responseHash", "payment", "session", "issuedAt"];
const SESSION_KEYS = ["escrow", "payer", "network", "currency", "maxAmount", "sequence", "inputTokens", "outputTokens", "cumulativeInputTokens", "cumulativeOutputTokens", "cumulativeCost", "previousReceiptHash", "closed"];
const SESSION_COUNTS = ["maxAmount", "sequence", "inputTokens", "outputTokens", "cumulativeInputTokens", "cumulativeOutputTokens", "cumulativeCost"];
const SIMULATED_ESCROW = /^simulated:[0-9a-f]{32}$/;

/** The session block's own rules, and how it agrees with the payment on the closing receipt. */
function isSessionBlock(session: unknown, payment: unknown, simulated: boolean): boolean {
  if (!isRecord(session) || !onlyKeys(session, SESSION_KEYS)) return false;
  if (simulated) {
    if (typeof session.escrow !== "string" || !SIMULATED_ESCROW.test(session.escrow) || session.payer !== undefined) return false;
  } else if (typeof session.escrow !== "string" || !base58Decode32(session.escrow) || typeof session.payer !== "string" || !base58Decode32(session.payer)) {
    return false;
  }
  if (session.network !== "solana-devnet" || session.currency !== "SOL" || typeof session.closed !== "boolean") return false;
  if (!SESSION_COUNTS.every((key) => typeof session[key] === "string" && BASE_UNITS.test(session[key] as string))) return false;
  const n = (key: string) => BigInt(session[key] as string);
  if (n("sequence") < BigInt(1) || n("cumulativeCost") > n("maxAmount")) return false;
  if (n("cumulativeInputTokens") < n("inputTokens") || n("cumulativeOutputTokens") < n("outputTokens")) return false;
  if (n("sequence") === BigInt(1)) {
    if (session.previousReceiptHash !== undefined || n("cumulativeInputTokens") !== n("inputTokens") || n("cumulativeOutputTokens") !== n("outputTokens")) return false;
  } else if (typeof session.previousReceiptHash !== "string" || !HASH.test(session.previousReceiptHash)) {
    return false;
  }
  if (payment === undefined) return session.closed === false;
  if (session.closed !== true || !isRecord(payment) || !isRecord(payment.metered)) return false;
  return payment.settlement === "metered-escrow"
    && payment.amount === session.cumulativeCost
    && (payment.payer === undefined || payment.payer === session.payer)
    && payment.metered.inputTokens === session.cumulativeInputTokens
    && payment.metered.outputTokens === session.cumulativeOutputTokens
    && payment.metered.maxAmount === session.maxAmount;
}
const PAYMENT_KEYS = ["network", "txSignature", "currency", "amount", "fee", "payer", "settlement", "metered"];
const METERED_KEYS = ["inputTokens", "outputTokens", "maxAmount", "refunded"];

const onlyKeys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every((key) => allowed.includes(key));

/** Structural check. A v2 receipt must name a transaction; a simulated one must not. */
export function isSandboxReceipt(value: unknown): value is SandboxReceipt {
  if (!isRecord(value) || !onlyKeys(value, ["receipt", "proof"])) return false;
  const { receipt, proof } = value;
  if (!isRecord(proof) || !onlyKeys(proof, ["type", "signature"]) || proof.type !== SANDBOX_PROOF_TYPE || typeof proof.signature !== "string") return false;
  if (!isRecord(receipt) || !onlyKeys(receipt, RECEIPT_KEYS)) return false;
  const simulated = receipt.schemaVersion === SANDBOX_SIMULATED_RECEIPT_VERSION;
  if (!simulated && receipt.schemaVersion !== REDDI_RECEIPT_V2_VERSION) return false;
  if (typeof receipt.providerId !== "string" || !base58Decode32(receipt.providerId)) return false;
  if (typeof receipt.declaredModel !== "string" || receipt.declaredModel.length === 0 || receipt.declaredModel.length > 200) return false;
  if (typeof receipt.requestHash !== "string" || !HASH.test(receipt.requestHash)) return false;
  if (typeof receipt.responseHash !== "string" || !HASH.test(receipt.responseHash)) return false;
  if (typeof receipt.issuedAt !== "string" || !ISO_UTC.test(receipt.issuedAt)) return false;
  const payment = receipt.payment;
  if (receipt.session !== undefined && !isSessionBlock(receipt.session, payment, simulated)) return false;
  // A session call before the settle states no payment: the session block states what the lock owes.
  if (payment === undefined) return receipt.session !== undefined;
  if (!isRecord(payment) || !onlyKeys(payment, PAYMENT_KEYS)) return false;
  if (payment.network !== "solana-devnet" || payment.currency !== "SOL") return false;
  if (typeof payment.amount !== "string" || !BASE_UNITS.test(payment.amount) || payment.amount === "0") return false;
  const fee = payment.fee;
  if (!isRecord(fee) || !onlyKeys(fee, ["amount", "treasury"]) || typeof fee.amount !== "string" || !BASE_UNITS.test(fee.amount)) return false;
  if (fee.treasury !== undefined && (typeof fee.treasury !== "string" || !base58Decode32(fee.treasury))) return false;
  if ((fee.amount === "0") !== (fee.treasury === undefined)) return false;
  if (BigInt(fee.amount) >= BigInt(payment.amount)) return false;
  if (payment.settlement === "metered-escrow") {
    // A simulated call or a devnet metered escrow; a direct devnet transfer pays the maximum and is never metered.
    const metered = payment.metered;
    if (!isRecord(metered) || !onlyKeys(metered, METERED_KEYS) || !METERED_KEYS.every((key) => typeof metered[key] === "string" && BASE_UNITS.test(metered[key] as string))) return false;
    const max = BigInt(metered.maxAmount as string);
    if (BigInt(payment.amount) > max || BigInt(metered.refunded as string) !== max - BigInt(payment.amount)) return false;
  } else if (payment.settlement !== "direct" || payment.metered !== undefined || fee.amount !== "0") {
    return false;
  }
  if (payment.payer !== undefined && (typeof payment.payer !== "string" || !base58Decode32(payment.payer))) return false;
  if (simulated) return payment.txSignature === undefined && payment.payer === undefined;
  return typeof payment.txSignature === "string" && TX_SIGNATURE.test(payment.txSignature);
}

/** True when the proof is the provider's Ed25519 signature over the receipt's canonical bytes. */
export async function sandboxReceiptSignatureValid(value: SandboxReceipt): Promise<boolean> {
  const rawKey = base58Decode32(value.receipt.providerId);
  const signature = base64ToBytes(value.proof.signature);
  if (!rawKey || !signature || signature.length !== 64) return false;
  const key = await subtle().importKey("raw", rawKey, { name: "Ed25519" }, false, ["verify"]);
  return subtle().verify({ name: "Ed25519" }, key, signature, utf8Bytes(canonicalizeSandboxReceipt(value.receipt)));
}

/**
 * Verifies a sandbox receipt against the request and response the buyer holds.
 * Every check runs, so the caller can show exactly which one failed.
 */
export async function verifySandboxReceipt(input: VerifySandboxReceiptInput): Promise<SandboxVerification> {
  const checks: SandboxVerificationCheck[] = [];
  if (!isSandboxReceipt(input.receipt)) {
    checks.push({ id: "shape", label: "Receipt is well formed", passed: false, detail: "Not a signed reddi.receipt.v2 receipt or a sandbox simulated receipt." });
    return { ok: false, checks };
  }
  const { receipt, proof } = input.receipt;
  const kind = receipt.schemaVersion === REDDI_RECEIPT_V2_VERSION ? "v2" : "simulated";
  checks.push({
    id: "shape",
    label: "Receipt is well formed",
    passed: true,
    detail: kind === "v2"
      ? "A reddi.receipt.v2 receipt naming a devnet transaction."
      : "A sandbox simulated receipt. It names no transaction, so it is not a reddi.receipt.v2 receipt.",
  });

  const requestHash = await sha256Hex(input.requestBody);
  const requestMatches = requestHash === receipt.requestHash && receipt.declaredModel === input.model;
  checks.push({
    id: "request-hash",
    label: "Request matches the receipt",
    passed: requestMatches,
    detail: requestHash !== receipt.requestHash
      ? "The request you sent does not hash to the value in the receipt."
      : receipt.declaredModel !== input.model
        ? "The receipt declares a different model than the one you asked for."
        : `sha256 ${requestHash.slice(0, 16)}… matches.`,
  });

  const responseHash = await sha256Hex(input.responseBody);
  checks.push({
    id: "response-hash",
    label: "Answer matches the receipt",
    passed: responseHash === receipt.responseHash,
    detail: responseHash === receipt.responseHash ? `sha256 ${responseHash.slice(0, 16)}… matches.` : "The response does not hash to the value the provider signed. It was changed after the receipt was written.",
  });

  const keyKnown = input.expectedProviderId === undefined || input.expectedProviderId === receipt.providerId;
  checks.push({
    id: "provider-key",
    label: "Signed by the listed provider key",
    passed: keyKnown,
    detail: keyKnown ? "The provider address is the one the models listing shows for this provider." : "The receipt names a different provider address than the listed one.",
  });

  let signatureValid = false;
  let signatureDetail = "The provider signature does not cover these receipt fields.";
  try {
    const rawKey = base58Decode32(receipt.providerId);
    const signature = base64ToBytes(proof.signature);
    if (!rawKey || !signature || signature.length !== 64) throw new Error("malformed");
    const key = await subtle().importKey("raw", rawKey, { name: "Ed25519" }, false, ["verify"]);
    signatureValid = await subtle().verify({ name: "Ed25519" }, key, signature, utf8Bytes(canonicalizeSandboxReceipt(receipt)));
    if (signatureValid) signatureDetail = "Ed25519 signature covers provider, declared model, both hashes and the payment fields.";
  } catch (error) {
    signatureDetail = error instanceof Error && /Ed25519|algorithm|supported/i.test(error.message)
      ? "This browser cannot verify Ed25519 signatures."
      : "The provider signature or address is malformed.";
  }
  checks.push({ id: "signature", label: "Provider signature is valid", passed: signatureValid, detail: signatureDetail });

  const payment = receipt.payment;
  if (!payment) {
    const session = receipt.session!;
    checks.push({
      id: "payment",
      label: "Payment fields match what you paid",
      passed: true,
      detail: `Session call ${session.sequence}: nothing has moved yet. The lock owes ${session.cumulativeCost} lamports so far, settled once when the session closes.`,
    });
    return { ok: checks.every((check) => check.passed), kind, checks };
  }
  const expected = input.expectedPayment ?? {};
  const mismatched = [
    expected.amount !== undefined && expected.amount !== (payment.metered?.maxAmount ?? payment.amount) ? "amount" : undefined,
    expected.txSignature !== undefined && expected.txSignature !== payment.txSignature ? "transaction" : undefined,
    expected.payer !== undefined && expected.payer !== payment.payer ? "payer" : undefined,
  ].filter((entry): entry is string => entry !== undefined);
  checks.push({
    id: "payment",
    label: "Payment fields match what you paid",
    passed: mismatched.length === 0,
    detail: mismatched.length > 0
      ? `The receipt states a different ${mismatched.join(" and ")} than you paid.`
      : kind === "v2"
        ? "Currency, amount, fee, payer and transaction are the ones you paid with."
        : payment.metered
          ? "Simulated: the maximum matches the challenge, the cost is what the tokens used come to, and the rest of the maximum is returned. No transaction is named."
          : "Simulated: the amount matches the challenge and no transaction is named.",
  });

  return { ok: checks.every((check) => check.passed), kind, checks };
}
