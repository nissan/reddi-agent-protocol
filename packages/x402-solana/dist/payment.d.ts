import { SwapClient } from './jupiter';
import { X402Request, PaymentReceipt } from './types';
import type { NonceReplayStore, ReceiptVerificationResult, ReceiptVerifier, X402Challenge, X402ChallengeInput } from './types';
/**
 * Strictly validate canonical Solana public-key text.
 * Requires base58 decode to exactly 32 bytes and round-trips to the same string.
 */
export declare function isValidSolanaPublicKey(address: string): boolean;
/** Backwards-compatible alias for older callers. */
export declare const isValidPaymentAddress: typeof isValidSolanaPublicKey;
export declare function buildX402Challenge(input: X402ChallengeInput): X402Challenge;
/**
 * Parse x402-request header into structured request.
 * Expected format: JSON string with amount, currency, paymentAddress, nonce.
 * @throws Error if header is invalid.
 */
export declare function parseX402Header(header: string): X402Request;
export declare function parseX402PaymentHeader(header: string): unknown;
export declare function verifyDemoPaymentReceipt(input: {
    receipt: unknown;
    challenge: X402Challenge;
    allowDemoPayment: boolean;
    replayStore?: NonceReplayStore;
}): Promise<ReceiptVerificationResult>;
export declare class DemoPaymentVerifier implements ReceiptVerifier {
    private readonly allowDemoPayment;
    constructor(allowDemoPayment: boolean);
    verifyReceipt(receipt: unknown, challenge: X402Challenge, replayStore?: NonceReplayStore): Promise<ReceiptVerificationResult>;
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
export declare class SolanaReceiptVerifier implements ReceiptVerifier {
    private readonly options;
    constructor(options: SolanaReceiptVerifierOptions);
    verifyReceipt(receiptInput: unknown, challenge: X402Challenge, replayStore?: NonceReplayStore): Promise<ReceiptVerificationResult>;
    private receiptSatisfiesChallenge;
}
export interface SendPaymentOptions {
    swapClient?: SwapClient;
    slippageBps?: number;
}
/**
 * Send a payment via Solana SystemProgram.transfer.
 * In this package version, this remains a test stub; no funding transactions are submitted.
 */
export declare function sendPayment(request: X402Request, options?: SendPaymentOptions): Promise<PaymentReceipt>;
