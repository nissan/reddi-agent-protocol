/**
 * A provider's configuration: one JSON file, plus a few environment variables
 * for things that should not sit in a file (the upstream API key) or that
 * differ per machine (the RPC endpoint, the key file path).
 *
 * Parsing fails closed: anything missing or malformed is an error that names
 * the field, and the provider does not start.
 */
import { PublicKey } from "@solana/web3.js";
import { directPaymentCurrency, ESCROW_DEVNET_MINTS, ESCROW_MAINNET_MINTS, providerMeteredTerms, type MeteredTerms } from "@reddi/x402-solana";

export type ProviderNetwork = "solana-devnet" | "solana-mainnet-beta";

/** The V1 escrow and registry program. The same id on devnet and mainnet. */
export const DEFAULT_ESCROW_PROGRAM_ID = "DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu";
export const DEFAULT_DEVNET_RPC_URL = "https://api.devnet.solana.com";
export const DEFAULT_CONFIG_FILE = "provider.json";
export const DEFAULT_REPLAY_FILE = ".rap-provider/accepted-escrows.log";
export const DEFAULT_PORT = 8787;

export interface ProviderConfigFile {
  name: string;
  description?: string;
  network: ProviderNetwork;
  /** The provider wallet's address. Payments settle to its token account. */
  wallet: string;
  /** Where buyers reach this provider. Must be https unless it is localhost. */
  publicUrl: string;
  /** The model this provider declares it serves. Receipts name it. */
  model: string;
  upstream: {
    /** An OpenAI-compatible base URL, for example https://openrouter.ai/api/v1 or http://localhost:11434/v1. */
    baseUrl?: string;
    /** The model name to send upstream when it differs from `model`. */
    model?: string;
    /** Name of the environment variable holding the upstream API key. Defaults to UPSTREAM_API_KEY. */
    apiKeyEnv?: string;
    /** Answer with a canned reply instead of calling a model. For trying the payment flow. */
    mock?: boolean;
    timeoutMs?: number;
  };
  price: {
    currency: string;
    /** Decimal price per million input and output tokens, in `currency`. */
    inputPerMillion: string;
    outputPerMillion: string;
    maxOutputTokens?: number;
  };
  /** A system prompt placed before every request. Optional. */
  systemPrompt?: string;
  /**
   * A text file holding the system prompt, relative to the config file. Use it
   * for long or private instructions you do not want in the config. It
   * replaces `systemPrompt`.
   */
  systemPromptFile?: string;
  rpcUrl?: string;
  /** Override only for a local validator or a test deployment. */
  programId?: string;
  /** The mint for `price.currency`. Needed on devnet for anything but USDC; fixed on mainnet. */
  mint?: string;
  /**
   * Currencies this provider has stopped taking new locks in, for example
   * ["PYUSD"] after its issuer changes how transfers work. While the price
   * currency is listed, paid calls are refused before any lock is read and the
   * provider's metadata says it is not accepting payments. Locks already
   * accepted still settle. `RAP_PROVIDER_PAUSED_CURRENCIES` (comma-separated)
   * adds to this list without editing the file.
   */
  pausedCurrencies?: string[];
  /**
   * Recovery only: another token account of the mint that the provider wallet
   * owns. Payouts go here when the wallet's usual token account is closed or
   * frozen.
   */
  payoutAccount?: string;
  /**
   * Off unless set. Lets the provider pay the rent (about 0.002 SOL, not
   * returned) to create a buyer's token account when the buyer closed its own
   * after the lock was accepted, so the settle can still land. `maxPerDay`
   * bounds how many it pays for in a UTC day.
   */
  refundAccountSubsidy?: { maxPerDay: number };
  /** For a local validator only: the genesis hash to expect instead of the public devnet one. */
  genesisHash?: string;
  keypairPath?: string;
  replayFile?: string;
  port?: number;
}

export interface ProviderConfig {
  name: string;
  description: string;
  network: ProviderNetwork;
  wallet: string;
  publicUrl: string;
  model: string;
  upstream: { baseUrl?: string; model: string; apiKey?: string; apiKeyEnv: string; mock: boolean; timeoutMs: number };
  terms: MeteredTerms;
  /** True while the price currency is in the paused list: no new locks are taken. */
  paused: boolean;
  pausedCurrencies: string[];
  /** Buyer token accounts the provider will pay to create in a UTC day. 0: never. */
  refundAccountsPerDay: number;
  systemPrompt?: string;
  rpcUrl: string;
  genesisHash?: string;
  keypairPath?: string;
  replayFile: string;
  port: number;
}

export type ConfigResult = { ok: true; config: ProviderConfig } | { ok: false; errors: string[] };

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

function isAddress(value: string): boolean {
  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
}

/** An http(s) URL with no credentials, query or fragment, or undefined. Plain http is for localhost only. */
export function serviceUrl(value: string, options: { allowHttpAnywhere?: boolean } = {}): URL | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.username || url.password || url.search || url.hash) return undefined;
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol === "https:") return url;
  if (url.protocol === "http:" && (local || options.allowHttpAnywhere)) return url;
  return undefined;
}

/** The mint the escrow program accepts for a currency on a network, when it is fixed. */
export function knownMint(network: ProviderNetwork, currency: string): string | undefined {
  if (network === "solana-mainnet-beta") return ESCROW_MAINNET_MINTS.find((m) => m.symbol === currency)?.mint.toBase58();
  return currency === "USDC" ? ESCROW_DEVNET_MINTS[0]?.mint.toBase58() : undefined;
}

/**
 * Turns the config file's contents and the environment into a checked
 * configuration. `RAP_PROVIDER_KEYPAIR_PATH`, `SOLANA_RPC_URL` and `PORT`
 * override the file; the upstream API key is read only from the environment.
 */
export function parseProviderConfig(file: unknown, env: Record<string, string | undefined> = {}): ConfigResult {
  const errors: string[] = [];
  if (!isRecord(file)) return { ok: false, errors: ["the config must be a JSON object"] };

  const name = text(file.name);
  if (!name || name.length > 80) errors.push("name: give the provider a name of at most 80 characters");
  const description = text(file.description);

  const network = text(file.network) as ProviderNetwork;
  if (network !== "solana-devnet" && network !== "solana-mainnet-beta") errors.push('network: must be "solana-devnet" or "solana-mainnet-beta"');

  const wallet = text(file.wallet);
  if (!isAddress(wallet)) errors.push("wallet: must be the provider wallet's Solana address");

  const publicUrl = text(file.publicUrl).replace(/\/+$/, "");
  if (!serviceUrl(publicUrl)) errors.push("publicUrl: must be an https address (http is accepted for localhost only), with no query or credentials");

  const model = text(file.model);
  if (!model || model.length > 200) errors.push("model: name the model this provider serves");

  const upstreamRaw = isRecord(file.upstream) ? file.upstream : {};
  const mock = upstreamRaw.mock === true;
  const baseUrl = text(upstreamRaw.baseUrl).replace(/\/+$/, "");
  // A model on the operator's own network may be plain http; the key is then the operator's concern.
  if (!mock && !serviceUrl(baseUrl, { allowHttpAnywhere: true })) errors.push('upstream.baseUrl: must be an OpenAI-compatible base URL such as "https://openrouter.ai/api/v1", or set upstream.mock to true');
  const apiKeyEnv = text(upstreamRaw.apiKeyEnv) || "UPSTREAM_API_KEY";
  if (!/^[A-Z_][A-Z0-9_]*$/.test(apiKeyEnv)) errors.push("upstream.apiKeyEnv: must be the name of an environment variable");
  const timeoutMs = upstreamRaw.timeoutMs === undefined ? 120_000 : Number(upstreamRaw.timeoutMs);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 600_000) errors.push("upstream.timeoutMs: must be between 1000 and 600000");

  const priceRaw = isRecord(file.price) ? file.price : {};
  const currency = text(priceRaw.currency);
  const programId = text(file.programId) || DEFAULT_ESCROW_PROGRAM_ID;
  if (!isAddress(programId)) errors.push("programId: must be a Solana address");
  if (network === "solana-mainnet-beta" && programId !== DEFAULT_ESCROW_PROGRAM_ID) errors.push("programId: cannot be changed on mainnet");

  let mint = text(file.mint);
  if (!directPaymentCurrency(currency)) {
    errors.push("price.currency: must be USDC, AUDD, PYUSD or USDG");
  } else if (!directPaymentCurrency(currency)?.tokenProgram) {
    errors.push(`price.currency: ${currency} is not a token currency; use USDC, AUDD, PYUSD or USDG`);
  } else if (network === "solana-devnet" || network === "solana-mainnet-beta") {
    const known = knownMint(network, currency);
    if (network === "solana-mainnet-beta") {
      if (!known) errors.push(`price.currency: ${currency} is not accepted by the escrow program on mainnet`);
      else if (mint && mint !== known) errors.push(`mint: on mainnet ${currency} is ${known} and cannot be changed`);
      else mint = known;
    } else {
      mint = mint || known || "";
      if (!mint) errors.push(`mint: on devnet, name the mint to accept for ${currency}`);
      else if (!isAddress(mint)) errors.push("mint: must be a Solana address");
    }
  }

  const pausedRaw = [...(Array.isArray(file.pausedCurrencies) ? file.pausedCurrencies : file.pausedCurrencies === undefined ? [] : [file.pausedCurrencies]), ...text(env.RAP_PROVIDER_PAUSED_CURRENCIES).split(",")];
  const pausedCurrencies: string[] = [];
  for (const entry of pausedRaw) {
    const symbol = text(entry).toUpperCase();
    if (!symbol && typeof entry === "string") continue;
    if (!directPaymentCurrency(symbol)?.tokenProgram) errors.push("pausedCurrencies: list currency symbols such as PYUSD or USDG");
    else if (!pausedCurrencies.includes(symbol)) pausedCurrencies.push(symbol);
  }

  const payoutAccount = text(file.payoutAccount);
  if (payoutAccount && !isAddress(payoutAccount)) errors.push("payoutAccount: must be the address of a token account the provider wallet owns");

  let refundAccountsPerDay = 0;
  if (file.refundAccountSubsidy !== undefined) {
    const maxPerDay = isRecord(file.refundAccountSubsidy) ? Number(file.refundAccountSubsidy.maxPerDay) : NaN;
    if (!Number.isSafeInteger(maxPerDay) || maxPerDay < 0 || maxPerDay > 1_000) errors.push("refundAccountSubsidy.maxPerDay: must be a whole number from 0 to 1000");
    else refundAccountsPerDay = maxPerDay;
  }

  const genesisHash = text(file.genesisHash) || undefined;
  if (genesisHash && network === "solana-mainnet-beta") errors.push("genesisHash: cannot be set on mainnet");

  const rpcUrl = text(env.SOLANA_RPC_URL) || text(file.rpcUrl) || (network === "solana-devnet" ? DEFAULT_DEVNET_RPC_URL : "");
  if (!rpcUrl) errors.push("rpcUrl: on mainnet, set SOLANA_RPC_URL (or rpcUrl) to your RPC provider's endpoint");
  else {
    try {
      const url = new URL(rpcUrl);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("protocol");
    } catch {
      errors.push("rpcUrl: must be an http(s) address");
    }
  }

  const portRaw = text(env.PORT) || (file.port === undefined ? "" : String(file.port));
  const port = portRaw ? Number(portRaw) : DEFAULT_PORT;
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) errors.push("port: must be between 1 and 65535");

  let terms: MeteredTerms | undefined;
  if (errors.length === 0) {
    try {
      terms = providerMeteredTerms({
        currency,
        inputPerMillion: text(priceRaw.inputPerMillion),
        outputPerMillion: text(priceRaw.outputPerMillion),
        ...(priceRaw.maxOutputTokens === undefined ? {} : { maxOutputTokens: Number(priceRaw.maxOutputTokens) }),
        programId,
        mint,
        payee: wallet,
        ...(payoutAccount ? { payoutAccount } : {}),
      });
    } catch (error) {
      errors.push(`price: ${error instanceof Error ? error.message : "could not be read"}`);
    }
  }
  if (errors.length > 0 || !terms) return { ok: false, errors };

  const systemPrompt = text(file.systemPrompt) || undefined;
  const apiKey = text(env[apiKeyEnv]) || undefined;
  return {
    ok: true,
    config: {
      name,
      description,
      network,
      wallet,
      publicUrl,
      model,
      upstream: { ...(baseUrl ? { baseUrl } : {}), model: text(upstreamRaw.model) || model, ...(apiKey ? { apiKey } : {}), apiKeyEnv, mock, timeoutMs },
      terms,
      paused: pausedCurrencies.includes(currency),
      pausedCurrencies,
      refundAccountsPerDay,
      ...(systemPrompt ? { systemPrompt } : {}),
      rpcUrl,
      ...(genesisHash ? { genesisHash } : {}),
      ...(text(env.RAP_PROVIDER_KEYPAIR_PATH) || text(file.keypairPath) ? { keypairPath: text(env.RAP_PROVIDER_KEYPAIR_PATH) || text(file.keypairPath) } : {}),
      replayFile: text(file.replayFile) || DEFAULT_REPLAY_FILE,
      port,
    },
  };
}

/** A starting config for `rap-provider init`. Mock upstream, devnet, USDC. */
export function exampleConfig(wallet: string): ProviderConfigFile {
  return {
    name: "My provider",
    description: "Describe what this provider is good at.",
    network: "solana-devnet",
    wallet,
    publicUrl: `http://localhost:${DEFAULT_PORT}`,
    model: "openai/gpt-4o-mini",
    upstream: { baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "UPSTREAM_API_KEY", mock: true },
    price: { currency: "USDC", inputPerMillion: "0.15", outputPerMillion: "0.60", maxOutputTokens: 1000 },
    keypairPath: "~/.config/solana/id.json",
  };
}
