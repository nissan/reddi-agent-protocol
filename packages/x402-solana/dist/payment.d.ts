import { SwapClient } from './jupiter';
import { X402Request, PaymentReceipt } from './types';
import type { NonceReplayStore, ReceiptVerificationResult, ReceiptVerifier, SolanaPaymentNetwork, X402Challenge, X402ChallengeInput } from './types';
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
    getParsedTransaction(signature: string, options?: unknown): Promise<unknown>;
    /** Used to confirm the RPC endpoint serves the network the challenge names. */
    getGenesisHash?(): Promise<string>;
}
/** Genesis hashes of the public Solana clusters. */
export declare const SOLANA_GENESIS_HASHES: Record<SolanaPaymentNetwork, string>;
/** Default limit on how old a payment transaction may be when it is presented. */
export declare const DEFAULT_MAX_TRANSACTION_AGE_SECONDS = 900;
export interface SolanaReceiptVerifierOptions {
    allowRealPayment: boolean;
    connection: ParsedTransactionConnection;
    /** Required when verifying USDC/SPL-token receipts. */
    usdcMint?: string;
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
}
export declare class SolanaReceiptVerifier implements ReceiptVerifier {
    private readonly options;
    private verifiedGenesisHash?;
    constructor(options: SolanaReceiptVerifierOptions);
    /**
     * Confirms the RPC endpoint serves the challenged network, so a transaction from
     * a cheaper cluster cannot settle a challenge for another. Always enforced on
     * solana-mainnet-beta against the public genesis hash. On other networks it runs
     * only when expectedGenesisHash is set, so local validators keep working.
     * A successful answer is remembered; a failure is asked again.
     */
    private clusterFailure;
    /** Refuses a transaction older than the configured limit, or one with no usable block time when a limit applies. */
    private ageFailure;
    verifyReceipt(receiptInput: unknown, challenge: X402Challenge, replayStore?: NonceReplayStore): Promise<ReceiptVerificationResult>;
    /** Returns a failure result when the parsed transaction does not settle the challenge, otherwise undefined. */
    private challengePaymentFailure;
}
/** Replay key for a settled transaction; namespaced so it cannot collide with a caller-chosen nonce. */
export declare function transactionReplayKey(network: string, signature: string): string;
/**
 * Converts a SOL amount to lamports without floating point multiplication, which
 * can land one lamport above the exact value (0.00051 SOL becomes 510000.00000000006,
 * which rounds up to 510001 and rejects an exact payment).
 * Returns undefined for anything that is not a positive amount with at most nine
 * decimal places.
 */
export declare function solAmountToLamports(amount: string | number): bigint | undefined;
export interface SendPaymentOptions {
    swapClient?: SwapClient;
    slippageBps?: number;
}
/**
 * Send a payment via Solana SystemProgram.transfer.
 * In this package version, this remains a test stub; no funding transactions are submitted.
 */
export declare function sendPayment(request: X402Request, options?: SendPaymentOptions): Promise<PaymentReceipt>;
