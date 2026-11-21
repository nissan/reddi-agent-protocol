/**
 * x402 payment request parsed from HTTP header.
 * Amount is represented as the smallest payment unit for the declared currency.
 */
export interface X402Request {
  amount: number;
  currency: string;
  paymentAddress: string;
  nonce: string;
  network?: SolanaPaymentNetwork;
  endpoint?: string;
  memo?: string;
  payerCurrency?: string;
  payerAddress?: string;
  autoSwap?: boolean;
}

export type SolanaPaymentNetwork = 'solana-devnet' | 'solana-mainnet-beta' | 'solana-testnet';

export interface X402ChallengeInput {
  version?: string;
  network: SolanaPaymentNetwork;
  payTo: string;
  amount: string | number;
  currency: string;
  endpoint: string;
  nonce: string;
  memo?: string;
}

/**
 * Protocol fee stated in a challenge so the buyer sees the split before paying.
 * The fee comes out of the listed amount: the buyer pays `amount` in total, the
 * provider receives `providerAmount` and `payTo` (the treasury) receives `amount`
 * of this block. Amounts are decimal strings in the challenge currency.
 */
export interface X402FeeTerms {
  /** Fee rate in basis points of the listed amount. */
  bps: number;
  /** Treasury owner address that receives the fee. */
  payTo: string;
  /** Fee, rounded down to the currency's smallest unit. "0" when the price is too small to yield one unit. */
  amount: string;
  /** What the provider receives: listed amount minus the fee. */
  providerAmount: string;
  /** Fee ceiling in the challenge currency, when there is one (0.1 for SOL). */
  cap?: string;
}

/** Operator configuration for the protocol fee. Never taken from a buyer or a provider. */
export interface ProtocolFeeConfig {
  /** Treasury owner address. */
  treasury: string;
  /** Fee rate in basis points. Defaults to PROTOCOL_FEE_BPS. */
  bps?: number;
}

export interface X402Challenge extends X402ChallengeInput {
  version: string;
  fee?: X402FeeTerms;
}

/**
 * Receipt shape used by specialist-side verifiers. This package deliberately
 * does not require secrets or submit transactions.
 */
export interface X402PaymentReceipt {
  network: SolanaPaymentNetwork;
  payTo: string;
  amount: string | number;
  currency: string;
  nonce: string;
  signature?: string;
  txSignature?: string;
  payer?: string;
  mint?: string;
  destinationTokenAccount?: string;
  demo?: boolean;
}

/**
 * Payment receipt after successful SOL transfer.
 */
export interface PaymentReceipt {
  txSignature: string;
  slot: number;
  lamports: number;
  nonce: string;
  settlementCurrency?: string;
  swap?: {
    performed: boolean;
    fromCurrency?: string;
    toCurrency?: string;
    orderId?: string;
    executeId?: string;
    inAmount?: string;
    outAmount?: string;
  };
}

export type ReceiptVerificationFailureReason =
  | 'invalid_receipt'
  | 'invalid_payee'
  | 'invalid_nonce'
  | 'duplicate_nonce'
  | 'wrong_amount'
  | 'wrong_currency'
  | 'wrong_payee'
  | 'wrong_network'
  | 'demo_payment_disabled'
  | 'unsupported_receipt'
  | 'payer_proof_required'
  | 'payer_proof_invalid'
  | 'payer_proof_expired';

/** The payment a direct receipt proved, handed to a payer-proof check. */
export interface ProvenDirectPayment {
  network: SolanaPaymentNetwork;
  txSignature: string;
  /** The wallet that signed the transaction and moved the funds. */
  payer: string;
  payTo: string;
}

/**
 * Checks that the request presenting a direct receipt comes from the wallet
 * that paid. `directPaymentProofCheck` builds one from the request's headers
 * and raw body.
 */
export type PayerProofCheck = (paid: ProvenDirectPayment) =>
  | { ok: true }
  | { ok: false; reason: 'payer_proof_required' | 'payer_proof_invalid' | 'payer_proof_expired'; message: string }
  | Promise<{ ok: true } | { ok: false; reason: 'payer_proof_required' | 'payer_proof_invalid' | 'payer_proof_expired'; message: string }>;

export type ReceiptVerificationResult =
  | { ok: true; receipt: X402PaymentReceipt; demo: boolean; fee?: X402FeeTerms }
  | {
      ok: false;
      reason: ReceiptVerificationFailureReason;
      message: string;
      expected?: unknown;
      actual?: unknown;
    };

export interface NonceReplayStore {
  checkAndStore(nonce: string): boolean | Promise<boolean>;
}

export interface ReceiptVerifier {
  verifyReceipt(receipt: unknown, challenge: X402Challenge, replayStore?: NonceReplayStore, payerProof?: PayerProofCheck): Promise<ReceiptVerificationResult>;
}

/**
 * x402 error codes.
 */
export type X402Error =
  | 'insufficient_funds'
  | 'duplicate_nonce'
  | 'invalid_request'
  | 'rpc_timeout'
  | 'unauthorized';
