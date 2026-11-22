/**
 * Browser RPC proxy rules for `/api/rpc`.
 *
 * Browsers send Solana JSON-RPC here instead of to the keyed provider URL, so
 * the key stays on the server. It forwards only the methods the app uses,
 * limits body and batch size, requires filters on getProgramAccounts (one per
 * batch), and never echoes the upstream URL or its errors. The Origin check
 * only keeps other web pages' browsers out: any non-browser client can send
 * the header, so cost is bounded by the per-client limit in rate-limit.ts and,
 * as the control of record, the Vercel firewall rule (audit S2-claude-05).
 * Subscriptions (websockets) are not proxied; the app uses the profile's public
 * websocket endpoint for those.
 */

export const MAX_RPC_BODY_BYTES = 64 * 1024;
export const MAX_RPC_BATCH = 20;
export const UPSTREAM_TIMEOUT_MS = 15_000;

/** Methods the app and its libraries call. Anything else is refused. */
export const ALLOWED_RPC_METHODS: ReadonlySet<string> = new Set([
  "getAccountInfo",
  "getBalance",
  "getBlockHeight",
  "getEpochInfo",
  "getFeeForMessage",
  "getGenesisHash",
  "getHealth",
  "getLatestBlockhash",
  "getMinimumBalanceForRentExemption",
  "getMultipleAccounts",
  "getParsedTransaction",
  "getRecentPrioritizationFees",
  "getSignatureStatuses",
  "getSignaturesForAddress",
  "getSlot",
  "getTokenAccountBalance",
  "getTokenAccountsByOwner",
  "getTransaction",
  "getVersion",
  "isBlockhashValid",
  "sendTransaction",
  "simulateTransaction",
  // Allowed only for the app's own programs; see checkRpcBody.
  "getProgramAccounts",
]);

/** getProgramAccounts calls allowed in one request. */
export const MAX_PROGRAM_SCANS_PER_REQUEST = 1;

export type RpcCheck =
  | { ok: true; body: string; calls: number; scans: number }
  | { ok: false; status: number; code: string; message: string; id: unknown };

type RpcCall = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };

function refuse(status: number, code: string, message: string, id: unknown = null): RpcCheck {
  return { ok: false, status, code, message, id };
}

/**
 * Checks a raw request body. `programIds` are the base58 ids that
 * getProgramAccounts may scan.
 */
export function checkRpcBody(raw: string, programIds: ReadonlySet<string>): RpcCheck {
  if (Buffer.byteLength(raw, "utf8") > MAX_RPC_BODY_BYTES) {
    return refuse(413, "rpc_body_too_large", `RPC requests are limited to ${MAX_RPC_BODY_BYTES} bytes.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return refuse(400, "rpc_parse_error", "Send a JSON-RPC request.");
  }
  const calls: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  if (calls.length === 0) return refuse(400, "rpc_invalid_request", "An empty batch is not a request.");
  if (calls.length > MAX_RPC_BATCH) {
    return refuse(413, "rpc_batch_too_large", `RPC batches are limited to ${MAX_RPC_BATCH} calls.`);
  }
  let scans = 0;
  for (const item of calls) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return refuse(400, "rpc_invalid_request", "Each call must be a JSON-RPC object.");
    }
    const call = item as RpcCall;
    if (call.jsonrpc !== "2.0" || typeof call.method !== "string") {
      return refuse(400, "rpc_invalid_request", "Each call needs jsonrpc \"2.0\" and a method.", call.id ?? null);
    }
    if (!ALLOWED_RPC_METHODS.has(call.method)) {
      return refuse(403, "rpc_method_not_allowed", `Method ${call.method.slice(0, 64)} is not available through this proxy.`, call.id ?? null);
    }
    if (call.method === "getProgramAccounts") {
      const programId = Array.isArray(call.params) ? call.params[0] : undefined;
      if (typeof programId !== "string" || !programIds.has(programId)) {
        return refuse(403, "rpc_method_not_allowed", "getProgramAccounts is limited to this app's programs.", call.id ?? null);
      }
      if (!hasAccountFilter(Array.isArray(call.params) ? call.params[1] : undefined)) {
        return refuse(403, "rpc_method_not_allowed", "getProgramAccounts needs a dataSize or memcmp filter.", call.id ?? null);
      }
      scans += 1;
      if (scans > MAX_PROGRAM_SCANS_PER_REQUEST) {
        return refuse(413, "rpc_batch_too_large", "Send one getProgramAccounts call per request.", call.id ?? null);
      }
    }
  }
  return { ok: true, body: raw, calls: calls.length, scans };
}

/** True when a getProgramAccounts config carries at least one dataSize or memcmp filter. */
function hasAccountFilter(config: unknown): boolean {
  if (!config || typeof config !== "object") return false;
  const filters = (config as { filters?: unknown }).filters;
  if (!Array.isArray(filters) || filters.length === 0) return false;
  return filters.some((filter) => {
    if (!filter || typeof filter !== "object") return false;
    const f = filter as { dataSize?: unknown; memcmp?: { offset?: unknown; bytes?: unknown } };
    if (typeof f.dataSize === "number" && Number.isInteger(f.dataSize) && f.dataSize >= 0) return true;
    return !!f.memcmp && typeof f.memcmp.offset === "number" && typeof f.memcmp.bytes === "string" && f.memcmp.bytes.length > 0;
  });
}

/**
 * True when a browser call may use the proxy: the Origin header must be the
 * proxy's own origin or one listed in `extraOrigins`. A call with no Origin is
 * refused. This stops other sites' pages, not scripts: the header is easy to set
 * outside a browser, which is why the rate limit and firewall rule exist.
 */
export function isAllowedOrigin(origin: string | null, requestUrl: string, extraOrigins: readonly string[]): boolean {
  if (!origin) return false;
  let own: string;
  try {
    own = new URL(requestUrl).origin;
  } catch {
    return false;
  }
  return origin === own || extraOrigins.includes(origin);
}

/** Parses RPC_PROXY_ALLOWED_ORIGINS (comma separated https origins). */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => {
      try {
        const url = new URL(value);
        return url.protocol === "https:" && url.origin === value;
      } catch {
        return false;
      }
    });
}

/** A JSON-RPC error response that says nothing about the upstream. */
export function rpcErrorResponse(status: number, code: string, message: string, id: unknown = null): Response {
  return Response.json(
    { jsonrpc: "2.0", id, error: { code: -32000, message, data: { code } } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

/** Forwards a checked body upstream. Upstream failures come back as a plain 502. */
export async function forwardRpc(
  body: string,
  upstreamUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = UPSTREAM_TIMEOUT_MS,
): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetchImpl(upstreamUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch {
    return rpcErrorResponse(502, "rpc_upstream_unreachable", "The RPC provider did not answer.");
  }
  if (upstream.status === 429) {
    return rpcErrorResponse(429, "rpc_rate_limited", "The RPC provider is rate limiting. Try again shortly.");
  }
  const contentType = upstream.headers.get("content-type") ?? "";
  if (!upstream.ok || !contentType.includes("application/json")) {
    return rpcErrorResponse(502, "rpc_upstream_error", "The RPC provider returned an error.");
  }
  const text = await upstream.text();
  return new Response(text, {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
