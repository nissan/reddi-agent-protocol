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
}
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
     * whole locked amount. The payee may do this at any time on a metered escrow;
     * the payer may on any escrow.
     */
    actual?: bigint;
    /** Treasury token account. The program accepts only the treasury's associated token account for the mint. */
    treasuryToken?: PublicKey;
    /** Where the unused part returns: any token account of the mint the payer owns. Defaults to the recorded source. */
    refundTo?: PublicKey;
}
/**
 * Destination is always taken from the original lock terms. `authority` signs and defaults to the payer.
 * Release: the program accepts the payer at any time, or the payee once the claim window has elapsed.
 * Settle (`options.actual`): the payee on a metered escrow, or the payer, at any time.
 * Every payout sends 2.5% of the paid amount to the treasury and the rest of the vault back to the payer.
 * Refund: the program accepts the payee at any time (decline), or the payer once the cancel window has elapsed.
 */
export declare function buildSettleTokenEscrowInstruction(t: TokenEscrowTerms, refund?: boolean, authority?: PublicKey, options?: SettleTokenEscrowOptions): TransactionInstruction;
export declare function decodeTokenEscrowAccount(data: Buffer): {
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
