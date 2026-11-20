/**
 * Browser side of saving a provider listing (#740). Builds the request the
 * onboarding page sends to `PUT /api/listings`. The server decides the wallet,
 * owner and network from the sign-in session; nothing here can choose them.
 */

import { MAINNET_STABLECOIN_MINTS } from "@reddi/x402-solana/payment";
import type { NetworkProfileName } from "@/lib/config/network-profile-name";
import { DEVNET_USDC_MINT } from "@/lib/payments/wallet-direct-payment";

const USD_AMOUNT = /^(\d{1,9})(?:\.(\d{1,6}))?$/;

/** A US dollar amount typed by the owner as whole USDC base units (six decimals), with no floating point. */
export function usdToUsdcBaseUnits(text: string): string | undefined {
  const match = USD_AMOUNT.exec(text.trim());
  if (!match) return undefined;
  const units = BigInt(match[1]) * BigInt(1_000_000) + BigInt((match[2] ?? "").padEnd(6, "0") || "0");
  return units.toString();
}

/** The USDC mint a listing on this profile is priced in. A local profile has none. */
export function usdcMintForProfile(profile: NetworkProfileName): string | undefined {
  if (profile === "devnet") return DEVNET_USDC_MINT;
  if (profile === "mainnet") return MAINNET_STABLECOIN_MINTS.USDC;
  return undefined;
}

export interface OnboardingListingInput {
  walletAddress: string;
  endpointUrl: string;
  perCallUsd: string;
  taskTypes: string[];
  inputModes: string[];
  outputModes: string[];
  privacyModes: string[];
  tags: string[];
  profile: NetworkProfileName;
}

export type ListingBody = {
  displayName: string;
  endpointUrl: string;
  declaredModels: string[];
  capabilities: Record<string, unknown>;
  pricePerCallBaseUnits: string;
  priceMint: string;
  status: "listed";
};

export function listingBodyFromOnboarding(input: OnboardingListingInput): { ok: true; body: ListingBody } | { ok: false; message: string } {
  const priceMint = usdcMintForProfile(input.profile);
  if (!priceMint) return { ok: false, message: "Listings are not published on this network profile." };
  const price = usdToUsdcBaseUnits(input.perCallUsd);
  if (!price) return { ok: false, message: "Set a per-call price in US dollars, with at most six decimal places, to publish the listing." };
  if (!input.endpointUrl.trim()) return { ok: false, message: "Set your endpoint address before publishing the listing." };
  const wallet = input.walletAddress;
  return {
    ok: true,
    body: {
      displayName: `Specialist ${wallet.slice(0, 4)}…${wallet.slice(-4)}`,
      endpointUrl: input.endpointUrl.trim(),
      declaredModels: [],
      capabilities: {
        taskTypes: input.taskTypes,
        inputModes: input.inputModes,
        outputModes: input.outputModes,
        privacyModes: input.privacyModes,
        tags: input.tags,
      },
      pricePerCallBaseUnits: price,
      priceMint,
      status: "listed",
    },
  };
}

type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type PublishOutcome = { published: boolean; message: string };

/**
 * Publishes the listing for the signed-in wallet and says plainly what happened.
 * `accessToken` is the wallet sign-in session; without one nothing is sent.
 */
export async function publishListing(
  input: OnboardingListingInput,
  accessToken: string | undefined,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<PublishOutcome> {
  if (!accessToken) return { published: false, message: "Sign in with your wallet to publish this listing." };
  const built = listingBodyFromOnboarding(input);
  if (!built.ok) return { published: false, message: built.message };
  try {
    const response = await fetchImpl("/api/listings", {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(built.body),
    });
    const data = (await response.json().catch(() => null)) as { ok?: boolean; listing?: { wallet?: string }; error?: { message?: string } } | null;
    if (!response.ok || !data?.ok) {
      return { published: false, message: data?.error?.message ?? "The listing could not be published right now." };
    }
    const savedUnder = data.listing?.wallet;
    if (savedUnder && savedUnder !== input.walletAddress) {
      return { published: true, message: `Listing published under the wallet you signed in with (${savedUnder.slice(0, 4)}…${savedUnder.slice(-4)}), which is not the wallet on this page.` };
    }
    return { published: true, message: "Listing published. It is routed to after the next health check reaches your endpoint." };
  } catch {
    return { published: false, message: "The listing could not be published right now." };
  }
}
