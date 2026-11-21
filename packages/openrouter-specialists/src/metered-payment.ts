/**
 * Per-token (metered) payment for a specialist call (#794).
 *
 * The buyer locks its approved maximum in a metered token escrow
 * (`lock_metered_token_escrow`) payable to this provider. The runtime reads
 * the lock back from the chain, runs the call, counts the tokens the model
 * reports, and settles the actual cost with `settle_token_escrow`. The
 * program pays 2.5% of it to the protocol treasury, the rest to the provider,
 * and returns the unused maximum to the buyer.
 *
 * The settle is signed by the operator, through `RuntimeDeps.settleMeteredEscrow`.
 * This runtime builds the instruction and never reads a key. Metered payment
 * is offered only when the operator configures a per-token price, the escrow
 * program and that signer.
 */
import {
  baseUnitsToDecimal,
  buildSettleTokenEscrowInstruction,
  decodeTokenEscrowAccount,
  directPaymentCurrency,
  parseX402PaymentHeader,
  prepareTokenPayout,
  settleMeteredCall,
  tokenCostBaseUnits,
  tokenEscrowAddresses,
  treasuryTokenAccount,
  type MeteredSettlement,
  type NonceReplayStore,
  type PerTokenPrice,
  type TokenEscrowTerms,
} from "@reddi/x402-solana";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import type { ChatMessage, RuntimeConfig, SpecialistProfile } from "./types.js";

/** Output tokens assumed when the request sets no limit and the operator sets none. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 1_000;

export interface MeteredPriceConfig {
  /** Price per million input and output tokens, in the profile's currency. */
  inputPerMillion: string;
  outputPerMillion: string;
  /** The most output tokens one call may use. */
  maxOutputTokens?: number;
}

/** What a reader of chain accounts returns. A `Connection` adapts to it. */
export type AccountReader = (address: PublicKey) => Promise<{ owner: PublicKey; data: Uint8Array } | null>;

/**
 * Signs the settle transaction with the provider wallet's key, sends it and
 * waits for confirmation. Returns the signature. The instructions go into one
 * transaction, in order, with the provider wallet as fee payer: idempotent
 * creates of the treasury's and the buyer's token accounts, then the settle.
 */
export type MeteredSettleSigner = (instructions: TransactionInstruction[]) => Promise<string>;

export interface MeteredTerms {
  price: PerTokenPrice;
  programId: PublicKey;
  mint: PublicKey;
  tokenProgram: PublicKey;
  payee: PublicKey;
  maxOutputTokens: number;
}

/** The provider's metered terms, or undefined when the operator has not configured them. */
export function meteredTerms(profile: SpecialistProfile, config: RuntimeConfig): MeteredTerms | undefined {
  const priced = config.meteredPrice;
  if (!priced || !config.escrowProgramId) return undefined;
  const currency = directPaymentCurrency(profile.price.currency);
  if (!currency?.tokenProgram) return undefined; // SOL settles through the SOL escrow, which this runtime does not offer.
  const mint = config.paymentMints?.[profile.price.currency] ?? (profile.price.currency === "USDC" ? config.usdcDevnetMint : undefined);
  if (!mint) return undefined;
  const price: PerTokenPrice = { currency: profile.price.currency, inputPerMillion: priced.inputPerMillion, outputPerMillion: priced.outputPerMillion };
  try {
    tokenCostBaseUnits(price, { inputTokens: 1, outputTokens: 1 });
    return {
      price,
      programId: new PublicKey(config.escrowProgramId),
      mint: new PublicKey(mint),
      tokenProgram: new PublicKey(currency.tokenProgram),
      payee: new PublicKey(profile.walletAddress),
      maxOutputTokens: priced.maxOutputTokens && priced.maxOutputTokens > 0 ? priced.maxOutputTokens : DEFAULT_MAX_OUTPUT_TOKENS,
    };
  } catch {
    return undefined;
  }
}

/** About four characters a token, over every message. */
export function estimateInputTokens(messages: readonly ChatMessage[]): number {
  return messages.reduce((total, message) => total + Math.ceil(message.content.length / 4), 0);
}

/** Output limit for this call: the request's own, held to the provider's. */
export function outputLimit(terms: MeteredTerms, requested?: number): number {
  return requested !== undefined && Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, terms.maxOutputTokens) : terms.maxOutputTokens;
}

/** What the challenge tells a buyer about metered payment. The buyer's lock must cover `estimatedMax`. */
export function meteredOffer(terms: MeteredTerms, messages: readonly ChatMessage[], requestedMaxTokens?: number): Record<string, unknown> {
  const estimate = { inputTokens: estimateInputTokens(messages), outputTokens: outputLimit(terms, requestedMaxTokens) };
  return {
    settlement: "metered-escrow",
    currency: terms.price.currency,
    inputPerMillion: terms.price.inputPerMillion,
    outputPerMillion: terms.price.outputPerMillion,
    maxOutputTokens: terms.maxOutputTokens,
    estimate,
    /** The least a lock may hold, in base units: the input estimate plus the full output limit. */
    minimumLockBaseUnits: tokenCostBaseUnits(terms.price, estimate).toString(),
    escrowProgramId: terms.programId.toBase58(),
    mint: terms.mint.toBase58(),
    payTo: terms.payee.toBase58(),
    nonce: "32 lowercase hex characters you choose; the escrow is [token-escrow, payer, nonce]",
  };
}

export interface MeteredPaymentHeader {
  escrow: PublicKey;
  payer: PublicKey;
  nonce: Uint8Array;
}

const NONCE_HEX = /^[0-9a-f]{32}$/;

/** The metered receipt a buyer presents, or undefined when the header is not one. */
export function readMeteredPaymentHeader(headers: Headers): MeteredPaymentHeader | { error: string } | undefined {
  const value = headers.get("x402-payment") ?? headers.get("x-payment");
  if (!value) return undefined;
  const parsed = parseX402PaymentHeader(value);
  if (!parsed || typeof parsed !== "object" || (parsed as { settlement?: unknown }).settlement !== "metered-escrow") return undefined;
  const record = parsed as Record<string, unknown>;
  const nonce = typeof record.nonce === "string" ? record.nonce.replace(/-/g, "").toLowerCase() : "";
  if (!NONCE_HEX.test(nonce)) return { error: "A metered payment names the 16-byte escrow nonce as 32 hex characters." };
  try {
    return { escrow: new PublicKey(String(record.escrow)), payer: new PublicKey(String(record.payer)), nonce: Uint8Array.from(Buffer.from(nonce, "hex")) };
  } catch {
    return { error: "A metered payment must name the payer and the escrow address." };
  }
}

export type VerifiedLock = { ok: true; terms: TokenEscrowTerms; maxBaseUnits: bigint; payer: PublicKey } | { ok: false; reason: string; message: string };

/**
 * Checks the lock on chain against this provider's terms: the escrow program,
 * the address the payer and nonce give, still locked, metered, payable to this
 * provider's token account in the accepted mint, and at least `minimum`.
 * The escrow is then remembered, so one lock pays for one call.
 */
export async function verifyMeteredLock(input: {
  header: MeteredPaymentHeader;
  terms: MeteredTerms;
  minimum: bigint;
  readAccount: AccountReader;
  replayStore: NonceReplayStore;
}): Promise<VerifiedLock> {
  const { header, terms } = input;
  const expected = tokenEscrowAddresses({ programId: terms.programId, payer: header.payer, nonce: header.nonce }).escrow;
  if (!expected.equals(header.escrow)) return { ok: false, reason: "invalid_receipt", message: "The escrow address is not the one this payer and nonce give." };
  let account: { owner: PublicKey; data: Uint8Array } | null;
  try {
    account = await input.readAccount(header.escrow);
  } catch {
    return { ok: false, reason: "payment_check_unavailable", message: "The chain could not be read. Nothing was accepted; present the same receipt again." };
  }
  if (!account) return { ok: false, reason: "invalid_receipt", message: "No escrow is locked at that address yet." };
  if (!account.owner.equals(terms.programId)) return { ok: false, reason: "invalid_receipt", message: "That account is not held by the escrow program." };
  let escrow: ReturnType<typeof decodeTokenEscrowAccount>;
  try {
    escrow = decodeTokenEscrowAccount(Buffer.from(account.data));
  } catch {
    return { ok: false, reason: "invalid_receipt", message: "That account is not a token escrow." };
  }
  if (escrow.status !== 0) return { ok: false, reason: "duplicate_nonce", message: "This escrow has already been settled or cancelled." };
  if (!escrow.metered) return { ok: false, reason: "invalid_receipt", message: "This escrow was not locked as a metered escrow." };
  if (!escrow.payer.equals(header.payer)) return { ok: false, reason: "invalid_receipt", message: "The escrow was locked by a different wallet." };
  if (!escrow.payee.equals(terms.payee)) return { ok: false, reason: "wrong_payee", message: "The escrow pays a different provider." };
  if (!escrow.mint.equals(terms.mint)) return { ok: false, reason: "wrong_currency", message: `The escrow holds a different mint than this provider's ${terms.price.currency}.` };
  // The provider's associated token account for the mint (the helper derives any owner's).
  if (!escrow.recipient.equals(treasuryTokenAccount({ mint: terms.mint, tokenProgram: terms.tokenProgram }, terms.payee))) {
    return { ok: false, reason: "wrong_payee", message: "The escrow pays a token account this provider does not use." };
  }
  if (escrow.amount < input.minimum) {
    return { ok: false, reason: "wrong_amount", message: `The locked maximum is below this request's estimate of ${input.minimum.toString()} base units.` };
  }
  if (!(await input.replayStore.checkAndStore(`metered-escrow:${header.escrow.toBase58()}`))) {
    return { ok: false, reason: "duplicate_nonce", message: "This escrow has already paid for a call." };
  }
  return {
    ok: true,
    payer: escrow.payer,
    maxBaseUnits: escrow.amount,
    terms: {
      programId: terms.programId,
      tokenProgram: terms.tokenProgram,
      payer: escrow.payer,
      payee: escrow.payee,
      mint: escrow.mint,
      source: escrow.source,
      recipient: escrow.recipient,
      amount: escrow.amount,
      nonce: Uint8Array.from(escrow.nonce),
      metered: true,
    },
  };
}

/** Token counts from the model's usage report, or the estimate from the text when it reports none. */
export function usageFrom(upstream: Record<string, unknown>, inputEstimate: number): { inputTokens: number; outputTokens: number } {
  const usage = upstream.usage as { prompt_tokens?: unknown; completion_tokens?: unknown } | undefined;
  const whole = (value: unknown) => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined);
  const input = whole(usage?.prompt_tokens);
  const output = whole(usage?.completion_tokens);
  if (input !== undefined && output !== undefined) return { inputTokens: input, outputTokens: output };
  const choices = upstream.choices as { message?: { content?: unknown } }[] | undefined;
  const text = typeof choices?.[0]?.message?.content === "string" ? choices[0].message.content : "";
  return { inputTokens: input ?? inputEstimate, outputTokens: output ?? Math.ceil(text.length / 4) };
}

/**
 * The settle for the tokens used, never above the locked maximum. The unused
 * part goes to the buyer's associated token account, and the transaction first
 * creates it and the treasury's token account if either is missing, so a
 * closed source account or a treasury account not yet created cannot stop the
 * payout. The provider pays rent for anything it creates.
 */
export function meteredSettlement(terms: MeteredTerms, lock: Extract<VerifiedLock, { ok: true }>, usage: { inputTokens: number; outputTokens: number }): { settlement: MeteredSettlement; instruction: TransactionInstruction; instructions: TransactionInstruction[] } {
  const decimals = directPaymentCurrency(terms.price.currency)!.decimals;
  const settlement = settleMeteredCall(terms.price, usage, baseUnitsToDecimal(lock.maxBaseUnits, decimals));
  if (settlement.chargedBaseUnits <= BigInt(0)) throw new Error("nothing to settle");
  const prep = prepareTokenPayout(lock.terms, terms.payee);
  const instruction = buildSettleTokenEscrowInstruction(lock.terms, false, terms.payee, {
    actual: settlement.chargedBaseUnits,
    treasuryToken: prep.treasuryToken,
    refundTo: prep.refundTo,
  });
  return { settlement, instruction, instructions: [...prep.instructions, instruction] };
}
