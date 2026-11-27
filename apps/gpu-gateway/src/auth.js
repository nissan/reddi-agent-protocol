// Request signing between the studio desks and the gateway, and signed download links.
//
// A desk signs:  HMAC-SHA256(desk secret, `${timestamp}\n${nonce}\n${method}\n${path}\n${sha256hex(body)}`)
// and sends X-Rap-Desk, X-Rap-Timestamp (unix seconds), X-Rap-Nonce (16 to 64 url-safe characters, fresh
// per request) and X-Rap-Signature (hex). The gateway accepts a timestamp within SKEW_S of its clock and
// each nonce once (the caller keeps the nonce store).

export const SKEW_S = 60;
const enc = new TextEncoder();

export function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256hex(data) {
  return hex(await crypto.subtle.digest("SHA-256", typeof data === "string" ? enc.encode(data) : data));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function hmacHex(secret, message) {
  return hex(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(message)));
}

/** Constant-time comparison of two hex strings (or tokens) of any length. */
export function sameText(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function signDeskRequest(secret, { method, path, body = "", timestamp, nonce }) {
  const bodyHash = await sha256hex(body);
  return hmacHex(secret, `${timestamp}\n${nonce}\n${method.toUpperCase()}\n${path}\n${bodyHash}`);
}

/**
 * Checks a desk's signature. Returns the desk name, or throws an Error with .status 401.
 * secrets: { script: "...", voice: "...", ... }. bodyBytes: the raw request body (ArrayBuffer or string).
 */
export async function verifyDesk(headers, { method, path, bodyBytes, secrets, now = Date.now() / 1000 }) {
  const desk = headers.get("x-rap-desk") || "";
  const ts = headers.get("x-rap-timestamp") || "";
  const sig = headers.get("x-rap-signature") || "";
  const nonce = headers.get("x-rap-nonce") || "";
  const fail = (why) => Object.assign(new Error(why), { status: 401 });
  const secret = Object.hasOwn(secrets, desk) ? secrets[desk] : undefined;
  if (!secret || secret.length < 32) throw fail("unknown desk");
  if (!/^\d{9,11}$/.test(ts) || Math.abs(now - Number(ts)) > SKEW_S) throw fail("stale or missing timestamp");
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) throw fail("missing nonce");
  if (!/^[0-9a-f]{64}$/.test(sig)) throw fail("bad signature");
  const expected = await hmacHex(secret, `${ts}\n${nonce}\n${method.toUpperCase()}\n${path}\n${await sha256hex(bodyBytes ?? "")}`);
  if (!sameText(sig, expected)) throw fail("bad signature");
  return { desk, nonce: `${desk}:${nonce}` };
}

/** A download link valid until `expires` (unix seconds): /f/TASK/FILE?e=...&s=... */
export async function signLink(secret, task, file, expires) {
  const s = await hmacHex(secret, `link\n${task}\n${file}\n${expires}`);
  return `/f/${task}/${file}?e=${expires}&s=${s}`;
}

export async function verifyLink(secret, task, file, e, s, now = Date.now() / 1000) {
  if (!/^\d{9,11}$/.test(e || "") || Number(e) < now) return false;
  return sameText(s || "", await hmacHex(secret, `link\n${task}\n${file}\n${e}`));
}
