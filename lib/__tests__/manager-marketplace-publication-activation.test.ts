import {
  applyMarketplaceApprovalAction,
  type MarketplaceApprovalAction,
  type MarketplaceApprovalRecord,
  type MarketplaceApprovalRecordState,
} from "@/lib/manager/marketplace-approval-actions";
import {
  deriveMarketplacePublicationActivationGate,
  type MarketplacePublicationActivationApproval,
} from "@/lib/manager/marketplace-publication-activation";
import { deriveMarketplacePublicExportItem } from "@/lib/manager/marketplace-public-export";
import { fixturePublishReadyProof } from "@/lib/manager/marketplace-public-export-fixtures";
import { getStaticAgentStackReviewWorkspace } from "@/lib/manager/static-agent-stack-review";

const timestamp = "2026-06-20T00:00:00Z";
const operatorId = "operator:test";

describe("marketplace publication activation gate", () => {
  it("returns a dry-run activation decision for an eligible public export item", () => {
    const exportItem = exportedItem();
    const decision = deriveMarketplacePublicationActivationGate({
      id: "activation:approve-ready:dry-run",
      exportItem,
      activationApproval: activationApproval(),
      requestedAt: timestamp,
    });

    expect(decision).toMatchObject({
      schemaVersion: "reddi.marketplace-publication-activation.v1",
      status: "dry_run_ready",
      mode: "dry_run",
      source: "public_export_item",
      reasonCodes: ["dry_run_activation_ready"],
      outputs: {
        hostedRap: "dry_run_only",
        ardCatalog: "dry_run_only",
        publicExportSnapshot: "dry_run_only",
      },
      activationPlan: {
        hostedRegistryWrite: false,
        ardCatalogWrite: false,
        livePublication: false,
        walletSigning: false,
        rpcProbe: false,
        livePayment: false,
        providerCall: false,
        mcpCall: false,
      },
      guardrails: {
        dryRunOnly: true,
        livePublicationActivated: false,
        hostedRegistryWrite: false,
        marketplacePublished: false,
        paymentActivationAllowed: false,
        walletSigning: false,
        rpcCall: false,
        providerCall: false,
        reputationMutated: false,
        quasarInstructionBuilt: false,
      },
    });
    expect(decision.evidenceRefs).toEqual(expect.arrayContaining([
      "evidence:operator-action:publish",
      "evidence:activation:approve-ready",
      "evidence:activation-intent:approve-ready",
      "evidence:operator-approval:approve-ready",
    ]));
  });

  it("is idempotent for repeated dry-run activation checks", () => {
    const input = {
      id: "activation:approve-ready:dry-run",
      exportItem: exportedItem(),
      activationApproval: activationApproval(),
      requestedAt: timestamp,
    };

    expect(deriveMarketplacePublicationActivationGate(input)).toEqual(deriveMarketplacePublicationActivationGate(input));
  });

  it.each([
    ["missing activation approval", undefined, "explicit_operator_gate_missing"],
    [
      "activation approval missing evidence",
      activationApproval({ evidenceRef: "" }),
      "explicit_operator_gate_evidence_missing",
    ],
    [
      "activation approval missing actor",
      activationApproval({ approvedBy: "" }),
      "explicit_operator_gate_actor_missing",
    ],
    [
      "activation intent missing",
      activationApproval({ activationIntentRef: "" }),
      "activation_gate_intent_missing",
    ],
    [
      "activation approval not approved",
      activationApproval({ approved: false }),
      "explicit_operator_gate_not_approved",
    ],
    [
      "activation approval operator mismatch",
      activationApproval({ operatorApprovalRef: "evidence:operator-approval:stale" }),
      "activation_gate_operator_mismatch",
    ],
    [
      "activation approval audit mismatch",
      activationApproval({ publicationAuditEvidenceRef: "evidence:operator-action:stale" }),
      "activation_gate_audit_mismatch",
    ],
    ["activation approval timestamp invalid", activationApproval({ approvedAt: "not-a-date" }), "activation_gate_timestamp_invalid"],
    ["activation approval timestamp too loose", activationApproval({ approvedAt: "June 20, 2026" }), "activation_gate_timestamp_invalid"],
    ["activation approval timestamp normalized invalid", activationApproval({ approvedAt: "2026-02-30T00:00:00Z" }), "activation_gate_timestamp_invalid"],
    [
      "live activation request",
      activationApproval({ mode: "live" }),
      "live_mode_unavailable",
    ],
  ] as Array<[string, MarketplacePublicationActivationApproval | undefined, string]>)(
    "blocks %s",
    (_label, approval, reasonCode) => {
      const decision = deriveMarketplacePublicationActivationGate({
        id: "activation:approve-ready:dry-run",
        exportItem: exportedItem(),
        activationApproval: approval,
        requestedAt: timestamp,
      });

      expect(decision.status).toBe("blocked");
      expect(decision.reasonCodes).toContain(reasonCode);
      expect(decision.outputs.hostedRap).toBe("blocked");
      expect(decision.outputs.ardCatalog).toBe("blocked");
      expect(decision.activationPlan.hostedRegistryWrite).toBe(false);
      expect(decision.activationPlan.livePublication).toBe(false);
      expect(decision.guardrails.hostedRegistryWrite).toBe(false);
      expect(decision.guardrails.marketplacePublished).toBe(false);
      expect(decision.guardrails.paymentActivationAllowed).toBe(false);
    },
  );

  it("blocks when public export is not eligible", () => {
    const exportItem = deriveMarketplacePublicExportItem(recordFor("approved", "approveReadyDraft"), fixturePublishReadyProof);

    const decision = deriveMarketplacePublicationActivationGate({
      id: "activation:blocked",
      exportItem,
      activationApproval: activationApproval(),
      requestedAt: timestamp,
    });

    expect(exportItem.ok).toBe(false);
    expect(decision.status).toBe("blocked");
    expect(decision.reasonCodes).toContain("export_not_eligible");
    expect(decision.blockedReasons).toEqual(expect.arrayContaining(exportItem.ok ? [] : exportItem.blockReasons));
    expect(decision.outputs.publicExportSnapshot).toBe("blocked");
  });

  it.each([
    [
      "latest lifecycle unpublishes",
      {
        action: "unpublish" as const,
        previousState: "published" as const,
        nextState: "approved" as const,
        evidenceRefs: ["evidence:operator-action:unpublish"],
      },
    ],
    [
      "latest lifecycle suspends with malformed evidence",
      {
        action: "suspend" as const,
        previousState: "published" as const,
        nextState: "suspended" as const,
        evidenceRefs: [],
      },
    ],
  ])("blocks when public export blocks because %s", (_label, latestAudit) => {
    const record: MarketplaceApprovalRecord = {
      ...publishedRecord(),
      auditHistory: [
        ...publishedRecord().auditHistory,
        {
          operatorId,
          reason: "Operator lifecycle action.",
          timestamp,
          sourceListingRef: "draft-listing:agent-stack-fixture:anthropic-financial-services:2026-06-18",
          readinessProofRef: null,
          operatorApprovalRef: null,
          ...latestAudit,
        },
      ],
    };
    const exportItem = deriveMarketplacePublicExportItem(record, fixturePublishReadyProof);

    const decision = deriveMarketplacePublicationActivationGate({
      id: "activation:blocked-lifecycle",
      exportItem,
      activationApproval: activationApproval(),
      requestedAt: timestamp,
    });

    expect(exportItem.ok).toBe(false);
    expect(decision.status).toBe("blocked");
    expect(decision.reasonCodes).toContain("export_not_eligible");
    expect(decision.blockedReasons.join(" ")).toContain("Publish audit evidence");
  });

  it("blocks forged live flags on a public export success", () => {
    const exportItem = exportedItem();
    const forgedLiveExport = {
      ...exportItem,
      listing: {
        ...exportItem.listing,
        payment: {
          ...exportItem.listing.payment,
          activation: "enabled" as "disabled",
        },
      },
    };

    const decision = deriveMarketplacePublicationActivationGate({
      id: "activation:forged-live",
      exportItem: forgedLiveExport,
      activationApproval: activationApproval(),
      requestedAt: timestamp,
    });

    expect(decision.status).toBe("blocked");
    expect(decision.reasonCodes).toContain("export_live_boundary_escalation");
    expect(decision.guardrails.livePublicationActivated).toBe(false);
    expect(decision.guardrails.paymentActivationAllowed).toBe(false);
  });

  it("blocks malformed request ids and timestamps without throwing", () => {
    for (const requestedAt of ["bad-date", "2026", "2026-02-30T00:00:00Z"]) {
      const decision = deriveMarketplacePublicationActivationGate({
        id: "",
        exportItem: exportedItem(),
        activationApproval: activationApproval(),
        requestedAt,
      });

      expect(decision.status).toBe("blocked");
      expect(decision.reasonCodes).toEqual(expect.arrayContaining([
        "missing_activation_id",
        "invalid_request_timestamp",
      ]));
    }
  });
});

function activationApproval(
  overrides: Partial<MarketplacePublicationActivationApproval> = {},
): MarketplacePublicationActivationApproval {
  return {
    approved: true,
    approvedBy: "operator:fixture",
    approvedAt: timestamp,
    evidenceRef: "evidence:activation:approve-ready",
    activationIntentRef: "evidence:activation-intent:approve-ready",
    operatorApprovalRef: "evidence:operator-approval:approve-ready",
    publicationAuditEvidenceRef: "evidence:operator-action:publish",
    ...overrides,
  };
}

function action(
  type: MarketplaceApprovalAction["type"],
  overrides: Partial<MarketplaceApprovalAction> = {},
): MarketplaceApprovalAction {
  return {
    type,
    operatorId,
    timestamp,
    ...(type === "publish" || type === "restore" ? { readinessProofRef: "readiness-proof:approve-ready" } : {}),
    ...overrides,
  };
}

function exportedItem() {
  const item = deriveMarketplacePublicExportItem(publishedRecord(), fixturePublishReadyProof);
  if (!item.ok) throw new Error(item.reasons.join(", "));
  return item;
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
