/**
 * The provider's view of the chain: read accounts, read the slot, and send a
 * transaction the provider wallet signs. Everything the request handler needs
 * from Solana goes through this, so tests replace it whole.
 */
import { Connection, PublicKey, Transaction, type Keypair, type TransactionInstruction } from "@solana/web3.js";
import type { SettlementRecord } from "@reddi/x402-solana";

export interface ProviderChain {
  readGenesisHash(): Promise<string>;
  readAccount(address: PublicKey): Promise<{ owner: PublicKey; data: Uint8Array; lamports: bigint; executable: boolean } | null>;
  readSlot(): Promise<bigint>;
  /** Signs with the provider wallet, sends, and resolves with the signature once confirmed. Rejects when it did not land. */
  sendInstructions(instructions: TransactionInstruction[]): Promise<string>;
  /** What a confirmed transaction did: the programs it called, the accounts it named and each token balance before and after. Null when it cannot be found. */
  readSettlement(signature: string): Promise<SettlementRecord | null>;
}

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

export function createProviderChain(rpcUrl: string, keypair?: Keypair): ProviderChain {
  const connection = new Connection(rpcUrl, "confirmed");
  return {
    readGenesisHash: () => connection.getGenesisHash(),
    async readAccount(address) {
      const info = await connection.getAccountInfo(address, "confirmed");
      return info ? { owner: info.owner, data: new Uint8Array(info.data), lamports: BigInt(info.lamports), executable: info.executable } : null;
    },
    async readSlot() {
      return BigInt(await connection.getSlot("confirmed"));
    },
    async readSettlement(signature) {
      // A transaction that has just confirmed can take a moment to be served.
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (attempt > 0) await pause(500 * attempt);
        const found = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
        if (!found || !found.meta) continue;
        const { meta } = found;
        const message = found.transaction.message;
        const keys = message.getAccountKeys(meta.loadedAddresses ? { accountKeysFromLookups: meta.loadedAddresses } : undefined);
        const key = (index: number) => keys.get(index)?.toBase58() ?? "";
        const accounts = Array.from({ length: keys.length }, (_, index) => key(index));
        const balances = new Map<string, { account: string; mint: string; before: bigint; after: bigint }>();
        const row = (index: number, mint: string) => {
          const id = `${index}:${mint}`;
          if (!balances.has(id)) balances.set(id, { account: key(index), mint, before: 0n, after: 0n });
          return balances.get(id)!;
        };
        for (const b of meta.preTokenBalances ?? []) row(b.accountIndex, b.mint).before = BigInt(b.uiTokenAmount.amount);
        for (const b of meta.postTokenBalances ?? []) row(b.accountIndex, b.mint).after = BigInt(b.uiTokenAmount.amount);
        return {
          failed: meta.err !== null,
          programIds: message.compiledInstructions.map((instruction) => key(instruction.programIdIndex)),
          accounts,
          tokenBalances: [...balances.values()],
        };
      }
      return null;
    },
    async sendInstructions(instructions) {
      if (!keypair) throw new Error("no provider key is loaded");
      const latest = await connection.getLatestBlockhash("confirmed");
      const transaction = new Transaction({ feePayer: keypair.publicKey, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }).add(...instructions);
      transaction.sign(keypair);
      const signature = await connection.sendRawTransaction(transaction.serialize(), { preflightCommitment: "confirmed" });
      try {
        const confirmation = await connection.confirmTransaction({ signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, "confirmed");
        if (confirmation.value.err) throw new Error("the transaction failed on chain");
        return signature;
      } catch (error) {
        // The confirmation can fail while the transaction lands. Look once more before calling it lost.
        const status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true }).catch(() => undefined);
        const value = status?.value;
        if (value && !value.err && (value.confirmationStatus === "confirmed" || value.confirmationStatus === "finalized")) return signature;
        throw error;
      }
    },
  };
}
