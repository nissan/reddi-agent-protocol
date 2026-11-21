/**
 * The seller side of a per-token (metered) call.
 *
 * A buyer locks the most it will pay in a metered token escrow payable to the
 * provider. The provider reads the lock back from the chain, serves the call,
 * counts the tokens the model reports and settles the actual cost. The escrow
 * program pays 2.5% of that to the protocol treasury, the rest to the
 * provider, and returns the unused maximum to the buyer.
 *
 * Nothing here reads a key or sends a transaction. `meteredSettlement` returns
 * instructions; the operator signs and sends them.
 */
import { PublicKey, type TransactionInstruction } from '@solana/web3.js';
import { prepareTokenPayout } from './escrow-readiness';
import { quoteMeteredCall, settleMeteredCall, tokenCostBaseUnits, type MeteredSettlement, type PerTokenPrice, type TokenCounts } from './metered';
import { baseUnitsToDecimal, directPaymentCurrency, parseX402PaymentHeader, SOLANA_GENESIS_HASHES } from './payment';
import { buildSettleTokenEscrowInstruction, decodeTokenEscrowAccount, SELLER_MIN_CANCEL_WINDOW_SLOTS, tokenEscrowAddresses, treasuryTokenAccount, type TokenEscrowTerms } from './token-escrow';
import type { NonceReplayStore, SolanaPaymentNetwork } from './types';

/** Output tokens assumed when the request sets no limit and the operator sets none. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 1_000;
/** The buyer's default maximum, as a multiple of the estimate. The buyer may raise it, never below the estimate. */
export const DEFAULT_MAX_CHARGE_MULTIPLE = 2;

/** What a reader of chain accounts returns. A `Connection` adapts to it. */
export type AccountReader = (address: PublicKey) => Promise<{ owner: PublicKey; data: Uint8Array } | null>;
/** The chain's current slot. */
export type SlotReader = () => Promise<number | bigint>;

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

export interface MeteredTermsInput {
  /** A token currency the escrow program accepts: USDC, AUDD, PYUSD or USDG. */
  currency: string;
  /** Decimal price per million input and output tokens, in `currency`. */
  inputPerMillion: string;
  outputPerMillion: string;
  /** The most output tokens one call may use. Defaults to `DEFAULT_MAX_OUTPUT_TOKENS`. */
  maxOutputTokens?: number;
  /** The escrow program buyers lock in. */
  programId: string | PublicKey;
  /** The mint accepted for `currency` on the provider's network. */
  mint: string | PublicKey;
  /** The provider's wallet. Payouts go to its associated token account for the mint. */
  payee: string | PublicKey;
}

/**
 * A provider's metered terms. Throws when the currency is not a token
 * currency, a price does not parse, or an address is malformed.
 */
export function providerMeteredTerms(input: MeteredTermsInput): MeteredTerms {
  const currency = directPaymentCurrency(input.currency);
  if (!currency) throw new Error(`unsupported currency: ${input.currency}`);
  // SOL settles through the SOL escrow, which has no metered seller path here.
  if (!currency.tokenProgram) throw new Error(`${input.currency} is not a token currency: metered calls are priced in USDC, AUDD, PYUSD or USDG`);
  const price: PerTokenPrice = { currency: input.currency, inputPerMillion: input.inputPerMillion, outputPerMillion: input.outputPerMillion };
  if (tokenCostBaseUnits(price, { inputTokens: 1_000_000, outputTokens: 1_000_000 }) <= BigInt(0)) throw new Error('a metered price must be above zero');
  const maxOutputTokens = input.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0) throw new Error('maxOutputTokens must be a positive whole number');
  return {
    price,
    programId: new PublicKey(input.programId),
    mint: new PublicKey(input.mint),
    tokenProgram: new PublicKey(currency.tokenProgram),
    payee: new PublicKey(input.payee),
    maxOutputTokens,
  };
}

/** About four characters a token, over every message. */
export function estimateInputTokens(messages: readonly { content: string }[]): number {
  return messages.reduce((total, message) => total + Math.ceil((typeof message.content === 'string' ? message.content : '').length / 4), 0);
}

/** Output limit for this call: the request's own, held to the provider's. */
export function outputLimit(terms: MeteredTerms, requested?: number): number {
  return requested !== undefined && Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, terms.maxOutputTokens) : terms.maxOutputTokens;
}

/** The estimate a call is quoted on: the input estimate plus the full output limit. */
export function meteredEstimate(terms: MeteredTerms, messages: readonly { content: string }[], requestedMaxTokens?: number): TokenCounts {
  return { inputTokens: estimateInputTokens(messages), outputTokens: outputLimit(terms, requestedMaxTokens) };
}

export interface MeteredOffer {
  settlement: 'metered-escrow';
  /** Present when the provider states its network. */
  network?: SolanaPaymentNetwork;
  currency: string;
  inputPerMillion: string;
  outputPerMillion: string;
  maxOutputTokens: number;
  estimate: TokenCounts;
  /** Cost of the estimate, as a decimal amount of `currency`. */
  estimatedCost: string;
  /** The maximum a buyer locks by default: twice the estimate. A buyer may lock more, never less than the estimate. */
  suggestedMaxCharge: string;
  suggestedMaxChargeBaseUnits: string;
  /** Protocol fee if the estimate holds: 2.5%, taken out of the provider's share. */
  estimatedFee: string;
  /** The least a lock may hold, in base units: the cost of the estimate. */
  minimumLockBaseUnits: string;
  escrowProgramId: string;
  mint: string;
  payTo: string;
  nonce: string;
  [key: string]: unknown;
}

/** What a 402 tells a buyer about metered payment. The buyer's lock must cover `minimumLockBaseUnits`. */
export function meteredOffer(terms: MeteredTerms, messages: readonly { content: string }[], requestedMaxTokens?: number, network?: SolanaPaymentNetwork): MeteredOffer {
  const estimate = meteredEstimate(terms, messages, requestedMaxTokens);
  const decimals = directPaymentCurrency(terms.price.currency)!.decimals;
  const minimum = tokenCostBaseUnits(terms.price, estimate);
  const suggested = minimum * BigInt(DEFAULT_MAX_CHARGE_MULTIPLE);
  const quote = suggested > BigInt(0) ? quoteMeteredCall(terms.price, estimate, baseUnitsToDecimal(suggested, decimals)) : undefined;
  return {
    settlement: 'metered-escrow',
    ...(network ? { network } : {}),
    currency: terms.price.currency,
    inputPerMillion: terms.price.inputPerMillion,
    outputPerMillion: terms.price.outputPerMillion,
    maxOutputTokens: terms.maxOutputTokens,
    estimate,
    estimatedCost: quote?.estimatedCost ?? '0',
    suggestedMaxCharge: quote?.maxCharge ?? '0',
    suggestedMaxChargeBaseUnits: suggested.toString(),
    estimatedFee: quote?.estimatedFee ?? '0',
    minimumLockBaseUnits: minimum.toString(),
    escrowProgramId: terms.programId.toBase58(),
    mint: terms.mint.toBase58(),
    payTo: terms.payee.toBase58(),
    nonce: '32 lowercase hex characters you choose; the escrow is [token-escrow, payer, nonce]',
  };
}

export interface MeteredPaymentHeader {
  escrow: PublicKey;
  payer: PublicKey;
  nonce: Uint8Array;
}

const NONCE_HEX = /^[0-9a-f]{32}$/;

/** A request's headers: a fetch `Headers`, or anything with the same `get`. */
export interface HeaderReader {
  get(name: string): string | null;
}

/** The metered receipt a buyer presents, or undefined when the header is not one. */
export function readMeteredPaymentHeader(headers: HeaderReader): MeteredPaymentHeader | { error: string } | undefined {
  const value = headers.get('x402-payment') ?? headers.get('x-payment');
  if (!value) return undefined;
  const parsed = parseX402PaymentHeader(value);
  if (!parsed || typeof parsed !== 'object' || (parsed as { settlement?: unknown }).settlement !== 'metered-escrow') return undefined;
  const record = parsed as Record<string, unknown>;
  const nonce = typeof record.nonce === 'string' ? record.nonce.replace(/-/g, '').toLowerCase() : '';
  if (!NONCE_HEX.test(nonce)) return { error: 'A metered payment names the 16-byte escrow nonce as 32 hex characters.' };
  try {
    return { escrow: new PublicKey(String(record.escrow)), payer: new PublicKey(String(record.payer)), nonce: Uint8Array.from(Buffer.from(nonce, 'hex')) };
  } catch {
    return { error: 'A metered payment must name the payer and the escrow address.' };
  }
}

/** The value a buyer sends in `x402-payment` once its metered lock is confirmed. */
export function meteredPaymentHeaderValue(input: { payer: PublicKey; nonce: Uint8Array; programId: PublicKey }): string {
  if (input.nonce.length !== 16) throw new Error('nonce must be 16 bytes');
  const { escrow } = tokenEscrowAddresses({ programId: input.programId, payer: input.payer, nonce: input.nonce });
  return JSON.stringify({ settlement: 'metered-escrow', escrow: escrow.toBase58(), payer: input.payer.toBase58(), nonce: Buffer.from(input.nonce).toString('hex') });
}

export type ClusterCheck = { ok: true } | { ok: false; reason: 'wrong_cluster' | 'payment_check_unavailable'; message: string };

/**
 * Confirms the RPC endpoint serves the network the provider is configured
 * for, so a lock on another cluster is never taken as payment. Run it before
 * trusting any account the endpoint returns.
 */
export async function checkProviderCluster(readGenesisHash: () => Promise<string>, network: SolanaPaymentNetwork, expectedGenesisHash?: string): Promise<ClusterCheck> {
  const publicHash = SOLANA_GENESIS_HASHES[network];
  if (!publicHash) return { ok: false, reason: 'wrong_cluster', message: `Unknown network ${String(network)}.` };
  // A public cluster's hash cannot be replaced. Only a local validator has its own.
  if (expectedGenesisHash !== undefined && network === 'solana-mainnet-beta' && expectedGenesisHash !== publicHash) {
    return { ok: false, reason: 'wrong_cluster', message: 'The mainnet genesis hash cannot be replaced.' };
  }
  let actual: string;
  try {
    actual = await readGenesisHash();
  } catch {
    return { ok: false, reason: 'payment_check_unavailable', message: 'The chain could not be read. Nothing was accepted.' };
  }
  const expected = expectedGenesisHash ?? publicHash;
  return actual === expected ? { ok: true } : { ok: false, reason: 'wrong_cluster', message: `The RPC endpoint is not ${network}.` };
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
  readSlot: SlotReader;
  replayStore: NonceReplayStore;
}): Promise<VerifiedLock> {
  const { header, terms } = input;
  const expected = tokenEscrowAddresses({ programId: terms.programId, payer: header.payer, nonce: header.nonce }).escrow;
  if (!expected.equals(header.escrow)) return { ok: false, reason: 'invalid_receipt', message: 'The escrow address is not the one this payer and nonce give.' };
  let account: { owner: PublicKey; data: Uint8Array } | null;
  try {
    account = await input.readAccount(header.escrow);
  } catch {
    return { ok: false, reason: 'payment_check_unavailable', message: 'The chain could not be read. Nothing was accepted; present the same receipt again.' };
  }
  if (!account) return { ok: false, reason: 'invalid_receipt', message: 'No escrow is locked at that address yet.' };
  if (!account.owner.equals(terms.programId)) return { ok: false, reason: 'invalid_receipt', message: 'That account is not held by the escrow program.' };
  let escrow: ReturnType<typeof decodeTokenEscrowAccount>;
  try {
    escrow = decodeTokenEscrowAccount(Buffer.from(account.data));
  } catch {
    return { ok: false, reason: 'invalid_receipt', message: 'That account is not a token escrow.' };
  }
  if (escrow.status !== 0) return { ok: false, reason: 'duplicate_nonce', message: 'This escrow has already been settled or cancelled.' };
  if (!escrow.metered) return { ok: false, reason: 'invalid_receipt', message: 'This escrow was not locked as a metered escrow.' };
  // The payer may refund once its window has elapsed, so the settlement has to
  // land before then. The time left now is what counts, not the window named
  // at lock: a buyer could lock, wait out most of the window, then make the
  // call. An escrow that states no window, or a slot that cannot be read, is
  // refused.
  if (escrow.cancelWindowSlots === undefined) {
    return { ok: false, reason: 'invalid_receipt', message: 'This escrow states no refund window. Lock a new one with the current program.' };
  }
  let currentSlot: bigint;
  try {
    currentSlot = BigInt(await input.readSlot());
  } catch {
    return { ok: false, reason: 'payment_check_unavailable', message: 'The chain could not be read. Nothing was accepted; present the same receipt again.' };
  }
  const elapsed = currentSlot > escrow.createdSlot ? currentSlot - escrow.createdSlot : BigInt(0);
  if (escrow.cancelWindowSlots < elapsed + SELLER_MIN_CANCEL_WINDOW_SLOTS) {
    return { ok: false, reason: 'invalid_receipt', message: "This escrow's refund window has less than 10 minutes left. Lock a new one with a longer refund window, then make the call straight away." };
  }
  if (!escrow.payer.equals(header.payer)) return { ok: false, reason: 'invalid_receipt', message: 'The escrow was locked by a different wallet.' };
  if (!escrow.payee.equals(terms.payee)) return { ok: false, reason: 'wrong_payee', message: 'The escrow pays a different provider.' };
  if (!escrow.mint.equals(terms.mint)) return { ok: false, reason: 'wrong_currency', message: `The escrow holds a different mint than this provider's ${terms.price.currency}.` };
  // The provider's associated token account for the mint (the helper derives any owner's).
  if (!escrow.recipient.equals(treasuryTokenAccount({ mint: terms.mint, tokenProgram: terms.tokenProgram }, terms.payee))) {
    return { ok: false, reason: 'wrong_payee', message: 'The escrow pays a token account this provider does not use.' };
  }
  if (escrow.amount < input.minimum) {
    return { ok: false, reason: 'wrong_amount', message: `The locked maximum is below this request's estimate of ${input.minimum.toString()} base units.` };
  }
  if (!(await input.replayStore.checkAndStore(`metered-escrow:${header.escrow.toBase58()}`))) {
    return { ok: false, reason: 'duplicate_nonce', message: 'This escrow has already paid for a call.' };
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
      ...(escrow.claimWindowSlots !== undefined && escrow.cancelWindowSlots !== undefined
        ? { claimWindowSlots: escrow.claimWindowSlots, cancelWindowSlots: escrow.cancelWindowSlots }
        : {}),
    },
  };
}

/** Token counts from an OpenAI-style usage report, or the estimate from the text when it reports none. */
export function usageFrom(upstream: Record<string, unknown>, inputEstimate: number): TokenCounts {
  const usage = upstream.usage as { prompt_tokens?: unknown; completion_tokens?: unknown } | undefined;
  const whole = (value: unknown) => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined);
  const input = whole(usage?.prompt_tokens);
  const output = whole(usage?.completion_tokens);
  if (input !== undefined && output !== undefined) return { inputTokens: input, outputTokens: output };
  const choices = upstream.choices as { message?: { content?: unknown } }[] | undefined;
  const text = typeof choices?.[0]?.message?.content === 'string' ? choices[0].message.content : '';
  return { inputTokens: input ?? inputEstimate, outputTokens: output ?? Math.ceil(text.length / 4) };
}

/**
 * The settle for the tokens used, never above the locked maximum. The unused
 * part goes to the buyer's associated token account, and the transaction first
 * creates it and the treasury's token account if either is missing, so a
 * closed source account or a treasury account not yet created cannot stop the
 * payout. The provider pays rent for anything it creates.
 */
export function meteredSettlement(terms: MeteredTerms, lock: Extract<VerifiedLock, { ok: true }>, usage: TokenCounts): { settlement: MeteredSettlement; instruction: TransactionInstruction; instructions: TransactionInstruction[] } {
  const decimals = directPaymentCurrency(terms.price.currency)!.decimals;
  const settlement = settleMeteredCall(terms.price, usage, baseUnitsToDecimal(lock.maxBaseUnits, decimals));
  if (settlement.chargedBaseUnits <= BigInt(0)) throw new Error('nothing to settle');
  const prep = prepareTokenPayout(lock.terms, terms.payee);
  const instruction = buildSettleTokenEscrowInstruction(lock.terms, false, terms.payee, {
    actual: settlement.chargedBaseUnits,
    treasuryToken: prep.treasuryToken,
    refundTo: prep.refundTo,
  });
  return { settlement, instruction, instructions: [...prep.instructions, instruction] };
}

/**
 * Declines a verified lock the provider will not serve, for example when the
 * model failed before any work was done: the payee may refund the whole
 * amount to the payer at any time. Returns the instruction for the operator
 * to sign with the provider wallet.
 */
export function meteredDecline(terms: MeteredTerms, lock: Extract<VerifiedLock, { ok: true }>): TransactionInstruction {
  return buildSettleTokenEscrowInstruction(lock.terms, true, terms.payee);
}
