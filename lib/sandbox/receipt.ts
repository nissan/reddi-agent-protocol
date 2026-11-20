/**
 * Sandbox inference receipts.
 *
 * A sandbox receipt is a `reddi.receipt.v1` envelope (packages/agent-protocol)
 * with a sandbox preview of the model-naming fields under `metadata.inference`
 * and a provider signature under `metadata.providerSignature`. The final field
 * layout for V1 is an open owner decision (issue 739); nothing here fixes it.
 *
 * This module is isomorphic: it uses only WebCrypto, so the browser verifies a
 * receipt with the same code the server used to write it.
 */
import type { ReddiReceipt } from "@reddi/agent-protocol/receipts";

export const SANDBOX_RECEIPT_PROTOCOL_VERSION = "sandbox-preview-1";
export const SANDBOX_SIGNATURE_ALGORITHM = "ed25519";

export type SandboxInferenceMetadata = {
  providerId: string;
  providerName: string;
  /** The model id the provider says served the call. Declared, not proven. */
  declaredModel: string;
  paymentMode: "simulated" | "devnet-transfer";
  scripted: true;
};

export type SandboxProviderSignature = {
  algorithm: typeof SANDBOX_SIGNATURE_ALGORITHM;
  /** Hex raw 32-byte public key of the sandbox provider. */
  publicKey: string;
  /** Hex signature over the canonical signing payload. */
  value: string;
};

export type SandboxReceipt = ReddiReceipt & {
  metadata: {
    sandbox: true;
    inference: SandboxInferenceMetadata;
    providerSignature: SandboxProviderSignature;
  };
};

/** Deterministic JSON: object keys sorted, no whitespace, undefined dropped. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

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

export async function sha256Hex(text: string): Promise<string> {
  return toHex(new Uint8Array(await subtle().digest("SHA-256", utf8Bytes(text))));
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Hex is used for keys and signatures so no encoded value can resemble a credential string. */
export function fromHex(text: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[0-9a-f]{2})*$/.test(text)) throw new Error("not lowercase hex");
  const bytes = new Uint8Array(new ArrayBuffer(text.length / 2));
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(text.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

export type SandboxChatMessage = { role: string; content: string };

/** The request fields a receipt commits to. */
export function requestHashInput(model: string, messages: readonly SandboxChatMessage[]): string {
  return canonicalJson({ model, messages: messages.map((message) => ({ role: message.role, content: message.content })) });
}

export function hashSandboxRequest(model: string, messages: readonly SandboxChatMessage[]): Promise<string> {
  return sha256Hex(requestHashInput(model, messages));
}

/** The response field a receipt commits to: the assistant text, byte for byte. */
export function hashSandboxResponse(answer: string): Promise<string> {
  return sha256Hex(answer);
}

/**
 * The bytes the provider signs. Everything a buyer relies on is covered: who
 * served, which model they declare, both hashes, and the payment reference.
 */
export function sandboxSigningPayload(receipt: Pick<ReddiReceipt, "schemaVersion" | "job" | "payer" | "specialist" | "payment" | "requestHash" | "responseHash" | "createdAt"> & { metadata: { inference: SandboxInferenceMetadata } }): string {
  return canonicalJson({
    schemaVersion: receipt.schemaVersion,
    jobId: receipt.job.id,
    payerId: receipt.payer.id,
    providerId: receipt.specialist.id,
    declaredModel: receipt.metadata.inference.declaredModel,
    paymentMode: receipt.metadata.inference.paymentMode,
    payment: {
      network: receipt.payment.network,
      asset: receipt.payment.asset,
      amount: receipt.payment.amount,
      paymentProofRef: receipt.payment.paymentProofRef,
    },
    requestHash: receipt.requestHash,
    responseHash: receipt.responseHash,
    createdAt: receipt.createdAt,
  });
}

export type SandboxVerificationCheck = {
  id: "shape" | "request-hash" | "response-hash" | "provider-key" | "signature";
  label: string;
  passed: boolean;
  detail: string;
};

export type SandboxVerification = { ok: boolean; checks: SandboxVerificationCheck[] };

export type VerifySandboxReceiptInput = {
  receipt: unknown;
  model: string;
  messages: readonly SandboxChatMessage[];
  /** The answer text the buyer actually holds. */
  answer: string;
  /** Public key the buyer expects for this provider, from the models listing. */
  expectedPublicKey?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/**
 * Structural check of the fields verification reads. The full reddi.receipt.v1
 * validator lives in packages/agent-protocol; its sources use ESM `.js` import
 * specifiers the app bundler does not resolve, so the app imports only its types
 * and the gateway tests hold every sandbox receipt to that validator instead.
 */
function isSandboxReceipt(value: unknown): value is SandboxReceipt {
  if (!isRecord(value) || value.schemaVersion !== "reddi.receipt.v1") return false;
  const { job, payer, specialist, payment, metadata } = value;
  if (!isRecord(job) || !isText(job.id) || !isRecord(payer) || !isText(payer.id) || !isRecord(specialist) || !isText(specialist.id)) return false;
  if (!isRecord(payment) || !isText(payment.network) || !isText(payment.asset) || !isText(payment.amount) || !isText(payment.paymentProofRef)) return false;
  if (!isText(value.requestHash) || !isText(value.responseHash) || !isText(value.createdAt)) return false;
  if (!isRecord(metadata) || metadata.sandbox !== true) return false;
  const { inference, providerSignature } = metadata;
  return isRecord(inference) && isText(inference.providerId) && isText(inference.declaredModel)
    && (inference.paymentMode === "simulated" || inference.paymentMode === "devnet-transfer")
    && isRecord(providerSignature) && providerSignature.algorithm === SANDBOX_SIGNATURE_ALGORITHM
    && isText(providerSignature.publicKey) && isText(providerSignature.value);
}

/**
 * Verifies a sandbox receipt against the request and answer the buyer holds.
 * Every check runs, so the caller can show exactly which one failed.
 */
export async function verifySandboxReceipt(input: VerifySandboxReceiptInput): Promise<SandboxVerification> {
  const checks: SandboxVerificationCheck[] = [];
  if (!isSandboxReceipt(input.receipt)) {
    checks.push({ id: "shape", label: "Receipt is well formed", passed: false, detail: "Not a reddi.receipt.v1 envelope with sandbox inference fields." });
    return { ok: false, checks };
  }
  const receipt = input.receipt;
  checks.push({ id: "shape", label: "Receipt is well formed", passed: true, detail: "A reddi.receipt.v1 envelope with sandbox inference fields." });

  const requestHash = await hashSandboxRequest(input.model, input.messages);
  checks.push({
    id: "request-hash",
    label: "Request matches the receipt",
    passed: requestHash === receipt.requestHash && receipt.metadata.inference.declaredModel === input.model,
    detail: requestHash === receipt.requestHash ? `sha256 ${requestHash.slice(0, 16)}… matches.` : "The request you sent does not hash to the value in the receipt.",
  });

  const responseHash = await hashSandboxResponse(input.answer);
  checks.push({
    id: "response-hash",
    label: "Answer matches the receipt",
    passed: responseHash === receipt.responseHash,
    detail: responseHash === receipt.responseHash ? `sha256 ${responseHash.slice(0, 16)}… matches.` : "The answer text does not hash to the value the provider signed. It was changed after the receipt was written.",
  });

  const signature = receipt.metadata.providerSignature;
  const keyKnown = input.expectedPublicKey === undefined || input.expectedPublicKey === signature.publicKey;
  checks.push({
    id: "provider-key",
    label: "Signed by the listed provider key",
    passed: keyKnown,
    detail: keyKnown ? "The signing key is the one the models listing shows for this provider." : "The receipt is signed by a different key than the provider's listed key.",
  });

  let signatureValid = false;
  let signatureDetail = "The provider signature does not cover these receipt fields.";
  try {
    const key = await subtle().importKey("raw", fromHex(signature.publicKey), { name: "Ed25519" }, false, ["verify"]);
    signatureValid = await subtle().verify({ name: "Ed25519" }, key, fromHex(signature.value), utf8Bytes(sandboxSigningPayload(receipt)));
    if (signatureValid) signatureDetail = "Ed25519 signature covers provider, declared model, payment reference and both hashes.";
  } catch (error) {
    signatureDetail = error instanceof Error && /Ed25519|algorithm|supported/i.test(error.message)
      ? "This browser cannot verify Ed25519 signatures."
      : "The provider signature or key is malformed.";
  }
  checks.push({ id: "signature", label: "Provider signature is valid", passed: signatureValid, detail: signatureDetail });

  return { ok: checks.every((check) => check.passed), checks };
}
