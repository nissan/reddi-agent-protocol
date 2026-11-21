import { Keypair, PublicKey, type Connection } from '@solana/web3.js';
import type { X402Challenge, X402PaymentReceipt } from './types';
declare const APPROVAL_PHRASE = "EXECUTE_DEVNET_X402_SPECIALIST_CALL";
export type DevnetUsdcTransferResult = {
    signature: string;
    destinationTokenAccount: string;
};
export type DevnetUsdcPaymentClient = {
    getSolBalanceLamports(publicKey: PublicKey): Promise<number>;
    getUsdcBalanceMicroUnits(owner: PublicKey, mint: PublicKey): Promise<bigint>;
    getOrCreateDestinationTokenAccount(payTo: PublicKey, mint: PublicKey): Promise<string>;
    submitUsdcTransfer(input: {
        payer: Keypair;
        payTo: PublicKey;
        mint: PublicKey;
        amountMicroUnits: bigint;
        destinationTokenAccount: string;
        challenge: X402Challenge;
    }): Promise<DevnetUsdcTransferResult>;
};
export type DevnetUsdcPaymentConfig = {
    rpcUrl: string;
    usdcMint: string;
    walletKeypairPath: string;
    endpointAllowlist: string[];
    maxUsdcMicroUnits: bigint | number | string;
    minFeeLamports?: number;
};
export type DevnetUsdcPaymentReadiness = {
    schemaVersion: 'reddi.x402-solana.devnet-usdc-payment-readiness.v1';
    ready: boolean;
    boundary: 'solana-devnet-only-no-mainnet';
    reasons: string[];
    payer: string | null;
    challenge: Pick<X402Challenge, 'network' | 'payTo' | 'amount' | 'currency' | 'endpoint' | 'nonce'>;
    spend: {
        amountMicroUnits: string;
        maxUsdcMicroUnits: string;
        capRespected: boolean;
    };
    balances: {
        solLamports: number | null;
        usdcMicroUnits: string | null;
    };
    destinationTokenAccount: string | null;
};
export type ExecuteDevnetUsdcPaymentInput = {
    challenge: X402Challenge;
    config: DevnetUsdcPaymentConfig;
    client: DevnetUsdcPaymentClient;
    approvalPhrase: typeof APPROVAL_PHRASE;
};
export declare function loadDevnetKeypair(path: string): Keypair;
export declare function assertDevnetRpcUrl(rpcUrl: string): void;
export declare function assertEndpointAllowed(endpoint: string, allowlist: string[]): void;
export declare function usdcAmountToMicroUnits(amount: string | number): bigint;
export declare function validateDevnetUsdcChallenge(challenge: X402Challenge, config: DevnetUsdcPaymentConfig): {
    payTo: PublicKey;
    mint: PublicKey;
    amountMicroUnits: bigint;
    maxUsdcMicroUnits: bigint;
};
export declare function prepareDevnetUsdcPayment(input: {
    challenge: X402Challenge;
    config: DevnetUsdcPaymentConfig;
    client: Pick<DevnetUsdcPaymentClient, 'getSolBalanceLamports' | 'getUsdcBalanceMicroUnits' | 'getOrCreateDestinationTokenAccount'>;
}): Promise<DevnetUsdcPaymentReadiness>;
export declare function executeDevnetUsdcPayment(input: ExecuteDevnetUsdcPaymentInput): Promise<X402PaymentReceipt>;
export declare function createSolanaDevnetUsdcPaymentClient(connection: Connection): DevnetUsdcPaymentClient;
export declare function challengeFromX402RequestHeader(header: string): X402Challenge;
/**
 * The proof headers for presenting a devnet USDC receipt with `body`, signed by
 * the same wallet file that paid. Send them with `x402-payment` on the paid retry.
 */
export declare function devnetUsdcPaymentProofHeaders(input: {
    receipt: X402PaymentReceipt;
    body: Uint8Array | string;
    walletKeypairPath: string;
}): Promise<Record<string, string>>;
export {};
