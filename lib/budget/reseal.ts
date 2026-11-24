/**
 * Server only. KEK rotation for Budget spender keys (review S6, S6-claude-07):
 * counts the live keys sealed under each KEK and, when asked, reseals every
 * key not under the current (first) KEK. Run from the incident route's
 * `reseal` action, where the KEKs already are. Resealing does not help when a
 * KEK may be exposed: the spender keys it opened are the same keys, so close
 * those Budgets instead.
 */

import { resealSpenderKey, sealedKid, type Kek } from "./keys";
import type { BudgetCustodyStore, SpenderRecord } from "./store";

export type ResealReport = {
  current: string;
  /** Live keys per KEK id before this run. */
  byKek: Record<string, number>;
  resealed: number;
  failed: { id: string; error: string }[];
  applied: boolean;
};

export async function resealAll(store: BudgetCustodyStore, keks: Kek[], apply: boolean): Promise<ResealReport> {
  const records = await store.withStatus(["pending", "open", "frozen", "closing"]);
  const report: ResealReport = { current: keks[0].id, byKek: {}, resealed: 0, failed: [], applied: apply };
  for (const record of records) {
    if (!record.sealed) continue;
    const kid = sealedKid(record.sealed) ?? "?";
    report.byKek[kid] = (report.byKek[kid] ?? 0) + 1;
    if (!apply || kid === keks[0].id) continue;
    let current: SpenderRecord | undefined = record;
    let done = false;
    for (let attempt = 0; attempt < 5 && current?.sealed && !done; attempt += 1) {
      try {
        const sealed = resealSpenderKey(current.sealed, current.id, current.spender, keks);
        done = (await store.update({ ...current, sealed, version: current.version + 1 })).ok;
      } catch (error) {
        report.failed.push({ id: record.id, error: error instanceof Error ? error.message : "reseal failed" });
        break;
      }
      if (!done) current = await store.byId(record.id);
    }
    if (done) report.resealed += 1;
  }
  return report;
}
