import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { buildDirectPaymentInstructions } from './direct-payment';
import { decimalToBaseUnits, isValidSolanaPublicKey, PROTOCOL_FEE_BPS } from './payment';
import type { SolanaPaymentNetwork, X402Challenge, X402FeeTerms, X402PaymentReceipt } from './types';

const BUYER_CURRENCY_DECIMALS: Record<string, number> = { SOL: 9, USDC: 6 };
const NETWORKS: SolanaPaymentNetwork[] = ['solana-devnet', 'solana-mainnet-beta', 'solana-testnet'];

/** What the buyer chose to buy, taken from the listing they selected, never from the challenge. */
export interface BuyerListing {
  /** Provider wallet named on the listing. */
  payTo: string;
  /** Listed price per call, as a decimal amount of `currency`. */
  amount: string | number;
  currency: string;
}

export interface BuyerDirectPaymentInput {
  /** Raw `x402-request` header value from the provider's 402 response, or an already parsed object. */
  challenge: unknown;
  listing: BuyerListing;
  /** Network the buyer's wallet is connected to. */
  network: SolanaPaymentNetwork;
  /** Most the buyer will pay for this call, as a decimal amount of the listing currency. */
  spendCap: string | number;
  payer: PublicKey;
  /** Required for USDC: the buyer's own configured mint. */
  usdcMint?: PublicKey;
  payerTokenAccount?: PublicKey;
  /** Highest fee rate the buyer accepts. Defaults to PROTOCOL_FEE_BPS. */
  maxFeeBps?: number;
}

export type BuyerPaymentRefusalReason =
  | 'invalid_challenge'
  | 'wrong_network'
  | 'wrong_payee'
  | 'wrong_currency'
  | 'price_above_listing'
  | 'above_spend_cap'
  | 'fee_terms_rejected';

export type BuyerDirectPaymentPlan =
  | {
      ok: true;
      challenge: X402Challenge;
      instructions: TransactionInstruction[];
      /** Everything the buyer pays for the call, in base units. Equals the challenge amount. */
      totalBaseUnits: bigint;
      fee?: X402FeeTerms;
      /** Builds the receipt to send back once the wallet has signed and the transaction is confirmed. */
      receiptFor(signature: string): X402PaymentReceipt;
    }
  | { ok: false; reason: BuyerPaymentRefusalReason; message: string };

function refuse(reason: BuyerPaymentRefusalReason, message: string): BuyerDirectPaymentPlan {
  return { ok: false, reason, message };
}

/** Reads a provider challenge without trusting its shape. Returns undefined when a required field is missing or mistyped. */
export function parseX402Challenge(value: unknown): X402Challenge | undefined {
  let candidate: unknown = value;
  if (typeof value === 'string') {
    try {
      candidate = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
  const c = candidate as Record<string, unknown>;
  const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
  if (!isText(c.network) || !NETWORKS.includes(c.network as SolanaPaymentNetwork)) return undefined;
  if (!isText(c.payTo) || !isValidSolanaPublicKey(c.payTo)) return undefined;
  if (!isText(c.currency) || !isText(c.nonce) || !isText(c.endpoint)) return undefined;
  if (typeof c.amount !== 'string' && typeof c.amount !== 'number') return undefined;
  if (c.memo !== undefined && typeof c.memo !== 'string') return undefined;
  let fee: X402FeeTerms | undefined;
  if (c.fee !== undefined) {
    const f = c.fee as Record<string, unknown> | null;
    if (!f || typeof f !== 'object') return undefined;
    if (typeof f.bps !== 'number' || !Number.isInteger(f.bps) || f.bps < 0) return undefined;
    if (!isText(f.payTo) || !isValidSolanaPublicKey(f.payTo)) return undefined;
    if (!isText(f.amount) || !isText(f.providerAmount)) return undefined;
    fee = { bps: f.bps, payTo: f.payTo, amount: f.amount, providerAmount: f.providerAmount };
  }
  const challenge: X402Challenge = {
    version: isText(c.version) ? c.version : '1',
    network: c.network as SolanaPaymentNetwork,
    payTo: c.payTo,
    amount: c.amount,
    currency: c.currency,
    endpoint: c.endpoint,
    nonce: c.nonce,
  };
  if (typeof c.memo === 'string') challenge.memo = c.memo;
  if (fee) challenge.fee = fee;
  return challenge;
}

/**
 * Decides whether a buyer should pay a provider's challenge, and if so builds
 * the payment instructions. Every check runs before any instruction exists:
 * the challenge must name the wallet's network, the provider and currency of
 * the listing the buyer selected, a price no higher than the listed price and
 * the buyer's spend cap, and fee terms that add up at an accepted rate.
 *
 * This signs nothing and sends nothing. The wallet does both.
 */
export function planBuyerDirectPayment(input: BuyerDirectPaymentInput): BuyerDirectPaymentPlan {
  const challenge = parseX402Challenge(input.challenge);
  if (!challenge) return refuse('invalid_challenge', 'the provider challenge is missing a required field or is not valid');

  if (challenge.network !== input.network) {
    return refuse('wrong_network', `the challenge is for ${challenge.network} but the wallet is on ${input.network}`);
  }
  if (challenge.payTo !== input.listing.payTo) {
    return refuse('wrong_payee', 'the challenge pays a different wallet from the selected listing');
  }
  if (challenge.currency !== input.listing.currency) {
    return refuse('wrong_currency', `the challenge asks for ${challenge.currency} but the listing is priced in ${input.listing.currency}`);
  }
  const decimals = BUYER_CURRENCY_DECIMALS[challenge.currency];
  if (decimals === undefined) return refuse('wrong_currency', `direct payment in ${challenge.currency} is not supported`);

  const price = decimalToBaseUnits(challenge.amount, decimals);
  const listed = decimalToBaseUnits(input.listing.amount, decimals);
  const cap = decimalToBaseUnits(input.spendCap, decimals);
  if (price === undefined) return refuse('invalid_challenge', 'the challenge amount is not a valid positive amount');
  if (listed === undefined) return refuse('price_above_listing', 'the selected listing has no valid price to compare against');
  if (cap === undefined) return refuse('above_spend_cap', 'a spend cap greater than zero is required');
  if (price > listed) return refuse('price_above_listing', 'the challenge asks for more than the listed price');
  if (price > cap) return refuse('above_spend_cap', 'the challenge asks for more than the spend cap');

  let instructions: TransactionInstruction[];
  try {
    instructions = buildDirectPaymentInstructions({
      challenge,
      payer: input.payer,
      usdcMint: input.usdcMint,
      payerTokenAccount: input.payerTokenAccount,
      maxFeeBps: input.maxFeeBps ?? PROTOCOL_FEE_BPS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'payment instructions could not be built';
    return refuse(/fee/.test(message) ? 'fee_terms_rejected' : 'invalid_challenge', message);
  }

  const payer = input.payer.toBase58();
  const mint = challenge.currency === 'USDC' ? input.usdcMint?.toBase58() : undefined;
  return {
    ok: true,
    challenge,
    instructions,
    totalBaseUnits: price,
    fee: challenge.fee,
    receiptFor(signature: string): X402PaymentReceipt {
      if (!signature || /^mock_/i.test(signature)) throw new Error('a real transaction signature is required');
      const receipt: X402PaymentReceipt = {
        network: challenge.network,
        payTo: challenge.payTo,
        amount: challenge.amount,
        currency: challenge.currency,
        nonce: challenge.nonce,
        signature,
        payer,
      };
      if (mint) receipt.mint = mint;
      return receipt;
    },
  };
}
