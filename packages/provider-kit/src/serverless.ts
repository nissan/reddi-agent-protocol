/**
 * A provider on a serverless host (Vercel functions, or any host that runs
 * many short-lived instances): no disk, no long-running timer, several copies
 * at once. Everything the provider remembers lives in Postgres
 * (`./postgres`), the wallet key and the private system prompt come from the
 * host's environment, and the host calls `sweep()` on a schedule instead of a
 * timer.
 *
 * It refuses to start without its key, its prompt (when it has one) or its
 * model's key, so it never accepts a payment it cannot serve.
 *
 * Refused here, until they have shared stores of their own:
 * - sessions (their ledger is kept in one process);
 * - `refundAccountSubsidy` (its daily bound is counted in one process, so it
 *   would multiply with the number of instances).
 */
import { checkProviderCluster } from "@redditech/x402-solana";
import { createProviderChain, type ProviderChain } from "./chain.js";
import { Capacity } from "./capacity.js";
import { parseProviderConfig, type ProviderConfig, type ProviderConfigFile } from "./config.js";
import { createProviderHandler, type ProviderHandler } from "./handler.js";
import { loadProviderKeyFromEnv } from "./keys.js";
import { postgresProviderStores, type PgPool } from "./postgres.js";
import { upstreamFor } from "./server.js";
import type { Upstream } from "./upstream.js";

export interface ServerlessProviderOptions {
  /** The provider's config, as in a provider.json file. `systemPromptFile` is not read here: use `promptEnv`. */
  file: ProviderConfigFile;
  env: Record<string, string | undefined>;
  pool: PgPool;
  /** The environment variable with the wallet's keypair (a JSON array of 64 numbers). */
  keyEnv: string;
  /** The environment variable with the private system prompt, if the provider has one. */
  promptEnv?: string;
  /** Where this provider is mounted on the host, such as `/humaniser`. Stripped before routing. */
  basePath?: string;
  /** Keys the provider's rows in the database. Defaults to the wallet address. */
  providerId?: string;
  log?: (event: Record<string, unknown>) => void;
  /** For tests. */
  chain?: ProviderChain;
  upstream?: Upstream;
}

export interface ServerlessProvider {
  config: ProviderConfig;
  handle(request: Request): Promise<Response>;
  /** Looks again at settles whose outcome was not known and whose answers are no longer held. Call it every minute or so. */
  sweep(): Promise<void>;
}

export type ServerlessProviderResult = { ok: true; provider: ServerlessProvider } | { ok: false; message: string };

const BASE_PATH = /^\/[a-z0-9][a-z0-9-]{0,62}$/;

export function createServerlessProvider(options: ServerlessProviderOptions): ServerlessProviderResult {
  const { systemPromptFile: _ignored, ...file } = options.file as ProviderConfigFile & { systemPromptFile?: string };
  let promptFile: ProviderConfigFile = file;
  if (options.promptEnv) {
    const prompt = options.env[options.promptEnv]?.trim();
    if (!prompt) return { ok: false, message: `no system prompt is set: put it in ${options.promptEnv}` };
    promptFile = { ...file, systemPrompt: prompt };
  }
  const parsed = parseProviderConfig(promptFile, options.env);
  if (!parsed.ok) return { ok: false, message: `config: ${parsed.errors.join("; ")}` };
  const config = parsed.config;
  if (config.sessions.enabled) return { ok: false, message: "sessions are not offered on a serverless host yet: set sessions.enabled to false" };
  if (config.refundAccountsPerDay > 0) return { ok: false, message: "refundAccountSubsidy is not offered on a serverless host yet: its daily bound is counted per instance" };
  if (config.upstream.mock && config.network === "solana-mainnet-beta") return { ok: false, message: "mock answers cannot be sold on mainnet: set upstream.mock to false" };
  // A serverless host has no model of its own to call without a key: a call would be accepted and then fail.
  if (!config.upstream.mock && !options.upstream && !config.upstream.apiKey) return { ok: false, message: `no model key is set: put it in ${config.upstream.apiKeyEnv}` };
  const basePath = options.basePath ?? "";
  if (basePath && !BASE_PATH.test(basePath)) return { ok: false, message: "basePath must look like /name (lowercase letters, digits and dashes)" };
  if (basePath && !new URL(config.publicUrl).pathname.replace(/\/+$/, "").endsWith(basePath)) {
    return { ok: false, message: `publicUrl must end with ${basePath}, where the provider is mounted, so buyers are sent to the right address` };
  }

  const key = loadProviderKeyFromEnv({ env: options.env, name: options.keyEnv, wallet: config.wallet });
  if (!key.ok) return { ok: false, message: key.message };
  const stores = postgresProviderStores(options.pool, options.providerId ?? config.wallet);
  const chain = options.chain ?? createProviderChain(config.rpcUrl, key.key.keypair);
  const handler: ProviderHandler = createProviderHandler(config, {
    chain,
    upstream: options.upstream ?? upstreamFor(config),
    replayStore: stores.replayStore,
    pendingSettles: stores.pendingSettles,
    lease: stores.lease,
    heldAnswers: stores.heldAnswers,
    capacity: new Capacity(config.capacity, stores.capacityStore),
    signMessage: key.key.signMessage,
    ...(options.log ? { log: options.log } : {}),
  });

  const handle = async (request: Request): Promise<Response> => {
    if (!basePath) return handler(request);
    const url = new URL(request.url);
    if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) {
      return new Response(JSON.stringify({ error: { code: "not_found", message: "No such route." } }), { status: 404, headers: { "content-type": "application/json; charset=utf-8" } });
    }
    url.pathname = url.pathname.slice(basePath.length) || "/";
    const init: RequestInit & { duplex?: "half" } = { method: request.method, headers: request.headers };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
      init.duplex = "half";
    }
    return handler(new Request(url, init));
  };

  const sweep = async (): Promise<void> => {
    // The sweep reads the chain; it never trusts one on another cluster.
    const cluster = await checkProviderCluster(() => chain.readGenesisHash(), config.network, config.genesisHash);
    if (!cluster.ok) {
      options.log?.({ event: "cluster_check_failed", reason: cluster.reason, alert: true });
      return;
    }
    await handler.settleDueSessions();
  };

  return { ok: true, provider: { config, handle, sweep } };
}
