import "server-only";

/**
 * The app server's own check that a wallet-paid call was paid, before it
 * writes a job record (#740).
 *
 * The provider verifies the payment to decide whether to answer. That is the
 * provider's word. A job row is this server's statement, so it looks at the
 * chain itself: the transaction must pay the selected listing's wallet the
 * listed price in the listed currency. Nothing is recorded when that cannot be
 * shown, or when anything needed for the check is not configured.
 */

import { Connection } from "@solana/web3.js";
import { SolanaReceiptVerifier, baseUnitsToDecimal, decimalToBaseUnits, directPaymentCurrency, type ParsedTransactionConnection } from "@redditech/x402-solana/payment";
import type { X402Challenge } from "@redditech/x402-solana/types";
import type { NetworkProfileName } from "@/lib/config/network-profile-name";
import { buyerMintFor, paymentNetworkForProfile } from "@/lib/payments/wallet-direct-payment";
import { listingNetworkForProfile, type Listing } from "@/lib/listings/listing-store";
import { recordVerifiedJob, type JobStoreDeps } from "@/lib/jobs/job-store";

/** What this server verified on chain for the call, in smallest units. */
export interface VerifiedPayment {
  currency: string;
  /** Token mint, or undefined for SOL. */
  mint?: string;
  amountBaseUnits: string;
  payer: string;
  fee: { amount: string; treasury?: string };
}

export type PaidCallOutcome =
  | { recorded: true; jobId: string; paid: VerifiedPayment }
  | { recorded: false; reason: string };

export interface PaidCallInput {
  /** The receipt the buyer's browser presented. Only read; every claim in it is checked. */
  receipt: unknown;
  /** The selected provider's listing, read from the database by the server. */
  listing: Listing;
  profile: NetworkProfileName;
  requestHash: string;
  responseHash?: string;
  declaredModel: string;
  delivered: boolean;
  /** The signed-in buyer, when there is one. Linked to the job only if their wallet is the one that paid. */
  session?: { userId: string; wallet: string };
}

export interface PaidCallDeps extends JobStoreDeps {
  connection?: ParsedTransactionConnection;
  rpcUrl?: string;
  /** Operator-configured mints per currency, as the buyer page uses. */
  mints?: Partial<Record<string, string | undefined>>;
  /** Treasury owner for the protocol fee, or undefined when none is configured. */
  feeTreasury?: string;
  now?: () => number;
}

/** The app keeps no replay ledger of its own: the jobs table refuses a second row for the same transaction. */
const JOBS_TABLE_IS_THE_REPLAY_GUARD = { checkAndStore: () => true };

export async function verifyAndRecordPaidCall(input: PaidCallInput, deps: PaidCallDeps = {}): Promise<PaidCallOutcome> {
  const network = paymentNetworkForProfile(input.profile);
  const listingNetwork = listingNetworkForProfile(input.profile);
  if (!network || !listingNetwork || input.listing.network !== listingNetwork) return { recorded: false, reason: "network_not_supported" };
  if (!input.receipt || typeof input.receipt !== "object" || Array.isArray(input.receipt)) return { recorded: false, reason: "invalid_receipt" };
  const receipt = input.receipt as Record<string, unknown>;

  const currency = typeof receipt.currency === "string" ? receipt.currency : "";
  const terms = directPaymentCurrency(currency);
  if (!terms) return { recorded: false, reason: "wrong_currency" };
  // The listing names a mint (or SOL). The receipt's currency must be that mint on this network, by our own table.
  const expectedMint = currency === "SOL" ? "SOL" : buyerMintFor(currency, network, deps.mints);
  if (!expectedMint || expectedMint !== input.listing.priceMint) return { recorded: false, reason: "currency_not_listed" };

  let price: bigint;
  try {
    price = BigInt(input.listing.pricePerCallBaseUnits);
  } catch {
    return { recorded: false, reason: "listing_price_missing" };
  }
  if (price <= BigInt(0)) return { recorded: false, reason: "listing_price_missing" };

  const nonce = typeof receipt.nonce === "string" ? receipt.nonce : "";
  const signature = typeof receipt.signature === "string" ? receipt.signature : typeof receipt.txSignature === "string" ? receipt.txSignature : "";
  const payer = typeof receipt.payer === "string" ? receipt.payer : "";
  if (!nonce || !signature || !payer) return { recorded: false, reason: "invalid_receipt" };

  // What must have been paid, from the listing and nothing else.
  const challenge: X402Challenge = {
    version: "1",
    network,
    payTo: input.listing.wallet,
    amount: baseUnitsToDecimal(price, terms.decimals),
    currency,
    endpoint: input.listing.endpointUrl,
    nonce,
  };

  const rpcUrl = deps.rpcUrl;
  const connection = deps.connection ?? (rpcUrl ? (new Connection(rpcUrl, "confirmed") as unknown as ParsedTransactionConnection) : undefined);
  if (!connection) return { recorded: false, reason: "rpc_not_configured" };

  const verifier = new SolanaReceiptVerifier({
    allowRealPayment: true,
    // This records a job after the call and serves nothing, so it needs no proof
    // that the caller paid: the provider checked that before answering.
    payerProof: "not-required",
    connection,
    mints: currency === "SOL" ? undefined : { [currency]: expectedMint },
    // With no treasury configured a mainnet verifier refuses every receipt, which is the safe default.
    protocolFee: deps.feeTreasury ? { treasury: deps.feeTreasury } : undefined,
    now: deps.now,
  });
  let verified;
  try {
    verified = await verifier.verifyReceipt(receipt, challenge, JOBS_TABLE_IS_THE_REPLAY_GUARD);
  } catch {
    return { recorded: false, reason: "chain_check_failed" };
  }
  if (!verified.ok) return { recorded: false, reason: `not_verified:${verified.reason}` };

  const written = await recordVerifiedJob(
    {
      buyerWallet: payer,
      buyerUserId: input.session && input.session.wallet === payer ? input.session.userId : undefined,
      providerWallet: input.listing.wallet,
      network: listingNetwork,
      declaredModel: input.declaredModel,
      requestHash: input.requestHash,
      responseHash: input.responseHash,
      amountBaseUnits: price.toString(),
      mint: input.listing.priceMint,
      txSignature: signature,
      status: input.delivered ? "delivered" : "failed",
    },
    deps,
  );
  if (!written.ok) return { recorded: false, reason: written.code };
  const feeUnits = verified.fee ? decimalToBaseUnits(verified.fee.amount, terms.decimals) ?? BigInt(0) : BigInt(0);
  const paid: VerifiedPayment = {
    currency,
    ...(currency === "SOL" ? {} : { mint: expectedMint }),
    amountBaseUnits: price.toString(),
    payer,
    fee: verified.fee && feeUnits > BigInt(0) ? { amount: feeUnits.toString(), treasury: verified.fee.payTo } : { amount: "0" },
  };
  return { recorded: true, jobId: written.id, paid };
}
