import {
  applyMarketplaceApprovalAction,
  type MarketplaceApprovalAction,
  type MarketplaceApprovalRecord,
  type MarketplaceApprovalRecordState,
} from "@/lib/manager/marketplace-approval-actions";
import {
  deriveMarketplacePublicExportItem,
  deriveMarketplacePublicExportSnapshot,
} from "@/lib/manager/marketplace-public-export";
import type { MarketplaceReadinessProofMetadata } from "@/lib/manager/marketplace-readiness-gate";
import { getStaticAgentStackReviewWorkspace } from "@/lib/manager/static-agent-stack-review";
import { validateAiCatalog } from "@reddi/agent-protocol/ai-catalog";

const timestamp = "2026-06-20T00:00:00Z";
const operatorId = "operator:test";

const publishReadyProof: MarketplaceReadinessProofMetadata = {
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
    approvedBy: operatorId,
    approvedAt: timestamp,
    evidenceRef: "evidence:operator-approval:approve-ready",
  },
};

describe("manager marketplace public export", () => {
  it("exports a published listing into hosted and ARD-compatible catalog snapshots", () => {
    const published = publishedRecord();
    const result = deriveMarketplacePublicExportItem(published, publishReadyProof);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reasons.join(","));

    expect(result.listing).toMatchObject({
      schemaVersion: "reddi.marketplace-public-export.v1",
      listingId: published.id,
      fixtureKey: "approveReadyDraft",
      source: {
        imported: true,
        staticOnly: true,
        untrusted: true,
      },
      endpoint: {
        bindingRef: publishReadyProof.endpointBindingRef,
        liveUrl: null,
        healthStatus: "not_probed",
      },
      payment: {
        planId: publishReadyProof.paymentPlan?.planId,
        activation: "disabled",
        settlement: "dry_run_only",
      },
      trust: {
        rapAttested: false,
        reputationAssigned: false,
        operatorApprovalEvidenceRef: publishReadyProof.operatorApproval?.evidenceRef,
      },
    });
    expect(result.listing.evidenceRefs).toEqual(expect.arrayContaining([
      "evidence:operator-action:publish",
      "evidence:operator-approval:approve-ready",
      "receipt:dry-run:approve-ready",
    ]));
    expect(result.boundaries).toMatchObject({
      livePaymentAllowed: false,
      walletSigningAllowed: false,
      rpcProbeAllowed: false,
      mcpCallAllowed: false,
      reputationAssignmentAllowed: false,
      publicationAllowed: true,
      hostedExportAllowed: true,
      ardCatalogExportAllowed: true,
    });
    expect(result.catalogResource).toMatchObject({
      identifier: "urn:reddi:marketplace-listing:approveReadyDraft",
      mediaType: "application/vnd.reddi.marketplace-listing+json",
      data: result.listing,
      metadata: {
        rap: {
          readinessStatus: "publish_ready",
          boundaries: result.boundaries,
        },
      },
    });
  });

  it("builds a catalog snapshot with only eligible exported entries", () => {
    const published = publishedRecord();
    const blocked = recordFor("approved", "approveReadyDraft");
    const snapshot = deriveMarketplacePublicExportSnapshot(
      [published, blocked],
      { [published.id]: publishReadyProof, [blocked.id]: publishReadyProof },
      { generatedAt: timestamp },
    );

    expect(snapshot.schemaVersion).toBe("reddi.marketplace-public-export.v1");
    expect(snapshot.generatedAt).toBe(timestamp);
    expect(snapshot.exported).toHaveLength(1);
    expect(snapshot.blocked).toHaveLength(1);
    expect(snapshot.aiCatalog).toMatchObject({
      specVersion: "1.0",
      entries: [snapshot.exported[0].catalogResource],
    });
    expect(validateAiCatalog(snapshot.aiCatalog).ok).toBe(true);
  });

  it.each(["draft", "needs_changes", "approved", "rejected", "suspended", "internal"] as MarketplaceApprovalRecordState[])(
    "blocks export from %s state",
    (state) => {
      const result = deriveMarketplacePublicExportItem(recordFor(state, "approveReadyDraft"), publishReadyProof);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected blocked export");
      expect(result.reasons).toContain(`record_state_not_published:${state}`);
      expect(result.boundaries.hostedExportAllowed).toBe(false);
      expect(result.boundaries.ardCatalogExportAllowed).toBe(false);
    },
  );

  it("blocks export when a published record is not public visible", () => {
    const result = deriveMarketplacePublicExportItem(
      { ...publishedRecord(), publicVisible: false },
      publishReadyProof,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected blocked export");
    expect(result.reasons).toContain("public_visibility_false");
  });

  it("blocks export when readiness is only dry-run ready", () => {
    const { operatorApproval, ...dryRunReadyProof } = publishReadyProof;
    expect(operatorApproval).toBeDefined();
    const result = deriveMarketplacePublicExportItem(publishedRecord(), dryRunReadyProof);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected blocked export");
    expect(result.reasons).toEqual(expect.arrayContaining([
      "readiness_not_publish_ready:dry_run_ready",
      "publication_not_allowed",
      "operator_approval_missing",
      "operator_approval_evidence_missing",
    ]));
    expect(result.readinessStatus).toBe("dry_run_ready");
  });

  it("blocks export when readiness is blocked", () => {
    const result = deriveMarketplacePublicExportItem(publishedRecord(), {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected blocked export");
    expect(result.reasons).toContain("readiness_not_publish_ready:blocked");
    expect(result.reasons).toContain("publication_not_allowed");
    expect(result.readinessStatus).toBe("blocked");
  });

  it("blocks export when operator approval proof lacks evidence", () => {
    const result = deriveMarketplacePublicExportItem(publishedRecord(), {
      ...publishReadyProof,
      operatorApproval: undefined,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected blocked export");
    expect(result.reasons).toEqual(expect.arrayContaining([
      "readiness_not_publish_ready:dry_run_ready",
      "operator_approval_missing",
      "operator_approval_evidence_missing",
    ]));
  });

  it("blocks export when publish audit evidence is missing", () => {
    const publishedWithoutAuditEvidence: MarketplaceApprovalRecord = {
      ...publishedRecord(),
      auditHistory: [
        {
          operatorId,
          action: "publish",
          reason: "Manual fixture with missing evidence.",
          timestamp,
          previousState: "approved",
          nextState: "published",
          evidenceRefs: [],
        },
      ],
    };

    const result = deriveMarketplacePublicExportItem(publishedWithoutAuditEvidence, publishReadyProof);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected blocked export");
    expect(result.reasons).toContain("publish_audit_missing");
  });

  it("does not export unsafe imported metadata even with forged published state and proof", () => {
    const forgedUnsafeRecord: MarketplaceApprovalRecord = {
      ...recordFor("published", "rejectedMalformedConnector", true),
      auditHistory: [{
        operatorId,
        action: "publish",
        reason: "Forged publish evidence.",
        timestamp,
        previousState: "approved",
        nextState: "published",
        evidenceRefs: ["evidence:forged:publish"],
      }],
    };

    const result = deriveMarketplacePublicExportItem(forgedUnsafeRecord, publishReadyProof);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected blocked export");
    expect(result.readinessStatus).toBe("blocked");
    expect(result.blockReasons.join(" ")).toContain("Safe metadata");
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
    readinessProof: publishReadyProof,
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
