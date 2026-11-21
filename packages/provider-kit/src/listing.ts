/**
 * The provider's listing in the app: sign in with the provider wallet, then
 * create or update the wallet's own listing. Three hosts are contacted, all
 * named by the app the operator chose: the app, and the auth service the app
 * says it uses. The wallet key signs one sign-in message and nothing else.
 */
import { decimalToBaseUnits, directPaymentCurrency } from "@reddi/x402-solana";
import type { ProviderConfig } from "./config.js";

/** The same statement the app's own wallet sign-in shows. */
export const SIGN_IN_STATEMENT = "Sign in to Reddi Agent Protocol. This proves you own this wallet. It does not move funds or approve any transaction.";

export type ListingFetch = (url: string, init: { method: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
export type ListingResult<T> = ({ ok: true } & T) | { ok: false; message: string };

export interface ListingBody {
  displayName: string;
  endpointUrl: string;
  declaredModels: string[];
  capabilities: Record<string, unknown>;
  priceInputPerMillionBaseUnits: string;
  priceOutputPerMillionBaseUnits: string;
  priceMint: string;
  status: "listed" | "paused";
}

/** What the app calls this provider's network. */
export const appNetwork = (network: ProviderConfig["network"]) => (network === "solana-mainnet-beta" ? "solana-mainnet" : "solana-devnet");

/** The listing this config describes. Paused while the price currency is paused, so buyers are not sent to a provider that will refuse them. */
export function listingBody(config: ProviderConfig): ListingResult<{ body: ListingBody }> {
  const { terms } = config;
  const url = new URL(config.publicUrl);
  if (url.protocol !== "https:" || !url.hostname.includes(".")) return { ok: false, message: "publicUrl must be a public https address before you list. Buyers and the app's health check call it." };
  const decimals = directPaymentCurrency(terms.price.currency)!.decimals;
  // The app stores whole base units per million tokens.
  const input = decimalToBaseUnits(terms.price.inputPerMillion, decimals);
  const output = decimalToBaseUnits(terms.price.outputPerMillion, decimals);
  if (input === undefined || output === undefined || input === null || output === null) return { ok: false, message: "price: could not be expressed in base units per million tokens." };
  return {
    ok: true,
    body: {
      displayName: config.name,
      endpointUrl: config.publicUrl,
      declaredModels: [config.model],
      capabilities: config.listingCapabilities,
      priceInputPerMillionBaseUnits: input.toString(),
      priceOutputPerMillionBaseUnits: output.toString(),
      priceMint: terms.mint.toBase58(),
      status: config.paused ? "paused" : "listed",
    },
  };
}

/** The sign-in message, in the form the auth service checks. */
export function signInMessage(appUrl: string, wallet: string, issuedAt: Date): string {
  const url = new URL(appUrl);
  return [`${url.host} wants you to sign in with your Solana account:`, wallet, "", SIGN_IN_STATEMENT, "", "Version: 1", `URI: ${url.href}`, `Issued At: ${issuedAt.toISOString()}`].join("\n");
}

const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const errorText = (body: unknown, fallback: string) => {
  const error = record(record(body).error);
  return typeof error.message === "string" ? error.message : typeof record(body).msg === "string" ? String(record(body).msg) : fallback;
};

export interface ListingClientInput {
  /** Defaults to the config's app. */
  appUrl?: string;
  config: ProviderConfig;
  signMessage: (message: Uint8Array) => Uint8Array | Promise<Uint8Array>;
  fetchImpl?: ListingFetch;
  now?: () => Date;
}

async function call(fetchImpl: ListingFetch, url: string, init: Parameters<ListingFetch>[1]): Promise<{ ok: boolean; status: number; body: unknown } | undefined> {
  try {
    const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(15_000) });
    return { ok: response.ok, status: response.status, body: await response.json().catch(() => null) };
  } catch {
    return undefined;
  }
}

/** The app's listings, after checking the app serves this provider's network. */
export async function readListings(input: Pick<ListingClientInput, "appUrl" | "config" | "fetchImpl">): Promise<ListingResult<{ listing: Record<string, unknown> | null }>> {
  const fetchImpl = input.fetchImpl ?? (fetch as unknown as ListingFetch);
  const appUrl = input.appUrl ?? input.config.appUrl;
  const response = await call(fetchImpl, `${appUrl}/api/listings`, { method: "GET" });
  if (!response) return { ok: false, message: `${appUrl} could not be reached.` };
  const body = record(response.body);
  if (!response.ok || body.ok !== true) return { ok: false, message: errorText(response.body, `${appUrl}/api/listings answered with status ${response.status}.`) };
  if (body.network !== appNetwork(input.config.network)) return { ok: false, message: `${appUrl} lists ${String(body.network)} providers, and this provider is on ${input.config.network}. Nothing was sent.` };
  const listings = Array.isArray(body.listings) ? body.listings : [];
  const mine = listings.map(record).find((entry) => entry.wallet === input.config.wallet);
  return { ok: true, listing: mine ?? null };
}

/** Signs in with the provider wallet and creates or updates its listing. */
export async function publishListing(input: ListingClientInput & { body: ListingBody }): Promise<ListingResult<{ listing: Record<string, unknown> }>> {
  const fetchImpl = input.fetchImpl ?? (fetch as unknown as ListingFetch);
  const { config } = input;
  const appUrl = input.appUrl ?? config.appUrl;

  const network = await readListings(input);
  if (!network.ok) return network;

  const auth = await call(fetchImpl, `${appUrl}/api/auth/config`, { method: "GET" });
  const authBody = record(auth?.body);
  if (!auth?.ok || typeof authBody.authUrl !== "string" || typeof authBody.publishableKey !== "string") return { ok: false, message: errorText(auth?.body, `${appUrl} did not say where to sign in.`) };
  let authUrl: URL;
  try {
    authUrl = new URL(authBody.authUrl);
    if (authUrl.protocol !== "https:") throw new Error("protocol");
  } catch {
    return { ok: false, message: `${appUrl} named a sign-in address that is not https. Nothing was signed.` };
  }

  const message = signInMessage(appUrl, config.wallet, input.now?.() ?? new Date());
  const signature = Buffer.from(await input.signMessage(new TextEncoder().encode(message))).toString("base64url");
  const signedIn = await call(fetchImpl, `${authUrl.origin}/auth/v1/token?grant_type=web3`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: authBody.publishableKey },
    body: JSON.stringify({ chain: "solana", message, signature }),
  });
  const token = record(signedIn?.body).access_token;
  if (!signedIn?.ok || typeof token !== "string") return { ok: false, message: `Wallet sign-in was refused: ${errorText(signedIn?.body, signedIn ? `status ${signedIn.status}` : "the sign-in service could not be reached")}.` };
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  const session = await call(fetchImpl, `${appUrl}/api/auth/session`, { method: "POST", headers });
  if (!session?.ok || record(session.body).wallet !== config.wallet) return { ok: false, message: errorText(session?.body, "The app did not confirm the sign-in for this wallet. Nothing was listed.") };

  const saved = await call(fetchImpl, `${appUrl}/api/listings`, { method: "PUT", headers, body: JSON.stringify(input.body) });
  if (!saved?.ok || record(saved.body).ok !== true) return { ok: false, message: `The listing was refused: ${errorText(saved?.body, saved ? `status ${saved.status}` : "the app could not be reached")}.` };
  return { ok: true, listing: record(record(saved.body).listing) };
}
