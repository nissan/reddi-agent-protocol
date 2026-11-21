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
/**
 * What a reader of chain accounts returns. A `Connection` adapts to it. Read
 * at `confirmed` commitment or better: a buyer can opt an escrow in to rating
 * only in the slot of the lock, so a read that sees that whole slot tells for
 * good whether the job is rated, and a `processed` read may not.
 */
export type AccountReader = (address: PublicKey) => Promise<{
    owner: PublicKey;
    data: Uint8Array;
} | null>;
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
export type PayoutCheck = {
    ok: true;
    payout: PayoutAccounts;
} | {
    ok: false;
    reason: 'refund_account_unusable' | 'provider_not_ready' | 'payment_check_unavailable';
    message: string;
};
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
export declare function checkMeteredPayout(input: {
    terms: MeteredTerms;
    escrow: Pick<TokenEscrowTerms, 'payer' | 'source' | 'recipient'>;
    readAccount: AccountReader;
    treasury?: PublicKey;
    allowPayerAssociatedAccount?: boolean;
    createRefundAccount?: boolean;
}): Promise<PayoutCheck>;
export type VerifiedLock = {
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
    /**
     * For a rated lock, the rating account's `opened_slot` as read with the
     * lock: the job this provider verified. The settle and the decline name
     * it, so they are refused (6051) if another job has taken the address by
     * then. Undefined for a lock that is not rated.
     */
    openedSlot?: bigint;
    /** The slot the lock was made in. The buyer may refund from `createdSlot + terms.cancelWindowSlots`. */
    createdSlot: bigint;
} | {
    ok: false;
    reason: string;
    message: string;
};
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
export declare function verifyMeteredLock(input: {
    header: MeteredPaymentHeader;
    terms: MeteredTerms;
    minimum: bigint;
    readAccount: AccountReader;
    readSlot: SlotReader;
    /** Unused for `session-call` and `session-settle`. */
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
    /**
     * What the lock is checked for. `call` (the default): one call, and the
     * escrow is remembered so it pays for no other. `session-call`: a call of a
     * session (`MeteredSessionLedger`), which itself claims the escrow and orders
     * the calls, so nothing is remembered here; a refund window too short for
     * another call is reported as `session_window_closing`. `session-settle`:
     * reading the lock back to settle a session's calls already served, so
     * neither the refund window left nor the replay store is consulted; every
     * other check still applies.
     */
    purpose?: 'call' | 'session-call' | 'session-settle';
}): Promise<VerifiedLock>;
/** The replay-store key that marks an escrow as taken, by a single call or by a session's first call. */
export declare function meteredEscrowReplayKey(escrow: PublicKey): string;
/** Token counts from an OpenAI-style usage report, or the estimate from the text when it reports none. */
export declare function usageFrom(upstream: Record<string, unknown>, inputEstimate: number): TokenCounts;
/**
 * The settle for the tokens used, never above the locked maximum. It pays
 * into the accounts checked with the lock (`lock.payout`), or into `payout`
 * when the caller has checked them again. Nothing is created unless that
 * check chose to create the buyer's token account. The settle of a rated
 * lock carries the escrow's rating account after the usual accounts and the
 * job's opened slot (`lock.openedSlot`) after its data; for a lock that is
 * not rated the instruction is unchanged.
 */
export declare function meteredSettlement(terms: MeteredTerms, lock: Extract<VerifiedLock, {
    ok: true;
}>, usage: TokenCounts, payout?: PayoutAccounts): {
    settlement: MeteredSettlement;
    instruction: TransactionInstruction;
    instructions: TransactionInstruction[];
};
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
export type ConfirmedSettlement = {
    ok: true;
    /** What left the lock for the provider and the treasury together: the amount billed. */
    paidBaseUnits: bigint;
    feeBaseUnits: bigint;
    providerBaseUnits: bigint;
    /** The buyer's own unused part: the maximum less the amount billed. */
    refundedBaseUnits: bigint;
    /** Anything returned to the buyer above that, for example tokens someone else sent to the vault. */
    surplusBaseUnits: bigint;
} | {
    ok: false;
    reason: 'not_found' | 'failed' | 'wrong_transaction' | 'amounts_do_not_add_up';
};
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
export declare function confirmMeteredSettlement(record: SettlementRecord | null, expected: {
    programId: PublicKey;
    escrow: PublicKey;
    mint: PublicKey;
    destination: PublicKey;
    treasuryToken: PublicKey;
    refundTo: PublicKey;
    maxBaseUnits: bigint;
    rating?: PublicKey;
}): ConfirmedSettlement;
/**
 * Declines a verified lock the provider will not serve, for example when the
 * model failed before any work was done: the payee may refund the whole
 * amount to the payer at any time. The program sends a decline to the source
 * account the lock recorded, which the lock check found usable. Returns the
 * instruction for the operator to sign with the provider wallet. The decline
 * of a rated lock carries the rating account, which the program closes: a
 * job that was not paid is not rated.
 */
export declare function meteredDecline(terms: MeteredTerms, lock: Extract<VerifiedLock, {
    ok: true;
}>): TransactionInstruction;
/** The rating account a rated lock's settle and decline carry, or undefined for a lock that is not rated. */
export declare function meteredRatingAccount(lock: Extract<VerifiedLock, {
    ok: true;
}>): PublicKey | undefined;
