import "server-only";

/**
 * The app server's own check of a per-token call paid through a metered
 * token escrow (#794), before it writes a job record.
 *
 * The buyer locked a maximum; after the response the provider settled the
 * actual cost. The job row states what this server saw on chain in the settle
 * transaction: it succeeded, it settled the escrow the buyer's payer and nonce
 * name, the selected listing's token account received its share, and the
 * protocol treasury received 2.5% of the amount charged. The token counts
 * behind that amount are the provider's report and are not checked here.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PROTOCOL_FEE_BPS, directPaymentCurrency, protocolFeeBaseUnits, protocolFeeCapBaseUnits, type ParsedTransactionConnection } from "@reddi/x402-solana/payment";
import { ESCROW_PROTOCOL_TREASURY, tokenEscrowAddresses, treasuryTokenAccount } from "@reddi/x402-solana/token-escrow";
import type { NetworkProfileName } from "@/lib/config/network-profile-name";
import { buyerMintFor, paymentNetworkForProfile } from "@/lib/payments/wallet-direct-payment";
import { listingNetworkForProfile, type Listing } from "@/lib/listings/listing-store";
import { recordVerifiedJob, type JobStoreDeps } from "@/lib/jobs/job-store";
import type { VerifiedPayment } from "@/lib/jobs/paid-call";

const NONCE_HEX = /^[0-9a-f]{32}$/;
/** Accounts of settle_token_escrow / release_token_escrow, in order. */
const SETTLE_ACCOUNT_COUNT = 9;

export interface MeteredCallInput {
  /** The metered receipt the buyer's browser presented: settlement, currency, payTo, payer, nonce, escrow. */
  receipt: unknown;
  /** The settle transaction the provider named in its answer. Only read; checked on chain. */
  settleSignature: unknown;
  listing: Listing;
  profile: NetworkProfileName;
  requestHash: string;
  responseHash?: string;
  declaredModel: string;
  delivered: boolean;
  session?: { userId: string; wallet: string };
}

export interface MeteredCallDeps extends JobStoreDeps {
  connection?: ParsedTransactionConnection;
  rpcUrl?: string;
  mints?: Partial<Record<string, string | undefined>>;
  /** The escrow program this app is configured for. */
  programId: PublicKey;
}

export interface VerifiedMeteredPayment extends VerifiedPayment {
  maxAmountBaseUnits: string;
  refundedBaseUnits: string;
}

type Refusal = { recorded: false; reason: string };
export type MeteredCallOutcome = { recorded: true; jobId: string; paid: VerifiedMeteredPayment } | Refusal;
const refuse = (reason: string): Refusal => ({ recorded: false, reason });

function key(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as { pubkey?: unknown; toBase58?: () => string };
    if (record.pubkey !== undefined) return key(record.pubkey);
    if (typeof record.toBase58 === "function") return record.toBase58();
  }
  return "";
}

function parsePublicKey(value: unknown): PublicKey | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  try {
    return new PublicKey(value);
  } catch {
    return undefined;
  }
}

type TokenBalance = { accountIndex?: unknown; mint?: unknown; uiTokenAmount?: { amount?: unknown } };

function balanceOf(balances: unknown, accountKeys: string[], account: string, mint: string): bigint {
  if (!Array.isArray(balances)) return BigInt(0);
  for (const entry of balances as TokenBalance[]) {
    if (typeof entry?.accountIndex !== "number" || accountKeys[entry.accountIndex] !== account || entry.mint !== mint) continue;
    const amount = entry.uiTokenAmount?.amount;
    if (typeof amount === "string" && /^\d+$/.test(amount)) return BigInt(amount);
  }
  return BigInt(0);
}

export async function verifyAndRecordMeteredCall(input: MeteredCallInput, deps: MeteredCallDeps): Promise<MeteredCallOutcome> {
  const network = paymentNetworkForProfile(input.profile);
  const listingNetwork = listingNetworkForProfile(input.profile);
  if (!network || !listingNetwork || input.listing.network !== listingNetwork) return refuse("network_not_supported");
  if (!input.receipt || typeof input.receipt !== "object" || Array.isArray(input.receipt)) return refuse("invalid_receipt");
  const receipt = input.receipt as Record<string, unknown>;
  if (receipt.settlement !== "metered-escrow") return refuse("invalid_receipt");

  const currency = typeof receipt.currency === "string" ? receipt.currency : "";
  const terms = directPaymentCurrency(currency);
  if (!terms || !terms.tokenProgram) return refuse("wrong_currency");
  const expectedMint = buyerMintFor(currency, network, deps.mints);
  if (!expectedMint || expectedMint !== input.listing.priceMint) return refuse("currency_not_listed");
  if (receipt.payTo !== input.listing.wallet) return refuse("wrong_provider");

  const payer = parsePublicKey(receipt.payer);
  const nonce = typeof receipt.nonce === "string" ? receipt.nonce.replace(/-/g, "").toLowerCase() : "";
  if (!payer || !NONCE_HEX.test(nonce)) return refuse("invalid_receipt");
  const { escrow, vault } = tokenEscrowAddresses({ programId: deps.programId, payer, nonce: Uint8Array.from(Buffer.from(nonce, "hex")) });
  if (receipt.escrow !== escrow.toBase58()) return refuse("escrow_mismatch");
  const settleSignature = typeof input.settleSignature === "string" ? input.settleSignature : "";
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(settleSignature)) return refuse("settle_signature_missing");

  const mint = new PublicKey(expectedMint);
  const tokenProgram = new PublicKey(terms.tokenProgram);
  const recipient = getAssociatedTokenAddressSync(mint, new PublicKey(input.listing.wallet), true, tokenProgram).toBase58();
  const treasuryToken = treasuryTokenAccount({ mint, tokenProgram }).toBase58();

  const connection = deps.connection ?? (deps.rpcUrl ? (new Connection(deps.rpcUrl, "confirmed") as unknown as ParsedTransactionConnection) : undefined);
  if (!connection) return refuse("rpc_not_configured");
  let tx: unknown;
  try {
    tx = await connection.getParsedTransaction(settleSignature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  } catch {
    return refuse("chain_check_failed");
  }
  const parsed = tx as {
    meta?: { err?: unknown; preTokenBalances?: unknown; postTokenBalances?: unknown } | null;
    transaction?: { message?: { accountKeys?: unknown[]; instructions?: unknown[] } };
  } | null;
  if (!parsed?.meta || !parsed.transaction?.message) return refuse("settle_not_found");
  if (parsed.meta.err !== null && parsed.meta.err !== undefined) return refuse("settle_failed_on_chain");
  const accountKeys = (parsed.transaction.message.accountKeys ?? []).map(key);
  const programId = deps.programId.toBase58();

  // The settle (or a full release) of this escrow, paying this listing's token account and the treasury.
  const settles = (parsed.transaction.message.instructions ?? []).filter((ix) => {
    const instruction = ix as { programId?: unknown; accounts?: unknown[] };
    if (key(instruction.programId) !== programId || !Array.isArray(instruction.accounts)) return false;
    const accounts = instruction.accounts.map(key);
    return (
      accounts.length === SETTLE_ACCOUNT_COUNT &&
      accounts[0] === escrow.toBase58() &&
      accounts[1] === vault.toBase58() &&
      accounts[3] === payer.toBase58() &&
      accounts[4] === expectedMint &&
      accounts[5] === recipient &&
      accounts[6] === treasuryToken &&
      accounts[8] === tokenProgram.toBase58()
    );
  });
  if (settles.length !== 1) return refuse("settle_not_for_this_escrow");

  const delta = (account: string) =>
    balanceOf(parsed.meta!.postTokenBalances, accountKeys, account, expectedMint) - balanceOf(parsed.meta!.preTokenBalances, accountKeys, account, expectedMint);
  const providerShare = delta(recipient);
  const fee = delta(treasuryToken);
  const charged = providerShare + fee;
  const maxAmount = balanceOf(parsed.meta.preTokenBalances, accountKeys, vault.toBase58(), expectedMint);
  if (providerShare <= BigInt(0) || fee < BigInt(0)) return refuse("settle_paid_nothing");
  if (charged > maxAmount) return refuse("settle_above_maximum");
  if (fee !== protocolFeeBaseUnits(charged, PROTOCOL_FEE_BPS, protocolFeeCapBaseUnits(currency))) return refuse("fee_mismatch");

  const written = await recordVerifiedJob(
    {
      buyerWallet: payer.toBase58(),
      buyerUserId: input.session && input.session.wallet === payer.toBase58() ? input.session.userId : undefined,
      providerWallet: input.listing.wallet,
      network: listingNetwork,
      declaredModel: input.declaredModel,
      requestHash: input.requestHash,
      responseHash: input.responseHash,
      amountBaseUnits: charged.toString(),
      mint: expectedMint,
      txSignature: settleSignature,
      status: input.delivered ? "delivered" : "failed",
    },
    deps,
  );
  if (!written.ok) return refuse(written.code);
  return {
    recorded: true,
    jobId: written.id,
    paid: {
      currency,
      mint: expectedMint,
      amountBaseUnits: charged.toString(),
      payer: payer.toBase58(),
      fee: fee > BigInt(0) ? { amount: fee.toString(), treasury: ESCROW_PROTOCOL_TREASURY.toBase58() } : { amount: "0" },
      maxAmountBaseUnits: maxAmount.toString(),
      refundedBaseUnits: (maxAmount - charged).toString(),
    },
  };
}
