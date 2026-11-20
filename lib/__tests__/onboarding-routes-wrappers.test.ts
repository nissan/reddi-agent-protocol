jest.mock("@/lib/onboarding/wallet-recovery", () => ({
  checkWalletBackupExists: jest.fn(),
  getWalletRecoveryOptions: jest.fn(),
}));

jest.mock("@/lib/onboarding/planner-execution", () => ({
  executePlannerSpecialistCall: jest.fn(),
  listPlannerRuns: jest.fn(),
}));

jest.mock("@/lib/onboarding/planner-feedback", () => ({
  listPlannerFeedback: jest.fn(),
  recordPlannerFeedback: jest.fn(),
}));

jest.mock("@/lib/onboarding/reputation-signal", () => ({
  listReputationCommits: jest.fn(),
  revealReputationRating: jest.fn(),
}));

describe("onboarding wrapper routes", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete process.env.JUPITER_API_BASE;
    delete process.env.JUPITER_SLIPPAGE_BPS;
  });

  it("GET /api/onboarding/wallet/recovery returns backup + options", async () => {
    const { checkWalletBackupExists, getWalletRecoveryOptions } = await import("@/lib/onboarding/wallet-recovery");
    (checkWalletBackupExists as jest.Mock).mockReturnValue(true);
    (getWalletRecoveryOptions as jest.Mock).mockReturnValue([{ id: "seed" }]);

    const { GET } = await import("@/app/api/onboarding/wallet/recovery/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.backup_exists).toBe(true);
    expect(body.recovery_options[0].id).toBe("seed");
  });

  it("GET /api/onboarding/settlement-config uses defaults and env overrides", async () => {
    const { GET } = await import("@/app/api/onboarding/settlement-config/route");

    const defRes = await GET();
    const defBody = await defRes.json();
    expect(defBody.api_base).toBe("https://api.jup.ag");
    expect(defBody.slippage_bps).toBe(50);

    process.env.JUPITER_API_BASE = "https://custom.jup";
    process.env.JUPITER_SLIPPAGE_BPS = "80";
    const overrideRes = await GET();
    const overrideBody = await overrideRes.json();
    expect(overrideBody.api_base).toBe("https://custom.jup");
    expect(overrideBody.slippage_bps).toBe(80);
  });

  it("/api/onboarding/planner/execute GET lists runs and POST executes", async () => {
    const { listPlannerRuns, executePlannerSpecialistCall } = await import("@/lib/onboarding/planner-execution");
    (listPlannerRuns as jest.Mock).mockReturnValue({ ok: true, runs: [{ runId: "r1" }] });
    (executePlannerSpecialistCall as jest.Mock).mockResolvedValue({ ok: true, runId: "r1" });

    const route = await import("@/app/api/onboarding/planner/execute/route");

    const getRes = await route.GET();
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.ok).toBe(true);
    expect(getBody.result.runs[0].runId).toBe("r1");

    const postReq = new Request("http://localhost/api/onboarding/planner/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Hello", policy: { requiresAttested: true } }),
    });
    const postRes = await route.POST(postReq);
    expect(postRes.status).toBe(200);
    const postBody = await postRes.json();
    expect(postBody.ok).toBe(true);
    expect(executePlannerSpecialistCall).toHaveBeenCalledTimes(1);
  });

  it("/api/onboarding/planner/feedback GET lists and POST records", async () => {
    const { listPlannerFeedback, recordPlannerFeedback } = await import("@/lib/onboarding/planner-feedback");
    (listPlannerFeedback as jest.Mock).mockReturnValue({ ok: true, entries: [{ runId: "r1" }] });
    (recordPlannerFeedback as jest.Mock).mockResolvedValue({ ok: true, runId: "r1" });

    const route = await import("@/app/api/onboarding/planner/feedback/route");

    const getRes = await route.GET();
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.ok).toBe(true);
    expect(getBody.result.entries[0].runId).toBe("r1");

    const postReq = new Request("http://localhost/api/onboarding/planner/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "r1", score: 95, agreesWithAttestation: true }),
    });
    const postRes = await route.POST(postReq);
    expect(postRes.status).toBe(200);
    const postBody = await postRes.json();
    expect(postBody.ok).toBe(true);
    expect(recordPlannerFeedback).toHaveBeenCalledTimes(1);
  });

  it("/api/onboarding/planner/reveal GET lists commits and POST validates runId", async () => {
    const { listReputationCommits, revealReputationRating } = await import("@/lib/onboarding/reputation-signal");
    (listReputationCommits as jest.Mock).mockReturnValue({ ok: true, commits: [{ runId: "r1" }] });
    (revealReputationRating as jest.Mock).mockResolvedValue({ ok: true });

    const route = await import("@/app/api/onboarding/planner/reveal/route");

    const getRes = await route.GET();
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.ok).toBe(true);

    const badReq = new Request("http://localhost/api/onboarding/planner/reveal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "" }),
    });
    const badRes = await route.POST(badReq);
    expect(badRes.status).toBe(400);

    const goodReq = new Request("http://localhost/api/onboarding/planner/reveal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "r1" }),
    });
    const goodRes = await route.POST(goodReq);
    expect(goodRes.status).toBe(200);
    expect(revealReputationRating).toHaveBeenCalledWith("r1");
  });
});
