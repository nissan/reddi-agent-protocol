import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { TokenEscrowTerms } from './token-escrow';
/**
 * Launch and payout checks for the V1 escrow program. These guard against
 * payouts that the program would accept but the runtime would refuse: a SOL
 * transfer that leaves the receiver below the rent-exempt minimum, and a token
 * payout to a treasury or refund token account that does not exist yet.
 */
/** Rent-exempt minimum of a plain system account (0 bytes of data). */
export declare const SYSTEM_ACCOUNT_RENT_EXEMPT_LAMPORTS = 890880n;
/** The treasury holds at least this much SOL before the first SOL payout, so a small fee never fails on rent. */
export declare const TREASURY_MIN_LAMPORTS = 1000000n;
/**
 * True when sending `incomingLamports` to an account holding `currentLamports`
 * would leave it above zero but below the rent-exempt minimum, which the
 * runtime refuses (InsufficientFundsForRent). A zero transfer never fails.
 */
export declare function solPayoutWouldFail(currentLamports: bigint, incomingLamports: bigint, rentExemptLamports?: bigint): boolean;
/**
 * The smallest payout a payee holding `currentLamports` can receive. Zero when
 * the payee is already rent-exempt.
 */
export declare function minimumSolPayout(currentLamports: bigint, rentExemptLamports?: bigint): bigint;
export interface SettlePreparation {
    /** Creates to put before the settle in the same transaction. Empty unless a create was asked for. */
    instructions: TransactionInstruction[];
    /** Where the unused part returns: the account named in the options, or the payer's associated token account. */
    refundTo: PublicKey;
    treasuryToken: PublicKey;
}
export interface TokenPayoutOptions {
    /** Return the unused part to this token account of the payer instead of its associated token account. */
    refundTo?: PublicKey;
    /**
     * Create the treasury's associated token account if it is missing, at the
     * funder's cost. Off by default: readiness is checked before a currency
     * opens, and a settle should not carry the create every time.
     */
    createTreasuryAccount?: boolean;
    /**
     * Create the payer's associated token account if it is missing, at the
     * funder's cost (its rent, about 0.002 SOL, is not returned to the funder).
     * Off by default: this is a subsidy, and the caller decides when to pay it.
     */
    createRefundAccount?: boolean;
    /**
     * Create a new token account owned by the payer at `seedAddress(funder,
     * seed, token program)` and return the unused part there. Only the funder can
     * create an account at that address, so the payer cannot close, re-own or
     * memo-lock it before the settle lands. The funder pays `lamports` (rent,
     * not returned) and signs. Takes the place of `createRefundAccount`.
     */
    freshRefundAccount?: FreshRefundAccount;
}
/** A token account the settle creates for the payer's refund. */
export interface FreshRefundAccount {
    /** At most 32 characters. */
    seed: string;
    /** The account size the mint needs (165 for classic SPL Token, more for some Token-2022 mints). */
    space: number;
    lamports: bigint;
}
/** `PublicKey.createWithSeed`, synchronously: sha256(base || seed || owner program). */
export declare function seedAddress(base: PublicKey, seed: string, program: PublicKey): PublicKey;
/** The seed of the refund account a settle creates for one lock: the escrow and its lock slot, so a later lock at the same address gets another. */
export declare function freshRefundSeed(escrow: PublicKey, createdSlot: bigint): string;
/**
 * The accounts a token payout names next to the escrow's own: the treasury's
 * associated token account for the mint, and the account the unused part
 * returns to. Nothing is created unless the options ask for it; a create is
 * idempotent, `funder` pays its rent and must sign the transaction.
 */
export declare function prepareTokenPayout(t: Pick<TokenEscrowTerms, 'mint' | 'tokenProgram' | 'payer'>, funder: PublicKey, treasury?: PublicKey, options?: TokenPayoutOptions): SettlePreparation;
export type TokenAccountProblem = 'missing' | 'wrong_program' | 'not_token_account' | 'uninitialised' | 'frozen' | 'wrong_mint' | 'wrong_owner' | 'memo_required';
export type TokenAccountCheck = {
    ok: true;
    amount: bigint;
} | {
    ok: false;
    problem: TokenAccountProblem;
    detail: string;
};
/**
 * Whether a token account can receive a transfer of `mint` right now: it
 * exists under the mint's token program, is initialised and not frozen, holds
 * the mint, belongs to `owner` when one is named, and does not require a memo
 * on incoming transfers (the escrow program sends none). Reads the whole
 * account, not only its first fields.
 */
export declare function checkTokenAccount(address: PublicKey, account: Pick<ReadAccount, 'owner' | 'data'> | null, expected: {
    mint: PublicKey;
    tokenProgram: PublicKey;
    owner?: PublicKey;
}): TokenAccountCheck;
export interface EscrowMint {
    symbol: string;
    mint: PublicKey;
    tokenProgram: PublicKey;
}
/** The mainnet allowlist of the V1 escrow program (programs/pinocchio-escrow/program/src/consts.rs). */
export declare const ESCROW_MAINNET_MINTS: readonly EscrowMint[];
/** The devnet build's extra mint (devnet USDC). */
export declare const ESCROW_DEVNET_MINTS: readonly EscrowMint[];
export interface ReadAccount {
    lamports: number | bigint;
    owner: PublicKey;
    data: Uint8Array;
}
export type AccountLookup = (address: PublicKey) => Promise<ReadAccount | null>;
export interface ReadinessItem {
    name: string;
    address: string;
    ok: boolean;
    detail: string;
}
/**
 * Read-only check that the treasury can receive every payout: enough SOL for a
 * small fee to land, and for each mint a token account under the mint's token
 * program that the treasury owns, initialised, not frozen and not requiring a
 * memo. Nothing is sent.
 */
export declare function checkTreasuryReadiness(lookup: AccountLookup, mints?: readonly EscrowMint[], treasury?: PublicKey): Promise<{
    ok: boolean;
    items: ReadinessItem[];
}>;
/**
 * What an issuer can change on a Token-2022 mint that would affect escrows in
 * it: the extensions present, the transfer hook program, the transfer fee, the
 * permanent delegate and the freeze, close and pause authorities. Supply and
 * metadata text are left out because they change in normal use.
 */
export interface Token2022MintPosture {
    extensionTypes: number[];
    transferHookProgram: string | null;
    transferFee: {
        olderBps: number;
        newerBps: number;
        newerEpoch: string;
        newerMaximumFee: string;
    } | null;
    permanentDelegate: string | null;
    freezeAuthority: string | null;
    mintCloseAuthority: string | null;
    pausable: {
        authority: string | null;
        paused: boolean;
    } | null;
}
/** Reads the posture from a Token-2022 mint account's raw data. */
export declare function token2022MintPosture(data: Uint8Array, address?: PublicKey): Token2022MintPosture;
/** Each field that differs from the recorded posture, as "field: before -> after". Empty when nothing changed. */
export declare function mintPostureChanges(recorded: Token2022MintPosture, current: Token2022MintPosture): string[];
