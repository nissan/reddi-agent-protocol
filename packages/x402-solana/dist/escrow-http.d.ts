import type { Connection } from '@solana/web3.js';
import type { TransactionInstruction } from '@solana/web3.js';
import { TokenEscrowTerms } from './token-escrow';
/** RAP-specific escrow extension; not the interoperable x402 SVM exact scheme. */
export interface EscrowChallenge {
    scheme: 'rap-spl-escrow-v1';
    network: 'solana-local-validator' | 'solana-devnet';
    genesisHash: string;
    tokenProgram: string;
    decimals: number;
    endpoint: string;
    requestHash: string;
    programId: string;
    payer: string;
    payee: string;
    mint: string;
    source: string;
    recipient: string;
    amount: string;
    nonce: string;
    expiresAt: number;
    /**
     * Slots after the lock from which the payee may claim. A whole number,
     * at least 1 and at most `cancelWindowSlots`. Omitted: about 10 minutes.
     */
    claimWindowSlots?: number;
    /**
     * Slots after the lock from which the payer may refund itself, at most
     * about 30 days. Omitted: about 30 minutes.
     */
    cancelWindowSlots?: number;
}
export interface EscrowProof {
    nonce: string;
    lockSignature: string;
}
export interface EscrowReceipt extends EscrowProof {
    scheme: 'rap-spl-escrow-v1';
    status: 'locked';
    escrow: string;
    amount: string;
    mint: string;
    requestHash: string;
    slot: number;
    /**
     * Present, and true, only when the buyer opted the escrow in to rating and
     * the seller accepts rated escrows. Every exit of that escrow must then
     * pass its rating account: build the seller's claim or decline with
     * `buildEscrowSellerExit`.
     */
    rated?: true;
}
export interface EscrowVerifyOptions {
    /**
     * Serve escrows the buyer opted in to rating. Default false: a rated escrow
     * is refused before anything is served. A seller that claims a rated escrow
     * has agreed to be rated and must then commit and reveal a rating of its
     * own within the program's windows or lose reputation.
     */
    acceptRatedEscrows?: boolean;
}
export declare const escrowRequestHash: (body: string) => string;
export declare function escrowTerms(c: EscrowChallenge): TokenEscrowTerms;
export declare function createEscrowChallenge(input: Omit<EscrowChallenge, 'scheme' | 'nonce'>): EscrowChallenge;
/**
 * Read-only verification against a trusted RPC. No caller-supplied state or token identity.
 * The escrow is read at `finalized`, in or after the slot of the lock, which is the only slot a
 * buyer can opt it in to rating in, so the rated bit read here is final. A rated escrow is
 * refused unless `options.acceptRatedEscrows` is true; when accepted, the receipt says `rated`.
 */
export declare function verifyEscrowLock(connection: Connection, c: EscrowChallenge, proof: EscrowProof, options?: EscrowVerifyOptions): Promise<EscrowReceipt>;
/**
 * The seller's exit of an escrow it accepted, signed by the payee: `claim`
 * (release to itself, once the claim window has elapsed) or `decline`
 * (everything back to the payer, at any time). For a receipt that says
 * `rated` the escrow's rating account follows the usual accounts, without
 * which the program refuses the exit; otherwise the instruction is exactly
 * `buildSettleTokenEscrowInstruction`'s.
 */
export declare function buildEscrowSellerExit(c: EscrowChallenge, receipt: Pick<EscrowReceipt, 'rated'>, kind: 'claim' | 'decline'): TransactionInstruction;
/** Single-process replay protection. Use durable atomic storage for multiple sellers/workers. */
export declare class EscrowSeller {
    private connection;
    private options;
    private pending;
    private busy;
    /** `options.acceptRatedEscrows` (default false): serve escrows opted in to rating; see `EscrowVerifyOptions`. */
    constructor(connection: Connection, options?: EscrowVerifyOptions);
    issue(input: Omit<EscrowChallenge, 'scheme' | 'nonce'>): EscrowChallenge;
    accept(endpoint: string, body: string, proof: EscrowProof): Promise<EscrowReceipt>;
}
/** Recovery context survives a paid retry/transport failure; never auto-pay twice. */
export declare class EscrowPurchaseError extends Error {
    readonly challenge: EscrowChallenge;
    readonly proof: EscrowProof;
    constructor(message: string, challenge: EscrowChallenge, proof: EscrowProof);
}
export interface EscrowHttpResponse {
    status: number;
    headers: {
        get(name: string): string | null;
    };
    json(): Promise<unknown>;
}
/** At most one approved lock and one retry; transport and signing remain caller-owned. */
export declare function buyWithEscrow(input: {
    endpoint: string;
    body: string;
    request(proof?: EscrowProof): Promise<EscrowHttpResponse>;
    approve(c: EscrowChallenge): Promise<void>;
    lock(c: EscrowChallenge): Promise<string>;
}): Promise<{
    result: unknown;
    receipt: EscrowReceipt;
}>;
