import "server-only";

/**
 * The app server's own check of a per-token call paid through a metered
 * token escrow (#794), before it writes a job record.
 *
 * The buyer locked a maximum; after the response the provider settled the
 * actual cost. The job row states what this server saw on chain in the settle
 * transaction: it succeeded, it settled the escrow the buyer's payer and nonce
 * name, the exit names the lock transaction's escrow by its slot (escrows at one
 * address over time are told apart that way), the selected listing's token
 * account received its share, the payer's refund account received the rest, and
 * the protocol treasury received the fee in force at the settle's block time (2.5%
 * launch rate before 2027-04-01 00:00 UTC, then 5%) of the amount charged. The token counts
 * behind that amount are the provider's report and are not checked here.
 */

import { createHash } from "crypto";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { protocolFeeBpsNear, directPaymentCurrency, protocolFeeBaseUnits, protocolFeeCapBaseUnits, type ParsedTransactionConnection } from "@redditech/x402-solana/payment";
import { ratingPda } from "@redditech/x402-solana/rating";
import { deliveryPda } from "@redditech/x402-solana/delivery";
import { ESCROW_PROTOCOL_TREASURY, tokenEscrowAddresses, treasuryTokenAccount } from "@redditech/x402-solana/token-escrow";
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
  /** What the buyer locked, from the lock transaction. */
  maxAmountBaseUnits: string;
  /** What the payer's refund account received in the settle: the unused part of the maximum, plus any surplus in the vault. */
  refundedBaseUnits: string;
  /** Tokens that were in the vault beyond the lock (sent by someone else), when there were any. */
  surplusBaseUnits?: string;
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

type TokenBalance = { accountIndex?: unknown; mint?: unknown; owner?: unknown; uiTokenAmount?: { amount?: unknown } };

/** True when the transaction's own token balances show `account` as a `mint` account owned by `owner`. */
function tokenAccountOwnedBy(balances: unknown[], accountKeys: string[], account: string, mint: string, owner: string): boolean {
  return balances.some((list) =>
    Array.isArray(list) &&
    (list as TokenBalance[]).some(
      (entry) => typeof entry?.accountIndex === "number" && accountKeys[entry.accountIndex] === account && entry.mint === mint && entry.owner === owner,
    ),
  );
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function decodeBase58(value: string): Uint8Array | undefined {
  let n = BigInt(0);
  for (const char of value) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) return undefined;
    n = n * BigInt(58) + BigInt(digit);
  }
  const bytes: number[] = [];
  while (n > BigInt(0)) {
    bytes.unshift(Number(n & BigInt(255)));
    n >>= BigInt(8);
  }
  for (const char of value) {
    if (char !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

/** lock_metered_token_escrow: discriminator (sha256("global:lock_metered_token_escrow")[0..8]), amount (u64 LE), nonce (16 bytes), windows. */
const LOCK_METERED_DISCRIMINATOR = createHash("sha256").update("global:lock_metered_token_escrow").digest().subarray(0, 8);
/** settle_token_escrow: discriminator, actual (u64 LE), then the escrow's created_slot (u64 LE). */
const SETTLE_DISCRIMINATOR = createHash("sha256").update("global:settle_token_escrow").digest().subarray(0, 8);
/** resolve_token_delivery: a judge's split of a disputed delivery-checked escrow. Not recorded (see below). */
const RESOLVE_DISCRIMINATOR = createHash("sha256").update("global:resolve_token_delivery").digest().subarray(0, 8);
/** release_token_escrow: discriminator, then the escrow's created_slot (u64 LE). */
const RELEASE_DISCRIMINATOR = createHash("sha256").update("global:release_token_escrow").digest().subarray(0, 8);

/**
 * The escrow instance a settle or release names: the created_slot every exit carries after its data
 * (program README, "Every exit names its escrow"). Undefined for any other instruction or layout.
 */
function exitCreatedSlot(data: unknown): bigint | undefined {
  if (typeof data !== "string") return undefined;
  const decoded = decodeBase58(data);
  if (!decoded) return undefined;
  const bytes = Buffer.from(decoded);
  const selector = bytes.subarray(0, 8);
  if (selector.equals(SETTLE_DISCRIMINATOR) && bytes.length === 24) return bytes.readBigUInt64LE(16);
  if (selector.equals(RELEASE_DISCRIMINATOR) && bytes.length === 16) return bytes.readBigUInt64LE(8);
  return undefined;
}

/**
 * The maximum the buyer locked, read from the lock transaction the receipt names
 * (audit S7-Codex-05, condition C20), and the slot that lock landed in, which is
 * the escrow's created_slot. The vault balance at settle time is not the
 * maximum: anyone can send tokens to the vault, which would raise it.
 */
async function lockedMaximum(
  connection: ParsedTransactionConnection,
  lockSignature: string,
  expected: { programId: string; escrow: string; vault: string; payer: string; mint: string; nonce: string },
): Promise<{ amount: bigint; slot: bigint } | undefined> {
  let tx: unknown;
  try {
    tx = await connection.getParsedTransaction(lockSignature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  } catch {
    return undefined;
  }
  const parsed = tx as { slot?: unknown; meta?: { err?: unknown } | null; transaction?: { message?: { instructions?: unknown[] } } } | null;
  if (!parsed?.meta || (parsed.meta.err !== null && parsed.meta.err !== undefined)) return undefined;
  if (typeof parsed.slot !== "number" || !Number.isSafeInteger(parsed.slot) || parsed.slot < 0) return undefined;
  const amounts: bigint[] = [];
  for (const ix of parsed.transaction?.message?.instructions ?? []) {
    const instruction = ix as { programId?: unknown; accounts?: unknown[]; data?: unknown };
    if (key(instruction.programId) !== expected.programId || !Array.isArray(instruction.accounts) || typeof instruction.data !== "string") continue;
    const accounts = instruction.accounts.map(key);
    if (accounts[0] !== expected.escrow || accounts[1] !== expected.vault || accounts[2] !== expected.payer || accounts[4] !== expected.mint) continue;
    const data = decodeBase58(instruction.data);
    if (!data || data.length < 32) continue;
    const bytes = Buffer.from(data);
    if (!bytes.subarray(0, 8).equals(LOCK_METERED_DISCRIMINATOR)) continue;
    if (bytes.subarray(16, 32).toString("hex") !== expected.nonce) continue;
    amounts.push(bytes.readBigUInt64LE(8));
  }
  return amounts.length === 1 ? { amount: amounts[0], slot: BigInt(parsed.slot) } : undefined;
}

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
  // A failed call is recorded only for the payer's own signed-in session (audit S5-claude-02, C5).
  if (!input.delivered && !(input.session && input.session.wallet === payer.toBase58())) return refuse("payer_not_proven");
  const { escrow, vault } = tokenEscrowAddresses({ programId: deps.programId, payer, nonce: Uint8Array.from(Buffer.from(nonce, "hex")) });
  if (receipt.escrow !== escrow.toBase58()) return refuse("escrow_mismatch");
  const settleSignature = typeof input.settleSignature === "string" ? input.settleSignature : "";
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(settleSignature)) return refuse("settle_signature_missing");

  const lockSignature = typeof receipt.lockSignature === "string" ? receipt.lockSignature : "";
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(lockSignature)) return refuse("lock_signature_missing");

  const mint = new PublicKey(expectedMint);
  const tokenProgram = new PublicKey(terms.tokenProgram);
  const associatedRecipient = getAssociatedTokenAddressSync(mint, new PublicKey(input.listing.wallet), true, tokenProgram).toBase58();
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
    blockTime?: number | null;
  } | null;
  if (!parsed?.meta || !parsed.transaction?.message) return refuse("settle_not_found");
  if (parsed.meta.err !== null && parsed.meta.err !== undefined) return refuse("settle_failed_on_chain");
  const accountKeys = (parsed.transaction.message.accountKeys ?? []).map(key);
  const programId = deps.programId.toBase58();
  const balances = [parsed.meta.preTokenBalances, parsed.meta.postTokenBalances];
  // The provider's payout account: its associated account, or a recovery account it owns for this
  // mint (the provider kit settles there when the associated account cannot receive). Ownership is
  // read from the settle transaction's own token balances (audit S7-Codex-05, condition C20).
  const isProviderPayout = (account: string) =>
    account === associatedRecipient || tokenAccountOwnedBy(balances, accountKeys, account, expectedMint, input.listing.wallet);

  // A delivery-checked escrow (bit 0x04) is not a per-token call: its exits carry the delivery
  // account and it can end in a judge's split. This recorder does not take those yet, so it says
  // so rather than recording, or refusing as another escrow's settle (audit D11).
  const delivery = deliveryPda(escrow, deps.programId).toBase58();
  const deliveryChecked = (parsed.transaction.message.instructions ?? []).some((ix) => {
    const instruction = ix as { programId?: unknown; accounts?: unknown[]; data?: unknown };
    if (key(instruction.programId) !== programId) return false;
    if (Array.isArray(instruction.accounts) && instruction.accounts.map(key).includes(delivery)) return true;
    const data = typeof instruction.data === "string" ? decodeBase58(instruction.data) : undefined;
    return data !== undefined && Buffer.from(data).subarray(0, 8).equals(RESOLVE_DISCRIMINATOR);
  });
  if (deliveryChecked) return refuse("delivery_check_not_supported");

  // The settle (or a full release) of this escrow, paying this listing's token account and the treasury.
  const settles = (parsed.transaction.message.instructions ?? []).filter((ix) => {
    const instruction = ix as { programId?: unknown; accounts?: unknown[]; data?: unknown };
    if (key(instruction.programId) !== programId || !Array.isArray(instruction.accounts)) return false;
    if (exitCreatedSlot(instruction.data) === undefined) return false;
    const accounts = instruction.accounts.map(key);
    return (
      // A job the buyer opted in to rating: its settle carries the escrow's rating account after the usual nine.
      (accounts.length === SETTLE_ACCOUNT_COUNT || (accounts.length === SETTLE_ACCOUNT_COUNT + 1 && accounts[SETTLE_ACCOUNT_COUNT] === ratingPda(escrow, deps.programId).toBase58())) &&
      accounts[0] === escrow.toBase58() &&
      accounts[1] === vault.toBase58() &&
      accounts[3] === payer.toBase58() &&
      accounts[4] === expectedMint &&
      isProviderPayout(accounts[5]) &&
      accounts[6] === treasuryToken &&
      accounts[8] === tokenProgram.toBase58()
    );
  });
  if (settles.length !== 1) return refuse("settle_not_for_this_escrow");
  const exit = settles[0] as { accounts: unknown[]; data: unknown };
  const recipient = key(exit.accounts[5]);
  const refundAccount = key(exit.accounts[7]);
  const exitSlot = exitCreatedSlot(exit.data)!;

  const delta = (account: string) =>
    balanceOf(parsed.meta!.postTokenBalances, accountKeys, account, expectedMint) - balanceOf(parsed.meta!.preTokenBalances, accountKeys, account, expectedMint);
  const providerShare = delta(recipient);
  const fee = delta(treasuryToken);
  const charged = providerShare + fee;
  const lock = await lockedMaximum(connection, lockSignature, {
    programId,
    escrow: escrow.toBase58(),
    vault: vault.toBase58(),
    payer: payer.toBase58(),
    mint: expectedMint,
    nonce,
  });
  if (lock === undefined) return refuse("lock_not_verified");
  // Escrows at one address over time share every account of the exit; only the slot it names tells
  // them apart (audit S7-Codex-R2-03). A lock and a settle of different escrows are not one job.
  if (exitSlot !== lock.slot) return refuse("settle_not_for_this_lock");
  const maxAmount = lock.amount;
  // Tokens in the vault beyond the lock (a donation) are reported apart; they never raise the maximum.
  const vaultBefore = balanceOf(parsed.meta.preTokenBalances, accountKeys, vault.toBase58(), expectedMint);
  const surplus = vaultBefore > maxAmount ? vaultBefore - maxAmount : BigInt(0);
  if (providerShare <= BigInt(0) || fee < BigInt(0)) return refuse("settle_paid_nothing");
  if (charged > maxAmount) return refuse("settle_above_maximum");
  // What came back is read from the settle too, not worked out from the maximum: the payer's refund
  // account's credit, which is never more than what the vault held beyond the charge.
  const refunded = refundAccount === recipient || refundAccount === treasuryToken ? BigInt(0) : delta(refundAccount);
  if (refunded < BigInt(0) || refunded > vaultBefore - charged) return refuse("refund_mismatch");
  // The program reads the fee rate from the cluster clock at settle: 2.5% until 1 April 2027, then 5%. Check against the
  // settle's block time, allowing either rate right at the switch (or when the block time is missing).
  const blockTimeMs = typeof parsed.blockTime === "number" ? parsed.blockTime * 1000 : undefined;
  const cap = protocolFeeCapBaseUnits(currency);
  if (!protocolFeeBpsNear(blockTimeMs).some((bps) => fee === protocolFeeBaseUnits(charged, bps, cap))) return refuse("fee_mismatch");

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
      refundedBaseUnits: refunded.toString(),
      ...(surplus > BigInt(0) ? { surplusBaseUnits: surplus.toString() } : {}),
    },
  };
}
