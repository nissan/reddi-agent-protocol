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
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, getTransferFeeConfig, unpackMint } from '@solana/spl-token';
import { checkTokenAccount, prepareTokenPayout } from './escrow-readiness';
import { quoteMeteredCall, settleMeteredCall, tokenCostBaseUnits, type MeteredSettlement, type PerTokenPrice, type TokenCounts } from './metered';
import { baseUnitsToDecimal, directPaymentCurrency, parseX402PaymentHeader, SOLANA_GENESIS_HASHES } from './payment';
import { ratingPda, withRatingAccount } from './rating';
import { buildSettleTokenEscrowInstruction, decodeTokenEscrowAccount, ESCROW_PROTOCOL_TREASURY, SELLER_MIN_CANCEL_WINDOW_SLOTS, tokenEscrowAddresses, treasuryTokenAccount, type TokenEscrowTerms } from './token-escrow';
import type { NonceReplayStore, SolanaPaymentNetwork } from './types';

/** Output tokens assumed when the request sets no limit and the operator sets none. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 1_000;
/** The buyer's default maximum, as a multiple of the estimate. The buyer may raise it, never below the estimate. */
export const DEFAULT_MAX_CHARGE_MULTIPLE = 2;

/**
 * What a reader of chain accounts returns. A `Connection` adapts to it. Read
 * at `confirmed` commitment or better: a buyer can opt an escrow in to rating
 * only in the slot of the lock, so a read that sees that whole slot tells for
 * good whether the job is rated, and a `processed` read may not.
 */
export type AccountReader = (address: PublicKey) => Promise<{ owner: PublicKey; data: Uint8Array } | null>;
/** The chain's current slot. */
export type SlotReader = () => Promise<number | bigint>;

/**
 * Signs the settle transaction with the provider wallet's key, sends it and
 * waits for confirmation. Returns the signature. The instructions go into one
 * transaction, in order, with the provider wallet as fee payer: the settle,
 * preceded by a create of the buyer's token account only when the operator
 * has chosen to pay for one.
 */
export type MeteredSettleSigner = (instructions: TransactionInstruction[]) => Promise<string>;

export interface MeteredTerms {
  price: PerTokenPrice;
  programId: PublicKey;
  mint: PublicKey;
  tokenProgram: PublicKey;
  payee: PublicKey;
  maxOutputTokens: number;
  /**
   * Another token account of the mint that the provider wallet owns. Payouts
   * go here when the provider's associated token account, which locks name,
   * is closed or frozen. A recovery setting; leave it unset otherwise.
   */
  payoutAccount?: PublicKey;
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
  /** Recovery only: another token account of the mint the provider wallet owns, used when its associated token account cannot receive. */
  payoutAccount?: string | PublicKey;
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
    ...(input.payoutAccount ? { payoutAccount: new PublicKey(input.payoutAccount) } : {}),
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

/** The accounts a settle pays into, as checked on chain. */
export interface PayoutAccounts {
  /** Set when the provider is paid at its recovery account instead of the recipient the lock names. */
  payTo?: PublicKey;
  treasuryToken: PublicKey;
  /** Where the unused part returns: a token account of the mint the payer owns. */
  refundTo: PublicKey;
  /** Pass the mint writable, so fees withheld on a Token-2022 vault are moved out and the vault can close. */
  harvestWithheldFees: boolean;
  /** The settle first creates `refundTo`, the payer's associated token account, at the provider's cost. */
  createRefundAccount?: boolean;
}

export type PayoutCheck =
  | { ok: true; payout: PayoutAccounts }
  | { ok: false; reason: 'refund_account_unusable' | 'provider_not_ready' | 'payment_check_unavailable'; message: string };

/**
 * Reads every account a settle of this escrow would pay into and says whether
 * the payout can land: the provider's token account (or its recovery
 * account), the treasury's, and the buyer's account for the unused part. Each
 * must exist under the mint's token program, be initialised, not frozen, hold
 * the mint, have the right owner and not require a memo.
 *
 * Nothing is created by default. `allowPayerAssociatedAccount` lets the
 * unused part go to the payer's associated token account when the recorded
 * source no longer works; `createRefundAccount` lets the provider pay to
 * create that account when it does not exist at all.
 */
export async function checkMeteredPayout(input: {
  terms: MeteredTerms;
  escrow: Pick<TokenEscrowTerms, 'payer' | 'source' | 'recipient'>;
  readAccount: AccountReader;
  treasury?: PublicKey;
  allowPayerAssociatedAccount?: boolean;
  createRefundAccount?: boolean;
}): Promise<PayoutCheck> {
  const { terms, escrow } = input;
  const token = { mint: terms.mint, tokenProgram: terms.tokenProgram };
  const treasury = input.treasury ?? ESCROW_PROTOCOL_TREASURY;
  const treasuryToken = treasuryTokenAccount(token, treasury);
  const notReady = (message: string): PayoutCheck => ({ ok: false, reason: 'provider_not_ready', message });
  try {
    let payTo: PublicKey | undefined;
    if (!checkTokenAccount(escrow.recipient, await input.readAccount(escrow.recipient), { ...token, owner: terms.payee }).ok) {
      const recovery = terms.payoutAccount;
      if (!recovery || recovery.equals(escrow.recipient) || !checkTokenAccount(recovery, await input.readAccount(recovery), { ...token, owner: terms.payee }).ok) {
        return notReady(`This provider's ${terms.price.currency} account cannot receive payment right now. Nothing was accepted; your lock is untouched.`);
      }
      payTo = recovery;
    }
    if (!checkTokenAccount(treasuryToken, await input.readAccount(treasuryToken), { ...token, owner: treasury }).ok) {
      return notReady(`The protocol treasury cannot receive ${terms.price.currency} right now, so this provider is not taking payment in it. Nothing was accepted; your lock is untouched.`);
    }
    let harvestWithheldFees = false;
    if (terms.tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
      const mint = await input.readAccount(terms.mint);
      if (!mint || !mint.owner.equals(TOKEN_2022_PROGRAM_ID)) return notReady(`The ${terms.price.currency} mint could not be read. Nothing was accepted; your lock is untouched.`);
      try {
        harvestWithheldFees = getTransferFeeConfig(unpackMint(terms.mint, { data: Buffer.from(mint.data), owner: mint.owner, lamports: 0, executable: false }, TOKEN_2022_PROGRAM_ID)) !== null;
      } catch {
        return notReady(`The ${terms.price.currency} mint could not be read. Nothing was accepted; your lock is untouched.`);
      }
    }
    const base = { ...(payTo ? { payTo } : {}), treasuryToken, harvestWithheldFees };
    const refundTarget = { ...token, owner: escrow.payer };
    const source = await input.readAccount(escrow.source);
    if (checkTokenAccount(escrow.source, source, refundTarget).ok) return { ok: true, payout: { ...base, refundTo: escrow.source } };
    if (input.allowPayerAssociatedAccount || input.createRefundAccount) {
      const associated = getAssociatedTokenAddressSync(terms.mint, escrow.payer, true, terms.tokenProgram);
      const held = associated.equals(escrow.source) ? source : await input.readAccount(associated);
      if (checkTokenAccount(associated, held, refundTarget).ok) return { ok: true, payout: { ...base, refundTo: associated } };
      // Only an account that does not exist can be created. A frozen or memo-requiring one stays as it is.
      if (input.createRefundAccount && held === null) return { ok: true, payout: { ...base, refundTo: associated, createRefundAccount: true } };
    }
    return {
      ok: false,
      reason: 'refund_account_unusable',
      message: `The ${terms.price.currency} account that funded this lock is closed, frozen or requires a memo, so the unused part could not be returned to you. Nothing was accepted. Restore that account and present the same lock again, or refund the lock once its refund window opens.`,
    };
  } catch {
    return { ok: false, reason: 'payment_check_unavailable', message: 'The chain could not be read. Nothing was accepted; present the same receipt again.' };
  }
}

export type VerifiedLock =
  | {
      ok: true;
      terms: TokenEscrowTerms;
      maxBaseUnits: bigint;
      payer: PublicKey;
      payout: PayoutAccounts;
      /**
       * The buyer opted this job in to rating (bit 0x02 of the escrow's flag
       * byte). Only ever true when the lock was verified with
       * `acceptRatedEscrows`. The settle and the decline then carry the rating
       * account, and by settling the provider agrees to be rated: it has to
       * commit and reveal its own rating within the windows or lose reputation.
       */
      rated: boolean;
    }
  | { ok: false; reason: string; message: string };

/**
 * Checks the lock on chain against this provider's terms: the escrow program,
 * the address the payer and nonce give, still locked, metered, payable to this
 * provider's token account in the accepted mint, and at least `minimum`. Then
 * checks that the payout can land (`checkMeteredPayout`), using the source
 * account the lock recorded for the unused part, so a call is refused before
 * any work is done rather than left unpaid after it.
 * The escrow is then remembered, so one lock pays for one call.
 *
 * An escrow the buyer opted in to rating is refused (`rated_escrow_declined`)
 * before anything is served or remembered, unless `acceptRatedEscrows` is
 * true. `readAccount` must read at `confirmed` commitment or better for that
 * answer to be final (see `AccountReader`).
 */
export async function verifyMeteredLock(input: {
  header: MeteredPaymentHeader;
  terms: MeteredTerms;
  minimum: bigint;
  readAccount: AccountReader;
  readSlot: SlotReader;
  replayStore: NonceReplayStore;
  /** The protocol treasury. Only a local test deployment has another. */
  treasury?: PublicKey;
  /**
   * Serve jobs the buyer opted in to rating. Default false: a rated escrow is
   * refused before serving. Settling a rated job is the provider's agreement
   * to be rated, after which it must commit and reveal a rating of its own
   * within the program's windows or lose reputation, so turn this on only
   * for a provider that does that.
   */
  acceptRatedEscrows?: boolean;
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
  if (escrow.rated && input.acceptRatedEscrows !== true) {
    return { ok: false, reason: 'rated_escrow_declined', message: 'This escrow was opted in to rating, and this provider does not take rated jobs. Nothing was accepted or served. Lock a new escrow without rating, and refund this one once its refund window opens.' };
  }
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
  const payout = await checkMeteredPayout({ terms, escrow, readAccount: input.readAccount, ...(input.treasury ? { treasury: input.treasury } : {}) });
  if (!payout.ok) return payout;
  if (!(await input.replayStore.checkAndStore(`metered-escrow:${header.escrow.toBase58()}`))) {
    return { ok: false, reason: 'duplicate_nonce', message: 'This escrow has already paid for a call.' };
  }
  return {
    ok: true,
    payer: escrow.payer,
    payout: payout.payout,
    rated: escrow.rated,
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
 * The settle for the tokens used, never above the locked maximum. It pays
 * into the accounts checked with the lock (`lock.payout`), or into `payout`
 * when the caller has checked them again. Nothing is created unless that
 * check chose to create the buyer's token account. The settle of a rated
 * lock carries the escrow's rating account after the usual accounts; for a
 * lock that is not rated the instruction is unchanged.
 */
export function meteredSettlement(
  terms: MeteredTerms,
  lock: Extract<VerifiedLock, { ok: true }>,
  usage: TokenCounts,
  payout: PayoutAccounts = lock.payout,
): { settlement: MeteredSettlement; instruction: TransactionInstruction; instructions: TransactionInstruction[] } {
  const decimals = directPaymentCurrency(terms.price.currency)!.decimals;
  const settlement = settleMeteredCall(terms.price, usage, baseUnitsToDecimal(lock.maxBaseUnits, decimals));
  if (settlement.chargedBaseUnits <= BigInt(0)) throw new Error('nothing to settle');
  const prep = prepareTokenPayout(lock.terms, terms.payee, undefined, { refundTo: payout.refundTo, createRefundAccount: payout.createRefundAccount === true });
  const instruction = withRatingAccount(
    buildSettleTokenEscrowInstruction(lock.terms, false, terms.payee, {
      actual: settlement.chargedBaseUnits,
      treasuryToken: payout.treasuryToken,
      refundTo: payout.refundTo,
      ...(payout.payTo ? { payTo: payout.payTo } : {}),
      ...(payout.harvestWithheldFees ? { harvestWithheldFees: true } : {}),
    }),
    lock.rated === true,
  );
  return { settlement, instruction, instructions: [...prep.instructions, instruction] };
}

/** One token account's balance before and after a transaction, in base units. */
export interface TokenBalanceChange {
  account: string;
  mint: string;
  before: bigint;
  after: bigint;
}

/** What a confirmed transaction did, as read back from the chain. */
export interface SettlementRecord {
  failed: boolean;
  /** Programs its instructions called. */
  programIds: string[];
  /** Every account it named. */
  accounts: string[];
  tokenBalances: TokenBalanceChange[];
}

export type ConfirmedSettlement =
  | {
      ok: true;
      /** What left the lock for the provider and the treasury together: the amount billed. */
      paidBaseUnits: bigint;
      feeBaseUnits: bigint;
      providerBaseUnits: bigint;
      /** The buyer's own unused part: the maximum less the amount billed. */
      refundedBaseUnits: bigint;
      /** Anything returned to the buyer above that, for example tokens someone else sent to the vault. */
      surplusBaseUnits: bigint;
    }
  | { ok: false; reason: 'not_found' | 'failed' | 'wrong_transaction' | 'amounts_do_not_add_up' };

/**
 * The amounts a settle actually moved, from the confirmed transaction: it
 * must have succeeded, called the escrow program and named this escrow (and,
 * when `expected.rating` is given, that rating account: pass
 * `meteredRatingAccount(lock)` for a rated lock). Accounts the transaction
 * names beyond those are not held against it. The
 * provider's credit and the treasury's fee are read from the balance changes,
 * not from what the provider intended. Refused when the buyer got back less
 * than the maximum less the amount billed, or more was billed than was
 * locked: a receipt cannot state that honestly. A mint that charges a
 * non-zero transfer fee would land here on every settle, since each transfer
 * arrives short; the accepted Token-2022 mints are watched to stay at zero.
 */
export function confirmMeteredSettlement(
  record: SettlementRecord | null,
  expected: { programId: PublicKey; escrow: PublicKey; mint: PublicKey; destination: PublicKey; treasuryToken: PublicKey; refundTo: PublicKey; maxBaseUnits: bigint; rating?: PublicKey },
): ConfirmedSettlement {
  if (!record) return { ok: false, reason: 'not_found' };
  if (record.failed) return { ok: false, reason: 'failed' };
  if (!record.programIds.includes(expected.programId.toBase58()) || !record.accounts.includes(expected.escrow.toBase58())) return { ok: false, reason: 'wrong_transaction' };
  if (expected.rating && !record.accounts.includes(expected.rating.toBase58())) return { ok: false, reason: 'wrong_transaction' };
  const mint = expected.mint.toBase58();
  const change = (account: PublicKey): bigint => {
    const row = record.tokenBalances.find((b) => b.account === account.toBase58() && b.mint === mint);
    return row ? row.after - row.before : BigInt(0);
  };
  const providerBaseUnits = change(expected.destination);
  const feeBaseUnits = change(expected.treasuryToken);
  const returned = change(expected.refundTo);
  const paidBaseUnits = providerBaseUnits + feeBaseUnits;
  if (providerBaseUnits <= BigInt(0) || feeBaseUnits < BigInt(0) || returned < BigInt(0) || paidBaseUnits > expected.maxBaseUnits) return { ok: false, reason: 'amounts_do_not_add_up' };
  const refundedBaseUnits = expected.maxBaseUnits - paidBaseUnits;
  if (returned < refundedBaseUnits) return { ok: false, reason: 'amounts_do_not_add_up' };
  return { ok: true, paidBaseUnits, feeBaseUnits, providerBaseUnits, refundedBaseUnits, surplusBaseUnits: returned - refundedBaseUnits };
}

/**
 * Declines a verified lock the provider will not serve, for example when the
 * model failed before any work was done: the payee may refund the whole
 * amount to the payer at any time. The program sends a decline to the source
 * account the lock recorded, which the lock check found usable. Returns the
 * instruction for the operator to sign with the provider wallet. The decline
 * of a rated lock carries the rating account, which the program closes: a
 * job that was not paid is not rated.
 */
export function meteredDecline(terms: MeteredTerms, lock: Extract<VerifiedLock, { ok: true }>): TransactionInstruction {
  return withRatingAccount(buildSettleTokenEscrowInstruction(lock.terms, true, terms.payee, lock.payout.harvestWithheldFees ? { harvestWithheldFees: true } : {}), lock.rated === true);
}

/** The rating account a rated lock's settle and decline carry, or undefined for a lock that is not rated. */
export function meteredRatingAccount(lock: Extract<VerifiedLock, { ok: true }>): PublicKey | undefined {
  return lock.rated === true ? ratingPda(tokenEscrowAddresses(lock.terms).escrow, lock.terms.programId) : undefined;
}
