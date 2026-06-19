import {
  agentStackOperatorReviewFixtureStates,
  type StaticAgentStackOperatorReviewFixture,
  type StaticAgentStackOperatorReviewItem,
  type StaticAgentStackOperatorReviewStateCode,
  type StaticAgentStackOperatorReviewStatus,
} from "@reddi/agent-protocol/agent-stack-fixtures";

export type OperatorDiscoveryFilter =
  | "all"
  | "needs-review"
  | "blocked"
  | "approve-ready"
  | "request-changes"
  | "rejected"
  | "suspended";

export type OperatorDiscoveryGroupView = {
  id: string;
  name: string;
  sourceKind: string;
  sourcePath: string;
  runtimeSurface: string;
  capabilityRefs: string[];
  rawSnapshotRefs: string[];
  writeCapable: boolean;
  humanReviewRequired: boolean;
};

export type OperatorDiscoveryCandidateView = {
  id: string;
  fixtureId: string;
  fixtureKey: string;
  title: string;
  description: string;
  status: StaticAgentStackOperatorReviewStatus;
  fixtureState: string;
  sourceUrl: string;
  checkedCommit: string;
  checkedRef: string;
  sourceKindSummary: string;
  staticOnly: true;
  imported: true;
  external: true;
  untrusted: true;
  rapAttested: false;
  rawSnapshotRefs: string[];
  resultRefs: string[];
  resourceCounts: {
    groups: number;
    reviewItems: number;
    warnings: number;
    rejected: number;
    blockers: number;
    resources: number;
  };
  groups: OperatorDiscoveryGroupView[];
  reviewItems: StaticAgentStackOperatorReviewItem[];
  warnings: StaticAgentStackOperatorReviewItem[];
  rejectedEntries: StaticAgentStackOperatorReviewItem[];
  validationDiagnostics: StaticAgentStackOperatorReviewItem[];
  connectorDiagnostics: StaticAgentStackOperatorReviewItem[];
  riskDiagnostics: StaticAgentStackOperatorReviewItem[];
  secretGuardrails: string[];
  readinessBlockers: string[];
  riskCategories: string[];
  draftPreview: {
    listingStatus: "draft" | "needs_review" | "blocked";
    publicationDisabled: true;
    paymentStatus: "missing_payment_setup";
    paymentActivation: "disabled";
    buyerPreview: Record<string, string>;
  };
  requiredStates: StaticAgentStackOperatorReviewStateCode[];
  requiredGroupKinds: string[];
};

export type OperatorDiscoveryWorkspaceView = {
  filters: Array<{ id: OperatorDiscoveryFilter; label: string; count: number }>;
  candidates: OperatorDiscoveryCandidateView[];
  emptyState: {
    title: string;
    message: string;
  };
};

const fixtureEntries = Object.entries(agentStackOperatorReviewFixtureStates) as Array<
  [string, StaticAgentStackOperatorReviewFixture]
>;

export function getStaticAgentStackReviewWorkspace(): OperatorDiscoveryWorkspaceView {
  const candidates = fixtureEntries.map(([fixtureKey, fixture]) => mapFixture(fixtureKey, fixture));

  return {
    candidates,
    filters: [
      { id: "all", label: "All", count: candidates.length },
      { id: "needs-review", label: "Needs review", count: candidates.filter((candidate) => candidate.status !== "approve_ready").length },
      { id: "blocked", label: "Blocked", count: candidates.filter((candidate) => candidate.resourceCounts.blockers > 0).length },
      { id: "approve-ready", label: "Approve-ready", count: candidates.filter((candidate) => hasRequiredState(candidate, "approve_ready_draft")).length },
      { id: "request-changes", label: "Request changes", count: candidates.filter((candidate) => hasRequiredState(candidate, "request_changes_missing_payment")).length },
      { id: "rejected", label: "Rejected", count: candidates.filter((candidate) => hasRequiredState(candidate, "rejected_malformed_connector")).length },
      { id: "suspended", label: "Suspended", count: candidates.filter((candidate) => hasRequiredState(candidate, "suspended_imported_listing")).length },
    ],
    emptyState: {
      title: "No imported catalog group matches this review lane",
      message: "This workspace is read-only fixture review. It never creates marketplace supply, payments, wallets, RPC calls, repository fetches, MCP contact, or command execution.",
    },
  };
}

function mapFixture(
  fixtureKey: string,
  fixture: StaticAgentStackOperatorReviewFixture,
): OperatorDiscoveryCandidateView {
  const payload = fixture.operatorReviewPayload;
  const warnings = payload.reviewItems.filter((item) => item.severity === "warning" || item.state === "unsafe_metadata_warning");
  const rejectedEntries = payload.reviewItems.filter((item) => item.source === "rejected_entry");
  const connectorDiagnostics = payload.reviewItems.filter((item) => item.source === "connector_diagnostic");
  const riskDiagnostics = payload.reviewItems.filter((item) => item.source === "risk_diagnostic");
  const validationDiagnostics = payload.reviewItems.filter((item) => item.source === "validation_warning");
  const readinessBlockers = payload.reviewItems
    .filter((item) => item.blocksPublication)
    .map((item) => `${item.reasonCodes.join(", ")}: ${item.message}`);

  return {
    id: `${payload.reviewId}:${fixtureKey}`,
    fixtureId: fixture.fixtureId,
    fixtureKey,
    title: titleForFixtureKey(fixtureKey),
    description: fixture.description,
    status: payload.status,
    fixtureState: fixture.fixtureState,
    sourceUrl: payload.source.sourceUrl,
    checkedCommit: payload.source.checkedCommit,
    checkedRef: payload.source.checkedRef ?? "unlabeled snapshot",
    sourceKindSummary: Array.from(new Set(payload.groups.map((group) => group.sourceKind))).join(", "),
    staticOnly: fixture.staticOnly,
    imported: true,
    external: true,
    untrusted: true,
    rapAttested: false,
    rawSnapshotRefs: payload.rawSnapshotRefs,
    resultRefs: fixture.uiTestRefs,
    resourceCounts: {
      groups: payload.groups.length,
      reviewItems: payload.reviewItems.length,
      warnings: warnings.length,
      rejected: rejectedEntries.length,
      blockers: payload.reviewItems.filter((item) => item.blocksPublication).length,
      resources: payload.groups.reduce((total, group) => total + group.capabilityRefs.length, 0),
    },
    groups: payload.groups.map((group) => ({
      id: group.groupId,
      name: group.name,
      sourceKind: group.sourceKind,
      sourcePath: group.sourcePath,
      runtimeSurface: group.runtimeSurface ?? "static import",
      capabilityRefs: group.capabilityRefs,
      rawSnapshotRefs: group.rawSnapshotRefs,
      writeCapable: group.writeCapable,
      humanReviewRequired: group.humanReviewRequired,
    })),
    reviewItems: payload.reviewItems,
    warnings,
    rejectedEntries,
    validationDiagnostics,
    connectorDiagnostics,
    riskDiagnostics,
    secretGuardrails: fixture.guardrails.filter((guardrail) => (
      guardrail.toLowerCase().includes("secret")
      || guardrail.toLowerCase().includes("credential")
      || guardrail.toLowerCase().includes("execute")
      || guardrail.toLowerCase().includes("fetch")
      || guardrail.toLowerCase().includes("payment")
    )),
    readinessBlockers,
    riskCategories: fixture.requiredRiskCategories,
    draftPreview: {
      listingStatus: payload.status === "approve_ready" ? "draft" : payload.status === "request_changes" ? "needs_review" : "blocked",
      publicationDisabled: payload.publication.disabled,
      paymentStatus: payload.payment.status,
      paymentActivation: payload.payment.activation,
      buyerPreview: payload.buyerPreview,
    },
    requiredStates: fixture.requiredReviewItemStates,
    requiredGroupKinds: fixture.requiredGroupKinds,
  };
}

function hasRequiredState(candidate: OperatorDiscoveryCandidateView, state: StaticAgentStackOperatorReviewStateCode) {
  return candidate.requiredStates.includes(state);
}

function titleForFixtureKey(fixtureKey: string) {
  return fixtureKey
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (value) => value.toUpperCase())
    .replace("Ai", "AI");
}
