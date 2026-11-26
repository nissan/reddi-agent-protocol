#!/usr/bin/env node
/**
 * `npx @redditech/x402-solana budget status|close|payout|freeze <budget>`:
 * a payer's way to look after a pooled budget with nothing but its address,
 * an RPC endpoint and their own wallet (#1209). No app, relay or account is
 * needed for `status`, `close` and `payout`: they read the chain and send
 * ordinary transactions. `freeze` asks a relay's signer to stop signing for
 * the budget, on the payer's signature.
 *
 * The keypair file (`--keypair`, a Solana CLI JSON file) is read on this
 * machine only, to sign; it is never sent anywhere. Without it, `close` and
 * `payout` print the unsigned transactions (base64) to sign in a wallet.
 */
import { PublicKey, Transaction } from '@solana/web3.js';
import { type BudgetRecoverReader } from './budget-recover';
export declare const USAGE: string;
/** What the command reaches outside itself, so tests can stand in for all of it. */
export interface CliIo {
    out(line: string): void;
    err(line: string): void;
    env: Record<string, string | undefined>;
    readFile(path: string): string;
    nowMs(): number;
    fetch(url: string, init: {
        method: string;
        headers: Record<string, string>;
        body: string;
    }): Promise<{
        status: number;
        text(): Promise<string>;
    }>;
    /** The chain behind an RPC url. */
    chain(rpc: string, programId: PublicKey): CliChain;
}
export interface CliChain extends BudgetRecoverReader {
    genesisHash(): Promise<string>;
    latestBlockhash(): Promise<string>;
    /** Sends a signed transaction and waits for it to confirm. Returns its signature. */
    sendAndConfirm(tx: Transaction): Promise<string>;
}
export declare const defaultIo: () => CliIo;
/** Runs one command. Returns the process exit code. */
export declare function runCli(argv: string[], io?: CliIo): Promise<number>;
