/** Starts the provider: loads the key, opens the payment memory, and serves the handler over HTTP. */
import { createServer, type Server } from "node:http";
import { Readable } from "node:stream";
import { createProviderChain, type ProviderChain } from "./chain.js";
import type { ProviderConfig } from "./config.js";
import { createProviderHandler } from "./handler.js";
import { loadProviderKey } from "./keys.js";
import { FileReplayStore } from "./replay.js";
import { FileSessionStore } from "./sessions.js";
import { FilePendingSettleStore } from "./pending.js";
import { dirname, join } from "node:path";
import { MeteredSessionLedger } from "@redditech/x402-solana";
import { createMockUpstream, createOpenAiCompatibleUpstream, type Upstream } from "./upstream.js";

/** How often sessions are checked for an idle timeout or a refund window that is about to open. */
export const SESSION_SWEEP_MS = 30_000;

export type StartResult = { ok: true; server: Server; close: () => Promise<void> } | { ok: false; message: string };

/** Serves a fetch-style handler on a Node HTTP server. */
export function serve(handler: (request: Request) => Promise<Response>, origin: string): Server {
  return createServer(async (req, res) => {
    try {
      const request = new Request(new URL(req.url ?? "/", origin), {
        method: req.method,
        headers: req.headers as HeadersInit,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : (Readable.toWeb(req) as unknown as BodyInit),
        duplex: "half",
      } as RequestInit);
      const response = await handler(request);
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(await response.text());
    } catch {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "internal_error", message: "The provider hit an unexpected error." } }));
    }
  });
}

export function upstreamFor(config: ProviderConfig): Upstream {
  return config.upstream.mock || !config.upstream.baseUrl
    ? createMockUpstream()
    : createOpenAiCompatibleUpstream({ baseUrl: config.upstream.baseUrl, apiKey: config.upstream.apiKey, timeoutMs: config.upstream.timeoutMs });
}

/**
 * Refuses to start, rather than start half-working, when the key is missing or
 * wrong, when mock answers would be sold on mainnet, or when the payment
 * memory is in use by another process.
 */
export async function startProvider(config: ProviderConfig, options: { log?: (event: Record<string, unknown>) => void; chain?: ProviderChain; host?: string } = {}): Promise<StartResult> {
  const key = loadProviderKey({ keypairPath: config.keypairPath, wallet: config.wallet });
  if (!key.ok) return { ok: false, message: key.message };
  if (config.upstream.mock && config.network === "solana-mainnet-beta") return { ok: false, message: "mock answers cannot be sold on mainnet: set upstream.mock to false" };
  let replayStore: FileReplayStore;
  try {
    replayStore = new FileReplayStore(config.replayFile);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "the payment memory file could not be opened" };
  }
  // Settles sent but not yet known to land are kept beside the payment memory, under the same lock.
  let pendingSettles: FilePendingSettleStore;
  try {
    pendingSettles = new FilePendingSettleStore(join(dirname(config.replayFile), "pending-settles.jsonl"));
  } catch (error) {
    replayStore.close();
    return { ok: false, message: error instanceof Error ? `pending settles: ${error.message}` : "the pending settle file could not be opened" };
  }
  // Sessions are kept beside the payment memory, whose lock already keeps a second process out.
  let sessionStore: FileSessionStore | undefined;
  let sessions: MeteredSessionLedger | undefined;
  if (config.sessions.enabled) {
    try {
      sessionStore = new FileSessionStore(config.sessions.file);
      sessions = new MeteredSessionLedger(config.terms, sessionStore);
      const restored = await sessions.restore();
      if (restored > 0) options.log?.({ event: "sessions_restored", count: restored });
    } catch (error) {
      sessionStore?.close();
      pendingSettles.close();
      replayStore.close();
      return { ok: false, message: error instanceof Error ? `sessions: ${error.message}` : "the session file could not be opened" };
    }
  }
  const chain = options.chain ?? createProviderChain(config.rpcUrl, key.key.keypair);
  const handler = createProviderHandler(config, { chain, upstream: upstreamFor(config), replayStore, pendingSettles, ...(sessions ? { sessions } : {}), signMessage: key.key.signMessage, log: options.log });
  const server = serve(handler, config.publicUrl);
  // Settles idle sessions, closing ones, and any near its refund window, including those restored above,
  // and looks again at single-call settles whose outcome was not known.
  let sweeping = false;
  const sweep = setInterval(() => {
    if (sweeping) return;
    sweeping = true;
    handler.settleDueSessions().catch(() => undefined).finally(() => {
      sweeping = false;
    });
  }, SESSION_SWEEP_MS);
  sweep.unref();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, options.host ?? "0.0.0.0", () => resolve());
  }).catch((error: unknown) => {
    clearInterval(sweep);
    sessionStore?.close();
    pendingSettles.close();
    replayStore.close();
    throw error;
  });
  return {
    ok: true,
    server,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(sweep);
        server.close(() => {
          sessionStore?.close();
          pendingSettles.close();
          replayStore.close();
          resolve();
        });
      }),
  };
}
