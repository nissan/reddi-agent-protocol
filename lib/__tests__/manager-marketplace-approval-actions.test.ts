import {
  applyMarketplaceApprovalAction,
  getBlockingApprovalReviewItems,
  type MarketplaceApprovalAction,
  type MarketplaceApprovalRecord,
  type MarketplaceApprovalRecordState,
} from "@/lib/manager/marketplace-approval-actions";
import type { MarketplaceReadinessProofMetadata } from "@/lib/manager/marketplace-readiness-gate";
import { getStaticAgentStackReviewWorkspace } from "@/lib/manager/static-agent-stack-review";

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

describe("manager marketplace approval actions", () => {
  it("approves static-safe imported metadata and publishes only with publish-ready proof", () => {
    const approve = applyMarketplaceApprovalAction(recordFor("draft", "approveReadyDraft"), action("approve"));

    expect(approve.ok).toBe(true);
    expect(approve.record.state).toBe("approved");
    expect(approve.record.publicVisible).toBe(false);

    const publish = applyMarketplaceApprovalAction(approve.record, action("publish", {
      readinessProof: publishReadyProof,
      evidenceRefs: ["evidence:operator-action:publish"],
    }));

    expect(publish.ok).toBe(true);
    expect(publish.record.state).toBe("published");
    expect(publish.record.publicVisible).toBe(true);
    expect(publish.readiness?.status).toBe("publish_ready");
    expect(publish.readiness?.boundaries.publicationAllowed).toBe(true);
    expect(publish.record.auditHistory).toEqual([
      expect.objectContaining({
        operatorId,
        action: "approve",
        previousState: "draft",
        nextState: "approved",
        timestamp,
      }),
      expect.objectContaining({
        operatorId,
        action: "publish",
        previousState: "approved",
        nextState: "published",
        evidenceRefs: expect.arrayContaining([
          "evidence:operator-action:publish",
          "evidence:operator-approval:approve-ready",
          "receipt:dry-run:approve-ready",
        ]),
      }),
    ]);
  });

  it("blocks publish before approval", () => {
    const result = applyMarketplaceApprovalAction(recordFor("draft", "approveReadyDraft"), action("publish", {
      readinessProof: publishReadyProof,
    }));

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("Publish requires approved state; got draft.");
    expect(result.record.state).toBe("draft");
    expect(result.record.publicVisible).toBe(false);
    expect(result.record.auditHistory).toEqual([]);
  });

  it("keeps approve internal-only even if an input record is unexpectedly public visible", () => {
    const approve = applyMarketplaceApprovalAction(recordFor("draft", "approveReadyDraft", true), action("approve"));

    expect(approve.ok).toBe(true);
    expect(approve.record.state).toBe("approved");
    expect(approve.record.publicVisible).toBe(false);
    expect(approve.record.auditHistory[0]).toMatchObject({
      action: "approve",
      previousState: "draft",
      nextState: "approved",
    });
  });

  it("blocks publish when readiness is blocked", () => {
    const result = applyMarketplaceApprovalAction(recordFor("approved", "rejectedMalformedConnector"), action("publish", {
      readinessProof: publishReadyProof,
    }));

    expect(result.ok).toBe(false);
    expect(result.readiness?.status).toBe("blocked");
    expect(result.readiness?.boundaries.publicationAllowed).toBe(false);
    expect(result.record.state).toBe("approved");
  });

  it("blocks publish when readiness is only dry-run ready", () => {
    const { operatorApproval, ...dryRunReadyProof } = publishReadyProof;
    expect(operatorApproval).toBeDefined();

    const result = applyMarketplaceApprovalAction(recordFor("approved", "approveReadyDraft"), action("publish", {
      readinessProof: dryRunReadyProof,
    }));

    expect(result.ok).toBe(false);
    expect(result.readiness?.status).toBe("dry_run_ready");
    expect(result.readiness?.boundaries.publicationAllowed).toBe(false);
    expect(result.record.state).toBe("approved");
  });

  it.each(["draft", "approve_ready", "blocked"] as MarketplaceApprovalRecordState[])(
    "requests changes from %s and records the reason",
    (state) => {
      const result = applyMarketplaceApprovalAction(recordFor(state, "approveReadyDraft"), action("request_changes", {
        reason: "Needs local endpoint binding evidence before approval.",
        evidenceRefs: ["evidence:review-note:1"],
      }));

      expect(result.ok).toBe(true);
      expect(result.record.state).toBe("needs_changes");
      expect(result.record.publicVisible).toBe(false);
      expect(result.record.auditHistory[0]).toMatchObject({
        action: "request_changes",
        reason: "Needs local endpoint binding evidence before approval.",
        previousState: state,
        nextState: "needs_changes",
        evidenceRefs: ["evidence:review-note:1"],
      });
    },
  );

  it("keeps reject terminal until a future explicit reopen lane exists", () => {
    const rejected = applyMarketplaceApprovalAction(recordFor("draft", "approveReadyDraft"), action("reject", {
      reason: "Operator rejected this import.",
    }));

    expect(rejected.ok).toBe(true);
    expect(rejected.record.state).toBe("rejected");
    expect(rejected.record.publicVisible).toBe(false);

    const retry = applyMarketplaceApprovalAction(rejected.record, action("approve"));

    expect(retry.ok).toBe(false);
    expect(retry.reason).toContain("terminal");
    expect(retry.record.state).toBe("rejected");
    expect(retry.record.auditHistory).toHaveLength(1);
  });

  it("suspends approved, published, internal, and already suspended records with public visibility forced false", () => {
    for (const state of ["approved", "published", "internal", "suspended"] as MarketplaceApprovalRecordState[]) {
      const result = applyMarketplaceApprovalAction(recordFor(state, "approveReadyDraft", true), action("suspend"));

      expect(result.ok).toBe(true);
      expect(result.record.state).toBe("suspended");
      expect(result.record.publicVisible).toBe(false);
      expect(result.record.auditHistory[0]).toMatchObject({
        action: "suspend",
        previousState: state,
        nextState: "suspended",
      });
    }
  });

  it("unpublishes idempotently and forces public visibility false", () => {
    const fromPublished = applyMarketplaceApprovalAction(recordFor("published", "approveReadyDraft", true), action("unpublish"));
    const fromApproved = applyMarketplaceApprovalAction(recordFor("approved", "approveReadyDraft", false), action("unpublish"));

    expect(fromPublished.ok).toBe(true);
    expect(fromPublished.record.state).toBe("approved");
    expect(fromPublished.record.publicVisible).toBe(false);
    expect(fromApproved.ok).toBe(true);
    expect(fromApproved.record.state).toBe("approved");
    expect(fromApproved.record.publicVisible).toBe(false);
  });

  it.each([
    "rejectedMalformedConnector",
    "suspendedUnsafeMetadata",
    "solanaAiKitBlocked",
  ])("does not approve unsafe, malformed, or static-risk imported metadata from %s", (fixtureKey) => {
    const record = recordFor("draft", fixtureKey);

    expect(getBlockingApprovalReviewItems(record.candidate).length).toBeGreaterThan(0);

    const result = applyMarketplaceApprovalAction(record, action("approve"));

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Imported metadata cannot be approved");
    expect(result.record.state).toBe("draft");
    expect(result.record.auditHistory).toEqual([]);
  });

  it("blocks unsafe metadata approval even when the static review item is informational", () => {
    const record = recordFor("draft", "approveReadyDraft");
    const warningOnlyRecord: MarketplaceApprovalRecord = {
      ...record,
      candidate: {
        ...record.candidate,
        reviewItems: [
          ...record.candidate.reviewItems,
          {
            id: "review:unsafe-info-only",
            state: "unsafe_metadata_warning",
            severity: "info",
            path: "plugins/",
            source: "validation_warning",
            reasonCodes: ["unsafe_metadata_warning"],
            message: "Informational unsafe metadata still requires operator review before approval.",
            blocksPublication: false,
            recommendedAction: "review_unsafe_metadata",
          },
        ],
      },
    };

    expect(getBlockingApprovalReviewItems(warningOnlyRecord.candidate)).toHaveLength(1);

    const result = applyMarketplaceApprovalAction(warningOnlyRecord, action("approve"));

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("unsafe_metadata_warning");
    expect(result.record.state).toBe("draft");
    expect(result.record.auditHistory).toEqual([]);
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
