import "server-only";

/**
 * Server only. The main app's Budget wiring for the build's network
 * (`./network`): the escrow program of that network's profile, its RPC, the
 * custody store, the spender's public key and the alert sender. The main app
 * never signs: approvals come from the Budget signer project
 * (`apps/budget-signer`, `./signer-client`), the only project the KMS issuer
 * is granted to.
 *
 * On devnet the RPC is the sandbox's devnet connection. On mainnet it is the
 * server's own keyed RPC (`SOLANA_RPC_URL`, Helius), with no public default:
 * a mainnet build without it serves no Budget route. Every route passes
 * `budgetGate` first (`./cluster-gate`): the RPC's genesis hash, once per
 * instance, and for an open, the mainnet switch.
 */

import { Connection } from "@solana/web3.js";
import { sandboxDevnetConnection } from "@/lib/sandbox/runtime";
import { serverRpcEndpoint } from "@/lib/rpc/server-rpc";
import { tryError } from "@/lib/try/http";
import { defaultAlertSender, sendBudgetAlert } from "./alerts";
import { budgetChainFor } from "./chain";
import { budgetOpenProblem, checkBudgetCluster } from "./cluster-gate";
import type { CustodyDeps } from "./custody";
import type { IncidentChain } from "./incident";
import { readSpenderPublicKey } from "./kms";
import { BUDGET_NETWORK_LABEL, budgetNetwork, budgetProgramIdFor } from "./network";
import { budgetRateLimited, supabaseCounter, type BudgetRoute } from "./rate-limit";
import { budgetCustodyStore } from "./store";
import type { BudgetChainReader } from "./watch";

export const BUDGET_NETWORK = budgetNetwork();
export const BUDGET_PROGRAM_ID = budgetProgramIdFor(BUDGET_NETWORK);

/** The custody store of this build's network: on mainnet the `budget_mainnet` schema through its own role, never the service key (#1205). */
export function budgetStore() {
  return budgetCustodyStore(process.env, BUDGET_NETWORK);
}

export function budgetCustodyDeps(): CustodyDeps | undefined {
  const store = budgetStore();
  if (!store) return undefined;
  return { store, signer: readSpenderPublicKey(), sender: defaultAlertSender() };
}

let mainnetConnection: Connection | undefined;

/** The Budget network's RPC. Throws on a mainnet build with no `SOLANA_RPC_URL`: there is no public fallback. */
export function budgetConnection(): Connection {
  if (BUDGET_NETWORK !== "solana-mainnet-beta") return sandboxDevnetConnection();
  if (!mainnetConnection) {
    const endpoint = serverRpcEndpoint();
    if (!endpoint.ok || endpoint.source !== "SOLANA_RPC_URL") throw new Error("SOLANA_RPC_URL is required for mainnet Budgets");
    mainnetConnection = new Connection(endpoint.url, "confirmed");
  }
  return mainnetConnection;
}

/** What a route says when the chain could not be read, named for the build's network. */
export function chainUnavailableMessage(signedNothing = true): string {
  return `${BUDGET_NETWORK_LABEL[BUDGET_NETWORK]} could not be reached.${signedNothing ? " Nothing was signed;" : ""} try again in a moment.`;
}

export function budgetChain(): BudgetChainReader & IncidentChain {
  return budgetChainFor(budgetConnection(), BUDGET_PROGRAM_ID);
}

const counter = supabaseCounter(BUDGET_NETWORK);

/**
 * A response when this Budget route must not be served now, else undefined:
 * for an open (`prepare`, `start`) the mainnet switch, then the durable rate
 * limits (`./rate-limit`), then the cluster check. `chain` is undefined only for
 * routes that read no chain.
 */
export async function budgetGate(
  request: Request,
  route: BudgetRoute,
  input: { chain?: Pick<IncidentChain, "genesisHash">; key?: string; payer?: string; headers?: Record<string, string> } = {},
): Promise<Response | undefined> {
  const headers = input.headers ?? {};
  if (route === "prepare" || route === "start") {
    const problem = budgetOpenProblem(BUDGET_NETWORK);
    if (problem) {
      console.error(JSON.stringify({ source: "budget-gate", event: "budgets_not_open", network: BUDGET_NETWORK, problem }));
      return tryError(503, "budgets_not_open", `New Budgets are not open on ${BUDGET_NETWORK_LABEL[BUDGET_NETWORK]} yet. Nothing was signed.`, headers);
    }
  }
  const limited = await budgetRateLimited(request, route, { network: BUDGET_NETWORK, counter, key: input.key, payer: input.payer, headers });
  if (limited) return limited;
  let chain = input.chain;
  if (!chain) {
    try {
      chain = budgetChain();
    } catch {
      return tryError(503, "chain_unavailable", "This server has no RPC for Budgets. Nothing was built or signed.", headers);
    }
  }
  const checked = await checkBudgetCluster({ network: BUDGET_NETWORK, genesisHash: () => chain!.genesisHash(), alertOperator: operatorAlert });
  if (!checked.ok) return tryError(503, checked.code, checked.message, headers);
  return undefined;
}

/** Tells the operator, through the same channels as every Budget operator alert. */
async function operatorAlert(text: string, detail: Record<string, unknown>): Promise<void> {
  const store = budgetStore();
  if (!store) return;
  await sendBudgetAlert({ audience: "operator", kind: "incident", subject: "Budget server on the wrong cluster", text, detail }, undefined, { store, sender: defaultAlertSender() });
}
