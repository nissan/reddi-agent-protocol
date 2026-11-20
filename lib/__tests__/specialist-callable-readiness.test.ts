import { summarizeSpecialistCallableReadiness } from "@/lib/specialist/callable-readiness";

const baseListing = {
  walletAddress: "wallet-11111111111111111111111111111111",
  pda: "pda-1",
  health: {
    status: "pass" as const,
    freshnessState: "fresh" as const,
    endpointUrl: "https://agent.example.com",
    lastCheckedAt: "2026-04-27T00:00:00.000Z",
  },
  capabilities: {
    taskTypes: ["summarize"],
    inputModes: ["text"],
    outputModes: ["text"],
    privacyModes: ["prompt_private"],
    tags: [],
    baseUsd: 0.01,
    perCallUsd: 0.01,
    context_requirements: [],
    runtime_capabilities: [],
  },
  attestation: {
    attested: true,
    lastAttestedAt: "2026-04-27T00:00:00.000Z",
  },
} as unknown as Parameters<typeof summarizeSpecialistCallableReadiness>[0];

describe("specialist callable readiness", () => {
  it("marks a healthy x402-protected specialist callable", () => {
    const summary = summarizeSpecialistCallableReadiness(baseListing, {
      status: "pass",
      reachable: true,
      x402Probe: "ok",
      securityStatus: "x402_challenge_detected",
      checkedAt: "2026-04-27T00:00:00.000Z",
      note: "ok",
    });

    expect(summary.status).toBe("callable");
    expect(summary.items.find((item) => item.id === "x402")?.status).toBe("pass");
  });

  it("blocks specialists whose completion endpoint is open without x402", () => {
    const summary = summarizeSpecialistCallableReadiness(baseListing, {
      status: "fail",
      reachable: true,
      x402Probe: "fail",
      securityStatus: "insecure_open_completion",
      checkedAt: "2026-04-27T00:00:00.000Z",
      note: "open completion",
    });

    expect(summary.status).toBe("blocked");
    expect(summary.headline).toMatch(/unpaid completions/i);
    expect(summary.items.find((item) => item.id === "x402")?.detail).toMatch(/unpaid-bypass risk/i);
  });

  it("requires capability registration before safe marketplace calls", () => {
    const summary = summarizeSpecialistCallableReadiness({ ...baseListing, capabilities: null }, null);

    expect(summary.status).toBe("action_required");
    expect(summary.items.find((item) => item.id === "capabilities")?.status).toBe("fail");
  });
});
