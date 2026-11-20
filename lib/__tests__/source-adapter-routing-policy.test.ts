import { detectListingSource, evaluateSourceRoutingDecision } from "@/lib/integrations/source-adapter/routing-policy";
import type { SpecialistListing } from "@/lib/registry/bridge";

function makeListing(tags: string[]): SpecialistListing {
  return {
    pda: "pda-1",
    walletAddress: "wallet-1",
    onchain: {
      owner: "wallet-1",
      agentType: "Primary",
      model: "model",
      rateLamports: 0n,
      minReputation: 0,
      reputationScore: 80,
      jobsCompleted: 0n,
      jobsFailed: 0n,
      createdAt: 0n,
      active: true,
      attestationAccuracy: 0,
    },
    capabilities: {
      taskTypes: ["summarize"],
      inputModes: ["text"],
      outputModes: ["text"],
      privacyModes: ["public"],
      tags,
      baseUsd: 0,
      perCallUsd: 0,
      context_requirements: [],
      runtime_capabilities: [],
    },
    health: {
      status: "pass",
      endpointUrl: "https://spec.example",
      lastCheckedAt: null,
    },
    attestation: {
      attested: false,
      lastAttestedAt: null,
    },
    capabilityHash: null,
    signals: {
      feedbackCount: 0,
      avgFeedbackScore: 0,
      attestationAgreements: 0,
      attestationDisagreements: 0,
    },
    ranking_score: 0,
  } as unknown as SpecialistListing;
}

describe("source adapter routing policy", () => {
  it("detects source tags from specialist listing metadata", () => {
    expect(detectListingSource(makeListing(["source:openclaw", "foo"]))).toBe("openclaw");
    expect(detectListingSource(makeListing(["source=hermes"]))).toBe("hermes");
    expect(detectListingSource(makeListing(["source:unknown"]))).toBeNull();
  });

  it("adds preference bonus for source match and rejects strict mismatches", () => {
    const openclawListing = makeListing(["source:openclaw"]);
    const hermesListing = makeListing(["source:hermes"]);

    const match = evaluateSourceRoutingDecision(openclawListing, {
      preferredSource: "openclaw",
      strictSourceMatch: false,
    });
    expect(match.scoreDelta).toBe(12);
    expect(match.reject).toBe(false);

    const strictMismatch = evaluateSourceRoutingDecision(hermesListing, {
      preferredSource: "openclaw",
      strictSourceMatch: true,
    });
    expect(strictMismatch.reject).toBe(true);
    expect(strictMismatch.reasons).toContain("source_mismatch:openclaw");
  });
});
