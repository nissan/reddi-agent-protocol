import "server-only";

/**
 * Server only. The main app's Budget wiring: devnet only for now (the
 * provider kit refuses Budgets on mainnet too), the escrow program of the
 * devnet profile, the custody store, the spender's public key and the alert
 * sender. The main app never signs: approvals come from the Budget signer
 * project (`apps/budget-signer`, `./signer-client`), the only project the KMS
 * issuer is granted to.
 */

import { SANDBOX_ESCROW_PROGRAM_ID } from "@/lib/sandbox/escrow";
import { sandboxDevnetConnection } from "@/lib/sandbox/runtime";
import { defaultAlertSender } from "./alerts";
import { budgetChainFor } from "./chain";
import type { CustodyDeps } from "./custody";
import type { IncidentChain } from "./incident";
import { readSpenderPublicKey } from "./kms";
import { budgetCustodyStore, GENESIS_HASH } from "./store";
import { tryError } from "@/lib/try/http";
import type { BudgetChainReader } from "./watch";

export const BUDGET_PROGRAM_ID = SANDBOX_ESCROW_PROGRAM_ID;

export function budgetCustodyDeps(): CustodyDeps | undefined {
  const store = budgetCustodyStore();
  if (!store) return undefined;
  return { store, signer: readSpenderPublicKey(), sender: defaultAlertSender() };
}

export function budgetChain(): BudgetChainReader & IncidentChain {
  return budgetChainFor(sandboxDevnetConnection(), BUDGET_PROGRAM_ID);
}

/**
 * A response when the RPC is not devnet, else undefined. Every Budget route
 * that reads the chain or builds a transaction checks it first: the program id
 * is devnet's, and a mainnet RPC would read every Budget as missing.
 */
export async function budgetNotDevnet(chain: Pick<IncidentChain, "genesisHash">, headers: Record<string, string> = {}): Promise<Response | undefined> {
  if ((await chain.genesisHash()) === GENESIS_HASH["solana-devnet"]) return undefined;
  return tryError(503, "not_devnet", "Budgets run on Solana devnet, and this server's RPC is not devnet. Nothing was built or signed.", headers);
}
