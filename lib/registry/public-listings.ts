import type { SpecialistListing } from "@/lib/registry/bridge";
import { resolveNetworkProfileNameFromEnv } from "@/lib/config/network-profile-name";

/**
 * Which registry listings the launch build's Providers page shows (#1148, #1203).
 *
 * - Never a test listing: a wallet our own devnet end-to-end runs registered (`rap-devnet-e2e-*`),
 *   or an index record with no registration on chain (no registry account address).
 * - On a mainnet build, only a provider whose last health check passed: a buyer about to pay real
 *   funds sees only providers that are answering.
 */
export function isTestListing(listing: Pick<SpecialistListing, "pda" | "onchain">): boolean {
  return !listing.pda || /^rap-devnet-e2e-/i.test(listing.onchain?.model ?? "");
}

type Env = Record<string, string | undefined>;

function clientEnv(): Env {
  return {
    NETWORK_PROFILE: process.env.NETWORK_PROFILE,
    NEXT_PUBLIC_BUILD_NETWORK_PROFILE: process.env.NEXT_PUBLIC_BUILD_NETWORK_PROFILE,
    NEXT_PUBLIC_NETWORK_PROFILE: process.env.NEXT_PUBLIC_NETWORK_PROFILE,
  };
}

export function publicProviderListings<T extends Pick<SpecialistListing, "pda" | "onchain" | "health">>(listings: readonly T[], env: Env = clientEnv()): T[] {
  const mainnet = resolveNetworkProfileNameFromEnv(env) === "mainnet";
  return listings.filter((listing) => !isTestListing(listing) && (!mainnet || listing.health?.status === "pass"));
}
