import { PublicKey, TransactionInstruction } from '@solana/web3.js';
/**
 * Anchor discriminators: the first 8 bytes of sha256("<kind>:<name>"). Fixed
 * here rather than hashed at runtime so this module also loads in a browser
 * bundle, where `node:crypto` is not available. A test recomputes each one.
 */
export declare const TOKEN_ESCROW_DISCRIMINATORS: Readonly<Record<string, readonly number[]>>;
export interface TokenEscrowTerms {
    programId: PublicKey;
    tokenProgram: PublicKey;
    payer: PublicKey;
    payee: PublicKey;
    mint: PublicKey;
    source: PublicKey;
    recipient: PublicKey;
    amount: bigint;
    nonce: Uint8Array;
    /**
     * Metered (per-token) escrow: `amount` is the buyer's authorised maximum and
     * the payee may settle the actual cost, up to it, at any time.
     */
    metered?: boolean;
    /**
     * Slots after the lock from which the payee may claim the whole amount.
     * Defaults to `DEFAULT_CLAIM_WINDOW_SLOTS` (about 10 minutes).
     */
    claimWindowSlots?: bigint;
    /**
     * Slots after the lock from which the payer may refund itself. Never before
     * the claim window. Defaults to `DEFAULT_CANCEL_WINDOW_SLOTS` (about 30 minutes).
     */
    cancelWindowSlots?: bigint;
}
/** Nominal slot time the program's windows are counted in. Real slot times drift, so a window is approximate in seconds. */
export declare const ESCROW_SLOT_MS = 400;
/** Windows used when a lock names none. Mirror `programs/pinocchio-escrow/program/src/consts.rs`. */
export declare const DEFAULT_CLAIM_WINDOW_SLOTS = 1500n;
export declare const DEFAULT_CANCEL_WINDOW_SLOTS = 4500n;
/** The longest refund window the program accepts: about 30 days. */
export declare const MAX_ESCROW_WINDOW_SLOTS = 6480000n;
/**
 * The least a seller should have left of a metered escrow's refund window
 * when it takes the call: about 10 minutes. The payer may refund once its
 * window has elapsed, so the seller must settle before then. Compare it with
 * `createdSlot + cancelWindowSlots - current slot`, not with the window named
 * at lock, which a buyer can let run down before calling.
 */
export declare const SELLER_MIN_CANCEL_WINDOW_SLOTS = 1500n;
/** A duration in seconds as a whole number of slots, rounded up, at the nominal slot time. */
export declare function escrowWindowSlots(seconds: number): bigint;
/** The program's rule: claim window of at least one slot, no later than the refund window, refund window at most the maximum. */
export declare function escrowWindows(t: Pick<TokenEscrowTerms, 'claimWindowSlots' | 'cancelWindowSlots'>): {
    claimWindowSlots: bigint;
    cancelWindowSlots: bigint;
};
/** Protocol fee treasury fixed in the escrow program: the Squads vault. */
export declare const ESCROW_PROTOCOL_TREASURY: PublicKey;
/** The treasury's associated token account for the escrow mint, which receives token fees. */
export declare function treasuryTokenAccount(t: Pick<TokenEscrowTerms, 'mint' | 'tokenProgram'>, treasury?: PublicKey): PublicKey;
export declare function tokenEscrowAddresses(t: Pick<TokenEscrowTerms, 'programId' | 'payer' | 'nonce'>): {
    escrow: PublicKey;
    vault: PublicKey;
    bump: number;
};
export declare function buildLockTokenEscrowInstruction(t: TokenEscrowTerms): TransactionInstruction;
export interface SettleTokenEscrowOptions {
    /**
     * Settle at this actual cost (at most the locked amount) instead of the
     * whole locked amount. Only the payee may, and only on a metered escrow.
     */
    actual?: bigint;
    /**
     * Pay the payee at this token account instead of the recipient recorded at
     * lock. Only when the payee itself is the authority (claim or settle), and it
     * must be a token account of the escrow mint that the payee owns. For a
     * recorded recipient that was since closed or frozen.
     */
    payTo?: PublicKey;
    /**
     * Pass the mint writable, so that transfer fees withheld on a Token-2022
     * vault are moved to the mint and the vault can close, returning its rent to
     * the payer. Leave it off otherwise: a writable mint makes every such
     * transaction contend for the same account. Applies to refunds too.
     */
    harvestWithheldFees?: boolean;
    /** Treasury token account. The program accepts only the treasury's associated token account for the mint. */
    treasuryToken?: PublicKey;
    /** Where the unused part returns: any token account of the mint the payer owns. Defaults to the recorded source. */
    refundTo?: PublicKey;
}
/**
 * `authority` signs and defaults to the payer. The destination is the recipient in the lock terms, unless the
 * payee is the authority and names another of its own token accounts (`options.payTo`).
 * Release: the program accepts the payer at any time, or the payee once the claim window has elapsed.
 * Settle (`options.actual`): only the payee, and only on a metered escrow; pass the payee as `authority`.
 * The payer never chooses a smaller amount: it releases in full, or refunds once the cancel window has elapsed.
 * Every payout sends 2.5% of the paid amount to the treasury and the rest of the vault back to the payer.
 * Refund: the program accepts the payee at any time (decline), or the payer once the cancel window has elapsed.
 */
export declare function buildSettleTokenEscrowInstruction(t: TokenEscrowTerms, refund?: boolean, authority?: PublicKey, options?: SettleTokenEscrowOptions): TransactionInstruction;
/**
 * Reads a token escrow account. `claimWindowSlots` and `cancelWindowSlots` are
 * undefined on an account the earlier program wrote, which stored no windows.
 */
export declare function decodeTokenEscrowAccount(data: Buffer): {
    claimWindowSlots: bigint | undefined;
    cancelWindowSlots: bigint | undefined;
    payer: PublicKey;
    payee: PublicKey;
    mint: PublicKey;
    source: PublicKey;
    recipient: PublicKey;
    amount: bigint;
    nonce: Buffer<ArrayBufferLike>;
    status: number;
    createdSlot: bigint;
    bump: number;
    metered: boolean;
};
