/**
 * Delivery-checked escrow: client side of the six delivery instructions of
 * `programs/pinocchio-escrow` (README "Delivery check") and of the exits of a
 * delivery-checked escrow. `programs/pinocchio-escrow/interface/vectors.json`
 * is the interface; `tests/delivery.test.ts` holds every builder and decoder
 * here to that file byte for byte.
 *
 * Nothing here signs or sends. Browser-safe: no `node:crypto`.
 *
 * The payer opts a locked escrow in with `open_delivery` in the slot of the
 * lock (normally the same transaction), naming a judge and two windows. That
 * sets bit 0x04 of the escrow's flag byte and creates the delivery account
 * `["delivery", escrow]`. Then:
 *
 * - the payee records what it delivered (`record_delivery`: units, bytes,
 *   SHA-256) before the escrow's refund window opens;
 * - the payer accepts (`accept_delivery`, the payee may be paid at once) or
 *   disputes (`dispute_delivery`, before the verify window ends);
 * - the payee's settle or claim needs an accepted delivery, or a recorded one
 *   whose verify window ended undisputed; the payer's release and the payee's
 *   decline are unchanged; the payer's refund waits for the verify window and
 *   a day to collect once something was recorded, and for the judge's window
 *   once disputed;
 * - a disputed escrow is split by its judge (`resolve_delivery`,
 *   `resolve_token_delivery`) or refunded after the judge's window.
 *
 * Every exit of such an escrow takes the delivery account after its usual
 * accounts and after the rating account when the escrow is rated
 * (`withDeliveryAccount`). Every delivery instruction names the job by the
 * delivery account's `openedSlot`, which is the escrow's lock slot.
 *
 * A seller decides before doing any work whether it accepts the judge and
 * windows it reads on the delivery account: recording a delivery is its
 * agreement to them. The provider kit refuses delivery-checked escrows unless
 * the provider names the judges it accepts.
 */
import { PublicKey, SystemProgram, TransactionInstruction, type AccountMeta } from '@solana/web3.js';

/**
 * Anchor-style discriminators: the first 8 bytes of sha256("<kind>:<name>").
 * Fixed here so the module loads in a browser bundle; a test recomputes each.
 */
export const DELIVERY_DISCRIMINATORS: Readonly<Record<string, readonly number[]>> = Object.freeze({
  'global:open_delivery': [36, 20, 127, 119, 57, 240, 240, 18],
  'global:record_delivery': [72, 245, 251, 211, 129, 177, 93, 214],
  'global:accept_delivery': [153, 42, 84, 137, 56, 87, 13, 64],
  'global:dispute_delivery': [4, 16, 98, 240, 151, 95, 239, 196],
  'global:resolve_delivery': [163, 51, 103, 248, 59, 80, 176, 7],
  'global:resolve_token_delivery': [199, 35, 109, 172, 19, 9, 25, 29],
  'account:DeliveryAccount': [106, 64, 168, 126, 77, 161, 141, 230],
});

function disc(name: string): Buffer {
  const bytes = DELIVERY_DISCRIMINATORS[name];
  if (!bytes) throw new Error(`unknown discriminator ${name}`);
  return Buffer.from(bytes);
}

/** Bit of an escrow's flag byte set by `open_delivery`. */
export const ESCROW_FLAG_DELIVERY = 0x04;
/** The buyer's time to check a recorded delivery: about a minute to about 7 days. */
export const MIN_VERIFY_WINDOW_SLOTS = 150n;
export const MAX_VERIFY_WINDOW_SLOTS = 1_512_000n;
/** The judge's time to rule on a dispute: about 10 minutes to about 14 days. */
export const MIN_RESOLVE_WINDOW_SLOTS = 1_500n;
export const MAX_RESOLVE_WINDOW_SLOTS = 3_024_000n;
/** After an undisputed verify window, the payee's time to collect before the payer may refund: about a day. */
export const DELIVERY_COLLECT_SLOTS = 216_000n;
export const DELIVERY_ACCOUNT_LEN = 162;

export const DELIVERY_STATES = ['awaiting', 'delivered', 'accepted', 'disputed'] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

/** True when the escrow's flag byte has the delivery-checked bit. */
export function isDeliveryCheckedFlag(flagByte: number): boolean {
  return (flagByte & ESCROW_FLAG_DELIVERY) !== 0;
}

/** The delivery account of an escrow: `["delivery", escrow]`. */
export function deliveryPda(escrow: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('delivery'), escrow.toBuffer()], programId)[0];
}

function u64(value: bigint, what: string, min = 0n): Buffer {
  if (value < min || value > 0xffffffffffffffffn) throw new Error(`${what} must be a u64 of at least ${min}`);
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
}

const meta = (pubkey: PublicKey, isWritable = false, isSigner = false): AccountMeta => ({ pubkey, isSigner, isWritable });

/** Whether the program would take these windows. */
export function deliveryWindowsValid(verifyWindowSlots: bigint, resolveWindowSlots: bigint): boolean {
  return (
    verifyWindowSlots >= MIN_VERIFY_WINDOW_SLOTS &&
    verifyWindowSlots <= MAX_VERIFY_WINDOW_SLOTS &&
    resolveWindowSlots >= MIN_RESOLVE_WINDOW_SLOTS &&
    resolveWindowSlots <= MAX_RESOLVE_WINDOW_SLOTS
  );
}

interface OfEscrow {
  programId: PublicKey;
  escrow: PublicKey;
}

/**
 * `open_delivery`, by the payer in the lock slot (put it in the lock's
 * transaction). `judgeAgent` is the judge's registry record, `["agent", judge]`
 * of the registry program.
 */
export function buildOpenDeliveryInstruction(
  input: OfEscrow & { payer: PublicKey; judge: PublicKey; judgeAgent: PublicKey; verifyWindowSlots: bigint; resolveWindowSlots: bigint },
): TransactionInstruction {
  if (!deliveryWindowsValid(input.verifyWindowSlots, input.resolveWindowSlots)) throw new Error('delivery windows out of range');
  return new TransactionInstruction({
    programId: input.programId,
    data: Buffer.concat([disc('global:open_delivery'), input.judge.toBuffer(), u64(input.verifyWindowSlots, 'verifyWindowSlots'), u64(input.resolveWindowSlots, 'resolveWindowSlots')]),
    keys: [
      meta(deliveryPda(input.escrow, input.programId), true),
      meta(input.escrow, true),
      meta(input.payer, true, true),
      meta(input.judgeAgent),
      meta(SystemProgram.programId),
    ],
  });
}

/** `record_delivery`, by the payee: what it delivered. `sha256` is the file's hash, 32 bytes. */
export function buildRecordDeliveryInstruction(
  input: OfEscrow & { payee: PublicKey; openedSlot: bigint; units: bigint; bytes: bigint; sha256: Uint8Array },
): TransactionInstruction {
  if (input.sha256.length !== 32) throw new Error('sha256 must be 32 bytes');
  return new TransactionInstruction({
    programId: input.programId,
    data: Buffer.concat([
      disc('global:record_delivery'),
      u64(input.openedSlot, 'openedSlot'),
      u64(input.units, 'units', 1n),
      u64(input.bytes, 'bytes', 1n),
      Buffer.from(input.sha256),
    ]),
    keys: [meta(deliveryPda(input.escrow, input.programId), true), meta(input.escrow), meta(input.payee, false, true)],
  });
}

function answer(name: string, input: OfEscrow & { payer: PublicKey; openedSlot: bigint }): TransactionInstruction {
  return new TransactionInstruction({
    programId: input.programId,
    data: Buffer.concat([disc(name), u64(input.openedSlot, 'openedSlot')]),
    keys: [meta(deliveryPda(input.escrow, input.programId), true), meta(input.escrow), meta(input.payer, false, true)],
  });
}

/** `accept_delivery`, by the payer: the payee may be paid at once. */
export function buildAcceptDeliveryInstruction(input: OfEscrow & { payer: PublicKey; openedSlot: bigint }): TransactionInstruction {
  return answer('global:accept_delivery', input);
}

/** `dispute_delivery`, by the payer, before the verify window ends: the escrow waits for the judge. */
export function buildDisputeDeliveryInstruction(input: OfEscrow & { payer: PublicKey; openedSlot: bigint }): TransactionInstruction {
  return answer('global:dispute_delivery', input);
}

function trailing(input: OfEscrow & { rated: boolean }): AccountMeta[] {
  const rating = PublicKey.findProgramAddressSync([Buffer.from('rating'), input.escrow.toBuffer()], input.programId)[0];
  return [...(input.rated ? [meta(rating, true)] : []), meta(deliveryPda(input.escrow, input.programId), true)];
}

/**
 * `resolve_delivery`, by the judge of a disputed SOL escrow. `payout` is what
 * the payee is awarded before the protocol fee (0 refunds everything).
 */
export function buildResolveDeliveryInstruction(
  input: OfEscrow & { payer: PublicKey; payee: PublicKey; treasury: PublicKey; judge: PublicKey; payout: bigint; openedSlot: bigint; rated: boolean },
): TransactionInstruction {
  return new TransactionInstruction({
    programId: input.programId,
    data: Buffer.concat([disc('global:resolve_delivery'), u64(input.payout, 'payout'), u64(input.openedSlot, 'openedSlot')]),
    keys: [
      meta(input.escrow, true),
      meta(input.payer, true),
      meta(input.payee, true),
      meta(input.treasury, true),
      meta(SystemProgram.programId),
      meta(input.judge, false, true),
      ...trailing(input),
    ],
  });
}

/**
 * `resolve_token_delivery`, by the judge of a disputed token escrow. The
 * accounts are a token settle's with the judge as authority: `destination` is
 * the recipient recorded at lock, `treasuryToken` the treasury's associated
 * account for the mint, `refund` a token account of the payer.
 */
export function buildResolveTokenDeliveryInstruction(
  input: OfEscrow & {
    vault: PublicKey;
    judge: PublicKey;
    payer: PublicKey;
    mint: PublicKey;
    destination: PublicKey;
    treasuryToken: PublicKey;
    refund: PublicKey;
    tokenProgram: PublicKey;
    payout: bigint;
    openedSlot: bigint;
    rated: boolean;
  },
): TransactionInstruction {
  return new TransactionInstruction({
    programId: input.programId,
    data: Buffer.concat([disc('global:resolve_token_delivery'), u64(input.payout, 'payout'), u64(input.openedSlot, 'openedSlot')]),
    keys: [
      meta(input.escrow, true),
      meta(input.vault, true),
      meta(input.judge, false, true),
      meta(input.payer, true),
      meta(input.mint),
      meta(input.destination, true),
      meta(input.treasuryToken, true),
      meta(input.refund, true),
      meta(input.tokenProgram),
      ...trailing(input),
    ],
  });
}

/**
 * Adds the delivery account to an exit (release, claim, settle, refund or
 * decline, SOL or token) already in the program's form (from
 * `withRatingAccount` or `buildTokenEscrowExitInstruction`): appended last,
 * writable, after the rating account when there is one. The escrow is the
 * exit's first account.
 */
export function withDeliveryAccount(exit: TransactionInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: exit.programId,
    data: Buffer.from(exit.data),
    keys: [...exit.keys, meta(deliveryPda(exit.keys[0].pubkey, exit.programId), true)],
  });
}

export interface DeliveryAccount {
  escrow: PublicKey;
  judge: PublicKey;
  /** The escrow's lock slot: names the job. */
  openedSlot: bigint;
  verifyWindowSlots: bigint;
  resolveWindowSlots: bigint;
  deliveredSlot: bigint;
  units: bigint;
  bytes: bigint;
  sha256: Uint8Array;
  disputedSlot: bigint;
  state: DeliveryState;
  bump: number;
}

/** Reads a delivery account. Throws for bytes that are not one. */
export function decodeDeliveryAccount(accountData: Uint8Array): DeliveryAccount {
  const data = Buffer.from(accountData);
  if (data.length < DELIVERY_ACCOUNT_LEN || !data.subarray(0, 8).equals(disc('account:DeliveryAccount'))) throw new Error('invalid delivery account');
  const state = DELIVERY_STATES[data[160]];
  if (state === undefined) throw new Error('invalid delivery state');
  return {
    escrow: new PublicKey(data.subarray(8, 40)),
    judge: new PublicKey(data.subarray(40, 72)),
    openedSlot: data.readBigUInt64LE(72),
    verifyWindowSlots: data.readBigUInt64LE(80),
    resolveWindowSlots: data.readBigUInt64LE(88),
    deliveredSlot: data.readBigUInt64LE(96),
    units: data.readBigUInt64LE(104),
    bytes: data.readBigUInt64LE(112),
    sha256: Uint8Array.from(data.subarray(120, 152)),
    disputedSlot: data.readBigUInt64LE(152),
    state,
    bump: data[161],
  };
}
