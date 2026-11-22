import { SwapClient } from './jupiter';
import { X402Request, PaymentReceipt } from './types';
import type { NonceReplayStore, PayerProofCheck, ProtocolFeeConfig, ReceiptVerificationResult, ReceiptVerifier, SolanaPaymentNetwork, X402Challenge, X402ChallengeInput, X402FeeTerms } from './types';
/**
 * Strictly validate canonical Solana public-key text.
 * Requires base58 decode to exactly 32 bytes and round-trips to the same string.
 */
export declare function isValidSolanaPublicKey(address: string): boolean;
/** Backwards-compatible alias for older callers. */
export declare const isValidPaymentAddress: typeof isValidSolanaPublicKey;
/** Standard protocol fee rate: 500 basis points, which is 5% of the price paid. */
export declare const PROTOCOL_FEE_BPS = 500;
/** Launch rate: 250 basis points (2.5%) for payments made before LAUNCH_RATE_ENDS_AT_MS. */
export declare const LAUNCH_PROTOCOL_FEE_BPS = 250;
/**
 * 2027-04-01T00:00:00Z in milliseconds. The escrow program holds the same
 * instant (LAUNCH_RATE_ENDS_UNIX, in seconds) and reads it at payout.
 */
export declare const LAUNCH_RATE_ENDS_AT_MS = 1806537600000;
/** Either side of the switch, how long a payment may still be checked at the other rate (block times and clocks drift). */
export declare const FEE_RATE_SWITCH_GRACE_MS: number;
/** The protocol fee rate in force at `atMs` (milliseconds since the epoch). */
export declare function protocolFeeBpsAt(atMs?: number): number;
/**
 * The rates a payment made around `atMs` may carry: the rate then, plus the
 * other rate within FEE_RATE_SWITCH_GRACE_MS of the switch. With no time
 * known, both.
 */
export declare function protocolFeeBpsNear(atMs?: number | null): number[];
/** Ceiling on the protocol fee for a SOL payment: 0.1 SOL. Token payments have no ceiling. */
export declare const SOL_PROTOCOL_FEE_CAP_LAMPORTS: bigint;
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
export declare const DIRECT_PAYMENT_CURRENCIES: Readonly<Record<string, DirectPaymentCurrency>>;
/** Looks up a direct payment currency without reading inherited object keys. */
export declare function directPaymentCurrency(currency: string): DirectPaymentCurrency | undefined;
/**
 * Mainnet mint addresses, read on-chain on 20 November 2026. Reference values
 * for operator configuration; nothing in this package uses them by default.
 */
export declare const MAINNET_STABLECOIN_MINTS: Readonly<{
    USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    AUDD: "AUDDttiEpCydTm7joUMbYddm72jAWXZnCpPZtDoxqBSw";
    PYUSD: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo";
    USDG: "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH";
}>;
/**
 * Converts a decimal amount to whole base units without floating point
 * multiplication. Returns undefined for anything that is not a positive amount
 * with at most `decimals` decimal places.
 */
export declare function decimalToBaseUnits(amount: string | number, decimals: number): bigint | undefined;
/** Renders whole base units as a decimal string with no trailing zeros. */
export declare function baseUnitsToDecimal(units: bigint, decimals: number): string;
/**
 * Fee in base units: the price times the rate, rounded down, never above
 * `capBaseUnits` when one is given. There is no minimum fee.
 */
export declare function protocolFeeBaseUnits(priceBaseUnits: bigint, bps?: number, capBaseUnits?: bigint): bigint;
/** Fee ceiling for a currency in its base units: 0.1 SOL for SOL, none for tokens. */
export declare function protocolFeeCapBaseUnits(currency: string): bigint | undefined;
/** Fee terms for a listed price, as a challenge states them. Throws on an unusable amount, currency or configuration. */
export declare function protocolFeeTerms(amount: string | number, currency: string, payTo: string, config: ProtocolFeeConfig): X402FeeTerms;
export interface BuildX402ChallengeOptions {
    /** When set, the challenge states the fee split. Comes from operator configuration only. */
    protocolFee?: ProtocolFeeConfig;
}
export declare function buildX402Challenge(input: X402ChallengeInput, options?: BuildX402ChallengeOptions): X402Challenge;
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
    /**
     * Whether the request presenting a receipt must prove it comes from the
     * wallet that paid. Defaults to `'required'`: a confirmed transfer is public,
     * so anyone who sees it could otherwise present it first and be served,
     * leaving the buyer refused as a duplicate. A provider passes a check built by
     * `directPaymentProofCheck` to `verifyReceipt`. `'not-required'` is only for a
     * verifier that serves nothing, such as a job ledger checking a receipt after
     * the call.
     */
    payerProof?: 'required' | 'not-required';
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
    verifyReceipt(receiptInput: unknown, challenge: X402Challenge, replayStore?: NonceReplayStore, payerProof?: PayerProofCheck): Promise<ReceiptVerificationResult>;
    /**
     * Works out the fee split this verifier requires for a challenge, from its own
     * configuration. Fee terms printed in the challenge are only compared against
     * that, so a challenge cannot lower the fee or redirect it.
     */
    private feeSplitFor;
    /** Returns a failure result when the parsed transaction does not settle the challenge, otherwise undefined. */
    private challengePaymentFailure;
}
/** Replay key for a settled transaction; namespaced so it cannot collide with a caller-chosen nonce. */
export declare function transactionReplayKey(network: string, signature: string): string;
/** Longest receipt nonce accepted, so every namespaced key fits the replay ledger's 300-character limit. */
export declare const MAX_RECEIPT_NONCE_LENGTH = 128;
/** True for a nonce of 1 to 128 characters from letters, digits and `. _ : ~ -`. */
export declare function isValidReceiptNonce(nonce: unknown): nonce is string;
/** Replay key for a real payment's challenge nonce, scoped to the network and payee. */
export declare function nonceReplayKey(network: string, payTo: string, nonce: string): string;
/** Replay key for a demo receipt's nonce; demo keys never share a namespace with real payments. */
export declare function demoNonceReplayKey(nonce: string): string;
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
