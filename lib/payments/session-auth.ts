/**
 * The buyer's side of session authorisation (provider kit, #865), for the
 * browser as well as Node: the payer wallet signs one delegation to a fresh
 * session key, and the session key signs each call. Uses WebCrypto only, so
 * it runs where the package's Node-crypto module cannot. The tests hold these
 * to the package's own message formats and verifier.
 */

import { PublicKey } from "@solana/web3.js";

export const SESSION_DELEGATION_HEADER = "x402-session-delegation";
export const SESSION_SIGNATURE_HEADER = "x402-session-signature";

/** `call`, `close`, `read`: session requests. `single`: a single metered call, sequence 0 (#866). */
export type SessionAction = "call" | "close" | "read" | "single";

export interface SessionDelegation {
  escrow: string;
  provider: string;
  sessionKey: string;
  /** Whole seconds since the epoch. */
  expiresAt: number;
}

export type MessageSigner = (message: Uint8Array) => Uint8Array | Promise<Uint8Array>;

/** The text the payer wallet signs. Same text as the package's `sessionDelegationMessage`. */
export function sessionDelegationMessage(d: SessionDelegation): string {
  return [
    "Reddi Agent Protocol session",
    "I let this session key make paid calls on my escrow lock.",
    `escrow: ${d.escrow}`,
    `provider: ${d.provider}`,
    `session key: ${d.sessionKey}`,
    `expires: ${new Date(d.expiresAt * 1000).toISOString()}`,
  ].join("\n");
}

function subtle(): SubtleCrypto {
  const api = globalThis.crypto?.subtle;
  if (!api) throw new Error("WebCrypto is not available in this environment");
  return api;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function utf8(text: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(text);
  const out = new Uint8Array(new ArrayBuffer(encoded.length));
  out.set(encoded);
  return out;
}

async function sha256Hex(body: string): Promise<string> {
  const digest = new Uint8Array(await subtle().digest("SHA-256", utf8(body)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The bytes the session key signs for one request: call number for `call`, 0 for `close`, `read` and `single`. */
export async function sessionRequestMessage(input: { action: SessionAction; escrow: string; sequence: number; body?: string }): Promise<string> {
  return ["reddi-session/1", input.action, input.escrow, String(input.sequence), await sha256Hex(input.body ?? "")].join("\n");
}

/** A fresh session key held in memory. Its private half never leaves this object. */
export async function createSessionKey(): Promise<{ publicKey: string; sign: MessageSigner }> {
  const pair = (await subtle().generateKey({ name: "Ed25519" }, false, ["sign", "verify"])) as CryptoKeyPair;
  const raw = new Uint8Array(await subtle().exportKey("raw", pair.publicKey));
  return {
    publicKey: new PublicKey(raw).toBase58(),
    sign: async (message) => {
      const bytes = new Uint8Array(new ArrayBuffer(message.length));
      bytes.set(message);
      return new Uint8Array(await subtle().sign({ name: "Ed25519" }, pair.privateKey, bytes));
    },
  };
}

/** The delegation header value, signed by the payer wallet (for example a wallet adapter's `signMessage`). */
export async function sessionDelegationHeaderValue(d: SessionDelegation, signWithPayer: MessageSigner): Promise<string> {
  const signature = await signWithPayer(new TextEncoder().encode(sessionDelegationMessage(d)));
  return base64(new TextEncoder().encode(JSON.stringify({ ...d, signature: base64(signature) })));
}

/** The signature header value for one request, signed by the session key over the exact body sent. */
export async function sessionSignatureHeaderValue(input: { action: SessionAction; escrow: string; sequence: number; body?: string }, signWithSessionKey: MessageSigner): Promise<string> {
  return base64(await signWithSessionKey(new TextEncoder().encode(await sessionRequestMessage(input))));
}

/** Both auth headers for one session call: the delegation made once per session, and this call's signature. */
export async function sessionAuthHeaders(input: { delegation: string; sessionKey: { sign: MessageSigner }; escrow: string; sequence: number; body: string }): Promise<Record<string, string>> {
  return {
    [SESSION_DELEGATION_HEADER]: input.delegation,
    [SESSION_SIGNATURE_HEADER]: await sessionSignatureHeaderValue({ action: "call", escrow: input.escrow, sequence: input.sequence, body: input.body }, input.sessionKey.sign),
  };
}

/**
 * Both auth headers for a single metered call (#866): the delegation, and the
 * key's signature with action `single`, sequence 0, over the exact body sent.
 * Same headers as the package's `paidCallAuthHeaders` with a session key.
 */
export async function paidCallAuthHeaders(input: { delegation: string; sessionKey: { sign: MessageSigner }; escrow: string; body: string }): Promise<Record<string, string>> {
  return {
    [SESSION_DELEGATION_HEADER]: input.delegation,
    [SESSION_SIGNATURE_HEADER]: await sessionSignatureHeaderValue({ action: "single", escrow: input.escrow, sequence: 0, body: input.body }, input.sessionKey.sign),
  };
}

export const PAYMENT_PROOF_HEADER = "x402-payment-proof";
export const PAYMENT_DELEGATION_HEADER = "x402-payment-delegation";

export interface DirectPaymentDelegation {
  /** The provider's payee wallet. */
  provider: string;
  sessionKey: string;
  /** Whole seconds since the epoch. */
  expiresAt: number;
}

/** The text the payer wallet signs to let a key prove its direct payments. Same text as the package's `directPaymentDelegationMessage`. */
export function directPaymentDelegationMessage(d: DirectPaymentDelegation): string {
  return [
    "Reddi Agent Protocol direct payments",
    "I let this key prove my direct payments to this provider.",
    `provider: ${d.provider}`,
    `session key: ${d.sessionKey}`,
    `expires: ${new Date(d.expiresAt * 1000).toISOString()}`,
  ].join("\n");
}

/** The direct-payment delegation header value, signed once by the payer wallet. */
export async function directPaymentDelegationHeaderValue(d: DirectPaymentDelegation, signWithPayer: MessageSigner): Promise<string> {
  const signature = await signWithPayer(new TextEncoder().encode(directPaymentDelegationMessage(d)));
  return base64(new TextEncoder().encode(JSON.stringify({ ...d, signature: base64(signature) })));
}

/**
 * The headers for one request that presents a direct payment (#882): a
 * signature over the network, the transaction, the payee and the body's
 * SHA-256, by the payer or by the key named in `delegation`. Same headers as
 * the package's `directPaymentProofHeaders`.
 */
export async function directPaymentProofHeaders(input: { network: string; txSignature: string; payTo: string; body: string; sign: MessageSigner; delegation?: string }): Promise<Record<string, string>> {
  const message = ["reddi-direct/1", input.network, input.txSignature, input.payTo, await sha256Hex(input.body)].join("\n");
  const proof = base64(await input.sign(new TextEncoder().encode(message)));
  return { [PAYMENT_PROOF_HEADER]: proof, ...(input.delegation ? { [PAYMENT_DELEGATION_HEADER]: input.delegation } : {}) };
}
