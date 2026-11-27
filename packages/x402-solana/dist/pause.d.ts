/**
 * Emergency pause of the Reddi Agent Protocol program.
 *
 * The program keeps one pause account at `["pause"]`. While the protocol is
 * paused it refuses new money coming in (escrow locks, budget opens,
 * reserves) and payouts to providers (release, claim, settle, and any
 * budget payout or judge's ruling that pays the provider something). Every
 * refund keeps working: cancels, budget closes, disputes, a payout or ruling
 * that pays the provider nothing.
 *
 * The instructions a pause can refuse take the pause account as their LAST
 * account, after any rating, delivery or memo account. `withPauseAccount`
 * appends it. A lock, release, settle, budget open or reserve without it is
 * refused with `PauseAccountRequired` (6102); a budget payout or judge's
 * resolve without it is treated as paused (refund only). Instructions the
 * pause never refuses ignore it, so appending it to every instruction of the
 * program is safe, and so is sending it to a program build that predates
 * the pause (it ignores trailing accounts).
 */
import { PublicKey, type AccountMeta, type Connection, type TransactionInstruction } from '@solana/web3.js';
export declare const PAUSE_SEED = "pause";
/** `account:PauseState`, 89 bytes. */
export declare const PAUSE_STATE_LEN = 89;
/** About 7 days: how long one pause lasts unless the admin renews it. */
export declare const PAUSE_SLOTS = 1512000n;
/** Program error numbers of the pause. */
export declare const PAUSE_ERRORS: Readonly<{
    readonly ProtocolPaused: 6101;
    readonly PauseAccountRequired: 6102;
    readonly NotPauseAuthority: 6103;
    readonly AlreadyPaused: 6104;
    readonly InvalidGuardian: 6105;
}>;
/** Plain-language text for a refusal because the protocol is paused. */
export declare const PAUSED_MESSAGE = "Reddi Agent Protocol is paused while an issue is checked. New payments and payouts to providers are on hold; refunds and closing a Budget still work.";
export declare function pauseAddress(programId: PublicKey): PublicKey;
/** The read-only account meta the gated instructions take last. */
export declare function pauseAccountMeta(programId: PublicKey): AccountMeta;
/** `ix` with the pause account appended, unless it is already last. */
export declare function withPauseAccount(ix: TransactionInstruction): TransactionInstruction;
export interface PauseState {
    guardian: PublicKey;
    /** The protocol is paused while the current slot is below this; 0 when not paused. */
    pausedUntilSlot: bigint;
    pausedAtSlot: bigint;
    lastBy: PublicKey;
}
/** Decode the pause account's data. Throws on a wrong size. */
export declare function decodePauseState(data: Uint8Array): PauseState;
export interface PauseStatus {
    /** `true` while paused; also `true` when the account is missing, because the program then refuses locks and payouts. */
    paused: boolean;
    /** The pause account does not exist yet (the program refuses gated calls). */
    missing: boolean;
    pausedUntilSlot: bigint;
    slot: bigint;
}
/** Read whether the program is paused now. */
export declare function readPauseStatus(connection: Connection, programId: PublicKey): Promise<PauseStatus>;
/** Whether `error` (a send/simulate error or its logs) is the program's pause refusal. */
export declare function isPausedError(error: unknown): boolean;
