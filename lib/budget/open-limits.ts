/**
 * Server only. How many relay Budgets may be open at once (#1204, task list
 * line 16, S2-claude-05/06): a ceiling over all payers on the network
 * (`BUDGET_MAX_OPEN_RELAY`, required on mainnet) and a smaller one per payer
 * (`BUDGET_MAX_OPEN_PER_PAYER`), so a few wallets cannot hold every slot the
 * signer and watcher are sized for. A pending record (opened by the page,
 * not yet on chain) holds a slot until it expires.
 *
 * Checked when the terms are prepared, before the wallet signs anything, and
 * again at start. Two payers starting at the same moment can pass the same
 * last slot; the ceiling is a soft one by a request or two, and the signer's
 * own approval ceilings still hold.
 */

import type { BudgetNetwork } from "./network";
import type { BudgetCustodyStore } from "./store";

export type OpenLimitRefusal = { ok: false; status: number; code: string; message: string };

const DEFAULTS: Record<BudgetNetwork, { total: number; perPayer: number }> = {
  "solana-devnet": { total: 500, perPayer: 10 },
  // No default total on mainnet: the gate (`./cluster-gate`) refuses opens until it is set.
  "solana-mainnet-beta": { total: 0, perPayer: 3 },
};

function count(raw: string | undefined, fallback: number): number {
  const value = raw?.trim();
  return value && /^[1-9]\d{0,5}$/.test(value) ? Number(value) : fallback;
}

export function openBudgetLimits(network: BudgetNetwork, env: Record<string, string | undefined> = process.env): { total: number; perPayer: number } {
  return { total: count(env.BUDGET_MAX_OPEN_RELAY, DEFAULTS[network].total), perPayer: count(env.BUDGET_MAX_OPEN_PER_PAYER, DEFAULTS[network].perPayer) };
}

/** Undefined when this payer may open one more Budget now, else the refusal. */
export async function openBudgetRoom(
  input: { store: BudgetCustodyStore; network: BudgetNetwork; payer: string; env?: Record<string, string | undefined> },
): Promise<OpenLimitRefusal | undefined> {
  const limits = openBudgetLimits(input.network, input.env);
  if (limits.total < 1) return { ok: false, status: 503, code: "budgets_not_open", message: "New Budgets are not open here yet." };
  let records;
  try {
    records = (await input.store.withStatus(["pending", "open"])).filter((r) => r.network === input.network);
  } catch {
    return { ok: false, status: 503, code: "store_unavailable", message: "Budgets could not be counted. Nothing was signed; try again." };
  }
  if (records.length >= limits.total) {
    return { ok: false, status: 503, code: "budgets_full", message: "RAP has as many Budgets open as it takes for now. Try again later, or close a Budget you no longer use." };
  }
  if (records.filter((r) => r.payer === input.payer).length >= limits.perPayer) {
    return { ok: false, status: 429, code: "payer_budgets_full", message: `This wallet already has ${limits.perPayer} Budgets open or opening. Close one you no longer use, then open another.` };
  }
  return undefined;
}
