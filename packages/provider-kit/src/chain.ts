/**
 * The provider's view of the chain: read accounts, read the slot, and send a
 * transaction the provider wallet signs. Everything the request handler needs
 * from Solana goes through this, so tests replace it whole.
 */
import { Connection, PublicKey, Transaction, type Keypair, type TransactionInstruction } from "@solana/web3.js";

export interface ProviderChain {
  readGenesisHash(): Promise<string>;
  readAccount(address: PublicKey): Promise<{ owner: PublicKey; data: Uint8Array; lamports: bigint; executable: boolean } | null>;
  readSlot(): Promise<bigint>;
  /** Signs with the provider wallet, sends, and resolves with the signature once confirmed. Rejects when it did not land. */
  sendInstructions(instructions: TransactionInstruction[]): Promise<string>;
}

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
