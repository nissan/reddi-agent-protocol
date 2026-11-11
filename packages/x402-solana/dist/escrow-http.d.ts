import type { Connection } from '@solana/web3.js';
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
}
export declare const escrowRequestHash: (body: string) => string;
export declare function escrowTerms(c: EscrowChallenge): TokenEscrowTerms;
export declare function createEscrowChallenge(input: Omit<EscrowChallenge, 'scheme' | 'nonce'>): EscrowChallenge;
/** Read-only verification against a trusted RPC. No caller-supplied state or token identity. */
export declare function verifyEscrowLock(connection: Connection, c: EscrowChallenge, proof: EscrowProof): Promise<EscrowReceipt>;
/** Single-process replay protection. Use durable atomic storage for multiple sellers/workers. */
export declare class EscrowSeller {
    private connection;
    private pending;
    private busy;
    constructor(connection: Connection);
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
