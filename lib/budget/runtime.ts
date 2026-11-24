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
import { budgetCustodyStore } from "./store";
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
