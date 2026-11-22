/**
 * Per-client rate limit for `/api/rpc` (security audit round 1, S2-claude-05, condition C4).
 *
 * Defence in depth only. Each server instance keeps its own window, so the Vercel firewall
 * rule on `/api/rpc` stays the control of record (docs/MAINNET-RPC.md). This bounds what one
 * client can spend on the keyed provider through a single warm instance.
 */

export const RPC_WINDOW_MS = 60_000;
/** JSON-RPC calls per client per window; a batch counts each call. */
export const RPC_CALLS_PER_WINDOW = 300;
/** getProgramAccounts calls per client per window. */
export const RPC_SCANS_PER_WINDOW = 10;
const MAX_TRACKED_CLIENTS = 10_000;

type Window = { startedAt: number; calls: number; scans: number };

export type RpcRateLimiter = {
  /** Records the cost and says whether it is within the limit. A refused request records nothing. */
  take(client: string, calls: number, scans: number): { ok: true } | { ok: false; retryAfterSeconds: number };
};

export function createRpcRateLimiter(now: () => number = Date.now, limits = { calls: RPC_CALLS_PER_WINDOW, scans: RPC_SCANS_PER_WINDOW, windowMs: RPC_WINDOW_MS }): RpcRateLimiter {
  const windows = new Map<string, Window>();
  return {
    take(client, calls, scans) {
      const at = now();
      let window = windows.get(client);
      if (!window || at - window.startedAt >= limits.windowMs) {
        if (!window && windows.size >= MAX_TRACKED_CLIENTS) {
          for (const [key, value] of windows) {
            if (at - value.startedAt >= limits.windowMs) windows.delete(key);
          }
          // Still full of live windows: drop the oldest entry rather than grow without bound.
          if (windows.size >= MAX_TRACKED_CLIENTS) windows.delete(windows.keys().next().value as string);
        }
        window = { startedAt: at, calls: 0, scans: 0 };
        windows.set(client, window);
      }
      if (window.calls + calls > limits.calls || window.scans + scans > limits.scans) {
        return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((window.startedAt + limits.windowMs - at) / 1000)) };
      }
      window.calls += calls;
      window.scans += scans;
      return { ok: true };
    },
  };
}

/**
 * The client address as the platform reports it. On Vercel `x-vercel-forwarded-for` and
 * `x-real-ip` are set by the edge and cannot be supplied by the client; the first
 * `x-forwarded-for` entry is the fallback for other hosts.
 */
export function rpcClientKey(headers: Headers): string {
  const pick = (value: string | null) => value?.split(",")[0]?.trim() || undefined;
  return pick(headers.get("x-vercel-forwarded-for")) ?? pick(headers.get("x-real-ip")) ?? pick(headers.get("x-forwarded-for")) ?? "unknown";
}
