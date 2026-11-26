/**
 * A provider's configuration: one JSON file, plus a few environment variables
 * for things that should not sit in a file (the upstream API key) or that
 * differ per machine (the RPC endpoint, the key file path).
 *
 * Parsing fails closed: anything missing or malformed is an error that names
 * the field, and the provider does not start.
 */
import { PublicKey } from "@solana/web3.js";
import { directPaymentCurrency, ESCROW_DEVNET_MINTS, ESCROW_MAINNET_MINTS, providerMeteredTerms, type MeteredTerms } from "@redditech/x402-solana";
import type { ClaudeEffort, ClaudeThinking } from "./upstream.js";
import type { CapacityLimits } from "./capacity.js";

const CLAUDE_EFFORTS: readonly ClaudeEffort[] = ["low", "medium", "high", "xhigh", "max"];

export type ProviderNetwork = "solana-devnet" | "solana-mainnet-beta";

/** The V1 escrow and registry program. The same id on devnet and mainnet. */
export const DEFAULT_ESCROW_PROGRAM_ID = "DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu";
export const DEFAULT_DEVNET_RPC_URL = "https://api.devnet.solana.com";
export const DEFAULT_CONFIG_FILE = "provider.json";
export const DEFAULT_REPLAY_FILE = ".rap-provider/accepted-escrows.log";
export const DEFAULT_SESSION_FILE = ".rap-provider/sessions.jsonl";
export const DEFAULT_BUDGET_FILE = ".rap-provider/budgets.jsonl";
/** Slots in a minute at 400 ms a slot. */
const SLOTS_PER_MINUTE = 150n;
export const DEFAULT_PORT = 8787;
export const DEFAULT_APP_URL = "https://app.agent-protocol.reddi.tech";
/** The largest request body the provider reads. It bounds the input tokens one call can be priced on. */
export const MAX_BODY_BYTES = 1_000_000;

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
    /** "openai-compatible" (the default) calls `baseUrl`; "anthropic" calls Claude through the Anthropic API. */
    provider?: string;
    /** An OpenAI-compatible base URL, for example https://openrouter.ai/api/v1 or http://localhost:11434/v1. */
    baseUrl?: string;
    /** Claude only: how much effort the model puts into an answer (low, medium, high, xhigh, max). */
    effort?: string;
    /** Claude only: "off" turns thinking off where the model allows it; "adaptive" (the default) leaves it on. */
    thinking?: string;
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
  /** How many calls the model takes. While full, the provider answers busy before any lock is taken. */
  capacity?: { requestsPerMinute?: number; requestsPerDay?: number; cooldownSeconds?: number };
  /** For `rap-provider register`: the app to list in (default: the Reddi Agent Protocol app) and what the listing says this provider can do. */
  listing?: { appUrl?: string; capabilities?: Record<string, unknown> };
  /** For a local validator only: the genesis hash to expect instead of the public devnet one. */
  genesisHash?: string;
  /**
   * Off unless true. Also accept a payer's delegation proved by a memo in its
   * lock transaction (Solana Pay transaction requests, where the wallet signs a
   * transaction but no separate message). Each such request costs one
   * transaction read from your RPC before the lock is checked.
   */
  lockBoundDelegations?: boolean;
  /**
   * Sessions: one lock pays for many calls and is settled once. Off unless
   * `enabled` is true. A session is settled after `idleSeconds` without a call
   * (default 600), when the buyer closes it, or before its refund window opens.
   * `file` keeps the sessions across restarts.
   */
  sessions?: { enabled?: boolean; idleSeconds?: number; file?: string };
  /**
   * Pooled budgets: a buyer's agent reserves a slice of one budget for this
   * provider and pays many calls from it. Off unless `enabled` is true. Only a
   * budget locked in this provider's price currency can pay it.
   * `minReservation` is the least slice it joins for, in the price currency
   * (decimal, default "0.10"); `reserveCalls` sizes the slice it asks for, in
   * calls at the request's maximum (default 10); `acceptedJudges` are the
   * judges it accepts on a budget (empty: only budgets with no judge);
   * `minOpenMinutes` is how long a budget must still be open for it to join
   * (default 60). `file` keeps the slices across restarts.
   *
   * What a budget may cost the provider before it is paid is capped:
   * `maxReservesPerHour` is how many reserves and raises it co-signs (and
   * pays the network fee of) for one budget in an hour (default 6);
   * `maxPriorityFeeLamports` is the most priority fee one of them may carry
   * (default 600); `maxFrontedRent` is the most rent, in SOL, it holds in
   * reservations at once, each returned when its slice is paid out (default
   * "0.05", about 25 budgets); `maxPayerAccountsPerDay` is how many payers'
   * token accounts it creates in a day, at about 0.002 SOL each and not
   * returned, when a payer closed its own before a payout (default 3).
   */
  budgets?: { enabled?: boolean; minReservation?: string; reserveCalls?: number; acceptedJudges?: string[]; minOpenMinutes?: number; file?: string; maxReservesPerHour?: number; maxPriorityFeeLamports?: number; maxFrontedRent?: string; maxPayerAccountsPerDay?: number };
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
  upstream: { provider: "openai-compatible" | "anthropic"; baseUrl?: string; model: string; apiKey?: string; apiKeyEnv: string; mock: boolean; timeoutMs: number; effort?: ClaudeEffort; thinking?: ClaudeThinking };
  terms: MeteredTerms;
  /** True while the price currency is in the paused list: no new locks are taken. */
  paused: boolean;
  pausedCurrencies: string[];
  /** Buyer token accounts the provider will pay to create in a UTC day. 0: never. */
  refundAccountsPerDay: number;
  capacity: CapacityLimits;
  /** The app `register` lists in. An https origin. */
  appUrl: string;
  listingCapabilities: Record<string, unknown>;
  systemPrompt?: string;
  rpcUrl: string;
  genesisHash?: string;
  /** Accept delegations proved by a memo in the lock transaction. */
  lockBoundDelegations: boolean;
  keypairPath?: string;
  replayFile: string;
  sessions: { enabled: boolean; idleMs: number; file: string };
  budgets: { enabled: boolean; minReservationBaseUnits: bigint; reserveCalls: number; acceptedJudges: PublicKey[]; minOpenSlots: bigint; file: string; maxReservesPerHour: number; maxPriorityFeeLamports: bigint; maxFrontedRentLamports: bigint; maxPayerAccountsPerDay: number };
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
  const upstreamProvider = text(upstreamRaw.provider) || "openai-compatible";
  if (upstreamProvider !== "openai-compatible" && upstreamProvider !== "anthropic") errors.push('upstream.provider: must be "openai-compatible" or "anthropic"');
  const claude = upstreamProvider === "anthropic";
  const baseUrl = claude ? "" : text(upstreamRaw.baseUrl).replace(/\/+$/, "");
  const effort = text(upstreamRaw.effort);
  if (effort && (!claude || !CLAUDE_EFFORTS.includes(effort as ClaudeEffort))) errors.push(`upstream.effort: only for the anthropic provider, one of ${CLAUDE_EFFORTS.join(", ")}`);
  const thinking = text(upstreamRaw.thinking);
  if (thinking && (!claude || (thinking !== "adaptive" && thinking !== "off"))) errors.push('upstream.thinking: only for the anthropic provider, "adaptive" or "off"');
  // A model on the operator's own network may be plain http; the key is then the operator's concern.
  if (!mock && !claude && !serviceUrl(baseUrl, { allowHttpAnywhere: true })) errors.push('upstream.baseUrl: must be an OpenAI-compatible base URL such as "https://openrouter.ai/api/v1", or set upstream.mock to true');
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

  const capacityRaw = isRecord(file.capacity) ? file.capacity : {};
  if (file.capacity !== undefined && !isRecord(file.capacity)) errors.push("capacity: must be an object");
  const limit = (name: string, value: unknown, max: number): number | undefined => {
    if (value === undefined) return undefined;
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 1 || n > max) {
      errors.push(`capacity.${name}: must be a whole number from 1 to ${max}`);
      return undefined;
    }
    return n;
  };
  const requestsPerMinute = limit("requestsPerMinute", capacityRaw.requestsPerMinute, 100_000);
  const requestsPerDay = limit("requestsPerDay", capacityRaw.requestsPerDay, 10_000_000);
  const cooldownSeconds = limit("cooldownSeconds", capacityRaw.cooldownSeconds, 86_400) ?? 60;
  const capacity: CapacityLimits = { ...(requestsPerMinute ? { requestsPerMinute } : {}), ...(requestsPerDay ? { requestsPerDay } : {}), cooldownSeconds };

  let refundAccountsPerDay = 0;
  if (file.refundAccountSubsidy !== undefined) {
    const maxPerDay = isRecord(file.refundAccountSubsidy) ? Number(file.refundAccountSubsidy.maxPerDay) : NaN;
    if (!Number.isSafeInteger(maxPerDay) || maxPerDay < 0 || maxPerDay > 1_000) errors.push("refundAccountSubsidy.maxPerDay: must be a whole number from 0 to 1000");
    else refundAccountsPerDay = maxPerDay;
  }

  const listingRaw = isRecord(file.listing) ? file.listing : {};
  const appUrlRaw = text(env.RAP_APP_URL) || text(listingRaw.appUrl) || DEFAULT_APP_URL;
  const appUrl = serviceUrl(appUrlRaw)?.origin;
  if (!appUrl || new URL(appUrlRaw).pathname.replace(/\/+$/, "") !== "") errors.push("listing.appUrl: must be the app's address, such as https://app.agent-protocol.reddi.tech");
  if (listingRaw.capabilities !== undefined && !isRecord(listingRaw.capabilities)) errors.push("listing.capabilities: must be an object");
  const listingCapabilities = isRecord(listingRaw.capabilities) ? listingRaw.capabilities : {};

  const sessionsRaw = file.sessions === undefined ? {} : isRecord(file.sessions) ? file.sessions : undefined;
  if (!sessionsRaw) errors.push("sessions: must be an object");
  // Off by default: turn on only for a provider that watches its session alerts.
  const sessionsEnabled = sessionsRaw?.enabled === true;
  if (sessionsRaw?.enabled !== undefined && typeof sessionsRaw.enabled !== "boolean") errors.push("sessions.enabled: must be true or false");
  // A buyer can leave a session unpaid by making its refund accounts unusable after it has been served
  // (closing them, re-owning them, or requiring memos), so sessions are not offered on mainnet yet.
  if (sessionsEnabled && network === "solana-mainnet-beta") errors.push("sessions.enabled: sessions are not offered on mainnet yet; leave this off");
  const idleSeconds = sessionsRaw?.idleSeconds === undefined ? 600 : Number(sessionsRaw.idleSeconds);
  if (!Number.isSafeInteger(idleSeconds) || idleSeconds < 30 || idleSeconds > 3_600) errors.push("sessions.idleSeconds: must be a whole number from 30 to 3600");

  const genesisHash = text(file.genesisHash) || undefined;
  if (file.lockBoundDelegations !== undefined && typeof file.lockBoundDelegations !== "boolean") errors.push("lockBoundDelegations: must be true or false");
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
  const budgetsRaw = file.budgets === undefined ? {} : isRecord(file.budgets) ? file.budgets : undefined;
  if (!budgetsRaw) errors.push("budgets: must be an object");
  if (budgetsRaw?.enabled !== undefined && typeof budgetsRaw.enabled !== "boolean") errors.push("budgets.enabled: must be true or false");
  const maxReservesPerHour = budgetsRaw?.maxReservesPerHour === undefined ? 6 : Number(budgetsRaw.maxReservesPerHour);
  if (!Number.isSafeInteger(maxReservesPerHour) || maxReservesPerHour < 1 || maxReservesPerHour > 60) errors.push("budgets.maxReservesPerHour: must be a whole number from 1 to 60");
  const maxPriorityFeeLamports = budgetsRaw?.maxPriorityFeeLamports === undefined ? 600 : Number(budgetsRaw.maxPriorityFeeLamports);
  if (!Number.isSafeInteger(maxPriorityFeeLamports) || maxPriorityFeeLamports < 0 || maxPriorityFeeLamports > 100_000) errors.push("budgets.maxPriorityFeeLamports: must be a whole number from 0 to 100000");
  const maxFrontedRentText = budgetsRaw?.maxFrontedRent === undefined ? "0.05" : text(budgetsRaw.maxFrontedRent);
  const frontedRentOk = /^\d{1,3}(\.\d{1,9})?$/.test(maxFrontedRentText);
  const [rentWhole, rentFraction = ""] = maxFrontedRentText.split(".");
  const maxFrontedRentLamports = frontedRentOk ? BigInt(rentWhole) * 1_000_000_000n + BigInt((rentFraction + "0".repeat(9)).slice(0, 9)) : 0n;
  if (!frontedRentOk || maxFrontedRentLamports < 2_000_000n || maxFrontedRentLamports > 10_000_000_000n) errors.push("budgets.maxFrontedRent: must be an amount of SOL from 0.002 to 10");
  const maxPayerAccountsPerDay = budgetsRaw?.maxPayerAccountsPerDay === undefined ? 3 : Number(budgetsRaw.maxPayerAccountsPerDay);
  if (!Number.isSafeInteger(maxPayerAccountsPerDay) || maxPayerAccountsPerDay < 0 || maxPayerAccountsPerDay > 1_000) errors.push("budgets.maxPayerAccountsPerDay: must be a whole number from 0 to 1000");
  const minReservationText = budgetsRaw?.minReservation === undefined ? "0.10" : text(budgetsRaw.minReservation);
  if (!/^\d{1,9}(\.\d{1,9})?$/.test(minReservationText) || Number(minReservationText) <= 0) errors.push("budgets.minReservation: must be a positive decimal amount in the price currency");
  const reserveCalls = budgetsRaw?.reserveCalls === undefined ? 10 : Number(budgetsRaw.reserveCalls);
  if (!Number.isSafeInteger(reserveCalls) || reserveCalls < 1 || reserveCalls > 1_000) errors.push("budgets.reserveCalls: must be a whole number from 1 to 1000");
  const minOpenMinutes = budgetsRaw?.minOpenMinutes === undefined ? 60 : Number(budgetsRaw.minOpenMinutes);
  if (!Number.isSafeInteger(minOpenMinutes) || minOpenMinutes < 10 || minOpenMinutes > 10_080) errors.push("budgets.minOpenMinutes: must be a whole number from 10 to 10080");
  const judgesRaw = budgetsRaw?.acceptedJudges === undefined ? [] : budgetsRaw.acceptedJudges;
  const acceptedJudges: PublicKey[] = [];
  if (!Array.isArray(judgesRaw) || judgesRaw.length > 16) errors.push("budgets.acceptedJudges: must be a list of up to 16 addresses");
  else for (const judge of judgesRaw) {
    if (typeof judge === "string" && isAddress(judge.trim())) acceptedJudges.push(new PublicKey(judge.trim()));
    else errors.push(`budgets.acceptedJudges: ${String(judge)} is not an address`);
  }
  if (errors.length > 0 || !terms) return { ok: false, errors };
  const [whole, fraction = ""] = minReservationText.split(".");
  const budgetDecimals = directPaymentCurrency(terms.price.currency)?.decimals ?? 6;
  if (fraction.length > budgetDecimals) return { ok: false, errors: [`budgets.minReservation: ${terms.price.currency} has ${budgetDecimals} decimal places`] };
  const minReservationBaseUnits = BigInt(whole) * 10n ** BigInt(budgetDecimals) + BigInt((fraction + "0".repeat(budgetDecimals)).slice(0, budgetDecimals) || "0");

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
      upstream: {
        provider: claude ? "anthropic" : "openai-compatible",
        ...(baseUrl ? { baseUrl } : {}),
        model: text(upstreamRaw.model) || model,
        ...(apiKey ? { apiKey } : {}),
        apiKeyEnv,
        mock,
        timeoutMs,
        ...(effort ? { effort: effort as ClaudeEffort } : {}),
        ...(thinking ? { thinking: thinking as ClaudeThinking } : {}),
      },
      terms,
      paused: pausedCurrencies.includes(currency),
      pausedCurrencies,
      refundAccountsPerDay,
      capacity,
      appUrl: appUrl ?? DEFAULT_APP_URL,
      listingCapabilities,
      ...(systemPrompt ? { systemPrompt } : {}),
      rpcUrl,
      ...(genesisHash ? { genesisHash } : {}),
      lockBoundDelegations: file.lockBoundDelegations === true,
      ...(text(env.RAP_PROVIDER_KEYPAIR_PATH) || text(file.keypairPath) ? { keypairPath: text(env.RAP_PROVIDER_KEYPAIR_PATH) || text(file.keypairPath) } : {}),
      replayFile: text(file.replayFile) || DEFAULT_REPLAY_FILE,
      sessions: { enabled: sessionsEnabled, idleMs: idleSeconds * 1_000, file: text(sessionsRaw?.file) || DEFAULT_SESSION_FILE },
      budgets: { enabled: budgetsRaw?.enabled === true, minReservationBaseUnits, reserveCalls, acceptedJudges, minOpenSlots: BigInt(minOpenMinutes) * SLOTS_PER_MINUTE, file: text(budgetsRaw?.file) || DEFAULT_BUDGET_FILE, maxReservesPerHour, maxPriorityFeeLamports: BigInt(maxPriorityFeeLamports), maxFrontedRentLamports, maxPayerAccountsPerDay },
      port,
    },
  };
}

/** A starting config for `rap-provider init`. Mock upstream, devnet, USDC. */
/** The Solana CLI's default keypair, which `init` points at until the operator names a dedicated provider key. */
export const SOLANA_CLI_DEFAULT_KEY = "~/.config/solana/id.json";

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
    keypairPath: SOLANA_CLI_DEFAULT_KEY,
  };
}
