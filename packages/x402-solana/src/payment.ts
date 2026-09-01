import { LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js';
import { needsAutoSwap, resolveMint, SwapClient } from './jupiter';
import { SPL_TOKEN_PROGRAM_ID, verifySplTransferCheckedObservation } from './spl-token-observer';
import { X402Request, PaymentReceipt } from './types';
import type {
  NonceReplayStore,
  ReceiptVerificationResult,
  ReceiptVerifier,
  SolanaPaymentNetwork,
  X402Challenge,
  X402ChallengeInput,
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

export function buildX402Challenge(input: X402ChallengeInput): X402Challenge {
  if (!SUPPORTED_NETWORKS.includes(input.network)) throw new Error(`unsupported Solana network: ${input.network}`);
  if (!isValidSolanaPublicKey(input.payTo)) throw new Error('payTo must be a valid Solana public key');
  if (!input.nonce || typeof input.nonce !== 'string') throw new Error('nonce is required');
  if (!input.currency || typeof input.currency !== 'string') throw new Error('currency is required');
  if (String(input.amount).length === 0 || Number(input.amount) <= 0) throw new Error('amount must be positive');
  if (!input.endpoint || typeof input.endpoint !== 'string') throw new Error('endpoint is required');
  return { version: input.version ?? '1', ...input };
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
  } catch (e: any) {
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
  getParsedTransaction(signature: string, options?: unknown): Promise<any>;
}

export interface SolanaReceiptVerifierOptions {
  allowRealPayment: boolean;
  connection: ParsedTransactionConnection;
  /** Required when verifying USDC/SPL-token receipts. */
  usdcMint?: string;
  /** Required when verifying AUDD x402 v2 SVM exact receipts. */
  auddMint?: string;
  /** Defaults to the legacy SPL Token program for AUDD exact receipts. */
  auddTokenProgram?: string;
}

export class SolanaReceiptVerifier implements ReceiptVerifier {
  constructor(private readonly options: SolanaReceiptVerifierOptions) {}

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

    const parsed = await this.options.connection.getParsedTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    if (!parsed?.meta || parsed.meta.err) return { ok: false, reason: 'invalid_receipt', message: 'transaction is missing or failed' };

    const unpaid = await this.challengePaymentFailure(parsed, receipt, challenge, signature);
    if (unpaid) return unpaid;

    if (replayStore) {
      const accepted = await replayStore.checkAndStore(receipt.nonce);
      if (!accepted) return { ok: false, reason: 'duplicate_nonce', message: 'receipt nonce has already been used', actual: receipt.nonce };
    }
    return { ok: true, receipt, demo: false };
  }

  /** Returns a failure result when the parsed transaction does not settle the challenge, otherwise undefined. */
  private async challengePaymentFailure(
    parsed: any,
    receipt: X402PaymentReceipt,
    challenge: X402Challenge,
    signature: string,
  ): Promise<ReceiptVerificationResult | undefined> {
    if (challenge.currency === 'SOL') {
      return transactionHasSolTransfer(parsed, receipt.payer, challenge.payTo, Number(challenge.amount))
        ? undefined
        : unsatisfiedChallenge();
    }
    if (challenge.currency === 'USDC') {
      return transactionHasTokenTransfer(parsed, receipt, challenge, this.options.usdcMint)
        ? undefined
        : unsatisfiedChallenge();
    }
    if (challenge.currency === 'AUDD') {
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

function transactionHasSolTransfer(parsed: any, payer: string | undefined, payTo: string, amountSol: number): boolean {
  const lamports = Math.ceil(amountSol * LAMPORTS_PER_SOL);
  return parsed.transaction?.message?.instructions?.some((ix: any) => {
    const info = ix?.parsed?.info;
    return ix?.programId?.toString?.() === SystemProgram.programId.toBase58()
      && ix?.parsed?.type === 'transfer'
      && (!payer || info?.source === payer)
      && info?.destination === payTo
      && Number(info?.lamports) >= lamports;
  }) === true;
}

function transactionHasTokenTransfer(parsed: any, receipt: X402PaymentReceipt, challenge: X402Challenge, expectedMint?: string): boolean {
  if (!expectedMint && !receipt.mint) return false;
  const mint = expectedMint ?? receipt.mint;
  const expectedAmount = String(challenge.amount);
  const instructions = parsed.transaction?.message?.instructions;
  if (!Array.isArray(instructions)) return false;

  return instructions.some((ix: any) => {
    const info = ix?.parsed?.info;
    if (!info || !['transfer', 'transferChecked'].includes(ix?.parsed?.type)) return false;
    if (info.mint && info.mint !== mint) return false;
    if (receipt.payer && info.authority && info.authority !== receipt.payer) return false;
    if (receipt.destinationTokenAccount && info.destination !== receipt.destinationTokenAccount) return false;

    const tokenAmount = info.tokenAmount?.uiAmountString ?? info.tokenAmount?.uiAmount ?? info.amount;
    if (String(tokenAmount) !== expectedAmount) return false;

    const destination = typeof info.destination === 'string' ? info.destination : receipt.destinationTokenAccount;
    if (!destination) return false;
    return transactionTokenAccountOwnedBy(parsed, destination, mint, challenge.payTo);
  });
}

function transactionTokenAccountOwnedBy(parsed: any, tokenAccount: string, mint: string | undefined, owner: string): boolean {
  const accountKeys = parsed.transaction?.message?.accountKeys;
  const postTokenBalances = parsed.meta?.postTokenBalances;
  if (!Array.isArray(accountKeys) || !Array.isArray(postTokenBalances)) return false;

  return postTokenBalances.some((balance: any) => {
    if (balance?.owner !== owner) return false;
    if (mint && balance?.mint !== mint) return false;
    const key = accountKeys[balance?.accountIndex];
    const pubkey = typeof key === 'string' ? key : key?.pubkey?.toString?.() ?? key?.toString?.();
    return pubkey === tokenAccount;
  });
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
