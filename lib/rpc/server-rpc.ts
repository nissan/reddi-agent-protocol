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
import { getNetworkProfile } from "@/lib/config/network";

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
    return { ok: true, url: getNetworkProfile().solana.rpcHttp, keyed: false, source: "profile" };
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
