// Request hygiene for the newsletter endpoints (WEB-07-S04, hardened in WEB-25 and WEB-27): same-origin,
// byte-accurate small body limit enforced while streaming, a durable per-client burst limit, and a constant-floor
// response time so the subscribe reply does not reveal whether an address is known.
import { createHmac } from "node:crypto";
import { ConflictError, type ContactStore } from "./store.ts";

export const MAX_BODY_BYTES = 1024;
export const BURST_LIMIT = 5;        // requests
export const BURST_WINDOW_MS = 60_000;
export const MIN_RESPONSE_MS = 400;  // floor applied to every subscribe reply
export const RETRY_AFTER_OUTAGE_S = 30;

export function sameOrigin(req: Request, siteUrl: string): boolean {
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  const origin = req.headers.get("origin");
  if (origin) {
    try { return new URL(origin).host === new URL(siteUrl).host || new URL(origin).host === new URL(req.url).host; } catch { return false; }
  }
  return fetchSite === "same-origin" || fetchSite === "none" || (!fetchSite && !origin); // non-browser clients without either header are allowed through to validation
}

export function clientKey(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

// Durable fixed-window limiter (WEB-27, WEB-28): the counter lives in the shared store, so consecutive requests that
// land on different serverless instances still share one count. Bucket names are an HMAC of the client address, so
// the store never holds an address; the window start is inside the document, so a returning client reuses one
// document. Each check costs one read and one conditional write; a lost race on the write is retried from a fresh
// read, and if the retries run out the request is treated as part of a burst. A store outage fails open: the
// request proceeds and the per-address daily limit in flow.ts remains the durable backstop. The limiter schedules a
// sweep of documents older than LIMIT_RETENTION_MS every `sweepEvery` admitted requests on an instance, or when an
// instance has not swept for LIMIT_SWEEP_INTERVAL_MS, so the counters stay bounded at any traffic level while an
// instance is alive (the owner's `prune-limits` remains for a manual sweep).
// Requests with no forwarding header share one "unknown" bucket; Vercel always sets the header, so that only
// affects local runs, where sharing a bucket is the safe side.
export const LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;
export const LIMIT_SWEEP_EVERY = 200;
export const LIMIT_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
export class DurableLimiter {
  private readonly store: ContactStore;
  private readonly secret: string;
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly sweepEvery: number;
  private admitted = 0;
  private lastSweep: number | null = null;
  constructor(store: ContactStore, secret: string, limit = BURST_LIMIT, windowMs = BURST_WINDOW_MS, sweepEvery = LIMIT_SWEEP_EVERY) { this.store = store; this.secret = secret; this.limit = limit; this.windowMs = windowMs; this.sweepEvery = sweepEvery; }
  bucket(key: string): string {
    return createHmac("sha256", this.secret).update(key).digest("hex");
  }
  // `schedule` runs the occasional sweep off the request path (the route passes runtime.defer); by default it runs detached.
  async allow(key: string, now: number, schedule: (work: () => Promise<unknown>) => void = (work) => { void work().catch(() => undefined); }): Promise<boolean> {
    const bucket = this.bucket(key);
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const current = await this.store.getLimit(bucket);
        const inWindow = current !== null && now - current.value.windowStart < this.windowMs;
        const count = inWindow ? current!.value.count : 0;
        if (count >= this.limit) return false;
        await this.store.putLimit(bucket, { count: count + 1, windowStart: inWindow ? current!.value.windowStart : now }, { version: current?.version ?? null });
        if (this.lastSweep === null) this.lastSweep = now; // the first request on an instance starts the clock without sweeping
        if (++this.admitted % this.sweepEvery === 0 || now - this.lastSweep >= LIMIT_SWEEP_INTERVAL_MS) { this.lastSweep = now; schedule(() => this.store.pruneLimits(now - LIMIT_RETENTION_MS)); }
        return true;
      } catch (error) {
        if (error instanceof ConflictError) continue; // another request of the same client won the write: re-read
        logStoreFailure("rate-limiter", error); // WEB-54: named, so a limiter that has failed open is visible
        return true; // store outage: fail open, flow.ts still enforces the per-address daily limit
      }
    }
    return false; // four lost races in a row is itself a burst
  }
}

// Reads at most MAX_BODY_BYTES from the request stream, counting bytes (not characters) and stopping as soon as
// the limit is exceeded, so an oversized body is never buffered in full.
export async function readSmallBody(req: Request, maxBytes = MAX_BODY_BYTES): Promise<{ ok: true; bytes: Uint8Array } | { ok: false }> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false };
  if (!req.body) return { ok: true, bytes: new Uint8Array(0) };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel().catch(() => undefined); return { ok: false }; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.byteLength; }
  return { ok: true, bytes };
}

export async function readSmallJson(req: Request): Promise<{ ok: true; value: unknown } | { ok: false }> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return { ok: false };
  const body = await readSmallBody(req);
  if (!body.ok) return { ok: false };
  try { return { ok: true, value: JSON.parse(new TextDecoder().decode(body.bytes)) }; } catch { return { ok: false }; }
}

// Token for the confirm and unsubscribe POST endpoints: query string (one-click POST per RFC 8058 keeps it
// there), a JSON body { t }, or a form field t. Never an address.
export async function readToken(req: Request): Promise<string> {
  const fromQuery = new URL(req.url).searchParams.get("t");
  if (fromQuery) return fromQuery;
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  const body = await readSmallBody(req, 4096);
  if (!body.ok) return "";
  const text = new TextDecoder().decode(body.bytes);
  if (type.startsWith("application/json")) { try { const v = JSON.parse(text) as { t?: unknown }; return typeof v.t === "string" ? v.t : ""; } catch { return ""; } }
  if (type.startsWith("application/x-www-form-urlencoded")) return new URLSearchParams(text).get("t") ?? "";
  return "";
}

// Response for the confirm and unsubscribe POST endpoints when the store is unavailable or every conditional write
// lost its race (WEB-27-S03): a retryable 503 the one-button page turns into "try again", also received by an
// RFC 8058 one-click POST, which mail clients retry.
export function retryLater(): Response {
  return Response.json({ state: "retry", message: "The newsletter service is busy. Please try again in a moment." }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": String(RETRY_AFTER_OUTAGE_S) } });
}

// An outage is a conflict that outlived its retries, a Blob SDK error, a non-200 blob read, or a network failure
// reaching the store. Anything else (a TypeError from a bug, a RangeError) is not an outage and must surface as a
// failure, not hide behind a retryable 503 (WEB-28-S03).
const NETWORK_RE = /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|UND_ERR|terminated|aborted|TimeoutError|AbortError|returned 5\d\d/i;
export function isOutage(error: unknown): boolean {
  if (error instanceof ConflictError) return true;
  if (!(error instanceof Error)) return false;
  if (error.name.startsWith("Blob") || error.name === "TimeoutError" || error.name === "AbortError") return true;
  if (NETWORK_RE.test(error.message)) return true;
  const cause = (error as { cause?: unknown }).cause;
  return cause instanceof Error ? NETWORK_RE.test(`${cause.name} ${cause.message} ${(cause as { code?: string }).code ?? ""}`) : false;
}

// WEB-54: the one greppable line for a store or limiter failure: `newsletter-store-failure op=<operation> class=<name> kind=<outage|bug>`.
// The operation is a fixed label (non-label characters collapse to "-", so a path or query can never ride along) and the class is
// the error's name, only if it is a plain identifier; the message, cause, address, token and contact key are never read.
export function logStoreFailure(op: string, error: unknown): void {
  const safeOp = op.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "unknown";
  const name = error instanceof Error ? error.name : "";
  const errorClass = /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(name) ? name : "Unknown";
  console.error(`newsletter-store-failure op=${safeOp} class=${errorClass} kind=${isOutage(error) ? "outage" : "bug"}`);
}

// Route-level handler for a thrown error on the POST endpoints: logs the named line above (never an address or token),
// answers 503 for an outage and rethrows everything else so a bug fails loudly.
export function outageOrThrow(label: string, error: unknown): Response {
  logStoreFailure(label, error);
  if (isOutage(error)) return retryLater();
  throw error;
}

// Resolves no earlier than `floorMs` after `startedAt`, so callers can give every reply the same minimum latency.
export async function holdUntil(startedAt: number, floorMs: number, now: () => number = Date.now): Promise<void> {
  const remaining = startedAt + floorMs - now();
  if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
}
