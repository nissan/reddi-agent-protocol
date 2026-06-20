import type {
  MarketplacePublicExportItem,
  MarketplacePublicExportSuccess,
} from "@/lib/manager/marketplace-public-export";

export const MARKETPLACE_PUBLICATION_ACTIVATION_SCHEMA_VERSION =
  "reddi.marketplace-publication-activation.v1" as const;

export type MarketplacePublicationActivationMode = "dry_run" | "live";

export type MarketplacePublicationActivationStatus = "dry_run_ready" | "blocked";

export type MarketplacePublicationActivationApproval = {
  approved: boolean;
  approvedBy: string;
  approvedAt: string;
  evidenceRef: string;
  activationIntentRef: string;
  mode?: MarketplacePublicationActivationMode;
  operatorApprovalRef: string;
  publicationAuditEvidenceRef: string;
};

export type MarketplacePublicationActivationInput = {
  id: string;
  exportItem: MarketplacePublicExportItem;
  activationApproval?: MarketplacePublicationActivationApproval;
  requestedAt: string;
};

export type MarketplacePublicationActivationReasonCode =
  | "dry_run_activation_ready"
  | "missing_activation_id"
  | "invalid_request_timestamp"
  | "export_not_eligible"
  | "export_live_boundary_escalation"
  | "publish_audit_not_current"
  | "explicit_operator_gate_missing"
  | "explicit_operator_gate_evidence_missing"
  | "explicit_operator_gate_actor_missing"
  | "explicit_operator_gate_not_approved"
  | "activation_gate_operator_mismatch"
  | "activation_gate_audit_mismatch"
  | "activation_gate_intent_missing"
  | "activation_gate_timestamp_invalid"
  | "live_mode_unavailable"
  | "live_escalation_not_allowed";

export type MarketplacePublicationActivationDecision = {
  schemaVersion: typeof MARKETPLACE_PUBLICATION_ACTIVATION_SCHEMA_VERSION;
  id: string;
  listingId: string;
  fixtureKey: string;
  status: MarketplacePublicationActivationStatus;
  mode: MarketplacePublicationActivationMode;
  source: "public_export_item";
  reasonCodes: MarketplacePublicationActivationReasonCode[];
  blockedReasons: string[];
  evidenceRefs: string[];
  outputs: {
    hostedRap: "dry_run_only" | "blocked";
    ardCatalog: "dry_run_only" | "blocked";
    publicExportSnapshot: "dry_run_only" | "blocked";
  };
  activationPlan: {
    hostedRegistryWrite: false;
    ardCatalogWrite: false;
    livePublication: false;
    walletSigning: false;
    rpcProbe: false;
    livePayment: false;
    providerCall: false;
    mcpCall: false;
  };
  guardrails: {
    dryRunOnly: true;
    livePublicationActivated: false;
    hostedRegistryWrite: false;
    marketplacePublished: false;
    paymentActivationAllowed: false;
    walletSigning: false;
    rpcCall: false;
    providerCall: false;
    reputationMutated: false;
    quasarInstructionBuilt: false;
  };
  createdAt: string;
};

export function deriveMarketplacePublicationActivationGate(
  input: MarketplacePublicationActivationInput,
): MarketplacePublicationActivationDecision {
  const mode = input.activationApproval?.mode ?? "dry_run";
  const exportSuccess = input.exportItem.ok ? input.exportItem : undefined;
  const reasonCodes = uniqueReasonCodes([
    isNonEmptyString(input.id) ? undefined : "missing_activation_id",
    isoTimestampIsValid(input.requestedAt) ? undefined : "invalid_request_timestamp",
    exportSuccess ? undefined : "export_not_eligible",
    exportSuccess && !exportBoundariesAreNonLive(exportSuccess) ? "export_live_boundary_escalation" : undefined,
    exportSuccess && !publishAuditIsCurrent(exportSuccess) ? "publish_audit_not_current" : undefined,
    input.activationApproval ? undefined : "explicit_operator_gate_missing",
    input.activationApproval && !isNonEmptyString(input.activationApproval.evidenceRef)
      ? "explicit_operator_gate_evidence_missing"
      : undefined,
    input.activationApproval && !isNonEmptyString(input.activationApproval.approvedBy)
      ? "explicit_operator_gate_actor_missing"
      : undefined,
    input.activationApproval && !isNonEmptyString(input.activationApproval.activationIntentRef)
      ? "activation_gate_intent_missing"
      : undefined,
    input.activationApproval && input.activationApproval.approved !== true ? "explicit_operator_gate_not_approved" : undefined,
    input.activationApproval && exportSuccess && !activationGateOperatorMatches(input.activationApproval, exportSuccess)
      ? "activation_gate_operator_mismatch"
      : undefined,
    input.activationApproval && exportSuccess && !activationGateAuditMatches(input.activationApproval, exportSuccess)
      ? "activation_gate_audit_mismatch"
      : undefined,
    input.activationApproval && !isoTimestampIsValid(input.activationApproval.approvedAt)
      ? "activation_gate_timestamp_invalid"
      : undefined,
    mode === "live" ? "live_mode_unavailable" : undefined,
    mode === "live" ? "live_escalation_not_allowed" : undefined,
  ]);
  const status: MarketplacePublicationActivationStatus = reasonCodes.length === 0 ? "dry_run_ready" : "blocked";
  const normalizedReasonCodes = status === "dry_run_ready"
    ? ["dry_run_activation_ready" as const]
    : reasonCodes;

  return {
    schemaVersion: MARKETPLACE_PUBLICATION_ACTIVATION_SCHEMA_VERSION,
    id: input.id,
    listingId: listingIdFor(input.exportItem),
    fixtureKey: fixtureKeyFor(input.exportItem),
    status,
    mode,
    source: "public_export_item",
    reasonCodes: normalizedReasonCodes,
    blockedReasons: blockedReasonsFor(normalizedReasonCodes, input.exportItem),
    evidenceRefs: uniqueRefs([
      ...(exportSuccess?.listing.evidenceRefs ?? []),
      ...(exportSuccess?.eligibility.evidenceRefs ?? []),
      ...(exportSuccess?.publishAudit.evidenceRefs ?? []),
      input.activationApproval?.evidenceRef,
      input.activationApproval?.activationIntentRef,
      input.activationApproval?.operatorApprovalRef,
      input.activationApproval?.publicationAuditEvidenceRef,
    ]),
    outputs: {
      hostedRap: status === "dry_run_ready" ? "dry_run_only" : "blocked",
      ardCatalog: status === "dry_run_ready" ? "dry_run_only" : "blocked",
      publicExportSnapshot: status === "dry_run_ready" ? "dry_run_only" : "blocked",
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
    createdAt: input.requestedAt,
  };
}

function exportBoundariesAreNonLive(exportItem: MarketplacePublicExportSuccess) {
  return exportItem.listing.endpoint.liveUrl === null
    && exportItem.listing.endpoint.healthStatus === "not_probed"
    && exportItem.listing.payment.activation === "disabled"
    && exportItem.listing.payment.settlement === "dry_run_only"
    && exportItem.listing.trust.rapAttested === false
    && exportItem.listing.trust.reputationAssigned === false
    && exportItem.eligibility.boundaries.livePublicationActivated === false
    && exportItem.eligibility.boundaries.paymentActivationAllowed === false
    && exportItem.eligibility.boundaries.trustClaimAllowed === false
    && exportItem.eligibility.boundaries.reputationClaimAllowed === false;
}

function listingIdFor(exportItem: MarketplacePublicExportItem) {
  return exportItem.ok ? exportItem.listing.listingId : exportItem.listingId;
}

function fixtureKeyFor(exportItem: MarketplacePublicExportItem) {
  return exportItem.ok ? exportItem.listing.fixtureKey : exportItem.fixtureKey;
}

function publishAuditIsCurrent(exportItem: MarketplacePublicExportSuccess) {
  return (exportItem.publishAudit.action === "publish" || exportItem.publishAudit.action === "restore")
    && exportItem.publishAudit.nextState === "published"
    && exportItem.publishAudit.evidenceRefs.some(isNonEmptyString);
}

function activationGateOperatorMatches(
  approval: MarketplacePublicationActivationApproval,
  exportItem: MarketplacePublicExportSuccess,
) {
  return approval.operatorApprovalRef === exportItem.listing.trust.operatorApprovalEvidenceRef;
}

function activationGateAuditMatches(
  approval: MarketplacePublicationActivationApproval,
  exportItem: MarketplacePublicExportSuccess,
) {
  return exportItem.publishAudit.evidenceRefs.includes(approval.publicationAuditEvidenceRef);
}

function isoTimestampIsValid(value: unknown) {
  if (!isNonEmptyString(value)) return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  const normalized = value.includes(".") ? parsed.toISOString() : parsed.toISOString().replace(".000Z", "Z");
  return normalized === value;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function uniqueRefs(refs: Array<string | undefined | null>) {
  return Array.from(new Set(refs.filter(isNonEmptyString)));
}

function uniqueReasonCodes(codes: Array<MarketplacePublicationActivationReasonCode | undefined>) {
  return Array.from(new Set(codes.filter((code): code is MarketplacePublicationActivationReasonCode => Boolean(code))));
}

function blockedReasonsFor(codes: MarketplacePublicationActivationReasonCode[], exportItem: MarketplacePublicExportItem) {
  return [
    ...codes
      .filter((code) => code !== "dry_run_activation_ready")
      .map((code) => activationReasonDescriptions[code]),
    ...(!exportItem.ok ? exportItem.blockReasons : []),
  ];
}

const activationReasonDescriptions: Record<MarketplacePublicationActivationReasonCode, string> = {
  dry_run_activation_ready: "Dry-run activation is ready; no live publication side effect is executed.",
  missing_activation_id: "Activation decision id is missing.",
  invalid_request_timestamp: "Activation request timestamp is missing or invalid.",
  export_not_eligible: "Public export item is blocked or not eligible.",
  export_live_boundary_escalation: "Public export item contains live or trust boundary escalation.",
  publish_audit_not_current: "Current public export audit is missing or not a publish/restore audit.",
  explicit_operator_gate_missing: "Explicit activation operator gate is missing.",
  explicit_operator_gate_evidence_missing: "Explicit activation operator gate evidence is missing.",
  explicit_operator_gate_actor_missing: "Explicit activation operator identity is missing.",
  explicit_operator_gate_not_approved: "Explicit activation operator gate is not approved.",
  activation_gate_operator_mismatch: "Activation gate operator approval does not match the public export evidence.",
  activation_gate_audit_mismatch: "Activation gate audit evidence does not match the public export audit.",
  activation_gate_intent_missing: "Activation intent evidence is missing.",
  activation_gate_timestamp_invalid: "Activation gate approval timestamp is missing or invalid.",
  live_mode_unavailable: "Live hosted publication activation is unavailable in this issue.",
  live_escalation_not_allowed: "Live publication escalation is not allowed by this dry-run gate.",
};
