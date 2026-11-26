/**
 * What a payer needs to look after a pooled budget without any app (#1209):
 * read it from the chain, close it, and collect what is owed back, from the
 * budget's address alone; and the message a payer signs to have a relay's
 * signer stop signing for a budget whose agent key leaked.
 *
 * Everything here reads public chain data and builds instructions. Nothing
 * here holds a key or sends a transaction: the caller signs and sends
 * (`./cli` does both for a keypair file the payer names).
 */
import { PublicKey, type TransactionInstruction } from '@solana/web3.js';
import { type BudgetAccount, type ReservationAccount } from './budget';
/** The V1 program, at the same address on devnet and mainnet. */
export declare const BUDGET_PROGRAM_ID: PublicKey;
export type BudgetRecoverNetwork = 'solana-devnet' | 'solana-mainnet-beta';
/** Each network's genesis hash, to tell an RPC on the wrong cluster. */
export declare const BUDGET_GENESIS_HASH: Readonly<Record<BudgetRecoverNetwork, string>>;
/** How old (or how far ahead) a freeze request may be when the signer gets it, in seconds. */
export declare const BUDGET_FREEZE_MAX_AGE_SECONDS = 600;
export declare const BUDGET_FREEZE_MAX_AHEAD_SECONDS = 120;
export interface BudgetFreezeRequest {
    network: BudgetRecoverNetwork;
    /** The budget's address (base58). */
    budget: string;
    /** The payer's wallet (base58): the one that signs. */
    payer: string;
    /** Unix seconds. */
    issuedAt: number;
}
/**
 * The text a payer's wallet signs (Ed25519, as `signMessage` does) to have
 * the relay's signer stop signing for one budget. It can only freeze: a
 * frozen budget gets no further call or reserve approval, and can still be
 * closed. Signing it again later is harmless.
 */
export declare function budgetFreezeMessage(request: BudgetFreezeRequest): Uint8Array;
/** What the recovery steps read from the chain. */
export interface BudgetRecoverReader {
    readAccount(address: PublicKey): Promise<{
        owner: PublicKey;
        data: Uint8Array;
    } | null>;
    /** Every reservation account of `budget` under the program. */
    reservations(budget: PublicKey): Promise<{
        address: PublicKey;
        data: Uint8Array;
    }[]>;
    slot(): Promise<bigint>;
}
type ConnectionLike = {
    getAccountInfo(address: PublicKey): Promise<{
        owner: PublicKey;
        data: Uint8Array;
    } | null>;
    getProgramAccounts(programId: PublicKey, config: {
        filters: unknown[];
    }): Promise<readonly {
        pubkey: PublicKey;
        account: {
            data: Uint8Array;
        };
    }[]>;
    getSlot(): Promise<number>;
};
/** A reader over a web3.js `Connection` (or anything shaped like one). */
export declare function budgetRecoverReader(connection: ConnectionLike, programId?: PublicKey): BudgetRecoverReader;
/** One provider's slice, and whether anyone can settle it now. */
export interface BudgetSliceStatus {
    address: PublicKey;
    reservation: ReservationAccount;
    /** A payout sent now would be accepted. */
    payable: boolean;
    /** The first slot a payout is accepted, when that is known and not yet reached. */
    payableAtSlot: bigint | null;
    /** In plain words: what a payout does, or what it waits for. */
    note: string;
}
export type BudgetStatus = {
    found: false;
    budget: PublicKey;
    reason: 'no_account' | 'not_a_budget';
} | {
    found: true;
    budget: PublicKey;
    programId: PublicKey;
    account: BudgetAccount;
    slot: bigint;
    /** The token program of a token budget's mint. Null for SOL. */
    tokenProgram: PublicKey | null;
    slices: BudgetSliceStatus[];
    /** Not closed yet: the payer can close now, anyone can once `account.openEnds` is reached. */
    open: boolean;
    anyoneMayClose: boolean;
};
/** Reads a budget and its slices from its address alone. */
export declare function readBudgetStatus(reader: BudgetRecoverReader, budget: PublicKey, programId?: PublicKey): Promise<BudgetStatus>;
type Found = Extract<BudgetStatus, {
    found: true;
}>;
/**
 * The instructions that close a budget: what was never reserved goes back to
 * the payer at once. `signer` is who signs and pays the fee: the payer at any
 * time, anyone once the open period has ended. For a token budget the
 * payer's associated token account is created first if it is missing.
 */
export declare function closeBudgetInstructions(status: Found, signer: PublicKey): TransactionInstruction[];
/**
 * One group of instructions per slice a payout would settle now (anyone may
 * send them; `feePayer` pays the fee and any missing token account). Send
 * each group as its own transaction. The money can only go to the provider's
 * recorded account, the treasury and the payer.
 */
export declare function payoutBudgetInstructions(status: Found, feePayer: PublicKey, treasury?: PublicKey): {
    slice: BudgetSliceStatus;
    instructions: TransactionInstruction[];
}[];
export {};
