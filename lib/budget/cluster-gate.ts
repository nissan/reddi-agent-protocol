/**
 * Server only, no secrets. What every Budget route checks before it serves
 * (#1204, task list lines 2 and 16):
 *
 * - **The cluster.** The RPC must answer the genesis hash of the build's
 *   network (`./network`) before the first request is served. Once it has,
 *   the answer is kept for the life of the server instance, so the check costs
 *   one RPC read per instance, not one per request (S2-claude-12). A wrong
 *   hash refuses every Budget route and tells the operator once per instance;
 *   an RPC that cannot be read refuses and is asked again next time.
 * - **Mainnet opens are refused by config** until the review passes
 *   (RAP-1157-S2, RAP-MB2-S4): `BUDGETS_MAINNET=open` together with a recorded
 *   mainnet deployment, the server RPC (`SOLANA_RPC_URL`, no public default)
 *   and the open-Budget ceiling. Only opening is gated: a payer's own
 *   close, approve, dispute and payout, and the watcher, keep working.
 */

import { mainnetDeploymentRecorded, type BudgetNetwork } from "./network";
import { GENESIS_HASH } from "./store";

export type ClusterCheck = { ok: true } | { ok: false; code: "wrong_cluster" | "chain_unavailable"; message: string };

export type ClusterGateState = { confirmed: Set<BudgetNetwork>; alerted: Set<string> };
const STATE: ClusterGateState = { confirmed: new Set(), alerted: new Set() };

/** Checks (once per instance, until it passes) that the RPC serves `network`. */
export async function checkBudgetCluster(
  input: { network: BudgetNetwork; genesisHash(): Promise<string>; alertOperator?(text: string, detail: Record<string, unknown>): Promise<unknown> },
  state: ClusterGateState = STATE,
): Promise<ClusterCheck> {
  if (state.confirmed.has(input.network)) return { ok: true };
  let hash: string;
  try {
    hash = await input.genesisHash();
  } catch {
    return { ok: false, code: "chain_unavailable", message: "The chain could not be reached. Nothing was built or signed; try again in a moment." };
  }
  if (hash === GENESIS_HASH[input.network]) {
    state.confirmed.add(input.network);
    return { ok: true };
  }
  const key = `${input.network}:${hash}`;
  if (!state.alerted.has(key)) {
    state.alerted.add(key);
    await input
      .alertOperator?.(`A Budget server's RPC answers the genesis hash of another cluster. This build serves ${input.network}; every Budget route refuses until the RPC is fixed and the server redeployed.`, { network: input.network, genesisHash: hash })
      .catch(() => undefined);
    console.error(JSON.stringify({ source: "budget-cluster-gate", event: "wrong_cluster", network: input.network, genesisHash: hash }));
  }
  return { ok: false, code: "wrong_cluster", message: `Budgets here run on ${input.network}, and this server's RPC is on another cluster. Nothing was built or signed.` };
}

/** The setting that opens mainnet Budgets, once the review of the mainnet entry point has passed. */
export const MAINNET_OPEN_ENV = "BUDGETS_MAINNET";

/** Why new Budgets may not be opened on this network now, or undefined when they may. Devnet is always open. */
export function budgetOpenProblem(network: BudgetNetwork, env: Record<string, string | undefined> = process.env, deploymentRecorded: () => boolean = mainnetDeploymentRecorded): string | undefined {
  if (network !== "solana-mainnet-beta") return undefined;
  if (env[MAINNET_OPEN_ENV]?.trim() !== "open") return `${MAINNET_OPEN_ENV} is not "open": mainnet Budgets wait for the review of the mainnet entry point.`;
  if (!deploymentRecorded()) return "config/networks/mainnet.json does not record a mainnet deployment.";
  if (!env.SOLANA_RPC_URL?.trim()) return "SOLANA_RPC_URL is not set: mainnet Budgets need the server's own RPC.";
  if (!/^[1-9]\d{0,5}$/.test(env.BUDGET_MAX_OPEN_RELAY?.trim() ?? "")) return "BUDGET_MAX_OPEN_RELAY is not set to a whole number: mainnet needs a ceiling on open relay Budgets.";
  return undefined;
}
