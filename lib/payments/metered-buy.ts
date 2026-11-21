/**
 * The buyer's side of a per-token call in the planner (#794): check the
 * provider's metered offer against the listing the buyer picked, quote the
 * estimate and the maximum, and build the lock their wallet signs.
 *
 * Nothing here signs or sends. A refusal means nothing was asked of the wallet.
 */

import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { baseUnitsToDecimal, decimalToBaseUnits } from "@reddi/x402-solana/payment";
import type { SolanaPaymentNetwork } from "@reddi/x402-solana/types";
import { buildMeteredLock } from "@/lib/payments/metered-lock";
import { perTokenPriceFor, quoteMeteredBuy, type ListedTokenPrices, type MeteredBuyQuote } from "@/lib/payments/metered-quote";
import { buyerMintFor } from "@/lib/payments/wallet-direct-payment";

const DECIMALS = 6;

export interface MeteredBuyInput {
  /** The provider's offer from its 402 body. Untrusted. */
  offer: unknown;
  /** The listing the buyer picked. */
  listing: { walletAddress: string; prices: ListedTokenPrices };
  network: SolanaPaymentNetwork;
  /** The escrow program this app is built for. */
  programId: PublicKey;
  payer: PublicKey;
  prompt: string;
  /** The buyer's budget for one call, in US dollars, when they set one. */
  maxSpendUsd?: number;
  mints?: Partial<Record<string, string | undefined>>;
  /** 16 random bytes. */
  nonce: Uint8Array;
}

export type MeteredBuyPlan =
  | {
      ok: true;
      quote: Extract<MeteredBuyQuote, { ok: true }>;
      instruction: TransactionInstruction;
      escrow: string;
      /** The receipt to present once the lock is confirmed. */
      receiptFor: (lockSignature: string) => Record<string, unknown>;
    }
  | { ok: false; reason: string; message: string };

const refuse = (reason: string, message: string): MeteredBuyPlan => ({ ok: false, reason, message });

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** True when the offered rate is no higher than the listed one. */
function withinListed(offered: unknown, listed: string): boolean {
  const o = decimalToBaseUnits(str(offered), DECIMALS);
  const l = decimalToBaseUnits(listed, DECIMALS);
  return o !== undefined && l !== undefined && o <= l;
}

export function planMeteredBuy(input: MeteredBuyInput): MeteredBuyPlan {
  if (!input.offer || typeof input.offer !== "object" || Array.isArray(input.offer)) return refuse("no_offer", "The provider made no per-token offer.");
  const offer = input.offer as Record<string, unknown>;
  if (offer.settlement !== "metered-escrow") return refuse("no_offer", "The provider made no per-token offer.");
  if (offer.payTo !== input.listing.walletAddress) return refuse("wrong_provider", "The offer pays a different wallet from the provider you selected.");
  if (offer.escrowProgramId !== input.programId.toBase58()) return refuse("wrong_program", "The offer names an escrow program this app does not use.");

  const currency = str(offer.currency);
  const mint = buyerMintFor(currency, input.network, input.mints);
  if (!mint || offer.mint !== mint) return refuse("wrong_mint", `The offer's ${currency || "currency"} mint is not the one this app accepts.`);

  const listed = perTokenPriceFor(input.listing.prices, currency);
  if (!listed) return refuse("not_per_token", `This listing has no per-token price in ${currency}.`);
  if (!withinListed(offer.inputPerMillion, listed.inputPerMillion) || !withinListed(offer.outputPerMillion, listed.outputPerMillion)) {
    return refuse("price_above_listing", "The provider asked for a higher per-token price than its listing shows.");
  }

  const maxOutputTokens = typeof offer.maxOutputTokens === "number" ? offer.maxOutputTokens : undefined;
  const quote = quoteMeteredBuy({
    prices: input.listing.prices,
    currency,
    prompt: input.prompt,
    maxOutputTokens,
    maxCharge: input.maxSpendUsd !== undefined ? input.maxSpendUsd.toFixed(DECIMALS) : undefined,
  });
  if (!quote.ok) return refuse(quote.reason, quote.message);

  // The provider settles only a lock that covers its full output limit.
  let minimum: bigint;
  try {
    minimum = BigInt(str(offer.minimumLockBaseUnits));
  } catch {
    return refuse("no_offer", "The offer does not state its minimum lock.");
  }
  let max = quote.maxChargeBaseUnits;
  if (max < minimum) {
    if (input.maxSpendUsd !== undefined) {
      return refuse("budget_below_minimum", `This call can cost up to ${baseUnitsToDecimal(minimum, DECIMALS)} ${currency}, above your budget.`);
    }
    max = minimum;
  }
  const locked = { ...quote, maxChargeBaseUnits: max, maxCharge: baseUnitsToDecimal(max, DECIMALS) };

  const lock = buildMeteredLock({
    quote: locked,
    programId: input.programId,
    payer: input.payer,
    payee: new PublicKey(input.listing.walletAddress),
    mint: new PublicKey(mint),
    nonce: input.nonce,
  });
  if (!lock.ok) return refuse(lock.reason, lock.message);
  const nonce = Buffer.from(input.nonce).toString("hex");
  const escrow = lock.escrow.toBase58();
  return {
    ok: true,
    quote: locked,
    instruction: lock.instruction,
    escrow,
    receiptFor: (lockSignature: string) => ({
      settlement: "metered-escrow",
      network: input.network,
      currency,
      payTo: input.listing.walletAddress,
      payer: input.payer.toBase58(),
      nonce,
      escrow,
      lockSignature,
    }),
  };
}
