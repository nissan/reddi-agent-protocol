import type { SpecialistListing } from "@/lib/registry/bridge";

jest.mock("@/lib/registry/bridge", () => ({
  fetchSpecialistListings: jest.fn(),
}));

jest.mock("@/lib/orchestrator/policy", () => ({
  readPolicy: jest.fn(),
}));

function makeListing(input: {
  wallet: string;
  tags?: string[];
  reputation?: number;
  attested?: boolean;
  taskTypes?: NonNullable<SpecialistListing["capabilities"]>["taskTypes"];
  inputModes?: NonNullable<SpecialistListing["capabilities"]>["inputModes"];
  privacyModes?: NonNullable<SpecialistListing["capabilities"]>["privacyModes"];
  runtimeCaps?: NonNullable<SpecialistListing["capabilities"]>["runtime_capabilities"];
  perCallUsd?: number;
  feedbackScore?: number;
  feedbackCount?: number;
  endpointUrl?: string;
  healthStatus?: "pass" | "fail" | "unknown";
  lastCheckedAt?: string | null;
  attestorCheckpoints?: string[];
  qualityClaims?: string[];
}): SpecialistListing {
  return {
    pda: `pda-${input.wallet}`,
    walletAddress: input.wallet,
    onchain: {
      owner: input.wallet,
      agentType: "Primary",
      model: "model",
      rateLamports: 0n,
      minReputation: 0,
      reputationScore: input.reputation ?? 100,
      jobsCompleted: 0n,
      jobsFailed: 0n,
      createdAt: 0n,
      active: true,
      attestationAccuracy: 0,
    },
    capabilities: {
      taskTypes: input.taskTypes ?? ["summarize"],
      inputModes: input.inputModes ?? ["text"],
      outputModes: ["text"],
      privacyModes: input.privacyModes ?? ["public"],
      tags: input.tags ?? [],
      baseUsd: 0,
      perCallUsd: input.perCallUsd ?? 0.01,
      context_requirements: [],
      runtime_capabilities: input.runtimeCaps ?? [],
      attestor_checkpoints: input.attestorCheckpoints ?? [],
      quality_claims: input.qualityClaims ?? [],
    },
    health: {
      status: input.healthStatus ?? "pass",
      endpointUrl: input.endpointUrl ?? `https://${input.wallet}.example`,
      lastCheckedAt: input.lastCheckedAt ?? null,
      freshnessState: "unknown",
    },
    attestation: {
      attested: input.attested ?? false,
      lastAttestedAt: null,
    },
    capabilityHash: null,
    signals: {
      feedbackCount: input.feedbackCount ?? 0,
      avgFeedbackScore: input.feedbackScore ?? 0,
      attestationAgreements: 0,
      attestationDisagreements: 0,
    },
    ranking_score: 0,
    indexSemantics: {
      schemaVersion: 2,
      rankingFormulaVersion: 1,
    },
  };
}

describe("planner resolve route", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("returns 400 when task is missing", async () => {
    const { POST } = await import("@/app/api/planner/tools/resolve/route");
    const req = new Request("http://localhost/api/planner/tools/resolve", {
      method: "POST",
      body: JSON.stringify({ task: "" }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: "task is required",
    });
  });

  it("returns 400 with appliedFilters when no eligible specialists are found", async () => {
    const { readPolicy } = await import("@/lib/orchestrator/policy");
    const { fetchSpecialistListings } = await import("@/lib/registry/bridge");

    (readPolicy as jest.Mock).mockReturnValue({
      maxPerTaskUsd: 0,
      requireAttestation: false,
      minReputation: 0,
      preferredPrivacyMode: "public",
    });

    (fetchSpecialistListings as jest.Mock).mockResolvedValue({ listings: [] });

    const { POST } = await import("@/app/api/planner/tools/resolve/route");
    const req = new Request("http://localhost/api/planner/tools/resolve", {
      method: "POST",
      body: JSON.stringify({ task: "summarize this" }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      candidate: null,
      appliedFilters: {
        sortBy: "ranking",
      },
      error: "No eligible specialists found matching your policy.",
    });
  });

  it("prefers source-matching specialists when preferredSource is set", async () => {
    const { fetchSpecialistListings } = await import("@/lib/registry/bridge");
    const { readPolicy } = await import("@/lib/orchestrator/policy");

    (readPolicy as jest.Mock).mockReturnValue({
      preferredPrivacyMode: "public",
      requireAttestation: false,
      maxPerTaskUsd: 0,
      minReputation: 0,
    });

    (fetchSpecialistListings as jest.Mock).mockResolvedValue({
      listings: [
        makeListing({ wallet: "wallet-hermes", tags: ["source:hermes"] }),
        makeListing({ wallet: "wallet-openclaw", tags: ["source:openclaw"] }),
      ],
    });

    const { POST } = await import("@/app/api/planner/tools/resolve/route");
    const req = new Request("http://localhost/api/planner/tools/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        task: "summarize",
        policy: { preferredSource: "openclaw" },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.candidate.walletAddress).toBe("wallet-openclaw");
    expect(body.candidate.selectionReasons).toContain("source:openclaw");
  });

  it("applies discovery filters and supports cost sorting", async () => {
    const { readPolicy } = await import("@/lib/orchestrator/policy");
    const { fetchSpecialistListings } = await import("@/lib/registry/bridge");

    (readPolicy as jest.Mock).mockReturnValue({
      maxPerTaskUsd: 0,
      requireAttestation: false,
      minReputation: 0,
      preferredPrivacyMode: "public",
    });

    (fetchSpecialistListings as jest.Mock).mockResolvedValue({
      listings: [
        makeListing({
          wallet: "wallet-a",
          taskTypes: ["summarize"],
          inputModes: ["text"],
          privacyModes: ["public"],
          runtimeCaps: ["stateful"],
          tags: ["finance"],
          attested: true,
          perCallUsd: 0.8,
          feedbackScore: 9,
          feedbackCount: 10,
          lastCheckedAt: "2026-04-23T00:00:00.000Z",
        }),
        makeListing({
          wallet: "wallet-b",
          taskTypes: ["summarize"],
          inputModes: ["text"],
          privacyModes: ["public"],
          runtimeCaps: ["stateful"],
          tags: ["finance", "realtime"],
          attested: true,
          perCallUsd: 0.3,
          feedbackScore: 8.7,
          feedbackCount: 8,
          lastCheckedAt: "2026-04-23T00:00:00.000Z",
        }),
      ],
    });

    const { POST } = await import("@/app/api/planner/tools/resolve/route");
    const req = new Request("http://localhost/api/planner/tools/resolve", {
      method: "POST",
      body: JSON.stringify({
        task: "summarize this",
        sortBy: "cost",
        runtimeCap: "stateful",
        tag: "finance",
        health: "pass",
        attested: true,
      }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      candidate: {
        walletAddress: "wallet-b",
      },
      appliedFilters: {
        sortBy: "cost",
        runtimeCap: "stateful",
        tag: "finance",
        health: "pass",
        attested: true,
      },
    });
  });

  it("supports reputation sorting", async () => {
    const { readPolicy } = await import("@/lib/orchestrator/policy");
    const { fetchSpecialistListings } = await import("@/lib/registry/bridge");

    (readPolicy as jest.Mock).mockReturnValue({
      maxPerTaskUsd: 0,
      requireAttestation: false,
      minReputation: 0,
      preferredPrivacyMode: "public",
    });

    (fetchSpecialistListings as jest.Mock).mockResolvedValue({
      listings: [
        makeListing({ wallet: "wallet-high-rep", reputation: 80 }),
        makeListing({ wallet: "wallet-low-rep", reputation: 20 }),
      ],
    });

    const { POST } = await import("@/app/api/planner/tools/resolve/route");
    const req = new Request("http://localhost/api/planner/tools/resolve", {
      method: "POST",
      body: JSON.stringify({ task: "summarize this", sortBy: "reputation" }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      candidate: {
        walletAddress: "wallet-high-rep",
      },
      appliedFilters: {
        sortBy: "reputation",
      },
    });
  });

  it("supports feedback sorting", async () => {
    const { readPolicy } = await import("@/lib/orchestrator/policy");
    const { fetchSpecialistListings } = await import("@/lib/registry/bridge");

    (readPolicy as jest.Mock).mockReturnValue({
      maxPerTaskUsd: 0,
      requireAttestation: false,
      minReputation: 0,
      preferredPrivacyMode: "public",
    });

    (fetchSpecialistListings as jest.Mock).mockResolvedValue({
      listings: [
        makeListing({ wallet: "wallet-low-feedback", feedbackScore: 7.1, feedbackCount: 2 }),
        makeListing({ wallet: "wallet-high-feedback", feedbackScore: 9.4, feedbackCount: 35 }),
      ],
    });

    const { POST } = await import("@/app/api/planner/tools/resolve/route");
    const req = new Request("http://localhost/api/planner/tools/resolve", {
      method: "POST",
      body: JSON.stringify({ task: "summarize this", sortBy: "feedback" }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      candidate: {
        walletAddress: "wallet-high-feedback",
      },
      appliedFilters: {
        sortBy: "feedback",
      },
    });
  });

  it("filters by required attestor checkpoints and quality claims", async () => {
    const { fetchSpecialistListings } = await import("@/lib/registry/bridge");
    const { readPolicy } = await import("@/lib/orchestrator/policy");

    (readPolicy as jest.Mock).mockReturnValue({
      preferredPrivacyMode: "public",
      requireAttestation: false,
      maxPerTaskUsd: 0,
      minReputation: 0,
    });

    (fetchSpecialistListings as jest.Mock).mockResolvedValue({
      listings: [
        makeListing({
          wallet: "wallet-disclosure-pass",
          tags: ["source:openclaw"],
          attestorCheckpoints: ["schema_contract_pass", "policy_bounds_ok"],
          qualityClaims: ["latency_p95_under_3s", "high_schema_compliance"],
        }),
        makeListing({
          wallet: "wallet-disclosure-miss",
          tags: ["source:openclaw"],
          attestorCheckpoints: ["schema_contract_pass"],
          qualityClaims: ["high_schema_compliance"],
        }),
      ],
    });

    const { POST } = await import("@/app/api/planner/tools/resolve/route");
    const req = new Request("http://localhost/api/planner/tools/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        task: "summarize",
        required_attestor_checkpoints: ["schema_contract_pass", "policy_bounds_ok"],
        required_quality_claims: ["latency_p95_under_3s"],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.candidate.walletAddress).toBe("wallet-disclosure-pass");
    expect(body.resolveDiagnostics).toMatchObject({
      totalListings: 2,
      acceptedCount: 1,
      rejectedBy: {
        disclosure: 1,
      },
      rejectedWalletSamples: {
        disclosure: ["wallet-disclosure-miss"],
      },
    });
  });
});
