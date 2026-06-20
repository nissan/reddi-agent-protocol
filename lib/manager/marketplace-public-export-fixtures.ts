import {
  applyMarketplaceApprovalAction,
  type MarketplaceApprovalAction,
  type MarketplaceApprovalRecord,
  type MarketplaceApprovalRecordState,
} from "@/lib/manager/marketplace-approval-actions";
import {
  deriveMarketplacePublicExportSnapshot,
  type MarketplacePublicExportSnapshot,
} from "@/lib/manager/marketplace-public-export";
import type { MarketplacePublicationEligibilityProof } from "@/lib/manager/marketplace-publication-eligibility";
import { getStaticAgentStackReviewWorkspace } from "@/lib/manager/static-agent-stack-review";

const fixtureTimestamp = "2026-06-20T00:00:00Z";
const fixtureOperatorId = "operator:fixture";

export const fixturePublishReadyProof: MarketplacePublicationEligibilityProof = {
  readinessProofRef: "readiness-proof:approve-ready",
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
  evidenceRefs: [
    "evidence:static-review:approve-ready",
    "source-proof:approve-ready",
    "hosted-attestation-proof:approve-ready",
    "publication-gate:approve-ready",
  ],
  attestationDraftRef: "attestation-draft:approve-ready",
  operatorApproval: {
    approved: true,
    approvedBy: fixtureOperatorId,
    approvedAt: fixtureTimestamp,
    evidenceRef: "evidence:operator-approval:approve-ready",
  },
  hostedAttestationClaim: {
    schemaVersion: "reddi.hosted-attestation-claim.v1",
    id: "hosted-claim:approve-ready",
    status: "hosted_attestation_ready",
    subject: { id: "draft-listing:agent-stack-fixture:anthropic-financial-services:2026-06-18", type: "listing" },
    source: {
      kind: "hosted-rap-registry",
      sourceId: "source:agent-stack-fixture:anthropic-financial-services:2026-06-18",
      catalogRef: "/.well-known/ai-catalog.json",
      listingId: "draft-listing:agent-stack-fixture:anthropic-financial-services:2026-06-18",
      rawSnapshotRef: "snapshot:approve-ready",
    },
    backing: {
      claimKind: "hosted_attestation_backed",
      attestationKind: "reddi_attested",
      reputationKind: "offchain_preview",
      quasarBacking: {
        status: "not_quasar_backed",
        instructionFlow: "not_built",
        promotionChecklistIssue: 441,
      },
      hostedAttestationBacking: {
        status: "ready",
        sourceProofRef: "source-proof:approve-ready",
        attestationProofRef: "hosted-attestation-proof:approve-ready",
        hostedBy: "reddi",
        operatorApprovalEvidenceRef: "evidence:operator-approval:approve-ready",
        publicationGateEvidenceRef: "publication-gate:approve-ready",
        publicationGateIssue: 395,
      },
    },
    evidenceSummary: {
      bindingId: "binding:approve-ready",
      receiptId: "receipt:dry-run:approve-ready",
      evidenceId: "evidence:static-review:approve-ready",
      evidenceHash: "sha256:approve-ready",
      evidenceRef: "evidence:static-review:approve-ready",
      paymentProofRef: "evidence:payment-plan:dry-run",
      attestationId: "attestation:approve-ready",
      reputationEventDraftId: "reputation:approve-ready",
      previewId: "preview:approve-ready",
      sourceProofRef: "source-proof:approve-ready",
      attestationProofRef: "hosted-attestation-proof:approve-ready",
      operatorApprovalEvidenceRef: "evidence:operator-approval:approve-ready",
      publicationGateEvidenceRef: "publication-gate:approve-ready",
    },
    display: {
      label: "Hosted attestation ready",
      explanation: "Fixture hosted attestation claim.",
      buyerFacingClaimAllowed: false,
    },
    reasonCodes: [
      "binding_valid",
      "preview_ready",
      "hosted_attestation_evidence_present",
      "operator_approval_present",
      "publication_gate_present",
      "buyer_facing_claim_disabled",
      "not_quasar_backed",
    ],
    guardrails: {
      reputationMutated: false,
      quasarInstructionBuilt: false,
      walletSigning: false,
      rpcCall: false,
      hostedRegistryWrite: false,
      marketplacePublished: false,
      livePaymentExecuted: false,
      providerCall: false,
    },
    createdAt: fixtureTimestamp,
  },
  hostedSourceProofRef: "source-proof:approve-ready",
  hostedAttestationProofRef: "hosted-attestation-proof:approve-ready",
  publicationGateEvidenceRef: "publication-gate:approve-ready",
  quasarCompatibility: {
    schemaVersion: "reddi.publication-quasar-compatibility.v1",
    issue: 390,
    status: "metadata_only",
    evidenceRef: "quasar-compatibility:metadata-only",
    quasarBackedClaimAllowed: false,
    instructionBuilt: false,
  },
};

export function getFixtureBackedMarketplacePublicExportSnapshot(): MarketplacePublicExportSnapshot {
  const published = publishedFixtureRecord();
  const approvedButUnpublished = recordFor("approved", "approveReadyDraft");
  const unsafeForgedPublished = {
    ...recordFor("published", "rejectedMalformedConnector", true),
    auditHistory: [{
      operatorId: fixtureOperatorId,
      action: "publish" as const,
      reason: "Forged publish fixture for blocked export diagnostics.",
      timestamp: fixtureTimestamp,
      previousState: "approved" as const,
      nextState: "published" as const,
      sourceListingRef: "draft-listing:agent-stack-fixture:anthropic-financial-services:2026-06-18",
      readinessProofRef: "readiness-proof:forged",
      operatorApprovalRef: "evidence:operator-approval:approve-ready",
      evidenceRefs: ["evidence:forged:publish"],
    }],
  };

  return deriveMarketplacePublicExportSnapshot(
    [published, approvedButUnpublished, unsafeForgedPublished],
    {
      [published.id]: fixturePublishReadyProof,
      [approvedButUnpublished.id]: fixturePublishReadyProof,
      [unsafeForgedPublished.id]: fixturePublishReadyProof,
    },
    { generatedAt: fixtureTimestamp },
  );
}

function action(
  type: MarketplaceApprovalAction["type"],
  overrides: Partial<MarketplaceApprovalAction> = {},
): MarketplaceApprovalAction {
  return {
    type,
    operatorId: fixtureOperatorId,
    timestamp: fixtureTimestamp,
    ...(type === "publish" || type === "restore" ? { readinessProofRef: "readiness-proof:approve-ready" } : {}),
    ...overrides,
  };
}

function publishedFixtureRecord() {
  const approve = applyMarketplaceApprovalAction(recordFor("draft", "approveReadyDraft"), action("approve"));
  if (!approve.ok) throw new Error(approve.reason);

  const publish = applyMarketplaceApprovalAction(approve.record, action("publish", {
    readinessProof: fixturePublishReadyProof,
    evidenceRefs: ["evidence:operator-action:publish"],
  }));
  if (!publish.ok) throw new Error(publish.reason);

  return publish.record;
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
