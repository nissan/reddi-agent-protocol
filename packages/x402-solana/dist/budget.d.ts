/**
 * Pooled budget: client side of the thirteen budget instructions of
 * `programs/pinocchio-escrow` (README "Pooled budget").
 * `programs/pinocchio-escrow/interface/vectors.json` is the interface;
 * `tests/budget.test.ts` holds every builder and decoder here to that file
 * byte for byte.
 *
 * Nothing here signs or sends. Browser-safe: no `node:crypto`.
 *
 * A person (the payer) locks one total in one token for an open period and
 * names a spender key that their agent holds instead of a wallet. While the
 * budget is open:
 *
 * - the agent's spender key and a provider together reserve a slice for that
 *   provider (`reserveInstruction`, both sign; the same call with a higher
 *   amount raises it);
 * - calls are metered off chain against the slice, and the provider posts
 *   what it is owed, at most its slice (`postFinalInstruction`; a re-post may
 *   only go down);
 * - the payer (or the spender, when the budget allows it) waives disputes on
 *   a posted slice (`waiveInstruction`) so it can be paid at once, or disputes
 *   it (`disputeInstruction`) for the judge.
 *
 * The payer or the spender closes the budget (`closeBudgetInstruction`), or
 * anyone once the open period has ended; what was never reserved goes back at
 * once. A slice is paid (`payoutInstruction`, by anyone) once waived, once its
 * dispute window ended undisputed (`disputeEnds`), or as a full refund once
 * the judge's window ended without a ruling (`judgeEnds`); the judge splits a
 * disputed one (`resolveInstruction`). The same payout call closes a slice
 * that was paid early, once its budget is closed or gone.
 *
 * Every instruction after the open names the budget by its `createdSlot`
 * (read it with `decodeBudget`) and is refused in the slot it was opened in.
 */
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
/**
 * Anchor-style discriminators: the first 8 bytes of sha256("<kind>:<name>").
 * Fixed here so the module loads in a browser bundle; a test recomputes each.
 */
export declare const BUDGET_DISCRIMINATORS: Readonly<Record<string, readonly number[]>>;
/** Open period and dispute window: about an hour to about 7 days. */
export declare const MIN_BUDGET_WINDOW_SLOTS = 9000n;
export declare const MAX_BUDGET_WINDOW_SLOTS = 1512000n;
/** The judge's window: about 10 minutes to about 14 days. */
export declare const MIN_BUDGET_JUDGE_SLOTS = 1500n;
export declare const MAX_BUDGET_JUDGE_SLOTS = 3024000n;
/** After each post the payer has at least this long to dispute: about an hour. */
export declare const MIN_REVIEW_SLOTS = 9000n;
export declare const MAX_BUDGET_RESERVATIONS = 8;
export declare const BUDGET_ALLOWLIST_LEN = 4;
/** Budget flag: the spender may waive disputes for the payer (needs an allowlist). */
export declare const BUDGET_FLAG_SPENDER_WAIVES = 1;
/** Budget flag set by a close. */
export declare const BUDGET_FLAG_CLOSED = 2;
export declare const BUDGET_ACCOUNT_LEN = 349;
export declare const RESERVATION_ACCOUNT_LEN = 147;
/** Caps the program applies to one budget, as for one escrow. */
export declare const MAX_SOL_BUDGET_LAMPORTS = 500000000n;
export declare const MAX_TOKEN_BUDGET_BASE_UNITS = 100000000n;
export declare const RESERVATION_STATES: readonly ["open", "posted", "disputed", "paid"];
export type ReservationState = (typeof RESERVATION_STATES)[number];
/** The budget of `payer` with this 16-byte nonce: `["budget", payer, nonce]`. */
export declare function budgetAddress(payer: PublicKey, nonce: Uint8Array, programId: PublicKey): PublicKey;
/** A token budget's vault, a token account owned by the budget: `["budget-vault", budget]`. */
export declare function budgetVaultAddress(budget: PublicKey, programId: PublicKey): PublicKey;
/** A provider's slice of a budget: `["reservation", budget, payee]`. */
export declare function reservationAddress(budget: PublicKey, payee: PublicKey, programId: PublicKey): PublicKey;
/** The smallest slice of a budget of `total`: 1% of it, at least one base unit. */
export declare function minReservation(total: bigint): bigint;
/** Whether the program would take these windows. */
export declare function budgetWindowsValid(openSlots: bigint, disputeSlots: bigint, judgeSlots: bigint): boolean;
/** The token side of a token budget's open. */
export interface BudgetTokenOpen {
    mint: PublicKey;
    /** The payer's token account the total comes from. */
    source: PublicKey;
    tokenProgram: PublicKey;
}
export interface OpenBudgetInput {
    programId: PublicKey;
    payer: PublicKey;
    nonce: Uint8Array;
    spender: PublicKey;
    /** The judge (a registered, active attestation agent), or null for none: then an allowlist is required. */
    judge: PublicKey | null;
    openSlots: bigint;
    disputeSlots: bigint;
    judgeSlots: bigint;
    /** Lamports, or base units of the mint. */
    total: bigint;
    /** Most one provider's slice may reach; omitted or 0 means the total. */
    perProviderCap?: bigint;
    /** Up to 4 providers; when given, only they may join. */
    allowlist?: PublicKey[];
    /** Let the spender waive disputes (needs an allowlist). */
    spenderMayWaive?: boolean;
    /** Omit for SOL. */
    token?: BudgetTokenOpen;
}
/**
 * `open_budget` or, with `token`, `open_token_budget`, by the payer. Checks
 * what the program checks about the terms, so a refused open fails here
 * first.
 */
export declare function openBudgetInstruction(input: OpenBudgetInput): TransactionInstruction;
interface OfBudget {
    programId: PublicKey;
    budget: PublicKey;
    /** The budget's `createdSlot`: names this budget instance. */
    createdSlot: bigint;
}
/**
 * `reserve`, signed by the spender and the payee (the payee pays the fee and
 * the reservation's rent). `amount` is the slice's new total: a raise sends
 * the higher total. `payoutAccount` is where the payee is paid: the payee
 * itself for SOL (the default), a token account of the budget's mint it owns
 * for tokens. If the payee still has a reservation paid early in an earlier
 * budget at the same address, put a `payoutInstruction` for it first in the
 * same transaction: it closes that reservation, which otherwise refuses the
 * reserve (6087).
 */
export declare function reserveInstruction(input: OfBudget & {
    spender: PublicKey;
    payee: PublicKey;
    amount: bigint;
    payoutAccount?: PublicKey;
}): TransactionInstruction;
/** `set_payout_account`, by the payee, while its slice is open or posted. */
export declare function setPayoutAccountInstruction(input: OfBudget & {
    payee: PublicKey;
    payoutAccount: PublicKey;
}): TransactionInstruction;
/** `post_final`, by the payee: what it is owed, at most its slice; a re-post may only go down. */
export declare function postFinalInstruction(input: OfBudget & {
    payee: PublicKey;
    amount: bigint;
}): TransactionInstruction;
/** `waive`, by the payer (or the spender on a budget that allows it), on a posted slice: it can be paid at once. */
export declare function waiveInstruction(input: OfBudget & {
    payee: PublicKey;
    signer: PublicKey;
}): TransactionInstruction;
/** `dispute`, by the payer, on a posted slice of a budget with a judge, before `disputeEnds`. */
export declare function disputeInstruction(input: OfBudget & {
    payee: PublicKey;
    payer: PublicKey;
}): TransactionInstruction;
/** The token side of a token budget's close. */
export interface BudgetTokenClose {
    mint: PublicKey;
    /** A token account the payer owns. */
    refund: PublicKey;
    tokenProgram: PublicKey;
}
/**
 * `close_budget` or, with `token`, `close_token_budget`: by the payer or the
 * spender any time, by anyone after the open period. Pass `memoProgram` (the
 * SPL Memo program) when the refund account requires incoming memos.
 */
export declare function closeBudgetInstruction(input: OfBudget & {
    signer: PublicKey;
    payer: PublicKey;
    token?: BudgetTokenClose;
    memoProgram?: PublicKey;
}): TransactionInstruction;
/** The token side of a token budget's payout or resolve. */
export interface BudgetTokenPayout {
    mint: PublicKey;
    /** The payout account recorded on the reservation. */
    payoutAccount: PublicKey;
    /** The protocol treasury's token account for the mint. */
    treasuryToken: PublicKey;
    /** A token account the payer owns. */
    refund: PublicKey;
    tokenProgram: PublicKey;
}
export interface PayoutInput extends OfBudget {
    payee: PublicKey;
    payer: PublicKey;
    /** The protocol treasury (SOL). */
    treasury: PublicKey;
    token?: BudgetTokenPayout;
    memoProgram?: PublicKey;
}
/**
 * `payout_budget` or, with `token`, `payout_token_budget`, by anyone: pays a
 * waived slice, one whose dispute window ended, or refunds one whose judge
 * did not rule in time; closes a slice paid early once its budget is closed
 * or gone. `treasury` is unused for a token budget but kept so one input
 * shape serves both.
 */
export declare function payoutInstruction(input: PayoutInput): TransactionInstruction;
/** `resolve_budget` or `resolve_token_budget`, by the judge: `payout` (at most the posted amount) to the payee before the fee. */
export declare function resolveInstruction(input: PayoutInput & {
    judge: PublicKey;
    payout: bigint;
}): TransactionInstruction;
export interface BudgetAccount {
    payer: PublicKey;
    spender: PublicKey;
    /** Null when the budget has no judge. */
    judge: PublicKey | null;
    /** Null for a SOL budget. */
    mint: PublicKey | null;
    nonce: Uint8Array;
    createdSlot: bigint;
    openSlots: bigint;
    disputeSlots: bigint;
    judgeSlots: bigint;
    total: bigint;
    unreserved: bigint;
    perProviderCap: bigint;
    /** The non-empty allowlist entries. */
    allowlist: PublicKey[];
    /** 0 until closed. */
    closedSlot: bigint;
    reservations: number;
    unsettled: number;
    spenderMayWaive: boolean;
    closed: boolean;
    /** The first slot at which reservations are refused and anyone may close. */
    openEnds: bigint;
}
/** Reads a budget account. Throws for bytes that are not one. */
export declare function decodeBudget(accountData: Uint8Array): BudgetAccount;
export interface ReservationAccount {
    budget: PublicKey;
    /** The `createdSlot` of the budget instance it belongs to. */
    budgetCreatedSlot: bigint;
    payee: PublicKey;
    payoutAccount: PublicKey;
    reserved: bigint;
    finalAmount: bigint;
    postedSlot: bigint;
    disputedSlot: bigint;
    state: ReservationState;
    waived: boolean;
}
/** Reads a reservation account. Throws for bytes that are not one. */
export declare function decodeReservation(accountData: Uint8Array): ReservationAccount;
/**
 * The first slot at which the payer can no longer dispute `reservation`, and
 * at which an undisputed one may be paid: the budget's dispute window from
 * its close, never earlier than `MIN_REVIEW_SLOTS` after the first post. Null
 * while the budget is open (the window has not started).
 */
export declare function disputeEnds(budget: BudgetAccount, reservation: ReservationAccount): bigint | null;
/** The first slot at which a disputed reservation refunds in full without the judge. Null unless disputed. */
export declare function judgeEnds(budget: BudgetAccount, reservation: ReservationAccount): bigint | null;
export {};
