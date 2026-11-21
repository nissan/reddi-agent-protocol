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
import { type MeteredSettlement, type PerTokenPrice, type TokenCounts } from './metered';
import { type TokenEscrowTerms } from './token-escrow';
import type { NonceReplayStore, SolanaPaymentNetwork } from './types';
/** Output tokens assumed when the request sets no limit and the operator sets none. */
export declare const DEFAULT_MAX_OUTPUT_TOKENS = 1000;
/** The buyer's default maximum, as a multiple of the estimate. The buyer may raise it, never below the estimate. */
export declare const DEFAULT_MAX_CHARGE_MULTIPLE = 2;
/** What a reader of chain accounts returns. A `Connection` adapts to it. */
export type AccountReader = (address: PublicKey) => Promise<{
    owner: PublicKey;
    data: Uint8Array;
} | null>;
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
export declare function providerMeteredTerms(input: MeteredTermsInput): MeteredTerms;
/** About four characters a token, over every message. */
export declare function estimateInputTokens(messages: readonly {
    content: string;
}[]): number;
/** Output limit for this call: the request's own, held to the provider's. */
export declare function outputLimit(terms: MeteredTerms, requested?: number): number;
/** The estimate a call is quoted on: the input estimate plus the full output limit. */
export declare function meteredEstimate(terms: MeteredTerms, messages: readonly {
    content: string;
}[], requestedMaxTokens?: number): TokenCounts;
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
export declare function meteredOffer(terms: MeteredTerms, messages: readonly {
    content: string;
}[], requestedMaxTokens?: number, network?: SolanaPaymentNetwork): MeteredOffer;
export interface MeteredPaymentHeader {
    escrow: PublicKey;
    payer: PublicKey;
    nonce: Uint8Array;
}
/** A request's headers: a fetch `Headers`, or anything with the same `get`. */
export interface HeaderReader {
    get(name: string): string | null;
}
/** The metered receipt a buyer presents, or undefined when the header is not one. */
export declare function readMeteredPaymentHeader(headers: HeaderReader): MeteredPaymentHeader | {
    error: string;
} | undefined;
/** The value a buyer sends in `x402-payment` once its metered lock is confirmed. */
export declare function meteredPaymentHeaderValue(input: {
    payer: PublicKey;
    nonce: Uint8Array;
    programId: PublicKey;
}): string;
export type ClusterCheck = {
    ok: true;
} | {
    ok: false;
    reason: 'wrong_cluster' | 'payment_check_unavailable';
    message: string;
};
/**
 * Confirms the RPC endpoint serves the network the provider is configured
 * for, so a lock on another cluster is never taken as payment. Run it before
 * trusting any account the endpoint returns.
 */
export declare function checkProviderCluster(readGenesisHash: () => Promise<string>, network: SolanaPaymentNetwork, expectedGenesisHash?: string): Promise<ClusterCheck>;
export type VerifiedLock = {
    ok: true;
    terms: TokenEscrowTerms;
    maxBaseUnits: bigint;
    payer: PublicKey;
} | {
    ok: false;
    reason: string;
    message: string;
};
/**
 * Checks the lock on chain against this provider's terms: the escrow program,
 * the address the payer and nonce give, still locked, metered, payable to this
 * provider's token account in the accepted mint, and at least `minimum`.
 * The escrow is then remembered, so one lock pays for one call.
 */
export declare function verifyMeteredLock(input: {
    header: MeteredPaymentHeader;
    terms: MeteredTerms;
    minimum: bigint;
    readAccount: AccountReader;
    readSlot: SlotReader;
    replayStore: NonceReplayStore;
}): Promise<VerifiedLock>;
/** Token counts from an OpenAI-style usage report, or the estimate from the text when it reports none. */
export declare function usageFrom(upstream: Record<string, unknown>, inputEstimate: number): TokenCounts;
/**
 * The settle for the tokens used, never above the locked maximum. The unused
 * part goes to the buyer's associated token account, and the transaction first
 * creates it and the treasury's token account if either is missing, so a
 * closed source account or a treasury account not yet created cannot stop the
 * payout. The provider pays rent for anything it creates.
 */
export declare function meteredSettlement(terms: MeteredTerms, lock: Extract<VerifiedLock, {
    ok: true;
}>, usage: TokenCounts): {
    settlement: MeteredSettlement;
    instruction: TransactionInstruction;
    instructions: TransactionInstruction[];
};
/**
 * Declines a verified lock the provider will not serve, for example when the
 * model failed before any work was done: the payee may refund the whole
 * amount to the payer at any time. Returns the instruction for the operator
 * to sign with the provider wallet.
 */
export declare function meteredDecline(terms: MeteredTerms, lock: Extract<VerifiedLock, {
    ok: true;
}>): TransactionInstruction;
