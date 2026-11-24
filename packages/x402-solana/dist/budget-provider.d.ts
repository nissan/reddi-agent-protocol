/**
 * Pooled budget, provider side: what a provider checks before it joins a
 * budget and before it serves a call paid from one (see `./budget` for the
 * accounts and instructions).
 *
 * The flow, for a provider:
 *
 * 1. A call with no payment is answered 402 with a `PooledBudgetOffer`: the
 *    provider's mint, its price, the slice it wants reserved and the judges
 *    it accepts.
 * 2. The agent's spender key builds `reserve` for that slice, signs it as the
 *    second signer and sends the transaction in `x402-budget-reserve`. The
 *    provider reads the budget, checks it (`checkPooledBudgetForProvider`),
 *    checks the transaction is exactly that reserve and nothing else
 *    (`checkReserveTransaction`), then signs it as payee and fee payer and
 *    sends it. It pays the fee and the slice's rent, which come back when the
 *    slice closes.
 * 3. Every call names the budget instance and a call number in `x402-budget`
 *    and carries the spender's signature over the request in
 *    `x402-budget-signature` (`verifyPooledBudgetRequest`). The spender is a
 *    key the agent holds, so it signs each call itself: no session key.
 * 4. Calls are metered against the slice off chain. The provider posts what
 *    it is owed once, when the budget closes or the calls stop, and is paid
 *    after the dispute window (`disputeEnds`) or at once when the payer
 *    waives.
 *
 * V1 rule: a provider joins only a budget locked in the token it prices in.
 * Nothing here swaps.
 *
 * Nothing here signs for the provider or sends. Verification uses Node's
 * crypto through `./ed25519`.
 */
import { PublicKey, Transaction, type TransactionInstruction } from '@solana/web3.js';
import { type Signer } from './session-auth';
import { type BudgetAccount, type BudgetApprovalCluster } from './budget';
export declare const BUDGET_PAYMENT_HEADER = "x402-budget";
export declare const BUDGET_SIGNATURE_HEADER = "x402-budget-signature";
export declare const BUDGET_RESERVE_HEADER = "x402-budget-reserve";
/** What a provider asks for in its 402 when it takes budgets. Amounts are base-unit strings. */
export interface PooledBudgetOffer {
    scheme: 'budget';
    /** The cluster's genesis hash. */
    network: string;
    programId: string;
    /** The provider's wallet: the payee and fee payer of `reserve`. */
    payee: string;
    /** Where the provider is paid: its wallet for SOL, its token account of `mint` for a token. */
    payoutAccount: string;
    /** Null for SOL. A budget in any other token cannot pay this provider. */
    mint: string | null;
    /** The slice the provider wants for a first reserve, and the least it takes. */
    reservation: string;
    minReservation: string;
    /** Judges the provider accepts on a budget. Empty: it takes only budgets with no judge. */
    acceptedJudges: string[];
    /** Slots the budget must still have open for the provider to join. */
    minOpenSlotsLeft: string;
}
export type PooledBudgetRefusal = 'budget_currency_not_accepted' | 'budget_closed' | 'budget_closing' | 'budget_instance_mismatch' | 'budget_judge_not_accepted' | 'budget_not_allowlisted' | 'budget_cap_too_small' | 'budget_funds_too_low' | 'budget_full';
export type PooledBudgetCheck = {
    ok: true;
} | {
    ok: false;
    reason: PooledBudgetRefusal;
    message: string;
};
/**
 * Whether this provider may join `budget` with a slice of `slice` base units
 * now. Pure: the caller reads the budget at `confirmed` or better and the
 * current slot.
 */
export declare function checkPooledBudgetForProvider(input: {
    budget: BudgetAccount;
    /** The `createdSlot` the buyer named; the budget read must be that instance. */
    createdSlot: bigint;
    payee: PublicKey;
    /** The provider's mint, or null when it is paid in SOL. */
    mint: PublicKey | null;
    acceptedJudges: PublicKey[];
    /** The new total the slice would have (a raise names the higher total). */
    slice: bigint;
    /** What the slice holds now: 0 before the first reserve. */
    reservedNow?: bigint;
    /** Whether the provider already holds a slice here (a raise does not take a new slot). */
    hasReservation?: boolean;
    currentSlot: bigint;
    minOpenSlotsLeft: bigint;
}): PooledBudgetCheck;
/** Highest compute-unit limit a reserve may ask the provider to pay for (a reserve measures about 24,000 units). */
export declare const MAX_RESERVE_COMPUTE_UNITS = 60000;
/** Default highest compute-unit price, in micro-lamports, a provider pays on a reserve it co-signs. */
export declare const DEFAULT_MAX_RESERVE_MICRO_LAMPORTS_PER_CU = 10000n;
export type ReserveTransactionCheck = {
    ok: true;
    amount: bigint;
    transaction: Transaction; /** The most this transaction can cost the provider in fees, in lamports. */
    maxFeeLamports: bigint;
} | {
    ok: false;
    reason: 'invalid_reserve';
    message: string;
};
/**
 * Checks a reserve the spender signed before the provider signs it: the fee
 * payer is the provider, its only instructions are compute-budget ones and
 * one `reserve` that is exactly the one this provider would build for this
 * budget, payee and payout account, with an amount from `minAmount` to
 * `maxAmount`, and the spender's signature over it is valid. Compute-budget
 * instructions are limited to at most one `SetComputeUnitLimit` (at most
 * `MAX_RESERVE_COMPUTE_UNITS`) and at most one `SetComputeUnitPrice` (at most
 * `maxMicroLamportsPerComputeUnit`), so the provider, as fee payer, cannot be
 * charged more than `maxFeeLamports`. A provider that signs only what passes
 * here pays fees and rent for nothing else.
 */
export declare function checkReserveTransaction(input: {
    transactionBase64: string;
    programId: PublicKey;
    budget: PublicKey;
    createdSlot: bigint;
    spender: PublicKey;
    payee: PublicKey;
    payoutAccount: PublicKey;
    minAmount: bigint;
    maxAmount: bigint;
    /** Highest compute-unit price the provider will pay; default `DEFAULT_MAX_RESERVE_MICRO_LAMPORTS_PER_CU`. */
    maxMicroLamportsPerComputeUnit?: bigint;
    /**
     * Set when the budget's spender is a P-256 key (`BudgetAccount.p256Spender`): the reserve then comes
     * right after the spender's secp256r1 approval and the provider is its only signer. `cluster` is the
     * program build's (mainnet or devnet).
     */
    p256?: {
        cluster: BudgetApprovalCluster;
    };
}): ReserveTransactionCheck;
/** The 33-byte key, signature and message of a secp256r1 approval instruction in the one layout the program takes. */
export declare function readSecp256r1Approval(ix: TransactionInstruction): {
    publicKey: Buffer;
    signature: Buffer;
    message: Buffer;
} | undefined;
/** The buyer side of step 2: a reserve signed by the spender, for the provider to check, sign and send. */
export declare function spenderSignedReserve(input: {
    offer: PooledBudgetOffer;
    budget: PublicKey;
    createdSlot: bigint;
    spender: PublicKey;
    amount: bigint;
    recentBlockhash: string;
    signWithSpender: Signer;
}): Promise<string>;
export type BudgetAction = 'call' | 'close' | 'read';
/** What `x402-budget` carries: the budget instance and this provider's call number in it. */
export interface BudgetPaymentHeader {
    budget: string;
    createdSlot: string;
    sequence: number;
}
/**
 * The message the spender signs for one call: the cluster, the action, the
 * budget instance, this provider, the call number and the SHA-256 of the
 * body. Naming the provider stops a call signed for one provider being
 * replayed to another; the call number stops a replay to the same one.
 */
export declare function budgetRequestMessage(input: {
    genesisHash: string;
    action: BudgetAction;
    budget: string;
    createdSlot: bigint;
    provider: string;
    sequence: number;
    bodyHash: string;
}): string;
/** The two headers a buyer sends with a budget-paid call. */
export declare function budgetRequestHeaders(input: {
    genesisHash: string;
    action: BudgetAction;
    budget: PublicKey;
    createdSlot: bigint;
    provider: PublicKey;
    sequence: number;
    body?: Uint8Array | string;
}, signWithSpender: Signer): Promise<Record<string, string>>;
/**
 * The two headers for a budget-paid call whose spender is a P-256 key: `x402-budget-signature`
 * carries the 33-byte compressed key, then the 64-byte low-S signature (ES256 over the same message).
 * `signWithSpender` may return DER or r || s.
 */
export declare function budgetRequestHeadersP256(input: {
    genesisHash: string;
    action: BudgetAction;
    budget: PublicKey;
    createdSlot: bigint;
    provider: PublicKey;
    sequence: number;
    body?: Uint8Array | string;
}, publicKey: Uint8Array, signWithSpender: Signer): Promise<Record<string, string>>;
/** Reads `x402-budget`. Undefined when it is absent; an error when it is malformed. */
export declare function readBudgetPaymentHeader(value: string | undefined): {
    budget: PublicKey;
    createdSlot: bigint;
    sequence: number;
} | {
    error: string;
} | undefined;
/**
 * Checks the spender's signature over one call. `spender` and `p256Spender` come from the budget
 * account read on chain, never from the request. A P-256 spender's header carries its key, which must
 * hash to `spender`.
 */
export declare function verifyPooledBudgetRequest(input: {
    genesisHash: string;
    action: BudgetAction;
    budget: PublicKey;
    createdSlot: bigint;
    provider: PublicKey;
    sequence: number;
    body?: Uint8Array | string;
    spender: PublicKey;
    p256Spender?: boolean;
    signatureHeader: string | undefined;
}): {
    ok: true;
} | {
    ok: false;
    reason: 'budget_signature_invalid';
    message: string;
};
/** The reservation this provider holds in a budget. */
export declare function providerReservation(budget: PublicKey, payee: PublicKey, programId: PublicKey): PublicKey;
