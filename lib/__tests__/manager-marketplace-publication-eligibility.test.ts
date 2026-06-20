import {
  applyMarketplaceApprovalAction,
  type MarketplaceApprovalAction,
  type MarketplaceApprovalRecord,
  type MarketplaceApprovalRecordState,
} from "@/lib/manager/marketplace-approval-actions";
import {
  deriveMarketplacePublicationEligibility,
  type MarketplacePublicationEligibilityProof,
} from "@/lib/manager/marketplace-publication-eligibility";
import { fixturePublishReadyProof } from "@/lib/manager/marketplace-public-export-fixtures";
import { getStaticAgentStackReviewWorkspace } from "@/lib/manager/static-agent-stack-review";

const timestamp = "2026-06-20T00:00:00Z";
const operatorId = "operator:test";

describe("marketplace publication eligibility matrix", () => {
  it("marks a reviewed published listing eligible without activating live publication", () => {
    const record = publishedRecord();
    const decision = deriveMarketplacePublicationEligibility(record, fixturePublishReadyProof);

    expect(decision).toMatchObject({
      schemaVersion: "reddi.marketplace-publication-eligibility.v1",
      status: "eligible",
      reasonCodes: ["eligible"],
      claimSources: {
        paymentProof: "readiness_proof",
        receiptEvidence: "readiness_proof",
        hostedAttestation: "hosted_attestation_claim",
        quasarCompatibility: "metadata_only",
        discoveryRelevance: "separate_from_trust",
      },
      boundaries: {
        publicationAllowed: true,
        hostedExportAllowed: true,
        ardCatalogExportAllowed: true,
        livePublicationActivated: false,
        paymentActivationAllowed: false,
        trustClaimAllowed: false,
        reputationClaimAllowed: false,
        discoveryRelevanceIsTrust: false,
      },
    });
    expect(decision.evidenceRefs).toEqual(expect.arrayContaining([
      "evidence:operator-action:publish",
      "evidence:operator-approval:approve-ready",
      "source-proof:approve-ready",
      "hosted-attestation-proof:approve-ready",
      "quasar-compatibility:metadata-only",
    ]));
  });

  it.each([
    ["approved but unpublished", recordFor("approved", "approveReadyDraft", false), fixturePublishReadyProof, "record_state_not_published"],
    ["not public visible", { ...publishedRecord(), publicVisible: false }, fixturePublishReadyProof, "public_visibility_false"],
    ["missing audit evidence", { ...publishedRecord(), auditHistory: [] }, fixturePublishReadyProof, "publish_audit_missing"],
    ["blocked readiness", publishedRecord(), {}, "readiness_not_publish_ready"],
    ["dry-run only readiness", publishedRecord(), { ...fixturePublishReadyProof, operatorApproval: undefined }, "readiness_not_publish_ready"],
    ["missing endpoint binding", publishedRecord(), { ...fixturePublishReadyProof, endpointBindingRef: undefined }, "endpoint_binding_missing"],
    ["missing payment proof", publishedRecord(), { ...fixturePublishReadyProof, paymentPlan: undefined }, "payment_proof_missing"],
    ["missing receipt evidence", publishedRecord(), { ...fixturePublishReadyProof, dryRunReceiptRefs: [], evidenceRefs: [] }, "receipt_evidence_missing"],
    ["missing hosted attestation", publishedRecord(), { ...fixturePublishReadyProof, hostedAttestationClaim: undefined }, "hosted_attestation_missing"],
    [
      "hosted attestation not ready",
      publishedRecord(),
      {
        ...fixturePublishReadyProof,
        hostedAttestationClaim: {
          ...fixturePublishReadyProof.hostedAttestationClaim!,
          status: "publication_gate_pending",
        },
      },
      "hosted_attestation_not_ready",
    ],
    ["missing Quasar compatibility", publishedRecord(), { ...fixturePublishReadyProof, quasarCompatibility: undefined }, "missing_quasar_compatibility"],
    [
      "blocked Quasar compatibility",
      publishedRecord(),
      {
        ...fixturePublishReadyProof,
        quasarCompatibility: {
          ...fixturePublishReadyProof.quasarCompatibility!,
          status: "blocked",
        },
      },
      "quasar_compatibility_blocked",
    ],
    [
      "unsafe metadata",
      publishedUnsafeRecord(),
      fixturePublishReadyProof,
      "unsafe_metadata",
    ],
    [
      "suspended state",
      recordFor("suspended", "approveReadyDraft", false),
      fixturePublishReadyProof,
      "suspended_or_unpublished_state",
    ],
  ] as Array<[string, MarketplaceApprovalRecord, MarketplacePublicationEligibilityProof, string]>)(
    "blocks %s",
    (_label, record, proof, reasonCode) => {
      const decision = deriveMarketplacePublicationEligibility(record, proof);

      expect(decision.status).toBe("blocked");
      expect(decision.reasonCodes).toContain(reasonCode);
      expect(decision.boundaries.hostedExportAllowed).toBe(false);
      expect(decision.boundaries.ardCatalogExportAllowed).toBe(false);
      expect(decision.boundaries.livePublicationActivated).toBe(false);
      expect(decision.boundaries.trustClaimAllowed).toBe(false);
      expect(decision.boundaries.reputationClaimAllowed).toBe(false);
      expect(decision.claimSources.discoveryRelevance).toBe("separate_from_trust");
    },
  );

  it.each([
    [
      "buyer-facing hosted claim",
      {
        ...fixturePublishReadyProof,
        hostedAttestationClaim: {
          ...fixturePublishReadyProof.hostedAttestationClaim!,
          display: {
            ...fixturePublishReadyProof.hostedAttestationClaim!.display,
            buyerFacingClaimAllowed: true as false,
          },
        },
      },
      "hosted_claim_buyer_facing_enabled",
    ],
    [
      "hosted claim guardrail escalation",
      {
        ...fixturePublishReadyProof,
        hostedAttestationClaim: {
          ...fixturePublishReadyProof.hostedAttestationClaim!,
          guardrails: {
            ...fixturePublishReadyProof.hostedAttestationClaim!.guardrails,
            rpcCall: true as false,
          },
        },
      },
      "hosted_claim_guardrail_escalation",
    ],
    [
      "hosted claim source proof mismatch",
      {
        ...fixturePublishReadyProof,
        hostedAttestationClaim: {
          ...fixturePublishReadyProof.hostedAttestationClaim!,
          evidenceSummary: {
            ...fixturePublishReadyProof.hostedAttestationClaim!.evidenceSummary,
            sourceProofRef: "source-proof:other-listing",
          },
        },
      },
      "hosted_claim_evidence_mismatch",
    ],
    [
      "hosted claim operator evidence mismatch",
      {
        ...fixturePublishReadyProof,
        hostedAttestationClaim: {
          ...fixturePublishReadyProof.hostedAttestationClaim!,
          evidenceSummary: {
            ...fixturePublishReadyProof.hostedAttestationClaim!.evidenceSummary,
            operatorApprovalEvidenceRef: "evidence:operator-approval:other-listing",
          },
        },
      },
      "hosted_claim_operator_evidence_mismatch",
    ],
  ] as Array<[string, MarketplacePublicationEligibilityProof, string]>)(
    "blocks %s",
    (_label, proof, reasonCode) => {
      const decision = deriveMarketplacePublicationEligibility(publishedRecord(), proof);

      expect(decision.status).toBe("blocked");
      expect(decision.reasonCodes).toContain(reasonCode);
      expect(decision.boundaries.hostedExportAllowed).toBe(false);
      expect(decision.boundaries.trustClaimAllowed).toBe(false);
      expect(decision.boundaries.reputationClaimAllowed).toBe(false);
    },
  );

  it("blocks live escalation or Quasar-backed claims", () => {
    const decision = deriveMarketplacePublicationEligibility(publishedRecord(), {
      ...fixturePublishReadyProof,
      boundaryClaims: { walletSigningAllowed: true },
      quasarCompatibility: {
        ...fixturePublishReadyProof.quasarCompatibility!,
        quasarBackedClaimAllowed: true as false,
        instructionBuilt: true as false,
      },
    });

    expect(decision.status).toBe("blocked");
    expect(decision.reasonCodes).toEqual(expect.arrayContaining([
      "live_escalation_not_allowed",
      "quasar_backed_claim_not_allowed",
      "quasar_instruction_built",
    ]));
    expect(decision.boundaries.walletSigningAllowed).toBe(false);
    expect(decision.boundaries.reputationClaimAllowed).toBe(false);
  });
});

function action(
  type: MarketplaceApprovalAction["type"],
  overrides: Partial<MarketplaceApprovalAction> = {},
): MarketplaceApprovalAction {
  return {
    type,
    operatorId,
    timestamp,
    ...overrides,
  };
}

function publishedRecord() {
  const approve = applyMarketplaceApprovalAction(recordFor("draft", "approveReadyDraft"), action("approve"));
  if (!approve.ok) throw new Error(approve.reason);

  const publish = applyMarketplaceApprovalAction(approve.record, action("publish", {
    readinessProof: fixturePublishReadyProof,
    evidenceRefs: ["evidence:operator-action:publish"],
  }));
  if (!publish.ok) throw new Error(publish.reason);

  return publish.record;
}

function publishedUnsafeRecord() {
  return {
    ...recordFor("published", "rejectedMalformedConnector", true),
    auditHistory: [{
      operatorId,
      action: "publish" as const,
      reason: "Forged publish evidence.",
      timestamp,
      previousState: "approved" as const,
      nextState: "published" as const,
      evidenceRefs: ["evidence:forged:publish"],
    }],
  };
}

function recordFor(
  state: MarketplaceApprovalRecordState,
  fixtureKey: string,
  publicVisible = false,
): MarketplaceApprovalRecord {
  const candidate = getStaticAgentStackReviewWorkspace().candidates.find((item) => item.fixtureKey === fixtureKey);
  if (!candidate) throw new Error(`missing fixture candidate: ${fixtureKey}`);
  return {
    id: `${state}:${fixtureKey}`,
    fixtureKey,
    candidate,
    state,
    publicVisible,
    auditHistory: [],
  };
}
