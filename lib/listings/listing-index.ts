import "server-only";

/**
 * Database listings in the shape the planner and the registry view already use (#740).
 *
 * When the database is configured it is the only source of listings: a failed
 * read yields no listings, never a fall back to files on disk. Without a
 * database (local development, tests) callers keep using the file index.
 */

import { MAINNET_STABLECOIN_MINTS } from "@reddi/x402-solana/payment";
import { resolveNetworkProfileName } from "@/lib/config/network";
import { DEVNET_USDC_MINT } from "@/lib/payments/wallet-direct-payment";
import { computeFreshnessState, type SpecialistIndexEntry } from "@/lib/onboarding/specialist-index";
import { supabasePublicConfig } from "@/lib/supabase/config";
import { listingNetworkForProfile, readPublicListings, type Listing, type ListingNetwork, type ListingStoreDeps } from "@/lib/listings/listing-store";

const USD_DECIMALS = 1_000_000;
/** Above this a base-unit price no longer converts to an exact enough dollar figure. */
const MAX_USD_BASE_UNITS = BigInt("1000000000000000");

/** Mints whose unit is one US dollar with six decimals, per network. */
function usdMints(network: ListingNetwork): Set<string> {
  if (network === "solana-mainnet") {
    return new Set([MAINNET_STABLECOIN_MINTS.USDC, MAINNET_STABLECOIN_MINTS.PYUSD, MAINNET_STABLECOIN_MINTS.USDG]);
  }
  return new Set([DEVNET_USDC_MINT]);
}

/** The listed price in US dollars, when the listing is priced in a US dollar stablecoin. There is no exchange rate here. */
export function listingPerCallUsd(listing: Pick<Listing, "pricePerCallBaseUnits" | "priceMint" | "network">): number | undefined {
  return baseUnitsToUsd(listing.pricePerCallBaseUnits, listing);
}

/** The listed per-million-token prices in US dollars, when priced in a US dollar stablecoin. A zero price is left out. */
export function listingTokenPricesUsd(
  listing: Pick<Listing, "priceInputPerMillionBaseUnits" | "priceOutputPerMillionBaseUnits" | "priceMint" | "network">,
): { inputPerMillionUsd?: number; outputPerMillionUsd?: number } {
  const inputPerMillionUsd = baseUnitsToUsd(listing.priceInputPerMillionBaseUnits, listing);
  const outputPerMillionUsd = baseUnitsToUsd(listing.priceOutputPerMillionBaseUnits, listing);
  return {
    ...(inputPerMillionUsd ? { inputPerMillionUsd } : {}),
    ...(outputPerMillionUsd ? { outputPerMillionUsd } : {}),
  };
}

function baseUnitsToUsd(value: string, listing: Pick<Listing, "priceMint" | "network">): number | undefined {
  if (!usdMints(listing.network).has(listing.priceMint)) return undefined;
  let units: bigint;
  try {
    units = BigInt(value);
  } catch {
    return undefined;
  }
  if (units < BigInt(0) || units > MAX_USD_BASE_UNITS) return undefined;
  return Number(units) / USD_DECIMALS;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * One listing as an index entry. The price, endpoint and health come from the
 * listing's own columns; anything the owner wrote about them inside
 * `capabilities` is ignored. Attestation and feedback are not in the database
 * yet, so an entry is never attested here.
 */
export function listingToIndexEntry(listing: Listing): SpecialistIndexEntry {
  const caps = listing.capabilities;
  const perCallUsd = listingPerCallUsd(listing);
  const lastSeen = listing.lastSeenAt ?? undefined;
  return {
    walletAddress: listing.wallet,
    updatedAt: listing.updatedAt ?? "",
    endpointUrl: listing.endpointUrl,
    healthcheckStatus: listing.healthStatus === "unknown" ? "pending" : listing.healthStatus,
    freshness_state: computeFreshnessState(lastSeen),
    attested: false,
    last_seen_at: lastSeen,
    capabilities: {
      taskTypes: strings(caps.taskTypes),
      inputModes: strings(caps.inputModes),
      outputModes: strings(caps.outputModes),
      privacyModes: strings(caps.privacyModes).filter((m): m is "public" | "per" | "vanish" => m === "public" || m === "per" || m === "vanish"),
      tags: strings(caps.tags),
      // A per-call price of zero means the listing is priced per token only.
      pricing: { baseUsd: 0, ...(perCallUsd ? { perCallUsd } : {}), ...listingTokenPricesUsd(listing) },
      context_requirements: [],
      runtime_capabilities: [],
    },
  };
}

export type ListingIndex =
  | { source: "files" }
  | { source: "database"; available: boolean; entries: SpecialistIndexEntry[] };

/** Where listings come from on this deployment, and the listed entries when that is the database. */
export async function loadListingIndex(deps: ListingStoreDeps = {}): Promise<ListingIndex> {
  if (!(deps.publicConfig ?? supabasePublicConfig())) return { source: "files" };
  const network = listingNetworkForProfile(resolveNetworkProfileName());
  if (!network) return { source: "files" };
  const result = await readPublicListings(network, deps);
  if (!result.ok) return { source: "database", available: false, entries: [] };
  return { source: "database", available: true, entries: result.listings.map(listingToIndexEntry) };
}
