/**
 * RAP's own first-party providers (#832), each on its own path of this one
 * Vercel project. The configs are the reviewed files in
 * deploy/first-party-providers; what differs per deployment comes from the
 * project's environment, and the secrets only from its sensitive variables:
 *
 * - PROVIDERS_NETWORK: "devnet" (the default) or "mainnet".
 * - PROVIDERS_PUBLIC_ORIGIN: where this project is served, such as
 *   https://providers.agent-protocol.reddi.tech. Each provider is at /<name>.
 * - PROVIDER_KIT_DATABASE_URL (sensitive): the server-side Postgres connection
 *   for the provider_kit schema.
 * - <NAME>_WALLET, <NAME>_KEYPAIR (sensitive) and <NAME>_PROMPT (sensitive) per
 *   provider, such as HUMANISER_WALLET.
 * - The model keys named in the configs (OPENROUTER_API_KEY on devnet;
 *   OPENAI_API_KEY and ANTHROPIC_API_KEY on mainnet), and on mainnet
 *   SOLANA_RPC_URL (sensitive: it carries the RPC key).
 *
 * A provider that is not fully set up refuses calls with 503 and logs why; it
 * never starts with a placeholder or a missing secret.
 */
import { createServerlessProvider, type PgPool, type ProviderConfigFile, type ServerlessProvider } from "@redditech/provider-kit";
import humaniserDevnet from "../../../deploy/first-party-providers/humaniser.devnet.provider.json" with { type: "json" };
import humaniserMainnet from "../../../deploy/first-party-providers/humaniser.mainnet.provider.json" with { type: "json" };
import writingStyleDevnet from "../../../deploy/first-party-providers/writing-style.devnet.provider.json" with { type: "json" };
import writingStyleMainnet from "../../../deploy/first-party-providers/writing-style.mainnet.provider.json" with { type: "json" };
import scriptWriterDevnet from "../../../deploy/first-party-providers/script-writer.devnet.provider.json" with { type: "json" };
import scriptWriterMainnet from "../../../deploy/first-party-providers/script-writer.mainnet.provider.json" with { type: "json" };

export const PROVIDERS = {
  humaniser: { prefix: "HUMANISER", devnet: humaniserDevnet, mainnet: humaniserMainnet },
  "writing-style": { prefix: "WRITING_STYLE", devnet: writingStyleDevnet, mainnet: writingStyleMainnet },
  "script-writer": { prefix: "SCRIPT_WRITER", devnet: scriptWriterDevnet, mainnet: scriptWriterMainnet },
} as const;

export type ProviderName = keyof typeof PROVIDERS;
export type Loaded = { ok: true; provider: ServerlessProvider } | { ok: false; message: string };
type Env = Record<string, string | undefined>;

export const isProviderName = (name: string): name is ProviderName => Object.hasOwn(PROVIDERS, name);

function network(env: Env): "devnet" | "mainnet" | undefined {
  const value = env.PROVIDERS_NETWORK?.trim() || "devnet";
  return value === "devnet" || value === "mainnet" ? value : undefined;
}

function origin(env: Env): string | undefined {
  const value = env.PROVIDERS_PUBLIC_ORIGIN?.trim();
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

/** One provider, built from its reviewed config and this deployment's environment. */
export function loadProvider(name: ProviderName, env: Env, pool: () => PgPool | undefined, log?: (event: Record<string, unknown>) => void): Loaded {
  const net = network(env);
  if (!net) return { ok: false, message: 'PROVIDERS_NETWORK must be "devnet" or "mainnet"' };
  const base = origin(env);
  if (!base) return { ok: false, message: "PROVIDERS_PUBLIC_ORIGIN must be an https origin, such as https://providers.example.com" };
  const entry = PROVIDERS[name];
  const wallet = env[`${entry.prefix}_WALLET`]?.trim();
  if (!wallet) return { ok: false, message: `${entry.prefix}_WALLET is not set` };
  const db = pool();
  if (!db) return { ok: false, message: "PROVIDER_KIT_DATABASE_URL is not set" };
  // The key and replay files are for a long-running server; here the key, the
  // prompt and the records come from the environment and the database.
  const { keypairPath: _k, replayFile: _r, systemPromptFile: _s, ...reviewed } = entry[net] as ProviderConfigFile & Record<string, unknown>;
  const file = { ...reviewed, wallet, publicUrl: `${base}/${name}` } as ProviderConfigFile;
  return createServerlessProvider({
    file,
    env,
    pool: db,
    keyEnv: `${entry.prefix}_KEYPAIR`,
    promptEnv: `${entry.prefix}_PROMPT`,
    basePath: `/${name}`,
    ...(log ? { log } : {}),
  });
}
