import type { OperatorDiscoveryCandidateView } from "@/lib/manager/static-agent-stack-review";
import { getMarketplaceApprovalQueue } from "@/lib/manager/marketplace-listings";

export type MarketplaceReadinessStatus = "blocked" | "dry_run_ready" | "publish_ready";

export type MarketplaceReadinessGateId =
  | "profile_completeness"
  | "safe_metadata"
  | "endpoint_metadata_validity"
  | "payment_plan_metadata"
  | "dry_run_receipt_evidence"
  | "attestation_draft"
  | "operator_approval"
  | "no_live_escalation";

export type MarketplaceReadinessGateDetail = {
  id: MarketplaceReadinessGateId;
  label: string;
  passed: boolean;
  evidenceRefs: string[];
  reason: string;
};

export type MarketplaceReadinessBoundary = {
  livePaymentAllowed: false;
  walletSigningAllowed: false;
  rpcProbeAllowed: false;
  mcpCallAllowed: false;
  reputationAssignmentAllowed: false;
  publicationAllowed: boolean;
};

export type MarketplacePaymentPlanProof = {
  schemaVersion: "marketplace-payment-plan-proof:v1";
  planId: string;
  currency: string;
  amount: number;
  activation: "disabled";
  settlement: "dry_run_only";
  evidenceRef: string;
};

export type MarketplaceOperatorApprovalProof = {
  approved: true;
  approvedBy: string;
  approvedAt: string;
  evidenceRef: string;
};

export type MarketplaceReadinessBoundaryClaims = Partial<
  Record<
    | "livePaymentAllowed"
    | "walletSigningAllowed"
    | "rpcProbeAllowed"
    | "mcpCallAllowed"
    | "reputationAssignmentAllowed",
    boolean
  >
>;

export type MarketplaceReadinessProofMetadata = {
  endpointBindingRef?: string;
  paymentPlan?: MarketplacePaymentPlanProof;
  dryRunReceiptRefs?: string[];
  evidenceRefs?: string[];
  attestationDraftRef?: string;
  operatorApproval?: MarketplaceOperatorApprovalProof;
  boundaryClaims?: MarketplaceReadinessBoundaryClaims;
};

export type MarketplaceReadinessResult = {
  listingId: string;
  fixtureKey: string;
  status: MarketplaceReadinessStatus;
  gates: MarketplaceReadinessGateDetail[];
  blockReasons: string[];
  boundaries: MarketplaceReadinessBoundary;
  staticOnly: true;
  imported: true;
  untrusted: true;
};

const gateLabels: Record<MarketplaceReadinessGateId, string> = {
  profile_completeness: "Profile completeness",
  safe_metadata: "Safe metadata",
  endpoint_metadata_validity: "Endpoint metadata validity",
  payment_plan_metadata: "Payment plan metadata",
  dry_run_receipt_evidence: "Dry-run receipt and evidence refs",
  attestation_draft: "Attestation draft ref",
  operator_approval: "Operator approval evidence",
  no_live_escalation: "No live escalation",
};

const nonApprovalGateIds: MarketplaceReadinessGateId[] = [
  "profile_completeness",
  "safe_metadata",
  "endpoint_metadata_validity",
  "payment_plan_metadata",
  "dry_run_receipt_evidence",
  "attestation_draft",
  "no_live_escalation",
];

export function getMarketplaceReadinessResults(
  proofByListingId: Record<string, MarketplaceReadinessProofMetadata> = {},
): MarketplaceReadinessResult[] {
  return getMarketplaceApprovalQueue().items.map((item) =>
    evaluateMarketplaceReadiness(item.id, item.fixtureKey, item.candidate, proofByListingId[item.id] ?? {})
  );
}

export function evaluateMarketplaceReadiness(
  listingId: string,
  fixtureKey: string,
  candidate: OperatorDiscoveryCandidateView,
  proof: MarketplaceReadinessProofMetadata = {},
): MarketplaceReadinessResult {
  const gates = [
    profileCompletenessGate(candidate),
    safeMetadataGate(candidate),
    endpointMetadataValidityGate(candidate, proof.endpointBindingRef),
    paymentPlanMetadataGate(proof.paymentPlan),
    dryRunReceiptEvidenceGate(proof),
    attestationDraftGate(proof.attestationDraftRef),
    operatorApprovalGate(proof.operatorApproval),
    noLiveEscalationGate(candidate, proof.boundaryClaims),
  ];
  const nonApprovalPassed = gates
    .filter((gate) => nonApprovalGateIds.includes(gate.id))
    .every((gate) => gate.passed);
  const allPassed = gates.every((gate) => gate.passed);
  const status: MarketplaceReadinessStatus = allPassed
    ? "publish_ready"
    : nonApprovalPassed
      ? "dry_run_ready"
      : "blocked";

  return {
    listingId,
    fixtureKey,
    status,
    gates,
    blockReasons: gates.filter((gate) => !gate.passed).map((gate) => `${gate.label}: ${gate.reason}`),
    boundaries: closedBoundaries(status === "publish_ready"),
    staticOnly: true,
    imported: true,
    untrusted: true,
  };
}

function gate(
  id: MarketplaceReadinessGateId,
  passed: boolean,
  reason: string,
  evidenceRefs: string[] = [],
): MarketplaceReadinessGateDetail {
  return {
    id,
    label: gateLabels[id],
    passed,
    evidenceRefs: evidenceRefs.filter(isNonEmptyString),
    reason,
  };
}

function profileCompletenessGate(candidate: OperatorDiscoveryCandidateView) {
  const buyerPreview = candidate.draftPreview.buyerPreview;
  const missing = [
    candidate.title ? undefined : "title",
    candidate.description ? undefined : "description",
    candidate.sourceUrl ? undefined : "source URL",
    candidate.checkedCommit ? undefined : "checked commit",
    candidate.groups.length > 0 ? undefined : "capability groups",
    Object.keys(buyerPreview).length > 0 ? undefined : "buyer preview",
  ].filter(isNonEmptyString);

  return gate(
    "profile_completeness",
    missing.length === 0,
    missing.length === 0
      ? "Imported listing has local profile metadata needed for review."
      : `Missing local profile metadata: ${missing.join(", ")}.`,
    [...candidate.rawSnapshotRefs, ...candidate.resultRefs],
  );
}

function safeMetadataGate(candidate: OperatorDiscoveryCandidateView) {
  const unsafeItems = candidate.reviewItems.filter((item) =>
    item.state === "unsafe_metadata_warning"
    || item.state === "static_risk_blocker"
    || item.state === "rejected_malformed_connector"
    || item.state === "suspended_imported_listing"
  );

  return gate(
    "safe_metadata",
    unsafeItems.length === 0,
    unsafeItems.length === 0
      ? "No blocking unsafe imported metadata is present in the static review payload."
      : unsafeItems.map((item) => item.reasonCodes.join(", ") || item.state).join("; "),
    candidate.resultRefs,
  );
}

function endpointMetadataValidityGate(
  candidate: OperatorDiscoveryCandidateView,
  endpointBindingRef?: string,
) {
  const invalidGroups = candidate.groups.filter((group) =>
    !isNonEmptyString(group.sourcePath)
    || !isNonEmptyString(group.sourceKind)
    || group.capabilityRefs.length === 0
  );
  const connectorBlockers = candidate.connectorDiagnostics.filter((item) =>
    item.state === "rejected_malformed_connector"
  );
  const missingEndpointBinding = candidate.reviewItems.filter((item) =>
    item.reasonCodes.includes("missing_endpoint_binding")
    || item.recommendedAction === "request_endpoint_binding"
  );
  const hasEndpointBindingProof = isNonEmptyString(endpointBindingRef);
  const passed = invalidGroups.length === 0
    && connectorBlockers.length === 0
    && (missingEndpointBinding.length === 0 || hasEndpointBindingProof);

  return gate(
    "endpoint_metadata_validity",
    passed,
    passed
      ? endpointPassedReason(missingEndpointBinding.length, hasEndpointBindingProof)
      : endpointFailureReason(invalidGroups.length, connectorBlockers.length, missingEndpointBinding.length),
    [...candidate.groups.flatMap((group) => group.rawSnapshotRefs), endpointBindingRef].filter(isNonEmptyString),
  );
}

function endpointPassedReason(missingEndpointBinding: number, hasEndpointBindingProof: boolean) {
  if (missingEndpointBinding > 0 && hasEndpointBindingProof) {
    return "Endpoint and connector declarations have schema-valid static metadata and local endpoint-binding proof; no live probe was run.";
  }
  return "Endpoint and connector declarations are schema-valid static metadata only; no live probe was run.";
}

function endpointFailureReason(
  invalidGroups: number,
  connectorBlockers: number,
  missingEndpointBinding: number,
) {
  const reasons = [
    invalidGroups > 0 ? "static endpoint group metadata is incomplete" : undefined,
    connectorBlockers > 0 ? "connector metadata is marked malformed in static diagnostics" : undefined,
    missingEndpointBinding > 0 ? "local endpoint-binding proof is required before publication" : undefined,
  ].filter(isNonEmptyString);

  return `Endpoint metadata is not publish-ready: ${reasons.join("; ")}.`;
}

function paymentPlanMetadataGate(paymentPlan?: MarketplacePaymentPlanProof) {
  const valid = Boolean(
    paymentPlan
    && paymentPlan.schemaVersion === "marketplace-payment-plan-proof:v1"
    && isNonEmptyString(paymentPlan.planId)
    && isNonEmptyString(paymentPlan.currency)
    && Number.isFinite(paymentPlan.amount)
    && paymentPlan.amount >= 0
    && paymentPlan.activation === "disabled"
    && paymentPlan.settlement === "dry_run_only"
    && isNonEmptyString(paymentPlan.evidenceRef)
  );

  return gate(
    "payment_plan_metadata",
    valid,
    valid
      ? "Payment plan proof metadata is present and dry-run only."
      : "Payment plan proof metadata is missing or not schema-valid.",
    paymentPlan?.evidenceRef ? [paymentPlan.evidenceRef] : [],
  );
}

function dryRunReceiptEvidenceGate(proof: MarketplaceReadinessProofMetadata) {
  const refs = [...(proof.dryRunReceiptRefs ?? []), ...(proof.evidenceRefs ?? [])].filter(isNonEmptyString);
  const passed = (proof.dryRunReceiptRefs ?? []).some(isNonEmptyString) && (proof.evidenceRefs ?? []).some(isNonEmptyString);

  return gate(
    "dry_run_receipt_evidence",
    passed,
    passed
      ? "Dry-run receipt and supporting local evidence refs are present."
      : "Dry-run receipt and supporting local evidence refs are required.",
    refs,
  );
}

function attestationDraftGate(attestationDraftRef?: string) {
  const passed = isNonEmptyString(attestationDraftRef);

  return gate(
    "attestation_draft",
    passed,
    passed ? "Attestation draft ref is present." : "Attestation draft ref is required.",
    attestationDraftRef ? [attestationDraftRef] : [],
  );
}

function operatorApprovalGate(operatorApproval?: MarketplaceOperatorApprovalProof) {
  const valid = Boolean(
    operatorApproval
    && operatorApproval.approved === true
    && isNonEmptyString(operatorApproval.approvedBy)
    && isNonEmptyString(operatorApproval.approvedAt)
    && isNonEmptyString(operatorApproval.evidenceRef)
  );

  return gate(
    "operator_approval",
    valid,
    valid ? "Explicit operator approval evidence is present." : "Explicit operator approval evidence is required before publication.",
    operatorApproval?.evidenceRef ? [operatorApproval.evidenceRef] : [],
  );
}

function noLiveEscalationGate(
  candidate: OperatorDiscoveryCandidateView,
  boundaryClaims?: MarketplaceReadinessBoundaryClaims,
) {
  const requestedLiveEscalations = Object.entries(boundaryClaims ?? {})
    .filter(([, value]) => value === true)
    .map(([key]) => key);
  const passed = candidate.staticOnly === true
    && candidate.imported === true
    && candidate.untrusted === true
    && candidate.rapAttested === false
    && requestedLiveEscalations.length === 0;

  return gate(
    "no_live_escalation",
    passed,
    passed
      ? "Boundary claims remain metadata-only with live payment, signing, probes, MCP calls, and reputation disabled."
      : `Live escalation is not allowed for imported metadata: ${requestedLiveEscalations.join(", ") || "trust boundary mismatch"}.`,
  );
}

function closedBoundaries(publicationAllowed: boolean): MarketplaceReadinessBoundary {
  return {
    livePaymentAllowed: false,
    walletSigningAllowed: false,
    rpcProbeAllowed: false,
    mcpCallAllowed: false,
    reputationAssignmentAllowed: false,
    publicationAllowed,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
