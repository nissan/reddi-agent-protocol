/**
 * Server only. The chain access the Budget relay and the Budget signer use:
 * account reads, the slot and genesis hash, and sending a signed close.
 */

import type { Connection, PublicKey } from "@solana/web3.js";
import type { IncidentChain } from "./incident";
import { budgetChainReader, type BudgetChainReader } from "./watch";

export function budgetChainFor(connection: Connection, programId: PublicKey): BudgetChainReader & IncidentChain {
  const reader = budgetChainReader(connection as never, programId);
  return {
    ...reader,
    async latestBlockhash() {
      return (await connection.getLatestBlockhash("confirmed")).blockhash;
    },
    async sendAndConfirm(tx) {
      const signature = await connection.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed" });
      for (let i = 0; i < 40; i += 1) {
        const status = (await connection.getSignatureStatuses([signature])).value[0];
        if (status?.err) throw new Error(`close failed on chain: ${JSON.stringify(status.err)}`);
        if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return signature;
        await new Promise((r) => setTimeout(r, 1000));
      }
      throw new Error(`close not confirmed in time: ${signature}`);
    },
  };
}
