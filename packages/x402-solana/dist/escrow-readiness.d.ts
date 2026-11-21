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
    /** Idempotent creates to put before the settle in the same transaction. */
    instructions: TransactionInstruction[];
    /** The payer's associated token account, to pass as `refundTo`. */
    refundTo: PublicKey;
    treasuryToken: PublicKey;
}
/**
 * Instructions that make sure a token payout's destinations exist: the
 * treasury's associated token account for the mint, and the payer's, which
 * receives the unused part. Both creates are idempotent, so they cost nothing
 * when the accounts are already there. `funder` pays rent for any account it
 * creates and must sign the transaction; for a settle that is the payee.
 */
export declare function prepareTokenPayout(t: Pick<TokenEscrowTerms, 'mint' | 'tokenProgram' | 'payer'>, funder: PublicKey, treasury?: PublicKey): SettlePreparation;
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
 * small fee to land, and a token account owned by the treasury for each mint,
 * under the mint's token program. Nothing is sent.
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
