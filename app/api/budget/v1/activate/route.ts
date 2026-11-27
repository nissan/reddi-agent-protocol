import { activateSpender } from "@/lib/budget/custody";
import { BUDGET_PROGRAM_ID, budgetChain, budgetCustodyDeps, budgetGate } from "@/lib/budget/runtime";
import { rateLimited, readJsonBody, tryError, tryJson } from "@/lib/try/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Step 3: once the payer's open is finalized, checks it on chain against what
 * the payer signed and switches the agent's key on. Reads the chain only, so
 * it needs no secret; the page polls it until it answers `open`.
 */
export async function POST(request: Request) {
  const limited = rateLimited(request, "call");
  if (limited) return limited;
  const body = await readJsonBody(request);
  const id = body?.id;
  if (typeof id !== "string" || !/^[0-9a-f]{32}$/.test(id)) return tryError(400, "invalid_request", "Send JSON with the Budget record's id.");
  const deps = budgetCustodyDeps();
  if (!deps) return tryError(503, "custody_not_configured", "Budgets are not switched on for this server yet.");
  let chain;
  try {
    chain = budgetChain();
  } catch {
    return tryError(503, "chain_unavailable", "This server has no RPC for Budgets.");
  }
  const gated = await budgetGate(request, "read", { chain, key: id });
  if (gated) return gated;
  const record = await deps.store.byId(id);
  if (!record) return tryError(404, "unknown_budget_key", "No Budget with that id.");
  if (record.status === "open") return tryJson({ status: "open", budget: record.budget });
  const activated = await activateSpender({ id, programId: BUDGET_PROGRAM_ID }, { ...deps, chain });
  if (activated.ok) return tryJson({ status: "open", budget: activated.record.budget });
  // Not on chain (or not finalized) yet: the page keeps waiting.
  if (activated.code === "budget_not_found" || activated.code === "chain_unavailable") return tryJson({ status: "waiting", budget: record.budget });
  return tryError(409, activated.code, activated.message);
}
