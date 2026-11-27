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

export const PAUSE_SEED = 'pause';
/** `account:PauseState`, 89 bytes. */
export const PAUSE_STATE_LEN = 89;
/** About 7 days: how long one pause lasts unless the admin renews it. */
export const PAUSE_SLOTS = 1_512_000n;

/** Program error numbers of the pause. */
export const PAUSE_ERRORS = Object.freeze({
  ProtocolPaused: 6101,
  PauseAccountRequired: 6102,
  NotPauseAuthority: 6103,
  AlreadyPaused: 6104,
  InvalidGuardian: 6105,
} as const);

/** Plain-language text for a refusal because the protocol is paused. */
export const PAUSED_MESSAGE =
  'Reddi Agent Protocol is paused while an issue is checked. New payments and payouts to providers are on hold; refunds and closing a Budget still work.';

export function pauseAddress(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(PAUSE_SEED)], programId)[0];
}

/** The read-only account meta the gated instructions take last. */
export function pauseAccountMeta(programId: PublicKey): AccountMeta {
  return { pubkey: pauseAddress(programId), isSigner: false, isWritable: false };
}

/** `ix` with the pause account appended, unless it is already last. */
export function withPauseAccount(ix: TransactionInstruction): TransactionInstruction {
  const pause = pauseAddress(ix.programId);
  const last = ix.keys[ix.keys.length - 1];
  if (last && last.pubkey.equals(pause)) return ix;
  ix.keys.push({ pubkey: pause, isSigner: false, isWritable: false });
  return ix;
}

export interface PauseState {
  guardian: PublicKey;
  /** The protocol is paused while the current slot is below this; 0 when not paused. */
  pausedUntilSlot: bigint;
  pausedAtSlot: bigint;
  lastBy: PublicKey;
}

/** Decode the pause account's data. Throws on a wrong size. */
export function decodePauseState(data: Uint8Array): PauseState {
  if (data.length < PAUSE_STATE_LEN) throw new Error('not a pause account');
  const view = Buffer.from(data);
  return {
    guardian: new PublicKey(view.subarray(8, 40)),
    pausedUntilSlot: view.readBigUInt64LE(40),
    pausedAtSlot: view.readBigUInt64LE(48),
    lastBy: new PublicKey(view.subarray(56, 88)),
  };
}

export interface PauseStatus {
  /** `true` while paused; also `true` when the account is missing, because the program then refuses locks and payouts. */
  paused: boolean;
  /** The pause account does not exist yet (the program refuses gated calls). */
  missing: boolean;
  pausedUntilSlot: bigint;
  slot: bigint;
}

/** Read whether the program is paused now. */
export async function readPauseStatus(connection: Connection, programId: PublicKey): Promise<PauseStatus> {
  const [info, slot] = await Promise.all([
    connection.getAccountInfo(pauseAddress(programId), 'confirmed'),
    connection.getSlot('confirmed'),
  ]);
  if (!info || !info.owner.equals(programId)) {
    return { paused: true, missing: true, pausedUntilSlot: 0n, slot: BigInt(slot) };
  }
  const state = decodePauseState(info.data);
  return {
    paused: BigInt(slot) < state.pausedUntilSlot,
    missing: false,
    pausedUntilSlot: state.pausedUntilSlot,
    slot: BigInt(slot),
  };
}

/** Whether `error` (a send/simulate error or its logs) is the program's pause refusal. */
export function isPausedError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${String((error as { logs?: unknown }).logs ?? '')}` : String(error);
  return /ProtocolPaused|Error Number: 6101|custom program error: 0x17d5\b/.test(text);
}
