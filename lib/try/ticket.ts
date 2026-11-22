/**
 * Server only. The try page's ticket (#925): what one paid try is for, sealed
 * with an HMAC so the Solana Pay endpoints can stay stateless across
 * serverless instances. The ticket travels in the Solana Pay link, so it
 * holds nothing secret: the task id, the provider's challenge nonce and
 * maximum, a reference key, and an expiry.
 *
 * The same secret derives the relay key for each ticket: the session key the
 * payer's lock transaction delegates to (the memo binds it), which signs the
 * one call to the provider. It is derived on demand and never stored.
 */
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { Keypair } from "@solana/web3.js";

export const TRY_SECRET_ENV = "TRY_RELAY_SECRET";
/** How long a ticket, and the delegation its lock carries, stays good. */
export const TRY_TICKET_SECONDS = 15 * 60;

export type TryTicket = {
  v: 1;
  /** Random id, 32 hex characters. Names the relay key. */
  id: string;
  taskId: string;
  /** The provider challenge's nonce (32 hex characters), also the escrow nonce. */
  nonce: string;
  /** The most the lock holds, in lamports, as a decimal string. */
  maxLamports: string;
  /** Base58 Solana Pay reference key, added read-only to the lock instruction so the page can find the transaction. */
  reference: string;
  /** Whole seconds since the epoch. */
  exp: number;
};

export class TryNotConfiguredError extends Error {}

/**
 * `TRY_RELAY_SECRET` (at least 32 characters) when set; otherwise derived from
 * the sandbox payee keys the server already holds, with its own label, so the
 * devnet try page works without a new setting. Refuses when neither exists.
 */
export function trySecret(env: Record<string, string | undefined> = process.env): Buffer {
  const own = env[TRY_SECRET_ENV]?.trim();
  if (own && own.length >= 32) return Buffer.from(own, "utf8");
  const payeeKeys = env.SANDBOX_PAYEE_KEYS?.trim();
  if (payeeKeys) return createHmac("sha256", "reddi-try-secret/1").update(payeeKeys, "utf8").digest();
  throw new TryNotConfiguredError("The try page is not configured on this server.");
}

const b64url = (buf: Buffer) => buf.toString("base64url");

function mac(secret: Buffer, payload: string): Buffer {
  return createHmac("sha256", secret).update("reddi-try-ticket/1|").update(payload, "utf8").digest();
}

export function newTicketId(): string {
  return randomBytes(16).toString("hex");
}

export function sealTicket(ticket: TryTicket, secret: Buffer): string {
  const payload = b64url(Buffer.from(JSON.stringify(ticket), "utf8"));
  return `${payload}.${b64url(mac(secret, payload))}`;
}

const HEX32 = /^[0-9a-f]{32}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** The ticket, when the token is well formed, sealed with this secret, and not expired. */
export function openTicket(token: unknown, secret: Buffer, nowMs: number = Date.now()): TryTicket | undefined {
  if (typeof token !== "string" || token.length > 2048) return undefined;
  const [payload, tag, extra] = token.split(".");
  if (!payload || !tag || extra !== undefined) return undefined;
  const expected = mac(secret, payload);
  const given = Buffer.from(tag, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
  let t: Partial<TryTicket>;
  try {
    t = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<TryTicket>;
  } catch {
    return undefined;
  }
  if (t.v !== 1 || typeof t.id !== "string" || !HEX32.test(t.id) || typeof t.taskId !== "string" || typeof t.nonce !== "string" || !HEX32.test(t.nonce)) return undefined;
  if (typeof t.maxLamports !== "string" || !/^[1-9][0-9]{0,18}$/.test(t.maxLamports) || typeof t.reference !== "string" || !BASE58.test(t.reference)) return undefined;
  if (typeof t.exp !== "number" || !Number.isSafeInteger(t.exp) || t.exp * 1000 <= nowMs) return undefined;
  return t as TryTicket;
}

/** The relay key for a ticket id: an ed25519 key from HMAC(secret, id). Same id, same key; never stored. */
export function relayKeypair(ticketId: string, secret: Buffer): Keypair {
  const seed = createHmac("sha256", secret).update("reddi-try-relay/1|").update(ticketId, "utf8").digest();
  return Keypair.fromSeed(Uint8Array.from(seed));
}
