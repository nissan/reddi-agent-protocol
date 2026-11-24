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
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
/**
 * Anchor-style discriminators: the first 8 bytes of sha256("<kind>:<name>").
 * Fixed here so the module loads in a browser bundle; a test recomputes each.
 */
export declare const DELIVERY_DISCRIMINATORS: Readonly<Record<string, readonly number[]>>;
/** Bit of an escrow's flag byte set by `open_delivery`. */
export declare const ESCROW_FLAG_DELIVERY = 4;
/** The buyer's time to check a recorded delivery: about a minute to about 7 days. */
export declare const MIN_VERIFY_WINDOW_SLOTS = 150n;
export declare const MAX_VERIFY_WINDOW_SLOTS = 1512000n;
/** The judge's time to rule on a dispute: about 10 minutes to about 14 days. */
export declare const MIN_RESOLVE_WINDOW_SLOTS = 1500n;
export declare const MAX_RESOLVE_WINDOW_SLOTS = 3024000n;
/** After an undisputed verify window, the payee's time to collect before the payer may refund: about a day. */
export declare const DELIVERY_COLLECT_SLOTS = 216000n;
export declare const DELIVERY_ACCOUNT_LEN = 162;
export declare const DELIVERY_STATES: readonly ["awaiting", "delivered", "accepted", "disputed"];
export type DeliveryState = (typeof DELIVERY_STATES)[number];
/** True when the escrow's flag byte has the delivery-checked bit. */
export declare function isDeliveryCheckedFlag(flagByte: number): boolean;
/** The delivery account of an escrow: `["delivery", escrow]`. */
export declare function deliveryPda(escrow: PublicKey, programId: PublicKey): PublicKey;
/** Whether the program would take these windows. */
export declare function deliveryWindowsValid(verifyWindowSlots: bigint, resolveWindowSlots: bigint): boolean;
interface OfEscrow {
    programId: PublicKey;
    escrow: PublicKey;
}
/**
 * `open_delivery`, by the payer in the lock slot (put it in the lock's
 * transaction). `judgeAgent` is the judge's registry record, `["agent", judge]`
 * of the registry program.
 */
export declare function buildOpenDeliveryInstruction(input: OfEscrow & {
    payer: PublicKey;
    judge: PublicKey;
    judgeAgent: PublicKey;
    verifyWindowSlots: bigint;
    resolveWindowSlots: bigint;
}): TransactionInstruction;
/** `record_delivery`, by the payee: what it delivered. `sha256` is the file's hash, 32 bytes. */
export declare function buildRecordDeliveryInstruction(input: OfEscrow & {
    payee: PublicKey;
    openedSlot: bigint;
    units: bigint;
    bytes: bigint;
    sha256: Uint8Array;
}): TransactionInstruction;
/** `accept_delivery`, by the payer: the payee may be paid at once. */
export declare function buildAcceptDeliveryInstruction(input: OfEscrow & {
    payer: PublicKey;
    openedSlot: bigint;
}): TransactionInstruction;
/** `dispute_delivery`, by the payer, before the verify window ends: the escrow waits for the judge. */
export declare function buildDisputeDeliveryInstruction(input: OfEscrow & {
    payer: PublicKey;
    openedSlot: bigint;
}): TransactionInstruction;
/**
 * `resolve_delivery`, by the judge of a disputed SOL escrow. `payout` is what
 * the payee is awarded before the protocol fee (0 refunds everything).
 */
export declare function buildResolveDeliveryInstruction(input: OfEscrow & {
    payer: PublicKey;
    payee: PublicKey;
    treasury: PublicKey;
    judge: PublicKey;
    payout: bigint;
    openedSlot: bigint;
    rated: boolean;
}): TransactionInstruction;
/**
 * `resolve_token_delivery`, by the judge of a disputed token escrow. The
 * accounts are a token settle's with the judge as authority: `destination` is
 * the recipient recorded at lock, `treasuryToken` the treasury's associated
 * account for the mint, `refund` a token account of the payer.
 */
export declare function buildResolveTokenDeliveryInstruction(input: OfEscrow & {
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
}): TransactionInstruction;
/**
 * Adds the delivery account to an exit (release, claim, settle, refund or
 * decline, SOL or token) already in the program's form (from
 * `withRatingAccount` or `buildTokenEscrowExitInstruction`): appended last,
 * writable, after the rating account when there is one. The escrow is the
 * exit's first account.
 */
export declare function withDeliveryAccount(exit: TransactionInstruction): TransactionInstruction;
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
export declare function decodeDeliveryAccount(accountData: Uint8Array): DeliveryAccount;
export {};
