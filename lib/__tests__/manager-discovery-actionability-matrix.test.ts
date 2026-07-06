import {
  DISCOVERY_ACTIONABILITY_LANE_ORDER,
  DISCOVERY_ACTIONABILITY_MATRIX_SCHEMA_VERSION,
  deriveDiscoveryActionabilityMatrix,
  deriveHostedDiscoveryActionabilityMatrix,
  describeDiscoveryLane,
  describeDiscoveryLaneState,
  type DiscoveryActionabilityLaneId,
  type DiscoveryActionabilityLaneState,
  type DiscoveryActionabilityMatrix,
} from "@/lib/manager/discovery-actionability-matrix";
import { searchHostedMarketplaceCatalog } from "@/lib/manager/marketplace-public-search";
import {
  getStaticAgentStackReviewWorkspace,
  type OperatorDiscoveryCandidateView,
} from "@/lib/manager/static-agent-stack-review";

const workspace = getStaticAgentStackReviewWorkspace();

function candidateByFixtureKey(fixtureKey: string): OperatorDiscoveryCandidateView {
  const candidate = workspace.candidates.find((item) => item.fixtureKey === fixtureKey);
  if (!candidate) throw new Error(`missing fixture candidate: ${fixtureKey}`);
  return candidate;
}

function laneState(matrix: DiscoveryActionabilityMatrix, lane: DiscoveryActionabilityLaneId) {
  const found = matrix.lanes.find((item) => item.lane === lane);
  if (!found) throw new Error(`missing lane: ${lane}`);
  return found;
}

describe("discovery actionability matrix derivation", () => {
  it("always emits the six lanes in canonical order with schema version", () => {
    for (const candidate of workspace.candidates) {
      const matrix = deriveDiscoveryActionabilityMatrix(candidate);
      expect(matrix.schemaVersion).toBe(DISCOVERY_ACTIONABILITY_MATRIX_SCHEMA_VERSION);
      expect(matrix.candidateId).toBe(candidate.id);
      expect(matrix.lanes.map((lane) => lane.lane)).toEqual([...DISCOVERY_ACTIONABILITY_LANE_ORDER]);
      expect(matrix.lanes.map((lane) => lane.lane)).toEqual([
        "source_provenance",
        "identity_evidence",
        "payment_readiness",
        "reputation_evidence",
        "policy_fit",
        "actionability",
      ]);
      for (const lane of matrix.lanes) {
        expect(lane.laneLabel.length).toBeGreaterThan(0);
        expect(lane.stateLabel.length).toBeGreaterThan(0);
        expect(lane.summary.length).toBeGreaterThan(0);
        expect(lane.reasonCodes.length).toBeGreaterThan(0);
      }
    }
  });

  it("never implies RAP trust/authorization and hard-disables every live boundary", () => {
    for (const candidate of workspace.candidates) {
      const matrix = deriveDiscoveryActionabilityMatrix(candidate);
      expect(matrix.discoveryTrustBoundary).toEqual({
        ardDiscoveryOnly: true,
        impliesRapTrust: false,
        impliesAuthorization: false,
        note: expect.stringContaining("not RAP trust"),
      });
      expect(matrix.guardrails).toEqual({
        autoPublish: false,
        autoPay: false,
        endpointInvocation: false,
        walletSigning: false,
        rpcCall: false,
        hostedRegistryMutation: false,
        trustMutation: false,
        reputationMutation: false,
      });
      expect(Object.values(matrix.guardrails).every((value) => value === false)).toBe(true);
    }
  });

  it("preserves source provenance: origin, snapshot ref/commit, and self-asserted flag", () => {
    for (const candidate of workspace.candidates) {
      const matrix = deriveDiscoveryActionabilityMatrix(candidate);
      expect(matrix.provenance.origin).toBe(candidate.sourceUrl);
      expect(matrix.provenance.originKind).toBe("static-import");
      expect(matrix.provenance.snapshot).toContain(candidate.checkedCommit);
      expect(matrix.provenance.snapshot).toContain(candidate.checkedRef);
      expect(matrix.provenance.metadataSelfAsserted).toBe(true);
      // Static fixtures do not record a crawl timestamp; UI must render it as unavailable.
      expect(matrix.provenance.crawlTimestamp).toBeNull();
    }
  });

  it("derives the expected per-lane states for each operator review fixture", () => {
    const expectations: Record<string, Partial<Record<DiscoveryActionabilityLaneId, DiscoveryActionabilityLaneState>>> = {
      approveReadyDraft: {
        source_provenance: "self_asserted",
        identity_evidence: "self_asserted",
        payment_readiness: "unavailable",
        reputation_evidence: "unavailable",
        policy_fit: "needs_human_review",
        actionability: "needs_human_review",
      },
      requestChangesMissingPayment: {
        payment_readiness: "unavailable",
        actionability: "needs_human_review",
      },
      rejectedMalformedConnector: {
        identity_evidence: "failed_verification",
        actionability: "blocked",
      },
      suspendedUnsafeMetadata: {
        identity_evidence: "failed_verification",
        actionability: "production_disabled",
      },
      solanaAiKitBlocked: {
        policy_fit: "blocked",
        actionability: "production_disabled",
      },
    };

    for (const [fixtureKey, laneExpectations] of Object.entries(expectations)) {
      const matrix = deriveDiscoveryActionabilityMatrix(candidateByFixtureKey(fixtureKey));
      for (const [lane, state] of Object.entries(laneExpectations)) {
        expect({ fixtureKey, lane, state: laneState(matrix, lane as DiscoveryActionabilityLaneId).state })
          .toEqual({ fixtureKey, lane, state });
      }
    }
  });

  it("separates lanes: rejected fixture fails identity while provenance stays self-asserted", () => {
    const matrix = deriveDiscoveryActionabilityMatrix(candidateByFixtureKey("rejectedMalformedConnector"));
    expect(laneState(matrix, "source_provenance").state).toBe("self_asserted");
    expect(laneState(matrix, "identity_evidence").state).toBe("failed_verification");
    expect(laneState(matrix, "identity_evidence").state).not.toBe(laneState(matrix, "source_provenance").state);
  });

  it("marks a clean approve-ready candidate as dry-run ready with live activation still gated", () => {
    const base = candidateByFixtureKey("approveReadyDraft");
    const synthetic = {
      ...base,
      status: "approve_ready",
      requiredStates: ["approve_ready_draft"],
      warnings: [],
      rejectedEntries: [],
      connectorDiagnostics: [],
      riskDiagnostics: [],
      resourceCounts: { ...base.resourceCounts, blockers: 0, rejected: 0, warnings: 0 },
    } as unknown as OperatorDiscoveryCandidateView;

    const matrix = deriveDiscoveryActionabilityMatrix(synthetic);
    expect(laneState(matrix, "actionability").state).toBe("dry_run_ready");
    expect(laneState(matrix, "actionability").reasonCodes).toEqual(
      expect.arrayContaining(["publication_disabled", "live_activation_gated"]),
    );
    expect(laneState(matrix, "policy_fit").state).toBe("self_asserted");
    // Dry-run readiness must not upgrade identity, reputation, or payment lanes.
    expect(laneState(matrix, "identity_evidence").state).toBe("self_asserted");
    expect(laneState(matrix, "reputation_evidence").state).toBe("unavailable");
    expect(laneState(matrix, "payment_readiness").state).toBe("unavailable");
  });

  it("reports unavailable source provenance when no snapshot was recorded", () => {
    const base = candidateByFixtureKey("approveReadyDraft");
    const synthetic = { ...base, sourceUrl: "", checkedCommit: "" } as OperatorDiscoveryCandidateView;
    const matrix = deriveDiscoveryActionabilityMatrix(synthetic);
    expect(laneState(matrix, "source_provenance").state).toBe("unavailable");
    expect(matrix.provenance.origin).toBe("unavailable");
    expect(matrix.provenance.snapshot).toBe("unavailable");
  });

  it("keeps payment live-gated (never enabled) when payment metadata exists but activation is off", () => {
    const base = candidateByFixtureKey("approveReadyDraft");
    const synthetic = {
      ...base,
      draftPreview: { ...base.draftPreview, paymentStatus: "configured_dry_run" },
    } as unknown as OperatorDiscoveryCandidateView;
    const matrix = deriveDiscoveryActionabilityMatrix(synthetic);
    expect(laneState(matrix, "payment_readiness").state).toBe("live_gated");
  });

  it("describes every lane state in the vocabulary, including states unused by current fixtures", () => {
    const allStates: DiscoveryActionabilityLaneState[] = [
      "unavailable",
      "self_asserted",
      "claimed",
      "verified",
      "failed_verification",
      "blocked",
      "needs_human_review",
      "dry_run_ready",
      "live_gated",
      "production_disabled",
    ];
    for (const state of allStates) {
      const described = describeDiscoveryLaneState(state);
      expect(described.stateLabel.length).toBeGreaterThan(0);
      expect(["neutral", "caution", "negative", "positive"]).toContain(described.tone);
    }
    for (const lane of DISCOVERY_ACTIONABILITY_LANE_ORDER) {
      expect(describeDiscoveryLane(lane).length).toBeGreaterThan(0);
    }
  });
});

describe("hosted discovery candidate actionability matrix", () => {
  const result = searchHostedMarketplaceCatalog({});

  it("derives claimed identity, gated payment/actionability, and preserved provenance", () => {
    expect(result.results.length).toBeGreaterThan(0);
    const item = result.results[0];
    const matrix = deriveHostedDiscoveryActionabilityMatrix(item, {
      generatedAt: result.generatedAt,
      catalogRef: result.source.catalogRef,
    });

    expect(matrix.lanes.map((lane) => lane.lane)).toEqual([...DISCOVERY_ACTIONABILITY_LANE_ORDER]);
    expect(laneState(matrix, "source_provenance").state).toBe("self_asserted");
    expect(laneState(matrix, "identity_evidence").state).toBe("claimed");
    expect(laneState(matrix, "payment_readiness").state).toBe("live_gated");
    expect(laneState(matrix, "reputation_evidence").state).toBe("unavailable");
    expect(laneState(matrix, "policy_fit").state).toBe("needs_human_review");
    expect(laneState(matrix, "actionability").state).toBe("live_gated");

    expect(matrix.provenance.origin).toBe(item.candidate.identifier);
    expect(matrix.provenance.originKind).toBe("hosted-rap-registry");
    expect(matrix.provenance.crawlTimestamp).toBe(result.generatedAt);
    expect(matrix.provenance.snapshot).toBe(item.candidate.rawSnapshotRef ?? result.source.catalogRef);
    expect(matrix.provenance.metadataSelfAsserted).toBe(true);
  });

  it("falls back to self-asserted identity when no publisher claim exists and keeps guardrails closed", () => {
    const item = result.results[0];
    const withoutPublisher = {
      ...item,
      candidate: { ...item.candidate, publisher: undefined },
    };
    const matrix = deriveHostedDiscoveryActionabilityMatrix(withoutPublisher);
    expect(laneState(matrix, "identity_evidence").state).toBe("self_asserted");
    expect(matrix.provenance.crawlTimestamp).toBeNull();
    expect(Object.values(matrix.guardrails).every((value) => value === false)).toBe(true);
    expect(matrix.discoveryTrustBoundary.impliesRapTrust).toBe(false);
    expect(matrix.discoveryTrustBoundary.impliesAuthorization).toBe(false);
  });
});
