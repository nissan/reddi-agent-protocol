// Signed, expiring newsletter tokens (WEB-07, hardened in WEB-25). Pure functions over Node's crypto so they
// are unit-testable. A token carries its purpose, the opaque contact key (a SHA-256 of the address, never the
// address itself, so request logs that record the URL never carry an address), issue and expiry times; the
// HMAC prevents forgery and the issue time lets the flow refuse confirmation links issued before an unsubscribe.
import { createHmac, timingSafeEqual } from "node:crypto";

export type TokenPurpose = "confirm" | "unsubscribe" | "build" | "preferences";
export type TokenPayload = { p: TokenPurpose; k: string; iat: number; exp: number };
export type TokenResult = { ok: true; payload: TokenPayload } | { ok: false; reason: "malformed" | "signature" | "expired" | "purpose" };

export const CONFIRM_TTL_MS = 48 * 60 * 60 * 1000; // confirmation links live two days
export const UNSUBSCRIBE_TTL_MS = 400 * 24 * 60 * 60 * 1000; // unsubscribe links outlive any issue they are printed in
export const BUILD_TTL_MS = 30 * 24 * 60 * 60 * 1000; // WEB-61: an early-access build link in an issue stays usable for a month
const KEY_RE = /^[0-9a-f]{64}$/;

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");

function sign(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function issueToken(secret: string, purpose: TokenPurpose, contactKey: string, now: number, ttlMs = purpose === "confirm" ? CONFIRM_TTL_MS : purpose === "build" ? BUILD_TTL_MS : UNSUBSCRIBE_TTL_MS): string {
  if (!secret || secret.length < 32) throw new Error("newsletter signing secret must be at least 32 characters");
  if (!KEY_RE.test(contactKey)) throw new Error("token subject must be a contact key, never an address");
  const body = b64(JSON.stringify({ p: purpose, k: contactKey, iat: now, exp: now + ttlMs } satisfies TokenPayload));
  return `${body}.${sign(secret, body)}`;
}

export function verifyToken(secret: string, token: string, purpose: TokenPurpose, now: number): TokenResult {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1] || token.length > 2048) return { ok: false, reason: "malformed" };
  const [body, sig] = parts;
  const expected = sign(secret, body);
  const a = Buffer.from(sig, "utf8"), b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "signature" };
  let payload: unknown;
  try { payload = JSON.parse(unb64(body)); } catch { return { ok: false, reason: "malformed" }; }
  if (typeof payload !== "object" || payload === null) return { ok: false, reason: "malformed" };
  const t = payload as Record<string, unknown>;
  if (typeof t.k !== "string" || !KEY_RE.test(t.k) || typeof t.iat !== "number" || typeof t.exp !== "number" || (t.p !== "confirm" && t.p !== "unsubscribe" && t.p !== "build" && t.p !== "preferences")) return { ok: false, reason: "malformed" };
  if (t.p !== purpose) return { ok: false, reason: "purpose" };
  if (now > t.exp) return { ok: false, reason: "expired" };
  return { ok: true, payload: { p: t.p, k: t.k, iat: t.iat, exp: t.exp } };
}
