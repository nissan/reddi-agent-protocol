/** Server only. Shared bits of the try page's routes (#925). */
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
