import { PublicKey, TransactionInstruction } from '@solana/web3.js';
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
}
export declare function tokenEscrowAddresses(t: Pick<TokenEscrowTerms, 'programId' | 'payer' | 'nonce'>): {
    escrow: PublicKey;
    vault: PublicKey;
    bump: number;
};
export declare function buildLockTokenEscrowInstruction(t: TokenEscrowTerms): TransactionInstruction;
/**
 * Destination is always taken from the original lock terms. `authority` signs and defaults to the payer.
 * Release: the program accepts the payer at any time, or the payee once the claim window has elapsed.
 * Refund: the program accepts the payee at any time (decline), or the payer once the cancel window has elapsed.
 */
export declare function buildSettleTokenEscrowInstruction(t: TokenEscrowTerms, refund?: boolean, authority?: PublicKey): TransactionInstruction;
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
};
