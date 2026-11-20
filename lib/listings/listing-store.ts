import "server-only";

/**
 * Provider listings in the database (#740).
 *
 * A listing belongs to the wallet that signed in. The wallet and the account id
 * always come from the checked session, never from the request body. The
 * network comes from the server's own profile. Health fields are observed by
 * the server elsewhere and cannot be set through this module.
 */

import type { NetworkProfileName } from "@/lib/config/network-profile-name";
import { supabaseOrigin, supabasePublicConfig, type SupabasePublicConfig } from "@/lib/supabase/config";

export type ListingNetwork = "solana-devnet" | "solana-mainnet";
export type ListingStatus = "draft" | "listed" | "paused";

/** What an owner may say about their own listing. */
export interface ListingInput {
  displayName: string;
  endpointUrl: string;
  declaredModels: string[];
  capabilities: Record<string, unknown>;
  /** Whole base units of the price mint, as a decimal string. */
  pricePerCallBaseUnits: string;
  /** A mint address, or "SOL" for native SOL. */
  priceMint: string;
  status: ListingStatus;
}

export interface Listing extends ListingInput {
  wallet: string;
  network: ListingNetwork;
  healthStatus: "unknown" | "pass" | "fail";
  lastSeenAt: string | null;
  updatedAt: string | null;
}

export type ListingRefusal = { ok: false; status: 400 | 403 | 503; code: "invalid_listing" | "network_not_supported" | "listing_removed" | "store_unavailable"; message: string };

const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,119}$/;
const BASE_UNITS = /^(0|[1-9][0-9]{0,17})$/;
const STATUSES: readonly ListingStatus[] = ["draft", "listed", "paused"];
const MAX_MODELS = 20;
const MAX_CAPABILITIES_BYTES = 16 * 1024;

/** Columns a client role may read. `owner_user_id` is never selected. */
const LISTING_COLUMNS =
  "wallet,display_name,endpoint_url,declared_models,capabilities,price_per_call_base_units,price_mint,network,status,health_status,last_seen_at,updated_at";

/** The database's name for the network this deployment serves. A local profile has none. */
export function listingNetworkForProfile(profile: NetworkProfileName): ListingNetwork | undefined {
  if (profile === "devnet") return "solana-devnet";
  if (profile === "mainnet") return "solana-mainnet";
  return undefined;
}

function invalid(message: string): ListingRefusal {
  return { ok: false, status: 400, code: "invalid_listing", message };
}

/** An https URL with a host, no credentials and no fragment. */
function publicHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 300) return undefined;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.hash) return undefined;
  return url.toString();
}

/** Checks what an owner sent. Unknown fields are ignored, so a body cannot name a wallet, owner, network or health. */
export function validateListingInput(body: unknown): { ok: true; input: ListingInput } | ListingRefusal {
  if (!body || typeof body !== "object" || Array.isArray(body)) return invalid("Send the listing as a JSON object.");
  const b = body as Record<string, unknown>;

  const displayName = typeof b.displayName === "string" ? b.displayName.trim() : "";
  if (displayName.length < 1 || displayName.length > 80) return invalid("The name must be 1 to 80 characters.");

  const endpointUrl = publicHttpsUrl(b.endpointUrl);
  if (!endpointUrl) return invalid("The endpoint must be an https address.");

  const models = b.declaredModels === undefined ? [] : b.declaredModels;
  if (!Array.isArray(models) || models.length > MAX_MODELS || !models.every((m) => typeof m === "string" && MODEL.test(m))) {
    return invalid(`List up to ${MAX_MODELS} model names.`);
  }
  const declaredModels = [...new Set(models as string[])];

  const capabilities = b.capabilities === undefined ? {} : b.capabilities;
  if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) return invalid("Capabilities must be an object.");
  if (Buffer.byteLength(JSON.stringify(capabilities), "utf8") > MAX_CAPABILITIES_BYTES) return invalid("Capabilities are too large.");

  const price = typeof b.pricePerCallBaseUnits === "string" ? b.pricePerCallBaseUnits : "";
  if (!BASE_UNITS.test(price)) return invalid("The price must be a whole number of base units, sent as text.");

  const priceMint = typeof b.priceMint === "string" ? b.priceMint : "";
  if (priceMint !== "SOL" && !WALLET.test(priceMint)) return invalid("The price currency must be SOL or a mint address.");

  const status = b.status === undefined ? "draft" : b.status;
  if (typeof status !== "string" || !STATUSES.includes(status as ListingStatus)) return invalid("Status must be draft, listed or paused.");

  return {
    ok: true,
    input: { displayName, endpointUrl, declaredModels, capabilities: capabilities as Record<string, unknown>, pricePerCallBaseUnits: price, priceMint, status: status as ListingStatus },
  };
}

type StoreResponse = { ok: boolean; status: number; json(): Promise<unknown> };
type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<StoreResponse>;

export interface ListingStoreDeps {
  url?: string;
  serviceKey?: string;
  publicConfig?: SupabasePublicConfig;
  fetchImpl?: FetchLike;
}

const UNAVAILABLE: ListingRefusal = { ok: false, status: 503, code: "store_unavailable", message: "Listings are not available right now." };

function fromRow(row: unknown): Listing | undefined {
  if (!row || typeof row !== "object") return undefined;
  const r = row as Record<string, unknown>;
  if (typeof r.wallet !== "string" || !WALLET.test(r.wallet)) return undefined;
  if (r.network !== "solana-devnet" && r.network !== "solana-mainnet") return undefined;
  if (typeof r.status !== "string" || !STATUSES.includes(r.status as ListingStatus)) return undefined;
  // bigint columns arrive as a JSON number; keep the exact digits and refuse anything that lost precision.
  const price = typeof r.price_per_call_base_units === "number" && Number.isSafeInteger(r.price_per_call_base_units)
    ? String(r.price_per_call_base_units)
    : typeof r.price_per_call_base_units === "string" ? r.price_per_call_base_units : "";
  if (!BASE_UNITS.test(price)) return undefined;
  return {
    wallet: r.wallet,
    displayName: typeof r.display_name === "string" ? r.display_name : "",
    endpointUrl: typeof r.endpoint_url === "string" ? r.endpoint_url : "",
    declaredModels: Array.isArray(r.declared_models) ? r.declared_models.filter((m): m is string => typeof m === "string") : [],
    capabilities: r.capabilities && typeof r.capabilities === "object" && !Array.isArray(r.capabilities) ? (r.capabilities as Record<string, unknown>) : {},
    pricePerCallBaseUnits: price,
    priceMint: typeof r.price_mint === "string" ? r.price_mint : "",
    network: r.network,
    status: r.status as ListingStatus,
    healthStatus: r.health_status === "pass" || r.health_status === "fail" ? r.health_status : "unknown",
    lastSeenAt: typeof r.last_seen_at === "string" ? r.last_seen_at : null,
    updatedAt: typeof r.updated_at === "string" ? r.updated_at : null,
  };
}

function serverCredentials(deps: ListingStoreDeps): { origin: string; serviceKey: string } | undefined {
  const origin = supabaseOrigin(deps.url ?? process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceKey = (deps.serviceKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  return origin && serviceKey ? { origin, serviceKey } : undefined;
}

/**
 * Creates or updates the signed-in wallet's own listing. `owner` must be the
 * checked session. A listing made on one network is not moved to another.
 */
export async function saveOwnListing(
  owner: { userId: string; wallet: string },
  input: ListingInput,
  network: ListingNetwork,
  deps: ListingStoreDeps = {},
): Promise<{ ok: true; listing: Listing } | ListingRefusal> {
  const credentials = serverCredentials(deps);
  if (!credentials || !WALLET.test(owner.wallet)) return UNAVAILABLE;
  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as FetchLike);
  const headers = { "content-type": "application/json", apikey: credentials.serviceKey, authorization: `Bearer ${credentials.serviceKey}` };
  try {
    const existing = await fetchImpl(`${credentials.origin}/rest/v1/providers?select=network,status&wallet=eq.${owner.wallet}`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!existing.ok) return UNAVAILABLE;
    const rows = await existing.json();
    const current = Array.isArray(rows) ? (rows[0] as { network?: unknown; status?: unknown } | undefined) : undefined;
    // Removal is a server decision. The owner cannot undo it by saving again.
    if (current && current.status === "removed") {
      return { ok: false, status: 403, code: "listing_removed", message: "This listing was removed and cannot be changed here." };
    }
    if (current && current.network !== network) {
      return { ok: false, status: 400, code: "network_not_supported", message: "This wallet's listing belongs to a different network." };
    }

    const response = await fetchImpl(`${credentials.origin}/rest/v1/providers?on_conflict=wallet&select=${LISTING_COLUMNS}`, {
      method: "POST",
      headers: { ...headers, prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        wallet: owner.wallet,
        owner_user_id: owner.userId,
        display_name: input.displayName,
        endpoint_url: input.endpointUrl,
        declared_models: input.declaredModels,
        capabilities: input.capabilities,
        price_per_call_base_units: input.pricePerCallBaseUnits,
        price_mint: input.priceMint,
        network,
        status: input.status,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return UNAVAILABLE;
    const saved = await response.json();
    const listing = fromRow(Array.isArray(saved) ? saved[0] : saved);
    return listing ? { ok: true, listing } : UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  }
}

/** The signed-in wallet's own listing in any status, or null when it has none. */
export async function readOwnListing(wallet: string, deps: ListingStoreDeps = {}): Promise<{ ok: true; listing: Listing | null } | ListingRefusal> {
  const credentials = serverCredentials(deps);
  if (!credentials || !WALLET.test(wallet)) return UNAVAILABLE;
  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as FetchLike);
  try {
    const response = await fetchImpl(`${credentials.origin}/rest/v1/providers?select=${LISTING_COLUMNS}&wallet=eq.${wallet}`, {
      method: "GET",
      headers: { apikey: credentials.serviceKey, authorization: `Bearer ${credentials.serviceKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return UNAVAILABLE;
    const rows = await response.json();
    return { ok: true, listing: Array.isArray(rows) && rows.length ? fromRow(rows[0]) ?? null : null };
  } catch {
    return UNAVAILABLE;
  }
}

/**
 * Listed providers on one network. Read with the public key, so the database's
 * own access rules apply and a draft or paused listing cannot be returned.
 */
export async function readPublicListings(network: ListingNetwork, deps: ListingStoreDeps = {}): Promise<{ ok: true; listings: Listing[] } | ListingRefusal> {
  const config = deps.publicConfig ?? supabasePublicConfig();
  if (!config) return UNAVAILABLE;
  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as FetchLike);
  try {
    const response = await fetchImpl(
      `${config.url}/rest/v1/providers?select=${LISTING_COLUMNS}&status=eq.listed&network=eq.${network}&order=updated_at.desc&limit=200`,
      { method: "GET", headers: { apikey: config.anonKey, authorization: `Bearer ${config.anonKey}` }, signal: AbortSignal.timeout(5000) },
    );
    if (!response.ok) return UNAVAILABLE;
    const rows = await response.json();
    if (!Array.isArray(rows)) return UNAVAILABLE;
    const listings = rows.map(fromRow).filter((l): l is Listing => l !== undefined && l.status === "listed" && l.network === network);
    return { ok: true, listings };
  } catch {
    return UNAVAILABLE;
  }
}
