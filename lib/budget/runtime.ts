import "server-only";

/**
 * Server only. The Budget relay's runtime wiring: devnet only for now (the
 * provider kit refuses Budgets on mainnet too), the escrow program of the
 * devnet profile, the custody store, the KEKs and the alert sender.
 */

import type { Connection } from "@solana/web3.js";
import { SANDBOX_ESCROW_PROGRAM_ID } from "@/lib/sandbox/escrow";
import { sandboxDevnetConnection } from "@/lib/sandbox/runtime";
import { defaultAlertSender } from "./alerts";
import type { CustodyDeps } from "./custody";
import type { IncidentChain } from "./incident";
import { readKeks } from "./keys";
import { budgetCustodyStore } from "./store";
import { budgetChainReader, type BudgetChainReader } from "./watch";

export const BUDGET_PROGRAM_ID = SANDBOX_ESCROW_PROGRAM_ID;

export function budgetCustodyDeps(): CustodyDeps | undefined {
  const store = budgetCustodyStore();
  if (!store) return undefined;
  return { store, keks: readKeks(), sender: defaultAlertSender() };
}

export function budgetChain(): BudgetChainReader & IncidentChain {
  const connection: Connection = sandboxDevnetConnection();
  const reader = budgetChainReader(connection as never, BUDGET_PROGRAM_ID);
  return {
    ...reader,
    async latestBlockhash() {
      return (await connection.getLatestBlockhash("confirmed")).blockhash;
    },
    async sendAndConfirm(tx) {
      const signature = await connection.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed" });
      for (let i = 0; i < 60; i += 1) {
        const status = (await connection.getSignatureStatuses([signature])).value[0];
        if (status?.err) throw new Error(`close failed on chain: ${JSON.stringify(status.err)}`);
        if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return signature;
        await new Promise((r) => setTimeout(r, 1000));
      }
      throw new Error(`close not confirmed in time: ${signature}`);
    },
  };
}
