import { DatabaseReplayStore, defaultNonceReplayStore, type NonceReplayStore } from "@reddi/x402-solana";

/**
 * Chooses where the runtime remembers payments it has already accepted.
 *
 * A real payment must not be accepted twice, including after a restart or on a
 * second instance, so real payments need the database store. The in-memory store
 * forgets on restart and is for demo payments and local development only.
 */
export type ReplayStoreChoice =
  | { ok: true; store: NonceReplayStore; durable: boolean; description: string }
  | { ok: false; message: string };

type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface ReplayStoreEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  ALLOW_REAL_X402_PAYMENT?: string;
  ALLOW_MEMORY_REPLAY_STORE?: string;
  [key: string]: string | undefined;
}

const isOn = (value: string | undefined) => value === "1" || value === "true";

/** The database origin, or undefined unless it is a plain https origin with no credentials, query or fragment. */
export function replayDatabaseOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return undefined;
  if (url.pathname !== "/" && url.pathname !== "") return undefined;
  return url.origin;
}

/**
 * Durable store that calls the `replay_check_and_store` database function over
 * the project's REST interface. The key never appears in a log or an error.
 */
export function createDatabaseReplayStore(origin: string, serviceKey: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): NonceReplayStore {
  return new DatabaseReplayStore({
    rpc: async (fn, args) => {
      try {
        const response = await fetchImpl(`${origin}/rest/v1/rpc/${encodeURIComponent(fn)}`, {
          method: "POST",
          headers: { "content-type": "application/json", apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify(args),
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) return { data: null, error: { status: response.status } };
        return { data: await response.json(), error: null };
      } catch {
        return { data: null, error: { status: 0 } };
      }
    },
  });
}

export function chooseReplayStore(env: ReplayStoreEnv, fetchImpl?: FetchLike): ReplayStoreChoice {
  const realPayments = isOn(env.ALLOW_REAL_X402_PAYMENT);
  const urlGiven = Boolean(env.SUPABASE_URL?.trim());
  const keyGiven = Boolean(env.SUPABASE_SERVICE_ROLE_KEY?.trim());

  if (urlGiven || keyGiven) {
    const origin = replayDatabaseOrigin(env.SUPABASE_URL);
    if (!origin) return { ok: false, message: "SUPABASE_URL must be an https origin with no path, credentials or query." };
    if (!keyGiven) return { ok: false, message: "SUPABASE_SERVICE_ROLE_KEY is required when SUPABASE_URL is set." };
    return {
      ok: true,
      durable: true,
      description: `database (${new URL(origin).host})`,
      store: createDatabaseReplayStore(origin, env.SUPABASE_SERVICE_ROLE_KEY!.trim(), fetchImpl),
    };
  }

  if (realPayments && !isOn(env.ALLOW_MEMORY_REPLAY_STORE)) {
    return {
      ok: false,
      message:
        "Real payments are on but no durable replay store is configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or set ALLOW_MEMORY_REPLAY_STORE=1 for local development only.",
    };
  }
  return { ok: true, durable: false, description: "in memory (forgets on restart)", store: defaultNonceReplayStore };
}
