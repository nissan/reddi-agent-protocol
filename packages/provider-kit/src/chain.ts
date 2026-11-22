/**
 * The provider's view of the chain: read accounts, read the slot, and send a
 * transaction the provider wallet signs. Everything the request handler needs
 * from Solana goes through this, so tests replace it whole.
 */
import { Connection, PublicKey, Transaction, type Keypair, type TransactionInstruction } from "@solana/web3.js";
import { transactionFactsReader, type ConfirmedTransactionFacts, type SettlementRecord } from "@redditech/x402-solana";

export interface ProviderChain {
  readGenesisHash(): Promise<string>;
  readAccount(address: PublicKey): Promise<{ owner: PublicKey; data: Uint8Array; lamports: bigint; executable: boolean } | null>;
  readSlot(): Promise<bigint>;
  /** Signs with the provider wallet, sends, and resolves with the signature once confirmed. Rejects when it did not land. */
  sendInstructions(instructions: TransactionInstruction[]): Promise<string>;
  /**
   * Signs with the provider wallet without sending, so the signature can be
   * recorded first. `transaction` is the signed transaction in base64.
   */
  signInstructions(instructions: TransactionInstruction[]): Promise<SignedTransaction>;
  /** Sends a transaction signed by `signInstructions` (again, if it was sent before) and resolves with its signature once confirmed. Rejects when it is not known to have landed. */
  sendSigned(signed: SignedTransaction): Promise<string>;
  /**
   * Where one signature stands. `landed`: confirmed without error. `failed`:
   * confirmed with an error, so it moved nothing. `expired`: not found and its
   * blockhash can no longer land, so it never will. `unknown`: anything else,
   * including an RPC that cannot be reached.
   */
  signatureState(signature: string, lastValidBlockHeight: number): Promise<"landed" | "failed" | "expired" | "unknown">;
  /** What a confirmed transaction did: the programs it called, its top-level instructions, the accounts it named and each token balance before and after. Null when it cannot be found. */
  readSettlement(signature: string): Promise<SettlementRecord | null>;
  /** Who signed a confirmed transaction, the accounts it named and its Memo instructions. Null when it cannot be found. Needed only with `lockBoundDelegations`. */
  readTransactionFacts?(signature: string): Promise<ConfirmedTransactionFacts | null>;
}

export interface SignedTransaction {
  signature: string;
  transaction: string;
  lastValidBlockHeight: number;
}

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** Base58 text of a transaction signature, as the cluster names it. */
export function base58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let text = "";
  while (value > 0n) {
    text = ALPHABET[Number(value % 58n)] + text;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    text = `1${text}`;
  }
  return text;
}

export function createProviderChain(rpcUrl: string, keypair?: Keypair): ProviderChain {
  const connection = new Connection(rpcUrl, "confirmed");
  const readFacts = transactionFactsReader(connection as unknown as Parameters<typeof transactionFactsReader>[0]);
  return {
    readTransactionFacts: (signature) => readFacts(signature),
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
          instructions: message.compiledInstructions.map((instruction) => ({
            programId: key(instruction.programIdIndex),
            accounts: instruction.accountKeyIndexes.map((index) => key(index)),
            data: Buffer.from(instruction.data).toString("base64"),
          })),
        };
      }
      return null;
    },
    async signInstructions(instructions) {
      if (!keypair) throw new Error("no provider key is loaded");
      const latest = await connection.getLatestBlockhash("confirmed");
      const transaction = new Transaction({ feePayer: keypair.publicKey, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }).add(...instructions);
      transaction.sign(keypair);
      return { signature: base58(transaction.signature!), transaction: transaction.serialize().toString("base64"), lastValidBlockHeight: latest.lastValidBlockHeight };
    },
    async sendSigned(signed) {
      const raw = Buffer.from(signed.transaction, "base64");
      const signature = await connection.sendRawTransaction(raw, { preflightCommitment: "confirmed", skipPreflight: false });
      if (signature !== signed.signature) throw new Error("the cluster reported another signature");
      const blockhash = Transaction.from(raw).recentBlockhash!;
      try {
        const confirmation = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight: signed.lastValidBlockHeight }, "confirmed");
        if (confirmation.value.err) throw new Error("the transaction failed on chain");
        return signature;
      } catch (error) {
        const status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true }).catch(() => undefined);
        const value = status?.value;
        if (value && !value.err && (value.confirmationStatus === "confirmed" || value.confirmationStatus === "finalized")) return signature;
        throw error;
      }
    },
    async signatureState(signature, lastValidBlockHeight) {
      try {
        const status = (await connection.getSignatureStatus(signature, { searchTransactionHistory: true })).value;
        if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) return status.err ? "failed" : "landed";
        if (status) return "unknown";
        // Not found. Once the chain is past the blockhash's last valid height it can never land.
        const height = await connection.getBlockHeight("confirmed");
        if (height <= lastValidBlockHeight) return "unknown";
        // Look once more, in case it landed between the two reads.
        const again = (await connection.getSignatureStatus(signature, { searchTransactionHistory: true })).value;
        if (again) return again.err ? "failed" : again.confirmationStatus === "processed" ? "unknown" : "landed";
        return "expired";
      } catch {
        return "unknown";
      }
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
