/**
 * The payout sweep fails loudly (#1208, RAP-MB6-S3): when a pass could not
 * settle a slice, the operator gets one alert naming each slice (provider and
 * Budget) and what went wrong. The route still answers 503, so the timer's
 * run and the outside monitor see the failure too.
 */
import type { BudgetAlert } from "./alerts";

export type SweepResult = { provider: string; budget: string; status: string };

export const SWEEP_FAILED_STATUSES = ["failed", "unreadable", "not_reached"] as const;
/** The same failing slices alert again after this long, not on every 5-minute pass. */
export const SWEEP_ALERT_REPEAT_MS = 60 * 60 * 1000;

export function failedSlices(results: SweepResult[]): SweepResult[] {
  return results.filter((r) => (SWEEP_FAILED_STATUSES as readonly string[]).includes(r.status));
}

const MEANING: Record<string, string> = {
  failed: "the settle transaction failed",
  unreadable: "the Budget or the slice could not be read",
  not_reached: "the pass ran out of time before this slice",
};

/** The operator alert for a pass with failed slices, or undefined when every slice settled. */
export function sweepFailureAlert(results: SweepResult[], sweep: string = "sandbox payout sweep"): BudgetAlert | undefined {
  const failed = failedSlices(results);
  if (failed.length === 0) return undefined;
  const lines = failed.map((r) => `- provider ${r.provider}, Budget ${r.budget}: ${MEANING[r.status] ?? r.status}`);
  return {
    audience: "operator",
    kind: "payout_sweep_failed",
    subject: `Payout sweep failed for ${failed.length} slice${failed.length === 1 ? "" : "s"}`,
    text: [`The ${sweep} could not settle ${failed.length} of ${results.length} slice${results.length === 1 ? "" : "s"}:`, ...lines, "", "The provider is not paid until the slice settles. The sweep tries again on its next pass; if this repeats, check the provider's key and balance and the RPC."].join("\n"),
    detail: { sweep, failed: failed.map((r) => ({ provider: r.provider, budget: r.budget, status: r.status })), slices: results.length },
  };
}

/** Lets the same set of failing slices through once per `repeatMs` (per server instance). */
export function createSweepAlertGate(repeatMs: number = SWEEP_ALERT_REPEAT_MS) {
  const last = new Map<string, number>();
  return {
    due(results: SweepResult[], nowMs: number = Date.now()): boolean {
      const key = failedSlices(results).map((r) => `${r.provider}:${r.budget}:${r.status}`).sort().join("|");
      if (!key) return false;
      const at = last.get(key);
      if (at !== undefined && nowMs - at < repeatMs) return false;
      if (last.size > 500) last.clear();
      last.set(key, nowMs);
      return true;
    },
  };
}
