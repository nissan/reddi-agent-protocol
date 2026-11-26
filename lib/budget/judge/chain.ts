/**
 * Server only. What the RAP judge reads from and sends to the chain. It finds
 * disputed slices itself, from the program's accounts, so a broken app or
 * database cannot hide a dispute from it.
 */

import bs58 from "bs58";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { BUDGET_DISCRIMINATORS, RESERVATION_ACCOUNT_LEN, RESERVATION_STATES } from "@redditech/x402-solana/budget";

export type ChainAccount = { owner: PublicKey; data: Uint8Array; lamports: number };

export interface JudgeChain {
  slot(): Promise<bigint>;
  /** Every reservation account of the program in the disputed state: address and data. */
  disputedReservations(): Promise<{ address: PublicKey; data: Uint8Array }[]>;
  readAccount(address: PublicKey): Promise<ChainAccount | null>;
  balance(address: PublicKey): Promise<number>;
  latestBlockhash(): Promise<string>;
  /** Sends a fully signed transaction and waits for `confirmed`. Throws on failure, with the chain's error. */
  sendAndConfirm(tx: Transaction): Promise<string>;
  /** The genesis hash, to check the RPC serves the network the judge was set up for. */
  genesisHash(): Promise<string>;
}

/** The byte at which a reservation's state is stored (`decodeReservation`). */
const STATE_OFFSET = 144;

export function judgeChainFor(connection: Connection, programId: PublicKey): JudgeChain {
  return {
    async slot() {
      return BigInt(await connection.getSlot("confirmed"));
    },
    async disputedReservations() {
      const accounts = await connection.getProgramAccounts(programId, {
        commitment: "confirmed",
        filters: [
          { dataSize: RESERVATION_ACCOUNT_LEN },
          { memcmp: { offset: 0, bytes: bs58.encode(Uint8Array.from(BUDGET_DISCRIMINATORS["account:Reservation"])) } },
          { memcmp: { offset: STATE_OFFSET, bytes: bs58.encode(Uint8Array.from([RESERVATION_STATES.indexOf("disputed")])) } },
        ],
      });
      return accounts.map((a) => ({ address: a.pubkey, data: a.account.data }));
    },
    async readAccount(address) {
      const info = await connection.getAccountInfo(address, "confirmed");
      return info ? { owner: info.owner, data: info.data, lamports: info.lamports } : null;
    },
    async balance(address) {
      return connection.getBalance(address, "confirmed");
    },
    async latestBlockhash() {
      return (await connection.getLatestBlockhash("confirmed")).blockhash;
    },
    async sendAndConfirm(tx) {
      const signature = await connection.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed" });
      for (let i = 0; i < 40; i += 1) {
        const status = (await connection.getSignatureStatuses([signature])).value[0];
        if (status?.err) throw new Error(`ruling failed on chain: ${JSON.stringify(status.err)}`);
        if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return signature;
        await new Promise((r) => setTimeout(r, 1000));
      }
      throw new Error(`ruling not confirmed in time: ${signature}`);
    },
    async genesisHash() {
      return connection.getGenesisHash();
    },
  };
}
