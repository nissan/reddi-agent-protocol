/**
 * The server's own Solana RPC endpoint. Server-side only.
 *
 * `SOLANA_RPC_URL` holds a keyed provider URL (Helius on mainnet, owner decision
 * 21 November 2026). The key sits in the URL, so the value must never reach a
 * browser, a response body or a log line: it is read only here, it has no
 * NEXT_PUBLIC_ twin, and `describeRpcEndpoint` gives the safe form to print.
 *
 * Browsers reach the same provider through `/api/rpc` (see lib/rpc/proxy.ts),
 * which forwards an allowlist of methods without exposing the URL.
 */
import { getNetworkProfile, registeredRpcHttp } from "@/lib/config/network";

export const SERVER_RPC_ENV = "SOLANA_RPC_URL";

export type ServerRpcEndpoint =
  | { ok: true; url: string; keyed: boolean; source: "SOLANA_RPC_URL" | "profile" }
  | { ok: false; code: "server_rpc_invalid"; message: string };

/** Reads the server RPC endpoint. A malformed SOLANA_RPC_URL is refused, not ignored. */
export function serverRpcEndpoint(env: Record<string, string | undefined> = process.env): ServerRpcEndpoint {
  if (typeof window !== "undefined") {
    return { ok: false, code: "server_rpc_invalid", message: "The server RPC endpoint is not available in the browser." };
  }
  const raw = env[SERVER_RPC_ENV]?.trim();
  if (!raw) {
    const profile = getNetworkProfile();
    // The browser-facing endpoint can be the app's own /api/rpc proxy. The server never calls
    // that (it would be refused for having no Origin, and loops back to itself); it uses the
    // profile's registered cluster RPC instead.
    const url = isAppRpcProxyPath(profile.solana.rpcHttp) ? registeredRpcHttp(profile.name) : profile.solana.rpcHttp;
    return { ok: true, url, keyed: false, source: "profile" };
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, code: "server_rpc_invalid", message: `${SERVER_RPC_ENV} is not a valid URL.` };
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    return { ok: false, code: "server_rpc_invalid", message: `${SERVER_RPC_ENV} must be an https URL without user info.` };
  }
  return { ok: true, url: parsed.toString(), keyed: parsed.search.length > 0, source: "SOLANA_RPC_URL" };
}

/** Host only, for logs and messages. Never the path or query, which can carry a key. */
export function describeRpcEndpoint(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unparseable RPC endpoint";
  }
}

/** True when `url` points at an /api/rpc proxy path rather than a Solana RPC provider. */
export function isAppRpcProxyPath(url: string): boolean {
  try {
    return new URL(url).pathname.replace(/\/+$/, "") === "/api/rpc";
  } catch {
    return false;
  }
}

/**
 * The RPC URL for server-side reads and verification (job records, registry, leaderboard).
 * Never the browser proxy. Undefined when SOLANA_RPC_URL is set but malformed.
 */
export function serverRpcUrl(env: Record<string, string | undefined> = process.env): string | undefined {
  const endpoint = serverRpcEndpoint(env);
  return endpoint.ok ? endpoint.url : undefined;
}
