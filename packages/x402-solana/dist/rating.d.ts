/**
 * Ratings and judge attestations of a job paid through escrow (#841).
 *
 * Client side of the ten rating and attestation instructions of
 * `programs/pinocchio-escrow` and of the exits of a rated escrow. The program
 * README and `programs/pinocchio-escrow/interface/vectors.json` are the
 * interface; `tests/rating.test.ts` holds every builder and decoder here to
 * that file byte for byte.
 *
 * Nothing here signs or sends. Browser-safe: no `node:crypto`.
 *
 * A rating belongs to one escrow. The buyer opts in with `open_rating` in the
 * slot of the lock (normally the same transaction), which sets bit 0x02 of the
 * escrow's flag byte. From then on every exit of that escrow (release, claim,
 * settle, refund, decline) takes the rating account, writable, right after
 * the instruction's usual accounts.
 *
 * Consent: the seller agrees to be rated by `accept_rating`, or by being the
 * authority of a claim or settle. Nothing else counts: a release by the payer
 * opens the rating only when the rating account says `accepted`, whoever else
 * signs the transaction. A seller that has agreed then has to commit and
 * reveal within the windows. A rated exit that pays the seller nothing
 * closes the rating unrated.
 *
 * Seller claim transactions must not carry the payer's signature. If the
 * payer signs a transaction in which the payee claims, even only as its fee
 * payer, the program treats the payer as the authority: that is a release by
 * the payer, not the seller's claim, and without `accept_rating` the job
 * closes unrated. The seller pays its own fees.
 */
import { PublicKey, TransactionInstruction, type Commitment } from '@solana/web3.js';
import { type SettleTokenEscrowOptions, type TokenEscrowTerms } from './token-escrow';
/**
 * Anchor-style discriminators: the first 8 bytes of sha256("<kind>:<name>").
 * Fixed here so the module loads in a browser bundle; a test recomputes each.
 */
export declare const RATING_DISCRIMINATORS: Readonly<Record<string, readonly number[]>>;
/** Slots a party has to commit after the paid exit, and to reveal after the second commitment: about 7 days each. */
export declare const RATING_COMMIT_SLOTS = 1512000n;
export declare const RATING_REVEAL_SLOTS = 1512000n;
/** Slots after which a judge may close an attestation the consumer never resolved. */
export declare const ATTESTATION_RESOLUTION_SLOTS = 1512000n;
export declare const RATING_ACCOUNT_LEN = 270;
export declare const ATTESTATION_ACCOUNT_LEN = 119;
/** Bits of an escrow's flag byte, the byte that has always held `metered`. */
export declare const ESCROW_FLAG_METERED = 1;
export declare const ESCROW_FLAG_RATED = 2;
/** Offset of the flag byte in a token escrow account. */
export declare const TOKEN_ESCROW_FLAG_OFFSET = 202;
/** Offset of the flag byte in a SOL escrow account that stores windows and no PER session key. */
export declare const SOL_ESCROW_FLAG_OFFSET = 132;
export interface EscrowFlags {
    metered: boolean;
    rated: boolean;
}
/** Reads the flag byte. Test the bits: a rated metered escrow stores 3, so comparing the byte with 1 is wrong. */
export declare function escrowFlags(flagByte: number): EscrowFlags;
/**
 * Kind and flags of an escrow account of the program, SOL or token, from its
 * data. Undefined when the bytes are neither. Reads both the current layouts
 * (165 and 219 bytes) and the earlier ones without windows (149 and 203).
 */
export declare function escrowAccountFlags(data: Uint8Array): ({
    kind: 'sol' | 'token';
} & EscrowFlags) | undefined;
/** True when the escrow account data (SOL or token) has the rated bit set. False for bytes that are not an escrow. */
export declare function isRatedEscrow(data: Uint8Array): boolean;
/** The rating account of an escrow: `["rating", escrow]`. */
export declare function ratingPda(escrow: PublicKey, programId: PublicKey): PublicKey;
/** The attestation account of an escrow's job: `["attestation", escrow]`. */
export declare function attestationPda(escrow: PublicKey, programId: PublicKey): PublicKey;
/** The agent record of a wallet: `["agent", owner]`. The address is passed whether or not the wallet is registered. */
export declare function agentPda(owner: PublicKey, programId: PublicKey): PublicKey;
/** A SOL escrow: `["escrow", payer, 16-byte nonce]`. */
export declare function solEscrowPda(payer: PublicKey, nonce: Uint8Array, programId: PublicKey): PublicKey;
/** SHA-256, synchronous and without `node:crypto`, so the commitment can be made in a browser. A test checks it against Node's. */
export declare function sha256(message: Uint8Array): Uint8Array;
/**
 * The commitment a party makes with `commit_rating`:
 * sha256(rating address ‖ signer address ‖ score byte ‖ 32-byte salt).
 * Keep the score and the salt: `reveal_rating` needs both, and a party that
 * commits and cannot reveal loses reputation. Use a fresh random salt per rating.
 */
export declare function ratingCommitment(rating: PublicKey, signer: PublicKey, score: number, salt: Uint8Array): Uint8Array;
interface OfEscrow {
    programId: PublicKey;
    /** The escrow the job was paid through. The rating and attestation addresses are derived from it. */
    escrow: PublicKey;
}
/**
 * `open_rating`: the payer opts the escrow in to rating. Only in the slot the
 * escrow was locked in, so send it in the lock's transaction, after the lock.
 * `judge` names the one wallet that may attest the job; leave it out for none.
 * The payer pays the rating account's rent, returned when the rating is closed.
 */
export declare function buildOpenRatingInstruction(input: OfEscrow & {
    payer: PublicKey;
    judge?: PublicKey;
}): TransactionInstruction;
/**
 * `accept_rating`: the seller (the escrow's payee) agrees to the rating while
 * the escrow is still locked, so that a release by the payer opens it. A
 * seller that is itself the authority of the claim or settle agrees by that
 * and need not call this. Co-signing the payer's release is not agreement.
 */
export declare function buildAcceptRatingInstruction(input: OfEscrow & {
    specialist: PublicKey;
}): TransactionInstruction;
/** `commit_rating`: the consumer or the specialist commits to `ratingCommitment(...)`. */
export declare function buildCommitRatingInstruction(input: OfEscrow & {
    signer: PublicKey;
    commitment: Uint8Array;
}): TransactionInstruction;
interface RatingParties {
    /** The rating's consumer: the escrow's payer. */
    consumer: PublicKey;
    /** The rating's specialist: the escrow's payee. */
    specialist: PublicKey;
}
/** `reveal_rating`: the signer (consumer or specialist) opens its commitment with the score and salt it committed to. */
export declare function buildRevealRatingInstruction(input: OfEscrow & RatingParties & {
    signer: PublicKey;
    score: number;
    salt: Uint8Array;
}): TransactionInstruction;
/** `expire_rating`: anyone may call it once the deadline of the phase the rating stopped in has passed. */
export declare function buildExpireRatingInstruction(input: OfEscrow & RatingParties & {
    caller: PublicKey;
}): TransactionInstruction;
/** `close_rating`: the consumer closes a final (revealed or expired) rating and gets its rent back. */
export declare function buildCloseRatingInstruction(input: OfEscrow & {
    consumer: PublicKey;
}): TransactionInstruction;
/** The five scores of an attestation, 1 to 10 each. */
export type AttestationScores = readonly [accuracy: number, completeness: number, relevance: number, format: number, latency: number];
/**
 * `attest_quality`: the judge the rating names records five scores for a paid
 * job. The judge must be registered as an attestation agent and pays the
 * attestation's rent. Must be made before the rating account is closed.
 */
export declare function buildAttestQualityInstruction(input: OfEscrow & {
    judge: PublicKey;
    scores: AttestationScores;
}): TransactionInstruction;
/** `confirm_attestation`: the consumer the attestation names confirms it, once. */
export declare function buildConfirmAttestationInstruction(input: OfEscrow & {
    judge: PublicKey;
    consumer: PublicKey;
}): TransactionInstruction;
/** `dispute_attestation`: the consumer the attestation names disputes it, once. */
export declare function buildDisputeAttestationInstruction(input: OfEscrow & {
    judge: PublicKey;
    consumer: PublicKey;
}): TransactionInstruction;
/** `close_attestation`: the judge gets the rent back once the attestation is resolved, or after the resolution window. */
export declare function buildCloseAttestationInstruction(input: OfEscrow & {
    judge: PublicKey;
}): TransactionInstruction;
/**
 * The program's custom error codes for ratings and attestations, by number.
 * 6010 to 6019 keep the numbers of the earlier program; 6033 to 6049 are new
 * with the escrow-bound rating. Held to the program's `error.rs` by a test.
 */
export declare const RATING_PROGRAM_ERRORS: {
    readonly 6010: "AlreadyCommitted";
    readonly 6011: "BothMustCommitFirst";
    readonly 6012: "CommitmentMismatch";
    readonly 6013: "InvalidScore";
    readonly 6014: "NotExpired";
    readonly 6015: "AlreadyFinalised";
    readonly 6016: "NotAttestationAgent";
    readonly 6018: "AttestationAlreadyResolved";
    readonly 6019: "AttestationScoreOutOfRange";
    readonly 6033: "RatingAccountRequired";
    readonly 6034: "InvalidRatingAccount";
    readonly 6035: "RatingNotAwaitingSettlement";
    readonly 6036: "RatingOptInClosed";
    readonly 6037: "AlreadyRated";
    readonly 6038: "InvalidJudge";
    readonly 6039: "JobNotPaid";
    readonly 6040: "CommitDeadlinePassed";
    readonly 6041: "RevealDeadlinePassed";
    readonly 6042: "AlreadyRevealed";
    readonly 6043: "EmptyCommitment";
    readonly 6044: "RatingNotFinal";
    readonly 6045: "RatedEscrowNotDelegable";
    readonly 6046: "RatingAlreadyAccepted";
    readonly 6047: "AttestationNotClosable";
    readonly 6048: "AlreadyAttested";
    readonly 6049: "JudgeNotActive";
};
export type RatingProgramErrorName = (typeof RATING_PROGRAM_ERRORS)[keyof typeof RATING_PROGRAM_ERRORS];
/** The name of a rating or attestation error code, or undefined for any other code. */
export declare function ratingProgramErrorName(code: number): RatingProgramErrorName | undefined;
export declare const RATING_STATES: readonly ["awaiting_settlement", "open", "both_committed", "revealed", "expired"];
/**
 * `awaiting_settlement`: opted in, escrow not yet paid. `open`: paid, waiting
 * for commitments. `both_committed`: waiting for reveals. `revealed` and
 * `expired` are final.
 */
export type RatingState = (typeof RATING_STATES)[number];
export interface RatingAccount {
    escrow: PublicKey;
    /** The escrow's payer. */
    consumer: PublicKey;
    /** The escrow's payee. */
    specialist: PublicKey;
    /** The one wallet that may attest the job, or undefined when the consumer named none. */
    judge?: PublicKey;
    /** The mint the job was paid in. Undefined for SOL, and for any escrow until the job is paid. */
    mint?: PublicKey;
    /** 32 bytes, or undefined until the consumer has committed. */
    consumerCommitment?: Uint8Array;
    /** 32 bytes, or undefined until the specialist has committed. */
    specialistCommitment?: Uint8Array;
    /** Amount paid out of the escrow before the protocol fee, in base units. Zero until paid. */
    paid: bigint;
    openedSlot: bigint;
    /** Slot of the paid exit; the commit deadline counts from it. */
    settledSlot: bigint;
    /** Slot of the second commitment; the reveal deadline counts from it. */
    committedSlot: bigint;
    state: RatingState;
    /** The consumer's score of the specialist, 1 to 10. Undefined until revealed. */
    consumerScore?: number;
    /** The specialist's score of the consumer, 1 to 10. Undefined until revealed. */
    specialistScore?: number;
    /** True once the specialist called `accept_rating`. False when it agreed by signing the paid exit instead. */
    accepted: boolean;
    /** True once the judge has attested the job. */
    attested: boolean;
    bump: number;
}
/**
 * Reads a rating account. Throws when the bytes are not one: the wrong
 * discriminator, shorter than the layout (which includes the shorter record
 * of the archived Anchor program's `extended` build), or an unknown state.
 */
export declare function decodeRatingAccount(accountData: Uint8Array): RatingAccount;
export declare const ATTESTATION_RESOLUTIONS: readonly ["pending", "confirmed", "disputed"];
export type AttestationResolution = (typeof ATTESTATION_RESOLUTIONS)[number];
export interface AttestationAccount {
    escrow: PublicKey;
    judge: PublicKey;
    consumer: PublicKey;
    /** Accuracy, completeness, relevance, format, latency. */
    scores: [number, number, number, number, number];
    resolution: AttestationResolution;
    /** Slot the attestation was made in; the judge may close an unresolved one after `ATTESTATION_RESOLUTION_SLOTS` from it. */
    createdSlot: bigint;
    bump: number;
}
/** Reads an attestation account. Throws when the bytes are not one. */
export declare function decodeAttestationAccount(accountData: Uint8Array): AttestationAccount;
/**
 * Adds the rating account to an exit of a rated escrow: release, claim,
 * settle, refund or decline, SOL or token. The escrow is the instruction's
 * first account, and the rating account goes right after the usual accounts,
 * writable. Without it the program refuses the exit of a rated escrow
 * (`RatingAccountRequired`, 6033).
 *
 * With `rated` false the instruction is returned as it is, so a transaction
 * for an escrow that is not rated does not change by a byte. Throws for an
 * instruction that is not one of the six exits or lacks its usual accounts.
 */
export declare function withRatingAccount(exit: TransactionInstruction, rated: boolean): TransactionInstruction;
/**
 * `buildSettleTokenEscrowInstruction` for an escrow that may be rated: the
 * same release, claim, settle, refund or decline, with the rating account
 * added when `rated` is true. Read `rated` from the escrow account
 * (`decodeTokenEscrowAccount(...).rated`).
 */
export declare function buildTokenEscrowExitInstruction(terms: TokenEscrowTerms, exit: {
    rated: boolean;
    refund?: boolean;
    authority?: PublicKey;
    options?: SettleTokenEscrowOptions;
}): TransactionInstruction;
export interface SolEscrowTerms {
    programId: PublicKey;
    payer: PublicKey;
    payee: PublicKey;
    /** Lamports. For a metered escrow, the buyer's authorised maximum. */
    amount: bigint;
    nonce: Uint8Array;
    metered?: boolean;
    /** Defaults to `DEFAULT_CLAIM_WINDOW_SLOTS`. */
    claimWindowSlots?: bigint;
    /** Defaults to `DEFAULT_CANCEL_WINDOW_SLOTS`. */
    cancelWindowSlots?: bigint;
}
/** `lock_escrow` or, with `metered`, `lock_metered_escrow`: the payer locks SOL for the payee. */
export declare function buildLockSolEscrowInstruction(t: SolEscrowTerms): TransactionInstruction;
interface SolEscrowExit {
    programId: PublicKey;
    escrow: PublicKey;
    payer: PublicKey;
    payee: PublicKey;
    /** Whether the escrow's rated bit is set; read it from the escrow account. Adds the rating account. */
    rated?: boolean;
    /** Defaults to the protocol treasury fixed in the program. */
    treasury?: PublicKey;
}
/**
 * `release_escrow`: pays the whole locked amount, less the fee. `signer` is
 * who signs: the payer (any time) or the payee (a claim, once the claim
 * window has elapsed).
 *
 * Rated escrow, released by the payer: the rating opens only if the seller
 * called `accept_rating` first. Otherwise the money moves as usual and the
 * rating account is closed, so the job is never rated. Check
 * `payerReleaseOpensRating` before releasing, or leave the seller to claim.
 */
export declare function buildReleaseSolEscrowInstruction(input: SolEscrowExit & {
    signer?: 'payer' | 'payee';
}): TransactionInstruction;
/** `settle_escrow`: the payee settles a metered escrow at `actual` lamports, at most the maximum; the rest returns to the payer. */
export declare function buildSettleSolEscrowInstruction(input: SolEscrowExit & {
    actual: bigint;
}): TransactionInstruction;
/**
 * `cancel_escrow`: everything back to the payer, no fee. `authority` signs:
 * the payee at any time (decline), or the payer once the cancel window has
 * elapsed (refund). A rated escrow's rating account is closed.
 */
export declare function buildCancelSolEscrowInstruction(input: Omit<SolEscrowExit, 'payee' | 'treasury'> & {
    authority: PublicKey;
}): TransactionInstruction;
export interface RatedLock {
    /** The lock, then `open_rating`. Both go into one transaction, in this order, signed by the payer. */
    instructions: [TransactionInstruction, TransactionInstruction];
    escrow: PublicKey;
    rating: PublicKey;
}
/**
 * Buyer: lock a token escrow and opt it in to rating in one transaction.
 * `open_rating` is accepted only in the slot of the lock, so the two must not
 * be split. Use a fresh nonce per job. The payer also pays the rating
 * account's rent, returned at `close_rating`, on a refund, or on a release
 * the seller never agreed to have rated.
 *
 * On a fixed-price job, do not release before the seller has agreed: read the
 * rating account and release only when `payerReleaseOpensRating` is true, or
 * leave the seller to claim. A release without the seller's agreement pays
 * the seller and closes the job unrated.
 */
export declare function buildRatedTokenEscrowLock(terms: TokenEscrowTerms, options?: {
    judge?: PublicKey;
}): RatedLock & {
    vault: PublicKey;
};
/** Buyer: lock a SOL escrow and opt it in to rating in one transaction. See `buildRatedTokenEscrowLock`. */
export declare function buildRatedSolEscrowLock(terms: SolEscrowTerms, options?: {
    judge?: PublicKey;
}): RatedLock;
/**
 * Buyer: whether a release by the payer now would open the rating. True only
 * while the escrow is unpaid and the seller has called `accept_rating`. When
 * false, a payer's release still pays the seller in full but closes the
 * rating account, and the job is never rated or attested; a buyer that wants
 * the rating waits for the seller to accept, or leaves the seller to claim or
 * settle (a paid exit the seller signs as the authority always opens it).
 */
export declare function payerReleaseOpensRating(rating: Pick<RatingAccount, 'state' | 'accepted'>): boolean;
/**
 * Reads the rating account of an escrow, at `confirmed` unless told
 * otherwise. Undefined when there is none: the job was never opted in, was
 * refunded, was released without the seller's agreement, or the rating was
 * closed. Throws when the account is not this program's or is not a rating,
 * and on RPC errors.
 */
export declare function readRatingAccount(connection: EscrowAccountReader, escrow: PublicKey, programId: PublicKey, commitment?: 'confirmed' | 'finalized'): Promise<RatingAccount | undefined>;
/** The part of a `Connection` the buyer and seller helpers use. */
export interface EscrowAccountReader {
    getAccountInfo(address: PublicKey, commitment?: Commitment): Promise<{
        owner: PublicKey;
        data: Uint8Array;
    } | null>;
}
export type EscrowRatingStatus = {
    ok: true;
    kind: 'sol' | 'token';
    metered: boolean;
    /** True when the buyer opted this job in to rating. Every exit must then carry `rating`. */
    rated: boolean;
    /** The rating account's address. An account exists there only while `rated` is true. */
    rating: PublicKey;
} | {
    ok: false;
    reason: 'not_found' | 'wrong_owner' | 'not_an_escrow';
};
/**
 * Seller: tells whether an escrow is rated, before serving. Reads the escrow
 * at `confirmed` commitment: opting in is only possible in the slot of the
 * lock, so a read that sees that whole slot is final on this point, and a
 * `processed` read may not be. Do not pass a weaker commitment.
 *
 * A seller that serves a rated job and is the authority of its settle or
 * claim has agreed to be rated: it must then commit and reveal within the
 * windows or lose reputation. Its claim transaction must not carry the
 * payer's signature (see the note at the top of this file). A seller that does not want that declines the job
 * (`cancel` as the payee, which also needs the rating account).
 *
 * RPC errors are thrown, not turned into "not rated".
 */
export declare function readEscrowRatingStatus(connection: EscrowAccountReader, escrow: PublicKey, programId: PublicKey, commitment?: 'confirmed' | 'finalized'): Promise<EscrowRatingStatus>;
/**
 * Seller: `accept_rating` for a rated escrow that is still locked, for a
 * seller that expects the payer to release (fixed-price jobs). Not needed
 * when the seller settles or claims itself. `seller` is the escrow's payee and signs.
 */
export declare function buildSellerAcceptRating(input: {
    programId: PublicKey;
    escrow: PublicKey;
    seller: PublicKey;
}): TransactionInstruction;
export {};
