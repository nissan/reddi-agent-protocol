import {
  evaluateMarketplaceReadiness,
  getMarketplaceReadinessResults,
  type MarketplaceReadinessProofMetadata,
} from "@/lib/manager/marketplace-readiness-gate";
import { getStaticAgentStackReviewWorkspace } from "@/lib/manager/static-agent-stack-review";

const completeProof: MarketplaceReadinessProofMetadata = {
  endpointBindingRef: "endpoint-binding:anthropic-financial-services:dry-run",
  paymentPlan: {
    schemaVersion: "marketplace-payment-plan-proof:v1",
    planId: "plan:anthropic-financial-services:dry-run",
    currency: "USD",
    amount: 0,
    activation: "disabled",
    settlement: "dry_run_only",
    evidenceRef: "evidence:payment-plan:dry-run",
  },
  dryRunReceiptRefs: ["receipt:dry-run:approve-ready"],
  evidenceRefs: ["evidence:static-review:approve-ready"],
  attestationDraftRef: "attestation-draft:approve-ready",
  operatorApproval: {
    approved: true,
    approvedBy: "operator:test",
    approvedAt: "2026-06-20T00:00:00Z",
    evidenceRef: "evidence:operator-approval:approve-ready",
  },
};

describe("manager marketplace readiness gate", () => {
  it("fails closed for imported listing fixtures without local proof metadata", () => {
    const results = getMarketplaceReadinessResults();

    expect(results).toHaveLength(8);
    expect(results.map((result) => result.listingId)).toContain("unpublished:approveReadyDraft");
    expect(results.every((result) => result.status === "blocked")).toBe(true);
    expect(results.every((result) => result.boundaries.livePaymentAllowed === false)).toBe(true);
    expect(results.every((result) => result.boundaries.walletSigningAllowed === false)).toBe(true);
    expect(results.every((result) => result.boundaries.rpcProbeAllowed === false)).toBe(true);
    expect(results.every((result) => result.boundaries.mcpCallAllowed === false)).toBe(true);
    expect(results.every((result) => result.boundaries.reputationAssignmentAllowed === false)).toBe(true);
    expect(results.every((result) => result.boundaries.publicationAllowed === false)).toBe(true);
    expect(results[0].gates.map((gate) => gate.id)).toEqual([
      "profile_completeness",
      "safe_metadata",
      "endpoint_metadata_validity",
      "payment_plan_metadata",
      "dry_run_receipt_evidence",
      "attestation_draft",
      "operator_approval",
      "no_live_escalation",
    ]);
  });

  it("marks approve-ready imported metadata publish-ready only when every local proof gate passes", () => {
    const candidate = candidateFor("approveReadyDraft");
    const result = evaluateMarketplaceReadiness(
      "approve_ready:approveReadyDraft",
      "approveReadyDraft",
      candidate,
      completeProof,
    );

    expect(result.status).toBe("publish_ready");
    expect(result.blockReasons).toEqual([]);
    expect(result.gates.every((gate) => gate.passed)).toBe(true);
    expect(result.boundaries).toEqual({
      livePaymentAllowed: false,
      walletSigningAllowed: false,
      rpcProbeAllowed: false,
      mcpCallAllowed: false,
      reputationAssignmentAllowed: false,
      publicationAllowed: true,
    });
  });

  it("blocks publication when endpoint binding proof is missing even if other proof refs exist", () => {
    const candidate = candidateFor("approveReadyDraft");
    const { endpointBindingRef, ...proofWithoutEndpointBinding } = completeProof;

    const result = evaluateMarketplaceReadiness(
      "approve_ready:approveReadyDraft",
      "approveReadyDraft",
      candidate,
      proofWithoutEndpointBinding,
    );

    expect(endpointBindingRef).toBeDefined();
    expect(result.status).toBe("blocked");
    expect(result.boundaries.publicationAllowed).toBe(false);
    expect(result.gates.find((gate) => gate.id === "endpoint_metadata_validity")).toMatchObject({
      passed: false,
    });
    expect(result.blockReasons).toContain(
      "Endpoint metadata validity: Endpoint metadata is not publish-ready: local endpoint-binding proof is required before publication.",
    );
  });

  it("allows dry-run readiness when local proof exists but operator approval is absent", () => {
    const candidate = candidateFor("approveReadyDraft");
    const { operatorApproval, ...proofWithoutApproval } = completeProof;

    const result = evaluateMarketplaceReadiness(
      "approve_ready:approveReadyDraft",
      "approveReadyDraft",
      candidate,
      proofWithoutApproval,
    );

    expect(operatorApproval).toBeDefined();
    expect(result.status).toBe("dry_run_ready");
    expect(result.boundaries.publicationAllowed).toBe(false);
    expect(result.gates.find((gate) => gate.id === "operator_approval")).toMatchObject({
      passed: false,
    });
    expect(result.blockReasons).toContain(
      "Operator approval evidence: Explicit operator approval evidence is required before publication.",
    );
  });

  it("keeps unsafe or malformed imported metadata blocked even with complete proof refs", () => {
    const candidate = candidateFor("rejectedMalformedConnector");

    const result = evaluateMarketplaceReadiness(
      "rejected:rejectedMalformedConnector",
      "rejectedMalformedConnector",
      candidate,
      completeProof,
    );

    expect(result.status).toBe("blocked");
    expect(result.boundaries.publicationAllowed).toBe(false);
    expect(result.gates.find((gate) => gate.id === "safe_metadata")).toMatchObject({ passed: false });
    expect(result.gates.find((gate) => gate.id === "endpoint_metadata_validity")).toMatchObject({
      passed: false,
    });
  });

  it("blocks proof metadata that attempts a live escalation", () => {
    const candidate = candidateFor("approveReadyDraft");
    const result = evaluateMarketplaceReadiness(
      "approve_ready:approveReadyDraft",
      "approveReadyDraft",
      candidate,
      {
        ...completeProof,
        boundaryClaims: {
          rpcProbeAllowed: true,
        },
      },
    );

    expect(result.status).toBe("blocked");
    expect(result.boundaries.rpcProbeAllowed).toBe(false);
    expect(result.boundaries.publicationAllowed).toBe(false);
    expect(result.gates.find((gate) => gate.id === "no_live_escalation")).toMatchObject({
      passed: false,
    });
  });
});

function candidateFor(fixtureKey: string) {
  const candidate = getStaticAgentStackReviewWorkspace().candidates.find((item) => item.fixtureKey === fixtureKey);
  if (!candidate) throw new Error(`missing fixture candidate: ${fixtureKey}`);
  return candidate;
}
