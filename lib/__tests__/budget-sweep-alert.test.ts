/** @jest-environment node */
import { createSweepAlertGate, failedSlices, sweepFailureAlert } from "@/lib/budget/sweep-alert";

const ok = { provider: "scribe", budget: "Budget1", status: "paid" };
const bad = { provider: "atlas", budget: "Budget2", status: "failed" };
const late = { provider: "scribe", budget: "Budget3", status: "not_reached" };

describe("payout sweep fails loudly (#1208, RAP-MB6-S3)", () => {
  it("has nothing to say when every slice settled", () => {
    expect(sweepFailureAlert([ok])).toBeUndefined();
    expect(sweepFailureAlert([])).toBeUndefined();
  });

  it("names each failed slice by provider and Budget, with the reason", () => {
    const alert = sweepFailureAlert([ok, bad, late])!;
    expect(alert).toMatchObject({ audience: "operator", kind: "payout_sweep_failed", subject: "Payout sweep failed for 2 slices" });
    expect(alert.text).toContain("could not settle 2 of 3 slices");
    expect(alert.text).toContain("provider atlas, Budget Budget2: the settle transaction failed");
    expect(alert.text).toContain("provider scribe, Budget Budget3: the pass ran out of time before this slice");
    expect(alert.text).not.toContain("Budget1");
    expect(alert.detail.failed).toEqual([
      { provider: "atlas", budget: "Budget2", status: "failed" },
      { provider: "scribe", budget: "Budget3", status: "not_reached" },
    ]);
  });

  it("counts unreadable slices as failures", () => {
    expect(failedSlices([{ provider: "p", budget: "b", status: "unreadable" }, ok])).toHaveLength(1);
    expect(sweepFailureAlert([{ provider: "p", budget: "b", status: "unreadable" }])!.subject).toBe("Payout sweep failed for 1 slice");
  });

  it("repeats the same failing slices hourly, and a new failure at once", () => {
    const gate = createSweepAlertGate();
    expect(gate.due([ok], 0)).toBe(false);
    expect(gate.due([bad, ok], 0)).toBe(true);
    expect(gate.due([ok, bad], 5 * 60_000)).toBe(false);
    expect(gate.due([bad, late], 5 * 60_000)).toBe(true);
    expect(gate.due([bad], 61 * 60_000)).toBe(true);
  });
});
