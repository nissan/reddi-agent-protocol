import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

jest.mock("@/lib/onboarding/specialist-index", () => ({
  applyPlannerFeedback: jest.fn().mockReturnValue({ ok: true }),
}));

jest.mock("@/lib/onboarding/consumer-registry", () => ({
  applyConsumerRating: jest.fn().mockReturnValue({ ok: true }),
}));

jest.mock("@/lib/onboarding/reputation-signal", () => ({
  commitReputationRating: jest.fn().mockResolvedValue({ ok: true, txSignature: "sig" }),
}));

describe("planner auditability (H4.3)", () => {
  const dataDir = join(process.cwd(), "data", "onboarding");
  const runsPath = join(dataDir, "planner-runs.json");
  const feedbackPath = join(dataDir, "planner-feedback.json");

  let runsBackup: string | null = null;
  let feedbackBackup: string | null = null;

  beforeEach(() => {
    jest.resetModules();
    mkdirSync(dataDir, { recursive: true });
    runsBackup = existsSync(runsPath) ? readFileSync(runsPath, "utf8") : null;
    feedbackBackup = existsSync(feedbackPath) ? readFileSync(feedbackPath, "utf8") : null;
  });

  afterEach(() => {
    if (runsBackup === null) writeFileSync(runsPath, "[]");
    else writeFileSync(runsPath, runsBackup);

    if (feedbackBackup === null) writeFileSync(feedbackPath, "[]");
    else writeFileSync(feedbackPath, feedbackBackup);
  });

  it("keeps settlement decision and quality signal independently auditable", async () => {
    const baseRun = {
      runId: "run_audit_1",
      status: "completed",
      paymentSatisfied: true,
      selectedWallet: "So11111111111111111111111111111111111111112",
      settlementState: "pending_evaluation",
    };
    writeFileSync(runsPath, JSON.stringify([baseRun], null, 2));
    writeFileSync(feedbackPath, JSON.stringify([], null, 2));

    const { decidePlannerSettlement } = await import("@/lib/onboarding/planner-settlement");
    const { recordPlannerFeedback, listPlannerFeedback } = await import("@/lib/onboarding/planner-feedback");

    const settlement = decidePlannerSettlement({
      runId: "run_audit_1",
      decision: "release",
      notes: "meets quality bar",
      consumerWallet: "So22222222222222222222222222222222222222222",
    });

    expect(settlement.ok).toBe(true);
    expect(settlement.run.settlementState).toBe("released");

    const feedback = await recordPlannerFeedback({
      runId: "run_audit_1",
      score: 2,
      notes: "low quality despite settlement release decision",
      consumerWallet: "So22222222222222222222222222222222222222222",
    } as Parameters<typeof recordPlannerFeedback>[0]);

    expect(feedback.ok).toBe(true);
    expect(feedback.record.runId).toBe("run_audit_1");
    expect(feedback.record.score).toBe(2);

    const listed = listPlannerFeedback();
    expect(listed.ok).toBe(true);
    expect(listed.results.some((r) => r.runId === "run_audit_1" && r.score === 2)).toBe(true);

    const runs = JSON.parse(readFileSync(runsPath, "utf8")) as Array<{ runId: string; settlementState?: string }>;
    expect(runs.find((r) => r.runId === "run_audit_1")?.settlementState).toBe("released");
  });
});
