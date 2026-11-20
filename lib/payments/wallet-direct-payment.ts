/**
 * Buyer-side checks for a wallet-signed direct per-call payment (#738).
 *
 * Runs in the browser and on the server. It never signs, submits or reads a
 * key: it decides whether the page may ask the buyer's wallet to sign, and what
 * a receipt must look like before the app forwards it to a provider.
 */

import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { planBuyerDirectPayment, type BuyerListing } from "@reddi/x402-solana/buyer";
import { directPaymentCurrency, MAINNET_STABLECOIN_MINTS } from "@reddi/x402-solana/payment";
import type { SolanaPaymentNetwork, X402FeeTerms, X402PaymentReceipt } from "@reddi/x402-solana/types";
import type { NetworkProfileName } from "@/lib/config/network-profile-name";

/** Currencies whose unit is one US dollar, so a listing priced in USD states their amount. */
const USD_STABLECOINS = new Set(["USDC", "PYUSD", "USDG"]);

/** Devnet USDC test mint published by Circle. Other devnet mints come from operator configuration. */
export const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

export type WalletPaymentRefusal = { ok: false; reason: string; message: string };

/** What the buyer saw and chose on the listing. */
export interface SelectedListing {
  walletAddress: string;
  /** Listed per-call price in US dollars. */
  perCallUsd?: number;
  /** Listed per-call price in a named currency, when the listing states one. */
  perCall?: { amount: string; currency: string };
}

/** Lamports as an exact decimal SOL amount, with no floating point. */
export function lamportsToSolAmount(lamports: bigint | number | string): string | undefined {
  let value: bigint;
  try {
    value = BigInt(lamports);
  } catch {
    return undefined;
  }
  if (value <= BigInt(0)) return undefined;
  const whole = value / BigInt(1_000_000_000);
  const fraction = (value % BigInt(1_000_000_000)).toString().padStart(9, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/** Build-time switch. Off unless the operator sets it; the browser never accepts a runtime override. */
export function walletDirectPaymentEnabled(value: string | undefined = process.env.NEXT_PUBLIC_WALLET_DIRECT_PAYMENT): boolean {
  return value === "1" || value === "true";
}

/** The payment network a wallet on this profile pays on. A local profile has none. */
export function paymentNetworkForProfile(profile: NetworkProfileName): SolanaPaymentNetwork | undefined {
  if (profile === "devnet") return "solana-devnet";
  if (profile === "mainnet") return "solana-mainnet-beta";
  return undefined;
}

/**
 * The listing terms to hold a challenge to, in the challenge's currency.
 * A USD price states the amount for a US dollar stablecoin and nothing else:
 * there is no exchange rate here, so SOL and AUDD need a price in that currency.
 */
export function listingForCurrency(listing: SelectedListing, currency: string): ({ ok: true } & { listing: BuyerListing }) | WalletPaymentRefusal {
  if (listing.perCall && listing.perCall.currency === currency) {
    return { ok: true, listing: { payTo: listing.walletAddress, amount: listing.perCall.amount, currency } };
  }
  if (USD_STABLECOINS.has(currency) && typeof listing.perCallUsd === "number" && Number.isFinite(listing.perCallUsd) && listing.perCallUsd > 0) {
    // Fixed notation with the currency's six decimals; never exponent form.
    return { ok: true, listing: { payTo: listing.walletAddress, amount: listing.perCallUsd.toFixed(6), currency } };
  }
  return {
    ok: false,
    reason: "listing_price_missing",
    message: `The listing does not state a price in ${currency}, so the request cannot be checked against it.`,
  };
}

/** The mint the buyer's side holds for a currency on a network. Undefined for SOL or when none is configured. */
export function buyerMintFor(currency: string, network: SolanaPaymentNetwork, configured: Partial<Record<string, string | undefined>> = {}): string | undefined {
  if (currency === "SOL") return undefined;
  const fromConfig = configured[currency]?.trim();
  if (fromConfig) return fromConfig;
  if (network === "solana-mainnet-beta") {
    return (MAINNET_STABLECOIN_MINTS as Record<string, string | undefined>)[currency];
  }
  if (network === "solana-devnet" && currency === "USDC") return DEVNET_USDC_MINT;
  return undefined;
}

export interface WalletPaymentRequest {
  /** Raw `x402-request` header value the provider returned. */
  challenge: unknown;
  listing: SelectedListing;
  profile: NetworkProfileName;
  /** Most the buyer will pay for this call, in US dollars. Applied to US dollar stablecoins as is. */
  maxPerCallUsd?: number;
  /** Cap in the challenge currency, for currencies that are not a US dollar stablecoin. */
  spendCap?: string;
  payer: string;
  /** Operator-configured mints per currency. */
  mints?: Partial<Record<string, string | undefined>>;
}

export type WalletPaymentPlan =
  | {
      ok: true;
      instructions: TransactionInstruction[];
      network: SolanaPaymentNetwork;
      currency: string;
      amount: string;
      payTo: string;
      totalBaseUnits: bigint;
      fee?: X402FeeTerms;
      receiptFor(signature: string): X402PaymentReceipt;
    }
  | WalletPaymentRefusal;

/** Decides whether the wallet may be asked to sign, and builds what it would sign. */
export function planWalletDirectPayment(request: WalletPaymentRequest): WalletPaymentPlan {
  const network = paymentNetworkForProfile(request.profile);
  if (!network) {
    return { ok: false, reason: "network_not_supported", message: "Wallet payments are not available on this network profile." };
  }
  let parsed: unknown = request.challenge;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return { ok: false, reason: "invalid_challenge", message: "The provider's payment request could not be read." };
    }
  }
  const currency = parsed && typeof parsed === "object" ? (parsed as { currency?: unknown }).currency : undefined;
  if (typeof currency !== "string" || !directPaymentCurrency(currency)) {
    return { ok: false, reason: "wrong_currency", message: "The provider asked for a currency this app does not pay in." };
  }
  const terms = listingForCurrency(request.listing, currency);
  if (!terms.ok) return terms;

  let spendCap: string | undefined = request.spendCap;
  if (!spendCap && USD_STABLECOINS.has(currency) && typeof request.maxPerCallUsd === "number" && Number.isFinite(request.maxPerCallUsd)) {
    spendCap = request.maxPerCallUsd.toFixed(6);
  }
  if (!spendCap) {
    return { ok: false, reason: "spend_cap_missing", message: `Set a spending limit in ${currency} before paying.` };
  }

  let payer: PublicKey;
  try {
    payer = new PublicKey(request.payer);
  } catch {
    return { ok: false, reason: "invalid_payer", message: "The connected wallet address is not valid." };
  }
  let mint: PublicKey | undefined;
  if (currency !== "SOL") {
    const mintAddress = buyerMintFor(currency, network, request.mints);
    if (!mintAddress) {
      return { ok: false, reason: "mint_not_configured", message: `No ${currency} mint is configured for ${network}.` };
    }
    try {
      mint = new PublicKey(mintAddress);
    } catch {
      return { ok: false, reason: "mint_not_configured", message: `The configured ${currency} mint is not a valid address.` };
    }
  }

  const plan = planBuyerDirectPayment({ challenge: parsed, listing: terms.listing, network, spendCap, payer, mint });
  if (!plan.ok) return plan;
  return {
    ok: true,
    instructions: plan.instructions,
    network,
    currency,
    amount: String(plan.challenge.amount),
    payTo: plan.challenge.payTo,
    totalBaseUnits: plan.totalBaseUnits,
    fee: plan.fee,
    receiptFor: plan.receiptFor,
  };
}

const BASE58_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

/**
 * Shape check on a receipt the browser hands back before the app forwards it.
 * It proves nothing about payment: the provider's verifier does that against
 * the chain. It only stops a placeholder or malformed value being forwarded.
 */
export function receiptHeaderForProvider(receipt: unknown): { ok: true; header: string; signature: string; nonce: string } | WalletPaymentRefusal {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    return { ok: false, reason: "invalid_receipt", message: "The payment receipt is missing." };
  }
  const r = receipt as Record<string, unknown>;
  const signature = typeof r.signature === "string" ? r.signature : typeof r.txSignature === "string" ? r.txSignature : "";
  if (!BASE58_SIGNATURE.test(signature)) {
    return { ok: false, reason: "invalid_receipt", message: "The payment receipt does not carry a transaction signature." };
  }
  if (r.demo === true) {
    return { ok: false, reason: "invalid_receipt", message: "A demo receipt cannot be presented as a wallet payment." };
  }
  for (const key of ["network", "payTo", "currency", "nonce"]) {
    if (typeof r[key] !== "string" || !(r[key] as string).length) {
      return { ok: false, reason: "invalid_receipt", message: `The payment receipt is missing ${key}.` };
    }
  }
  if (typeof r.amount !== "string" && typeof r.amount !== "number") {
    return { ok: false, reason: "invalid_receipt", message: "The payment receipt is missing amount." };
  }
  const header = JSON.stringify({
    network: r.network,
    payTo: r.payTo,
    amount: r.amount,
    currency: r.currency,
    nonce: r.nonce,
    signature,
    ...(typeof r.payer === "string" ? { payer: r.payer } : {}),
    ...(typeof r.mint === "string" ? { mint: r.mint } : {}),
    ...(typeof r.destinationTokenAccount === "string" ? { destinationTokenAccount: r.destinationTokenAccount } : {}),
  });
  return { ok: true, header, signature, nonce: r.nonce as string };
}
