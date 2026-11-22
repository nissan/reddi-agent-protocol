/** Server only. Shared bits of the try page's routes (#925). */
import { createRpcRateLimiter, rpcClientKey } from "@/lib/rpc/rate-limit";
import { isDevnetConnection } from "@/lib/sandbox/devnet-genesis";
import { trySecret, TryNotConfiguredError } from "./ticket";

export const TRY_PAY_PATH = "/api/try/v1/pay";

/** Solana Pay wallets fetch from outside any page, so the transaction request answers any origin. */
export const SOLANA_PAY_CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept, accept-encoding",
} as const;

export function tryJson(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

export function tryError(status: number, code: string, message: string, headers: Record<string, string> = {}): Response {
  return tryJson({ error: { code, message } }, status, headers);
}

/** The secret, or a 503 response when this server has none. */
export function secretOrResponse(headers: Record<string, string> = {}): { ok: true; secret: Buffer } | { ok: false; response: Response } {
  try {
    return { ok: true, secret: trySecret() };
  } catch (error) {
    if (error instanceof TryNotConfiguredError) return { ok: false, response: tryError(503, "try_not_configured", error.message, headers) };
    throw error;
  }
}

/** The `solana:` link for a ticket: a Solana Pay transaction request to this app. */
export function solanaPayLink(origin: string, token: string): { payUrl: string; solanaPayUrl: string } {
  const payUrl = `${origin}${TRY_PAY_PATH}?t=${encodeURIComponent(token)}`;
  return { payUrl, solanaPayUrl: `solana:${encodeURIComponent(payUrl)}` };
}

export async function readJsonBody(request: Request, maxBytes = 4096): Promise<Record<string, unknown> | undefined> {
  try {
    const text = await request.text();
    if (text.length > maxBytes) return undefined;
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Per-client limits for the try routes, per server instance (defence in depth,
 * as for /api/rpc): `calls` counts status polls and transaction requests,
 * `scans` counts started tries.
 */
const limiter = createRpcRateLimiter(Date.now, { calls: 90, scans: 10, windowMs: 60_000 });

export function rateLimited(request: Request, kind: "call" | "start", headers: Record<string, string> = {}): Response | undefined {
  const taken = limiter.take(rpcClientKey(request.headers), kind === "call" ? 1 : 0, kind === "start" ? 1 : 0);
  if (taken.ok) return undefined;
  return tryError(429, "rate_limited", "Too many requests from this client. Try again shortly.", { ...headers, "retry-after": String(taken.retryAfterSeconds) });
}

/**
 * The sandbox payees are well-known devnet keys, and a Solana Pay wallet shows
 * no cluster, so nothing is built or read unless the RPC really is devnet.
 */
export async function devnetOrResponse(connection: { getGenesisHash(): Promise<string> }, headers: Record<string, string> = {}): Promise<Response | undefined> {
  return (await isDevnetConnection(connection)) ? undefined : tryError(503, "not_devnet", "The try page runs on Solana devnet, and this server's RPC is not devnet. Nothing was built or signed.", headers);
}
