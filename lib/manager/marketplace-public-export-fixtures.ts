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
import type { MarketplaceReadinessProofMetadata } from "@/lib/manager/marketplace-readiness-gate";
import { getStaticAgentStackReviewWorkspace } from "@/lib/manager/static-agent-stack-review";

const fixtureTimestamp = "2026-06-20T00:00:00Z";
const fixtureOperatorId = "operator:fixture";

export const fixturePublishReadyProof: MarketplaceReadinessProofMetadata = {
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
    approvedBy: fixtureOperatorId,
    approvedAt: fixtureTimestamp,
    evidenceRef: "evidence:operator-approval:approve-ready",
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
