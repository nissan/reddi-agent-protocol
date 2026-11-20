import { LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js';
import { needsAutoSwap, resolveMint, SwapClient } from './jupiter';
import { SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, verifySplTransferCheckedObservation } from './spl-token-observer';
import { X402Request, PaymentReceipt } from './types';
import type {
  NonceReplayStore,
  ProtocolFeeConfig,
  ReceiptVerificationResult,
  ReceiptVerifier,
  SolanaPaymentNetwork,
  X402Challenge,
  X402ChallengeInput,
  X402FeeTerms,
  X402PaymentReceipt,
} from './types';

const SUPPORTED_NETWORKS: SolanaPaymentNetwork[] = ['solana-devnet', 'solana-mainnet-beta', 'solana-testnet'];

/**
 * Strictly validate canonical Solana public-key text.
 * Requires base58 decode to exactly 32 bytes and round-trips to the same string.
 */
export function isValidSolanaPublicKey(address: string): boolean {
  if (typeof address !== 'string' || address.trim() !== address || address.length === 0) return false;
  try {
    const publicKey = new PublicKey(address);
    return publicKey.toBytes().length === 32 && publicKey.toBase58() === address;
  } catch {
    return false;
  }
}

/** Backwards-compatible alias for older callers. */
export const isValidPaymentAddress = isValidSolanaPublicKey;

/** Protocol fee rate: 5 basis points, which is 0.05% of the listed price. */
export const PROTOCOL_FEE_BPS = 5;
const BPS_DENOMINATOR = 10_000;
/** Highest fee rate this package will state or verify: 10%. Guards against a mistyped configuration. */
const MAX_PROTOCOL_FEE_BPS = 1_000;

/** A currency a direct per-call payment can be made in. `tokenProgram` is absent for native SOL. */
export interface DirectPaymentCurrency {
  decimals: number;
  tokenProgram?: string;
}

/**
 * Currencies accepted for direct per-call payments. The token program is fixed
 * per currency: USDC and AUDD are classic SPL Token mints, PYUSD and USDG are
 * Token-2022 mints. The mint address itself always comes from configuration.
 */
export const DIRECT_PAYMENT_CURRENCIES: Readonly<Record<string, DirectPaymentCurrency>> = Object.freeze({
  SOL: { decimals: 9 },
  USDC: { decimals: 6, tokenProgram: SPL_TOKEN_PROGRAM_ID },
  AUDD: { decimals: 6, tokenProgram: SPL_TOKEN_PROGRAM_ID },
  PYUSD: { decimals: 6, tokenProgram: TOKEN_2022_PROGRAM_ID },
  USDG: { decimals: 6, tokenProgram: TOKEN_2022_PROGRAM_ID },
});

/** Looks up a direct payment currency without reading inherited object keys. */
export function directPaymentCurrency(currency: string): DirectPaymentCurrency | undefined {
  return Object.prototype.hasOwnProperty.call(DIRECT_PAYMENT_CURRENCIES, currency) ? DIRECT_PAYMENT_CURRENCIES[currency] : undefined;
}

/**
 * Mainnet mint addresses, read on-chain on 20 November 2026. Reference values
 * for operator configuration; nothing in this package uses them by default.
 */
export const MAINNET_STABLECOIN_MINTS = Object.freeze({
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  AUDD: 'AUDDttiEpCydTm7joUMbYddm72jAWXZnCpPZtDoxqBSw',
  PYUSD: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
  USDG: '2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH',
});

/**
 * Converts a decimal amount to whole base units without floating point
 * multiplication. Returns undefined for anything that is not a positive amount
 * with at most `decimals` decimal places.
 */
export function decimalToBaseUnits(amount: string | number, decimals: number): bigint | undefined {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) return undefined;
  let text: string;
  if (typeof amount === 'number') {
    if (!Number.isFinite(amount) || amount <= 0) return undefined;
    // toFixed avoids exponent notation for small numbers; one extra place exposes
    // a value finer than the smallest unit instead of silently rounding it.
    text = amount.toFixed(decimals + 1).replace(/0+$/, '').replace(/\.$/, '');
  } else {
    text = amount;
  }
  const match = new RegExp(`^(\\d+)(?:\\.(\\d{1,${Math.max(decimals, 1)}}))?$`).exec(text);
  if (!match || (decimals === 0 && match[2] !== undefined)) return undefined;
  const units = BigInt(match[1]) * BigInt(10) ** BigInt(decimals) + BigInt((match[2] ?? '').padEnd(decimals, '0') || '0');
  return units > BigInt(0) ? units : undefined;
}

/** Renders whole base units as a decimal string with no trailing zeros. */
export function baseUnitsToDecimal(units: bigint, decimals: number): string {
  const text = units.toString().padStart(decimals + 1, '0');
  const whole = text.slice(0, text.length - decimals);
  const fraction = decimals === 0 ? '' : text.slice(text.length - decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

/** Fee in base units: the listed price times the rate, rounded down. There is no minimum fee. */
export function protocolFeeBaseUnits(priceBaseUnits: bigint, bps: number = PROTOCOL_FEE_BPS): bigint {
  if (!Number.isInteger(bps) || bps < 0 || bps > MAX_PROTOCOL_FEE_BPS) throw new Error(`protocol fee bps must be a whole number from 0 to ${MAX_PROTOCOL_FEE_BPS}`);
  if (priceBaseUnits < BigInt(0)) throw new Error('price must not be negative');
  return (priceBaseUnits * BigInt(bps)) / BigInt(BPS_DENOMINATOR);
}

interface FeeSplit {
  terms: X402FeeTerms;
  decimals: number;
  feeUnits: bigint;
  providerUnits: bigint;
}

function feeSplit(amount: string | number, currency: string, payTo: string, config: ProtocolFeeConfig): FeeSplit {
  const decimals = directPaymentCurrency(currency)?.decimals;
  if (decimals === undefined) throw new Error(`a protocol fee is not supported for currency ${currency}`);
  if (!isValidSolanaPublicKey(config.treasury)) throw new Error('protocol fee treasury must be a valid Solana public key');
  if (config.treasury === payTo) throw new Error('protocol fee treasury must differ from the payee');
  const bps = config.bps ?? PROTOCOL_FEE_BPS;
  const price = decimalToBaseUnits(amount, decimals);
  if (price === undefined) throw new Error(`amount must be a positive ${currency} amount with at most ${decimals} decimal places`);
  const feeUnits = protocolFeeBaseUnits(price, bps);
  const providerUnits = price - feeUnits;
  return {
    decimals,
    feeUnits,
    providerUnits,
    terms: {
      bps,
      payTo: config.treasury,
      amount: baseUnitsToDecimal(feeUnits, decimals),
      providerAmount: baseUnitsToDecimal(providerUnits, decimals),
    },
  };
}

/** Fee terms for a listed price, as a challenge states them. Throws on an unusable amount, currency or configuration. */
export function protocolFeeTerms(amount: string | number, currency: string, payTo: string, config: ProtocolFeeConfig): X402FeeTerms {
  return feeSplit(amount, currency, payTo, config).terms;
}

export interface BuildX402ChallengeOptions {
  /** When set, the challenge states the fee split. Comes from operator configuration only. */
  protocolFee?: ProtocolFeeConfig;
}

export function buildX402Challenge(input: X402ChallengeInput, options: BuildX402ChallengeOptions = {}): X402Challenge {
  if (!SUPPORTED_NETWORKS.includes(input.network)) throw new Error(`unsupported Solana network: ${input.network}`);
  if (!isValidSolanaPublicKey(input.payTo)) throw new Error('payTo must be a valid Solana public key');
  if (!input.nonce || typeof input.nonce !== 'string') throw new Error('nonce is required');
  if (!input.currency || typeof input.currency !== 'string') throw new Error('currency is required');
  if (String(input.amount).length === 0 || Number(input.amount) <= 0) throw new Error('amount must be positive');
  if (!input.endpoint || typeof input.endpoint !== 'string') throw new Error('endpoint is required');
  const challenge: X402Challenge = { version: input.version ?? '1', ...input };
  if (options.protocolFee) challenge.fee = protocolFeeTerms(input.amount, input.currency, input.payTo, options.protocolFee);
  return challenge;
}

/**
 * Parse x402-request header into structured request.
 * Expected format: JSON string with amount, currency, paymentAddress, nonce.
 * @throws Error if header is invalid.
 */
export function parseX402Header(header: string): X402Request {
  try {
    const parsed = JSON.parse(header);
    const amount = typeof parsed.amount === 'number' ? parsed.amount : typeof parsed.amount === 'string' ? Number(parsed.amount) : Number.NaN;
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('amount must be a positive number');
    if (!parsed.currency || typeof parsed.currency !== 'string') throw new Error('currency is required (e.g., "SOL")');
    const paymentAddress = typeof parsed.paymentAddress === 'string' ? parsed.paymentAddress : typeof parsed.payTo === 'string' ? parsed.payTo : undefined;
    if (!paymentAddress) throw new Error('paymentAddress is required');
    if (!parsed.nonce || typeof parsed.nonce !== 'string') throw new Error('nonce is required');
    if (!isValidSolanaPublicKey(paymentAddress)) throw new Error('paymentAddress must be a valid Solana public key');
    return {
      amount,
      currency: parsed.currency,
      paymentAddress,
      nonce: parsed.nonce,
      network: typeof parsed.network === 'string' ? parsed.network : undefined,
      endpoint: typeof parsed.endpoint === 'string' ? parsed.endpoint : undefined,
      memo: typeof parsed.memo === 'string' ? parsed.memo : undefined,
      payerCurrency: typeof parsed.payerCurrency === 'string' ? parsed.payerCurrency : undefined,
      payerAddress: typeof parsed.payerAddress === 'string' ? parsed.payerAddress : undefined,
      autoSwap: typeof parsed.autoSwap === 'boolean' ? parsed.autoSwap : false,
    };
  } catch (e: unknown) {
    if (e instanceof SyntaxError) throw new Error('x402-request header is not valid JSON');
    throw e;
  }
}

export function parseX402PaymentHeader(header: string): unknown {
  if (header.startsWith('demo:')) return header;
  try {
    return JSON.parse(header);
  } catch {
    return header;
  }
}

function normalizeReceipt(receipt: unknown): X402PaymentReceipt | undefined {
  if (typeof receipt === 'string' && receipt.startsWith('demo:')) {
    return {
      demo: true,
      network: 'solana-devnet',
      payTo: '',
      amount: '',
      currency: '',
      nonce: receipt.slice('demo:'.length),
    };
  }
  if (!receipt || typeof receipt !== 'object') return undefined;
  const record = receipt as Record<string, unknown>;
  if (record.demo === true) return undefined;
  if (
    typeof record.network !== 'string' ||
    typeof record.payTo !== 'string' ||
    (typeof record.amount !== 'string' && typeof record.amount !== 'number') ||
    typeof record.currency !== 'string' ||
    typeof record.nonce !== 'string'
  ) {
    return undefined;
  }
  return {
    network: record.network as SolanaPaymentNetwork,
    payTo: record.payTo,
    amount: record.amount,
    currency: record.currency,
    nonce: record.nonce,
    signature: typeof record.signature === 'string' ? record.signature : undefined,
    txSignature: typeof record.txSignature === 'string' ? record.txSignature : undefined,
    payer: typeof record.payer === 'string' ? record.payer : undefined,
    mint: typeof record.mint === 'string' ? record.mint : undefined,
    destinationTokenAccount: typeof record.destinationTokenAccount === 'string' ? record.destinationTokenAccount : undefined,
    demo: record.demo === true,
  };
}

export async function verifyDemoPaymentReceipt(input: {
  receipt: unknown;
  challenge: X402Challenge;
  allowDemoPayment: boolean;
  replayStore?: NonceReplayStore;
}): Promise<ReceiptVerificationResult> {
  if (!input.allowDemoPayment) {
    return { ok: false, reason: 'demo_payment_disabled', message: 'demo x402 payments require explicit ALLOW_DEMO_X402_PAYMENT' };
  }

  const receipt = normalizeReceipt(input.receipt);
  if (!receipt) return { ok: false, reason: 'invalid_receipt', message: 'x402 payment receipt is not an explicit demo receipt' };
  if (!receipt.demo) return { ok: false, reason: 'unsupported_receipt', message: 'real Solana receipt verification is not implemented yet' };

  const expected = input.challenge;
  if (receipt.demo && receipt.payTo === '' && receipt.amount === '' && receipt.currency === '') {
    receipt.payTo = expected.payTo;
    receipt.amount = expected.amount;
    receipt.currency = expected.currency;
    receipt.network = expected.network;
  }

  if (receipt.network !== expected.network) {
    return { ok: false, reason: 'wrong_network', message: 'receipt network does not match challenge', expected: expected.network, actual: receipt.network };
  }
  if (!isValidSolanaPublicKey(receipt.payTo)) {
    return { ok: false, reason: 'invalid_payee', message: 'receipt payTo is not a valid Solana public key', actual: receipt.payTo };
  }
  if (receipt.payTo !== expected.payTo) {
    return { ok: false, reason: 'wrong_payee', message: 'receipt payee does not match challenge', expected: expected.payTo, actual: receipt.payTo };
  }
  if (String(receipt.amount) !== String(expected.amount)) {
    return { ok: false, reason: 'wrong_amount', message: 'receipt amount does not match challenge', expected: expected.amount, actual: receipt.amount };
  }
  if (receipt.currency !== expected.currency) {
    return { ok: false, reason: 'wrong_currency', message: 'receipt currency does not match challenge', expected: expected.currency, actual: receipt.currency };
  }
  if (receipt.nonce !== expected.nonce) {
    return { ok: false, reason: 'invalid_nonce', message: 'receipt nonce does not match challenge', expected: expected.nonce, actual: receipt.nonce };
  }
  if (input.replayStore) {
    const accepted = await input.replayStore.checkAndStore(receipt.nonce);
    if (!accepted) return { ok: false, reason: 'duplicate_nonce', message: 'receipt nonce has already been used', actual: receipt.nonce };
  }

  return { ok: true, receipt, demo: true };
}

export class DemoPaymentVerifier implements ReceiptVerifier {
  constructor(private readonly allowDemoPayment: boolean) {}

  verifyReceipt(receipt: unknown, challenge: X402Challenge, replayStore?: NonceReplayStore): Promise<ReceiptVerificationResult> {
    return verifyDemoPaymentReceipt({ receipt, challenge, allowDemoPayment: this.allowDemoPayment, replayStore });
  }
}

export interface ParsedTransactionConnection {
  getParsedTransaction(signature: string, options?: unknown): Promise<unknown>;
  /** Used to confirm the RPC endpoint serves the network the challenge names. */
  getGenesisHash?(): Promise<string>;
}

/** Genesis hashes of the public Solana clusters. */
export const SOLANA_GENESIS_HASHES: Record<SolanaPaymentNetwork, string> = {
  'solana-mainnet-beta': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  'solana-devnet': 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  'solana-testnet': '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY',
};

/** Default limit on how old a payment transaction may be when it is presented. */
export const DEFAULT_MAX_TRANSACTION_AGE_SECONDS = 900;
/** Tolerance for a block time slightly ahead of the verifier's clock. */
const MAX_CLOCK_SKEW_SECONDS = 60;

export interface SolanaReceiptVerifierOptions {
  allowRealPayment: boolean;
  connection: ParsedTransactionConnection;
  /** Required when verifying USDC/SPL-token receipts. Same as `mints.USDC`. */
  usdcMint?: string;
  /**
   * Accepted mint per token currency (USDC, AUDD, PYUSD, USDG), from operator
   * configuration only. A currency with no entry here is refused, apart from
   * the legacy `usdcMint` and `auddMint` options. Amounts in a challenge for a
   * currency configured here are decimal amounts, as for USDC.
   */
  mints?: Readonly<Record<string, string | undefined>>;
  /** Required when verifying AUDD x402 v2 SVM exact receipts. */
  auddMint?: string;
  /** Defaults to the legacy SPL Token program for AUDD exact receipts. */
  auddTokenProgram?: string;
  /**
   * Oldest block time accepted, in seconds before now. On solana-mainnet-beta it
   * defaults to DEFAULT_MAX_TRANSACTION_AGE_SECONDS and cannot be switched off.
   * On other networks the check runs only when this is set.
   */
  maxTransactionAgeSeconds?: number;
  /** Clock used for the age check, in milliseconds. Defaults to Date.now. */
  now?: () => number;
  /**
   * Genesis hash the RPC endpoint must report. On solana-mainnet-beta the public
   * mainnet hash is always enforced and this cannot replace it. On other networks
   * the check runs only when this is set (see SOLANA_GENESIS_HASHES).
   */
  expectedGenesisHash?: string;
  /**
   * Protocol fee the payment must include, or 'disabled' for an operator that
   * takes none. On solana-mainnet-beta one of the two must be set: a mainnet
   * verifier with no fee decision refuses every receipt. The treasury is taken
   * from here only, never from the challenge or the receipt.
   */
  protocolFee?: ProtocolFeeConfig | 'disabled';
}

export class SolanaReceiptVerifier implements ReceiptVerifier {
  private verifiedGenesisHash?: string;

  constructor(private readonly options: SolanaReceiptVerifierOptions) {}

  /**
   * Confirms the RPC endpoint serves the challenged network, so a transaction from
   * a cheaper cluster cannot settle a challenge for another. Always enforced on
   * solana-mainnet-beta against the public genesis hash. On other networks it runs
   * only when expectedGenesisHash is set, so local validators keep working.
   * A successful answer is remembered; a failure is asked again.
   */
  private async clusterFailure(network: SolanaPaymentNetwork): Promise<ReceiptVerificationResult | undefined> {
    const mainnet = network === 'solana-mainnet-beta';
    const configured = this.options.expectedGenesisHash;
    if (!mainnet && configured === undefined) return undefined;
    const expected = mainnet ? SOLANA_GENESIS_HASHES[network] : configured;
    if (mainnet && configured !== undefined && configured !== expected) {
      return { ok: false, reason: 'unsupported_receipt', message: 'expectedGenesisHash cannot replace the public mainnet genesis hash' };
    }
    const connection = this.options.connection;
    if (typeof connection.getGenesisHash !== 'function') {
      return { ok: false, reason: 'unsupported_receipt', message: 'network check requires a connection that reports its genesis hash' };
    }
    const actual = this.verifiedGenesisHash ?? await connection.getGenesisHash();
    if (actual !== expected) {
      return { ok: false, reason: 'wrong_network', message: 'RPC endpoint does not serve the challenged network', expected, actual };
    }
    this.verifiedGenesisHash = actual;
    return undefined;
  }

  /** Refuses a transaction older than the configured limit, or one with no usable block time when a limit applies. */
  private ageFailure(parsed: Record<string, unknown>, network: SolanaPaymentNetwork): ReceiptVerificationResult | undefined {
    const configured = this.options.maxTransactionAgeSeconds;
    if (configured !== undefined && !(Number.isFinite(configured) && configured > 0)) {
      return { ok: false, reason: 'unsupported_receipt', message: 'maxTransactionAgeSeconds must be a positive number' };
    }
    const limit = configured ?? (network === 'solana-mainnet-beta' ? DEFAULT_MAX_TRANSACTION_AGE_SECONDS : undefined);
    if (limit === undefined) return undefined;
    const blockTime = parsed.blockTime;
    if (typeof blockTime !== 'number' || !Number.isSafeInteger(blockTime) || blockTime <= 0) {
      return { ok: false, reason: 'invalid_receipt', message: 'transaction has no block time yet; present the receipt again shortly' };
    }
    const nowSeconds = Math.floor((this.options.now ?? Date.now)() / 1000);
    const age = nowSeconds - blockTime;
    if (age > limit) {
      return { ok: false, reason: 'invalid_receipt', message: 'transaction is older than the accepted payment window', expected: `at most ${limit} seconds old`, actual: `${age} seconds old` };
    }
    if (age < -MAX_CLOCK_SKEW_SECONDS) {
      return { ok: false, reason: 'invalid_receipt', message: 'transaction block time is in the future', actual: blockTime };
    }
    return undefined;
  }

  async verifyReceipt(receiptInput: unknown, challenge: X402Challenge, replayStore?: NonceReplayStore): Promise<ReceiptVerificationResult> {
    if (!this.options.allowRealPayment) {
      return { ok: false, reason: 'unsupported_receipt', message: 'real Solana receipt verification is disabled' };
    }
    const receipt = normalizeReceipt(receiptInput);
    if (!receipt || receipt.demo) return { ok: false, reason: 'invalid_receipt', message: 'real Solana receipt is required' };
    const base = validateReceiptShape(receipt, challenge);
    if (base) return base;
    const signature = receipt.signature ?? receipt.txSignature;
    if (!signature) return { ok: false, reason: 'invalid_receipt', message: 'receipt signature is required' };

    const feeDecision = this.feeSplitFor(challenge);
    if ('failure' in feeDecision) return feeDecision.failure;
    const split = feeDecision.split;

    const wrongCluster = await this.clusterFailure(challenge.network);
    if (wrongCluster) return wrongCluster;

    const parsed = asRecord(await this.options.connection.getParsedTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    }));
    const meta = asRecord(parsed?.meta);
    if (!parsed || !meta || meta.err) return { ok: false, reason: 'invalid_receipt', message: 'transaction is missing or failed' };

    const tooOld = this.ageFailure(parsed, challenge.network);
    if (tooOld) return tooOld;

    const unpaid = await this.challengePaymentFailure(parsed, receipt, challenge, signature, replayStore, split);
    if (unpaid) return unpaid;

    // A verified on-chain payment satisfies exactly one challenge. The nonce alone
    // cannot enforce that, because the caller that presents the receipt may also
    // choose the nonce, so the transaction signature is recorded as well. Without a
    // replay store there is nothing to record it in, and the receipt is refused.
    if (!replayStore) {
      return { ok: false, reason: 'unsupported_receipt', message: 'real Solana receipt verification requires a replay store' };
    }
    // Recorded only after the transaction is shown to pay this challenge, so a
    // third party cannot burn someone else's signature with a non-matching receipt.
    const signatureAccepted = await replayStore.checkAndStore(transactionReplayKey(challenge.network, signature));
    if (!signatureAccepted) {
      return { ok: false, reason: 'duplicate_nonce', message: 'transaction signature has already been used for a payment', actual: signature };
    }
    const accepted = await replayStore.checkAndStore(receipt.nonce);
    if (!accepted) return { ok: false, reason: 'duplicate_nonce', message: 'receipt nonce has already been used', actual: receipt.nonce };
    return split ? { ok: true, receipt, demo: false, fee: split.terms } : { ok: true, receipt, demo: false };
  }

  /**
   * Works out the fee split this verifier requires for a challenge, from its own
   * configuration. Fee terms printed in the challenge are only compared against
   * that, so a challenge cannot lower the fee or redirect it.
   */
  private feeSplitFor(challenge: X402Challenge): { split?: FeeSplit } | { failure: ReceiptVerificationResult } {
    const config = this.options.protocolFee;
    if (config === undefined && challenge.network === 'solana-mainnet-beta') {
      return { failure: { ok: false, reason: 'unsupported_receipt', message: "mainnet receipt verification requires a protocol fee treasury, or protocolFee: 'disabled'" } };
    }
    if (config === undefined || config === 'disabled') {
      if (challenge.fee !== undefined) {
        return { failure: { ok: false, reason: 'unsupported_receipt', message: 'challenge states a protocol fee but this verifier has none configured', actual: challenge.fee } };
      }
      return {};
    }
    let split: FeeSplit;
    try {
      split = feeSplit(challenge.amount, challenge.currency, challenge.payTo, config);
    } catch (error) {
      return { failure: { ok: false, reason: 'unsupported_receipt', message: error instanceof Error ? error.message : 'protocol fee cannot be computed for this challenge' } };
    }
    const stated = challenge.fee;
    if (stated !== undefined && (
      stated.bps !== split.terms.bps
      || stated.payTo !== split.terms.payTo
      || stated.amount !== split.terms.amount
      || stated.providerAmount !== split.terms.providerAmount
    )) {
      return { failure: { ok: false, reason: 'unsupported_receipt', message: 'challenge fee terms do not match the configured protocol fee', expected: split.terms, actual: stated } };
    }
    return { split };
  }

  /** Returns a failure result when the parsed transaction does not settle the challenge, otherwise undefined. */
  private async challengePaymentFailure(
    parsed: Record<string, unknown>,
    receipt: X402PaymentReceipt,
    challenge: X402Challenge,
    signature: string,
    replayStore?: NonceReplayStore,
    split?: FeeSplit,
  ): Promise<ReceiptVerificationResult | undefined> {
    // A fee that rounds down to zero leaves a single transfer of the full price.
    const fee = split && split.feeUnits > BigInt(0) ? split : undefined;
    if (challenge.currency === 'SOL') {
      if (fee) {
        return transactionHasSolSplit(parsed, receipt.payer, challenge.payTo, fee)
          ? undefined
          : unsatisfiedChallenge('transaction does not pay both the provider share and the protocol fee', fee.terms);
      }
      return transactionHasSolTransfer(parsed, receipt.payer, challenge.payTo, challenge.amount)
        ? undefined
        : unsatisfiedChallenge();
    }
    const token = directPaymentCurrency(challenge.currency);
    const configuredMints = this.options.mints;
    const configuredMint = (configuredMints && Object.prototype.hasOwnProperty.call(configuredMints, challenge.currency)
      ? configuredMints[challenge.currency]
      : undefined) ?? (challenge.currency === 'USDC' ? this.options.usdcMint : undefined);
    if (token?.tokenProgram && (configuredMint || challenge.currency !== 'AUDD' || !this.options.auddMint)) {
      const mint = configuredMint;
      if (!mint) {
        return { ok: false, reason: 'unsupported_receipt', message: `${challenge.currency} receipt verification requires a configured ${challenge.currency === 'USDC' ? 'usdcMint' : `mint (mints.${challenge.currency}${challenge.currency === 'AUDD' ? ' or the legacy auddMint' : ''})`}` };
      }
      if (receipt.mint !== undefined && receipt.mint !== mint) {
        return unsatisfiedChallenge(`receipt mint does not match the configured ${challenge.currency} mint`, mint, receipt.mint);
      }
      if (fee) {
        return transactionHasTokenSplit(parsed, receipt, challenge, mint, token.tokenProgram, fee)
          ? undefined
          : unsatisfiedChallenge('transaction does not pay both the provider share and the protocol fee', fee.terms);
      }
      return transactionHasTokenTransfer(parsed, receipt, challenge, mint, token.tokenProgram)
        ? undefined
        : unsatisfiedChallenge();
    }
    if (challenge.currency === 'AUDD') {
      // Legacy AUDD exact receipts state the amount in base units and carry no
      // fee split. A deployment that takes a fee must configure `mints.AUDD`.
      if (split) {
        return { ok: false, reason: 'unsupported_receipt', message: 'a protocol fee on AUDD requires the AUDD mint in `mints`, not the legacy auddMint option' };
      }
      const mint = this.options.auddMint;
      if (!mint) {
        return { ok: false, reason: 'unsupported_receipt', message: 'AUDD receipt verification requires a configured auddMint' };
      }
      if (receipt.mint !== undefined && receipt.mint !== mint) {
        return unsatisfiedChallenge('receipt mint does not match the configured AUDD mint', mint, receipt.mint);
      }
      const result = await verifySplTransferCheckedObservation({
        parsedTransaction: parsed,
        commitment: 'confirmed',
        replayStore,
        evidenceSource: 'parsed-rpc-transaction',
        expected: {
          network: challenge.network,
          signature,
          mint,
          tokenProgram: this.options.auddTokenProgram ?? SPL_TOKEN_PROGRAM_ID,
          payTo: challenge.payTo,
          amountBaseUnits: String(challenge.amount),
          destinationTokenAccount: receipt.destinationTokenAccount,
          authority: receipt.payer,
          memo: challenge.memo,
          memoRequired: challenge.memo !== undefined,
        },
      });
      if (result.ok) return undefined;
      return unsatisfiedChallenge(
        `transaction does not satisfy x402 challenge payment terms (${result.reason}: ${result.message})`,
        result.expected,
        result.actual,
      );
    }
    return { ok: false, reason: 'unsupported_receipt', message: `unsupported challenge currency: ${challenge.currency}` };
  }
}

/** Replay key for a settled transaction; namespaced so it cannot collide with a caller-chosen nonce. */
export function transactionReplayKey(network: string, signature: string): string {
  return `x402:tx:${network}:${signature}`;
}

function unsatisfiedChallenge(
  message = 'transaction does not satisfy x402 challenge payment terms',
  expected?: unknown,
  actual?: unknown,
): ReceiptVerificationResult {
  return { ok: false, reason: 'invalid_receipt', message, expected, actual };
}

function validateReceiptShape(receipt: X402PaymentReceipt, challenge: X402Challenge): ReceiptVerificationResult | undefined {
  if (receipt.network !== challenge.network) return { ok: false, reason: 'wrong_network', message: 'receipt network does not match challenge', expected: challenge.network, actual: receipt.network };
  if (!isValidSolanaPublicKey(receipt.payTo)) return { ok: false, reason: 'invalid_payee', message: 'receipt payTo is not a valid Solana public key', actual: receipt.payTo };
  if (receipt.payTo !== challenge.payTo) return { ok: false, reason: 'wrong_payee', message: 'receipt payee does not match challenge', expected: challenge.payTo, actual: receipt.payTo };
  if (String(receipt.amount) !== String(challenge.amount)) return { ok: false, reason: 'wrong_amount', message: 'receipt amount does not match challenge', expected: challenge.amount, actual: receipt.amount };
  if (receipt.currency !== challenge.currency) return { ok: false, reason: 'wrong_currency', message: 'receipt currency does not match challenge', expected: challenge.currency, actual: receipt.currency };
  if (receipt.nonce !== challenge.nonce) return { ok: false, reason: 'invalid_nonce', message: 'receipt nonce does not match challenge', expected: challenge.nonce, actual: receipt.nonce };
  return undefined;
}

/**
 * Converts a SOL amount to lamports without floating point multiplication, which
 * can land one lamport above the exact value (0.00051 SOL becomes 510000.00000000006,
 * which rounds up to 510001 and rejects an exact payment).
 * Returns undefined for anything that is not a positive amount with at most nine
 * decimal places.
 */
export function solAmountToLamports(amount: string | number): bigint | undefined {
  return decimalToBaseUnits(amount, 9);
}

function lamportsOf(value: unknown): bigint | undefined {
  if (typeof value === 'bigint') return value >= BigInt(0) ? value : undefined;
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : undefined;
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  return undefined;
}

function transactionHasSolTransfer(parsed: Record<string, unknown>, payer: string | undefined, payTo: string, amountSol: string | number): boolean {
  const lamports = solAmountToLamports(amountSol);
  if (lamports === undefined) return false;
  const instructions = parsedInstructions(parsed);
  return instructions.some((ix) => {
    const parsedInstruction = asRecord(ix.parsed);
    const info = asRecord(parsedInstruction?.info);
    const paid = lamportsOf(info?.lamports);
    return publicKeyText(ix.programId) === SystemProgram.programId.toBase58()
      && parsedInstruction?.type === 'transfer'
      && (!payer || info?.source === payer)
      && info?.destination === payTo
      && paid !== undefined
      && paid >= lamports;
  });
}

/**
 * Both legs of a fee-bearing SOL payment must be present as separate transfers:
 * the provider's share to the payee and the fee to the treasury. One transfer
 * cannot count for both.
 */
function transactionHasSolSplit(parsed: Record<string, unknown>, payer: string | undefined, payTo: string, split: FeeSplit): boolean {
  const transfers = parsedInstructions(parsed).map((ix) => {
    const parsedInstruction = asRecord(ix.parsed);
    const info = asRecord(parsedInstruction?.info);
    const paid = lamportsOf(info?.lamports);
    const isTransfer = publicKeyText(ix.programId) === SystemProgram.programId.toBase58()
      && parsedInstruction?.type === 'transfer'
      && (!payer || info?.source === payer)
      && paid !== undefined;
    return isTransfer ? { destination: info?.destination, paid: paid as bigint } : undefined;
  });
  const providerLeg = transfers.findIndex((t) => t !== undefined && t.destination === payTo && t.paid >= split.providerUnits);
  const feeLeg = transfers.findIndex((t, index) => index !== providerLeg && t !== undefined && t.destination === split.terms.payTo && t.paid >= split.feeUnits);
  return providerLeg !== -1 && feeLeg !== -1;
}

/** Raw base units moved by a parsed `transferChecked`, or undefined when they cannot be read exactly. */
function tokenTransferBaseUnits(info: Record<string, unknown>, decimals: number): bigint | undefined {
  const tokenAmount = asRecord(info.tokenAmount);
  if (!tokenAmount) return undefined;
  if (tokenAmount.decimals !== undefined && tokenAmount.decimals !== decimals) return undefined;
  if (typeof tokenAmount.amount === 'string' && /^\d+$/.test(tokenAmount.amount)) return BigInt(tokenAmount.amount);
  const ui = tokenAmount.uiAmountString;
  return typeof ui === 'string' ? decimalToBaseUnits(ui, decimals) : undefined;
}

/**
 * Both legs of a fee-bearing token payment must be present as separate
 * `transferChecked` instructions of the configured mint: the provider's share to
 * a token account the payee owns, and the fee to a token account the treasury owns.
 */
function transactionHasTokenSplit(parsed: Record<string, unknown>, receipt: X402PaymentReceipt, challenge: X402Challenge, mint: string, tokenProgram: string, split: FeeSplit): boolean {
  const legs = parsedInstructions(parsed).map((ix) => {
    const parsedInstruction = asRecord(ix.parsed);
    const info = asRecord(parsedInstruction?.info);
    if (!info || parsedInstruction?.type !== 'transferChecked') return undefined;
    if (!instructionIsFromTokenProgram(ix, tokenProgram)) return undefined;
    if (info.mint !== mint) return undefined;
    if (receipt.payer && info.authority && info.authority !== receipt.payer) return undefined;
    const units = tokenTransferBaseUnits(info, split.decimals);
    if (units === undefined || typeof info.destination !== 'string') return undefined;
    return { destination: info.destination, units };
  });
  const providerLeg = legs.findIndex((leg) => leg !== undefined
    && leg.units === split.providerUnits
    && (!receipt.destinationTokenAccount || leg.destination === receipt.destinationTokenAccount)
    && transactionTokenAccountOwnedBy(parsed, leg.destination, mint, challenge.payTo));
  const feeLeg = legs.findIndex((leg, index) => index !== providerLeg && leg !== undefined
    && leg.units === split.feeUnits
    && transactionTokenAccountOwnedBy(parsed, leg.destination, mint, split.terms.payTo));
  return providerLeg !== -1 && feeLeg !== -1;
}

/**
 * `mint` is the verifier's configured mint, never a value taken from the receipt.
 * Only `transferChecked` is accepted: it names its mint and carries a decimal-aware
 * amount, whereas a plain `transfer` names no mint and reports raw base units.
 */
/** True only when a parsed instruction names the token program the currency is issued under. */
function instructionIsFromTokenProgram(ix: Record<string, unknown>, tokenProgram: string): boolean {
  return publicKeyText(ix.programId) === tokenProgram;
}

function transactionHasTokenTransfer(parsed: Record<string, unknown>, receipt: X402PaymentReceipt, challenge: X402Challenge, mint: string, tokenProgram: string): boolean {
  const expectedAmount = String(challenge.amount);
  const instructions = parsedInstructions(parsed);

  return instructions.some((ix) => {
    const parsedInstruction = asRecord(ix.parsed);
    const info = asRecord(parsedInstruction?.info);
    if (!info || parsedInstruction?.type !== 'transferChecked') return false;
    if (!instructionIsFromTokenProgram(ix, tokenProgram)) return false;
    if (info.mint !== mint) return false;
    if (receipt.payer && info.authority && info.authority !== receipt.payer) return false;
    if (receipt.destinationTokenAccount && info.destination !== receipt.destinationTokenAccount) return false;

    const tokenAmountRecord = asRecord(info.tokenAmount);
    const tokenAmount = tokenAmountRecord?.uiAmountString ?? tokenAmountRecord?.uiAmount;
    if (String(tokenAmount) !== expectedAmount) return false;

    const destination = typeof info.destination === 'string' ? info.destination : receipt.destinationTokenAccount;
    if (!destination) return false;
    return transactionTokenAccountOwnedBy(parsed, destination, mint, challenge.payTo);
  });
}

function transactionTokenAccountOwnedBy(parsed: Record<string, unknown>, tokenAccount: string, mint: string | undefined, owner: string): boolean {
  const accountKeys = asArray(asRecord(asRecord(parsed.transaction)?.message)?.accountKeys);
  const postTokenBalances = asArray(asRecord(parsed.meta)?.postTokenBalances);
  if (!accountKeys || !postTokenBalances) return false;

  return postTokenBalances.some((item) => {
    const balance = asRecord(item);
    if (!balance) return false;
    if (balance.owner !== owner) return false;
    if (mint && balance.mint !== mint) return false;
    if (!Number.isSafeInteger(balance.accountIndex)) return false;
    const key = accountKeys[Number(balance.accountIndex)];
    const keyRecord = asRecord(key);
    const pubkey = typeof key === 'string' ? key : publicKeyText(keyRecord?.pubkey) ?? publicKeyText(key);
    return pubkey === tokenAccount;
  });
}

function parsedInstructions(parsed: Record<string, unknown>): Record<string, unknown>[] {
  return (asArray(asRecord(asRecord(parsed.transaction)?.message)?.instructions) ?? [])
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => item !== undefined);
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function publicKeyText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value === null || typeof value !== 'object') return undefined;
  const toString = (value as { toString?: unknown }).toString;
  if (typeof toString !== 'function' || toString === Object.prototype.toString) return undefined;
  const rendered = toString.call(value);
  return typeof rendered === 'string' ? rendered : undefined;
}

export interface SendPaymentOptions {
  swapClient?: SwapClient;
  slippageBps?: number;
}

/**
 * Send a payment via Solana SystemProgram.transfer.
 * In this package version, this remains a test stub; no funding transactions are submitted.
 */
export async function sendPayment(request: X402Request, options: SendPaymentOptions = {}): Promise<PaymentReceipt> {
  let swapMeta: PaymentReceipt['swap'];

  if (needsAutoSwap(request)) {
    if (!options.swapClient) throw new Error('token_mismatch_requires_swap_client');
    if (!request.payerAddress) throw new Error('payerAddress is required when autoSwap=true');

    const swapResult = await options.swapClient.swap({
      inputMint: resolveMint(request.payerCurrency || request.currency),
      outputMint: resolveMint(request.currency),
      amount: String(request.amount),
      userPublicKey: request.payerAddress,
      slippageBps: options.slippageBps ?? 50,
    });

    swapMeta = {
      performed: true,
      fromCurrency: request.payerCurrency,
      toCurrency: request.currency,
      orderId: swapResult.orderId,
      executeId: swapResult.executeId,
      inAmount: swapResult.inAmount,
      outAmount: swapResult.outAmount,
    };
  } else {
    swapMeta = {
      performed: false,
      fromCurrency: request.payerCurrency || request.currency,
      toCurrency: request.currency,
    };
  }

  return {
    txSignature: 'mock_tx_signature_' + Math.random().toString(36).substring(7),
    slot: Math.floor(Math.random() * 1000000),
    lamports: request.amount,
    nonce: request.nonce,
    settlementCurrency: request.currency,
    swap: swapMeta,
  };
}
