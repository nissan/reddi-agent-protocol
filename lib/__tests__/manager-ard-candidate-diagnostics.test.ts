import {
  classifySourceTrustCandidate,
  sourceTrustConformanceFixtureCases,
} from "@reddi/agent-protocol/source-trust-conformance-matrix";
import { deriveAttestationReputationBridge } from "@reddi/agent-protocol/attestation-reputation-bridge";
import type { DiscoveryCandidatePolicy } from "@reddi/agent-protocol/discovery-source";

import {
  ARD_CANDIDATE_DIAGNOSTICS_SCHEMA_VERSION,
  deriveArdCandidateDiagnostics,
} from "@/lib/manager/ard-candidate-diagnostics";
import { searchHostedMarketplaceCatalog } from "@/lib/manager/marketplace-public-search";

const STRICT_POLICY: DiscoveryCandidatePolicy = {
  allowedSourceKinds: ["local-specialist"],
  requireVerifiedTrust: true,
  allowedAssets: ["AUDD"],
  allowedNetworks: ["solana-devnet"],
  maxQuote: { amount: "10000", asset: "AUDD", network: "solana-devnet" },
};

function hostedSearchItem(query?: string) {
  const result = searchHostedMarketplaceCatalog(query ? { q: query } : {});
  expect(result.results.length).toBeGreaterThan(0);
  return { item: result.results[0], generatedAt: result.generatedAt };
}

describe("ARD candidate diagnostics read model (#344)", () => {
  it("separates relevance from identity, trust, policy, payment, evidence, and reputation sections", () => {
    const { item, generatedAt } = hostedSearchItem();
    const diagnostics = deriveArdCandidateDiagnostics(item, { generatedAt });

    expect(diagnostics.schemaVersion).toBe(ARD_CANDIDATE_DIAGNOSTICS_SCHEMA_VERSION);
    expect(diagnostics.candidateId).toBe(item.candidate.identifier);

    // The seven separated sections all exist as distinct structures.
    expect(diagnostics.relevance.scoreMeaning).toBe("relevance_only_not_trust");
    expect(diagnostics.relevance.score).toBe(item.match.score);
    expect(diagnostics.publisherIdentity).toBeDefined();
    expect(diagnostics.trustEvidence.sourceTrustState).toBe("listed_untrusted");
    expect(diagnostics.policyDecision.gate).toBe("policy");
    expect(diagnostics.budgetPaymentFit.quoteGate.gate).toBe("quote");
    expect(diagnostics.budgetPaymentFit.paymentGate.gate).toBe("payment");
    expect(diagnostics.budgetPaymentFit.budgetGate.gate).toBe("budget");
    expect(diagnostics.receiptEvidenceHistory.status).toBe("no_history");
    expect(diagnostics.reputationState.assigned).toBe(false);
    expect(diagnostics.reputationState.buyerFacingClaimsAllowed).toBe(false);

    // Composition: #577 matrix + #344 explainability ride along.
    expect(diagnostics.actionabilityMatrix.schemaVersion).toBe("reddi.discovery-actionability-matrix.v1");
    expect(diagnostics.explainability.schemaVersion).toBe("reddi.ranking-explainability.v1");

    // Boundary and guardrails: relevance never becomes an approval.
    expect(diagnostics.boundary.ardRelevanceIsNever).toEqual([
      "trust",
      "safety",
      "budget",
      "payment",
      "invocation",
      "publication",
    ]);
    expect(diagnostics.guardrails).toEqual({
      endpointProbed: false,
      trustMutated: false,
      reputationMutated: false,
      paymentExecuted: false,
      publicationTriggered: false,
    });
  });

  it("keeps a high-relevance hosted candidate fail-closed when trust/policy/quote gates fail", () => {
    const { item, generatedAt } = hostedSearchItem();
    expect(item.match.score).toBeGreaterThan(0);

    const diagnostics = deriveArdCandidateDiagnostics(item, { generatedAt, policy: STRICT_POLICY });

    // Relevance is untouched and still reported...
    expect(diagnostics.relevance.score).toBe(item.match.score);
    // ...but the candidate is rejected: hosted-rap-registry is not an allowed
    // source, trust is unverified, and no quote exists.
    expect(diagnostics.explainability.selection.state).toBe("rejected");
    const rejectionCodes = diagnostics.explainability.rejectionReasons.map((reason) => reason.code);
    expect(rejectionCodes).toContain("source_not_allowed");
    expect(rejectionCodes).toContain("trust_verification_required");
    expect(rejectionCodes).toContain("missing_quote");
  });

  it("composes the #593 conformance row so a blocked source stays blocked regardless of relevance", () => {
    const { item, generatedAt } = hostedSearchItem();
    const row = classifySourceTrustCandidate(
      sourceTrustConformanceFixtureCases.highRelevanceBlockedArd.input,
    );
    expect(row.state).toBe("blocked");
    expect(row.discoveryBoundary.relevanceScore).toBe(0.99);

    const diagnostics = deriveArdCandidateDiagnostics(item, { generatedAt, sourceTrustRow: row });
    expect(diagnostics.trustEvidence.sourceTrustState).toBe("blocked");
    expect(diagnostics.trustEvidence.reasonCodes).toContain("credential_leakage_rejected");
    expect(diagnostics.trustEvidence.conformanceFindings.length).toBeGreaterThan(0);
    expect(
      diagnostics.trustEvidence.conformanceFindings.some(
        (message) => message.code === "relevance_only_not_trust",
      ),
    ).toBe(true);
    // The relevance section still reports search relevance separately.
    expect(diagnostics.relevance.scoreMeaning).toBe("relevance_only_not_trust");
  });

  it("composes the #606 bridge listing projection as the reputation state section", () => {
    const { item, generatedAt } = hostedSearchItem();
    const bridge = deriveAttestationReputationBridge({
      id: "bridge:ard-diagnostics-test",
      createdAt: "2026-07-16T00:00:00Z",
    });

    const diagnostics = deriveArdCandidateDiagnostics(item, {
      generatedAt,
      reputationProjection: bridge.bridge.listingProjection,
    });
    expect(diagnostics.reputationState.offchainPreview).toBe(
      bridge.bridge.listingProjection.offchainPreview,
    );
    expect(diagnostics.reputationState.hostedAttestation).toBe(
      bridge.bridge.listingProjection.hostedAttestation,
    );
    expect(diagnostics.reputationState.quasar).toBe(bridge.bridge.listingProjection.quasar);
    expect(diagnostics.reputationState.buyerFacingClaimsAllowed).toBe(false);
  });

  it("carries settlement and attestation gates for every hosted candidate (no silent bypass)", () => {
    const result = searchHostedMarketplaceCatalog();
    for (const item of result.results) {
      const diagnostics = deriveArdCandidateDiagnostics(item, { generatedAt: result.generatedAt });
      const gateIds = diagnostics.explainability.gates.map((cell) => cell.gate);
      expect(gateIds).toContain("settlement");
      expect(gateIds).toContain("attestation");
      const settlement = diagnostics.explainability.gates.find((cell) => cell.gate === "settlement");
      const attestation = diagnostics.explainability.gates.find((cell) => cell.gate === "attestation");
      expect(settlement?.state).not.toBe("passed");
      expect(attestation?.state).not.toBe("passed");
      expect(diagnostics.explainability.selection.state).not.toBe("selected");
      expect(diagnostics.explainability.guardrails.settlementBypassPossible).toBe(false);
      expect(diagnostics.explainability.guardrails.attestationBypassPossible).toBe(false);
    }
  });
});
