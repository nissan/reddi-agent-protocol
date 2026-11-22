import { getNetworkProfile } from "@/lib/config/network";
import { checkRpcBody, forwardRpc, isAllowedOrigin, MAX_RPC_BODY_BYTES, parseAllowedOrigins, rpcErrorResponse } from "@/lib/rpc/proxy";
import { serverRpcEndpoint } from "@/lib/rpc/server-rpc";
import { createRpcRateLimiter, rpcClientKey } from "@/lib/rpc/rate-limit";

// One limiter per server instance; see lib/rpc/rate-limit.ts.
const limiter = createRpcRateLimiter();

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function appProgramIds(): Set<string> {
  const programs = getNetworkProfile().programs;
  return new Set(
    [programs.escrowProgramId, programs.registryProgramId, programs.reputationProgramId, programs.attestationProgramId].filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    ),
  );
}

/**
 * POST /api/rpc: Solana JSON-RPC for this app's pages. Forwards an allowlist of
 * methods to the server's RPC provider so a keyed URL never reaches the browser.
 */
export async function POST(req: Request) {
  if (!isAllowedOrigin(req.headers.get("origin"), req.url, parseAllowedOrigins(process.env.RPC_PROXY_ALLOWED_ORIGINS))) {
    return rpcErrorResponse(403, "rpc_origin_not_allowed", "This RPC proxy serves this app's pages only.");
  }
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_RPC_BODY_BYTES) {
    return rpcErrorResponse(413, "rpc_body_too_large", `RPC requests are limited to ${MAX_RPC_BODY_BYTES} bytes.`);
  }
  const endpoint = serverRpcEndpoint();
  if (!endpoint.ok) return rpcErrorResponse(503, endpoint.code, "The server RPC endpoint is not configured correctly.");

  const checked = checkRpcBody(await req.text(), appProgramIds());
  if (!checked.ok) return rpcErrorResponse(checked.status, checked.code, checked.message, checked.id);
  const allowed = limiter.take(rpcClientKey(req.headers), checked.calls, checked.scans);
  if (!allowed.ok) {
    const limited = rpcErrorResponse(429, "rpc_rate_limited", "Too many RPC requests from this client. Try again shortly.");
    limited.headers.set("retry-after", String(allowed.retryAfterSeconds));
    return limited;
  }
  return forwardRpc(checked.body, endpoint.url);
}
