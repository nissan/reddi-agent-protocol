import "server-only";

/**
 * Every listing carries an Agent Definition Language (ADL v0.3) document.
 *
 * A provider that sends its own (the provider kit always does) has it checked:
 * it must pass ADL Level 3 and say what the listing says (network, paid wallet,
 * mint, price, model, endpoint). A listing saved without one, such as the
 * onboarding form's, gets one made from its fields. Either way the listing and
 * its ADL cannot disagree, and the document is stored next to the listing.
 */

import {
  buildProviderAdl,
  parseAdlDocument,
  providerTermsFromAdl,
  type AdlDocument,
  type AdlNetwork,
  type AdlPrice,
} from "@redditech/agent-protocol/adl";
import { baseUnitsToDecimal, decimalToBaseUnits, directPaymentCurrency, MAINNET_STABLECOIN_MINTS } from "@redditech/x402-solana/payment";
import type { ListingInput, ListingNetwork } from "@/lib/listings/listing-store";
import { DEVNET_USDC_MINT } from "@/lib/payments/wallet-direct-payment";

export type ListingAdlSource = "provider" | "generated";
export type ListingAdl = { ok: true; adl: AdlDocument; source: ListingAdlSource } | { ok: false; message: string };

const adlNetwork = (network: ListingNetwork): AdlNetwork => (network === "solana-mainnet" ? "solana-mainnet-beta" : "solana-devnet");

/** The currency a listing's mint is, where the app knows it: the mainnet allowlist, or devnet USDC. */
export function currencyForMint(network: ListingNetwork, mint: string): string | undefined {
  if (network === "solana-mainnet") return Object.entries(MAINNET_STABLECOIN_MINTS).find(([, m]) => m === mint)?.[0];
  return mint === DEVNET_USDC_MINT ? "USDC" : undefined;
}

const sameUrl = (a: string, b: string) => {
  try {
    return new URL(a).href.replace(/\/+$/, "") === new URL(b).href.replace(/\/+$/, "");
  } catch {
    return false;
  }
};

function baseUnits(decimal: string, decimals: number): string | undefined {
  const units = decimalToBaseUnits(decimal, decimals);
  return units === undefined || units === null ? undefined : units.toString();
}

/** Where a provider's ADL and its listing disagree, one line each. */
function mismatches(input: ListingInput, terms: ReturnType<typeof providerTermsFromAdl> & { ok: true }, owner: { wallet: string; network: ListingNetwork }): string[] {
  const t = terms.terms;
  const problems: string[] = [];
  if (t.mode !== "live") problems.push("extensions.x402.mode must be live for a listing");
  if (t.network !== adlNetwork(owner.network)) problems.push(`the ADL is for ${t.network}, and this app lists ${adlNetwork(owner.network)} providers`);
  if (t.payTo !== owner.wallet) problems.push("payTo must be the signed-in wallet");
  if (t.mint !== input.priceMint) problems.push("the ADL asset mint is not the listing's price mint");
  const decimals = directPaymentCurrency(t.currency)?.decimals;
  if (decimals === undefined) problems.push(`${t.currency} is not a currency the protocol takes`);
  else if (t.price.per === "token") {
    if (baseUnits(t.price.inputPerMillion, decimals) !== input.priceInputPerMillionBaseUnits || baseUnits(t.price.outputPerMillion, decimals) !== input.priceOutputPerMillionBaseUnits) problems.push("the ADL per-token price is not the listing's price");
    if (input.pricePerCallBaseUnits !== "0") problems.push("a listing priced per token in its ADL cannot also set a price per job");
  } else {
    if (baseUnits(t.price.amount, decimals) !== input.pricePerCallBaseUnits) problems.push("the ADL price per call is not the listing's price per job");
    if (input.priceInputPerMillionBaseUnits !== "0" || input.priceOutputPerMillionBaseUnits !== "0") problems.push("a listing priced per call in its ADL cannot also set per-token prices");
  }
  if (t.declaredModel ? !input.declaredModels.includes(t.declaredModel) : input.declaredModels.length > 0) problems.push("the ADL declared model must be one of the listing's models");
  if (t.endpointUrl && !sameUrl(t.endpointUrl, input.endpointUrl)) problems.push("the ADL endpoint is not the listing's endpoint");
  return problems;
}

/**
 * The ADL for a listing the signed-in wallet is saving. `adlText` is the
 * provider's own document (YAML or JSON), or undefined to have one made from
 * the listing.
 */
export function listingAdl(input: ListingInput, adlText: unknown, owner: { wallet: string; network: ListingNetwork }): ListingAdl {
  if (adlText !== undefined) {
    if (typeof adlText !== "string") return { ok: false, message: "Send the ADL document as YAML or JSON text." };
    const parsed = parseAdlDocument(adlText);
    if (!parsed.ok) return parsed;
    const terms = providerTermsFromAdl(parsed.document);
    if (!terms.ok) return { ok: false, message: `The ADL document does not pass ADL v0.3 Level 3: ${terms.problems.slice(0, 5).join("; ")}` };
    const problems = mismatches(input, terms, owner);
    if (problems.length) return { ok: false, message: `The ADL document and the listing disagree: ${problems.join("; ")}.` };
    return { ok: true, adl: parsed.document, source: "provider" };
  }

  const currency = currencyForMint(owner.network, input.priceMint);
  const decimals = currency ? directPaymentCurrency(currency)?.decimals : undefined;
  if (!currency || decimals === undefined) return { ok: false, message: "Send an ADL document with this listing: the app can only describe listings priced in a stablecoin it knows." };
  const decimal = (units: string) => baseUnitsToDecimal(BigInt(units), decimals);
  const perToken = input.priceInputPerMillionBaseUnits !== "0" || input.priceOutputPerMillionBaseUnits !== "0";
  // Without a provider's own ceiling, the most one call can cost is listed as a call of up to a million tokens each way.
  const price: AdlPrice = perToken
    ? {
        per: "token",
        inputPerMillion: decimal(input.priceInputPerMillionBaseUnits),
        outputPerMillion: decimal(input.priceOutputPerMillionBaseUnits),
        maxPerCall: decimal((BigInt(input.priceInputPerMillionBaseUnits) + BigInt(input.priceOutputPerMillionBaseUnits)).toString()),
      }
    : { per: "call", amount: decimal(input.pricePerCallBaseUnits) };
  const adl = buildProviderAdl({
    name: input.displayName,
    ...(input.declaredModels[0] ? { model: input.declaredModels[0] } : {}),
    network: adlNetwork(owner.network),
    currency,
    mint: input.priceMint,
    payTo: owner.wallet,
    price,
    endpointUrl: input.endpointUrl,
  });
  const check = providerTermsFromAdl(adl);
  if (!check.ok) return { ok: false, message: `This listing cannot be described in ADL v0.3: ${check.problems.slice(0, 5).join("; ")}` };
  return { ok: true, adl, source: "generated" };
}
