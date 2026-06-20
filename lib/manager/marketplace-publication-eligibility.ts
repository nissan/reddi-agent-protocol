import type { MarketplaceApprovalRecord } from "@/lib/manager/marketplace-approval-actions";
import type {
  MarketplaceReadinessBoundary,
  MarketplaceReadinessProofMetadata,
  MarketplaceReadinessResult,
} from "@/lib/manager/marketplace-readiness-gate";
import { evaluateMarketplaceReadiness } from "@/lib/manager/marketplace-readiness-gate";
import type { HostedAttestationClaim } from "@reddi/agent-protocol/hosted-attestation-claim";

export const MARKETPLACE_PUBLICATION_ELIGIBILITY_SCHEMA_VERSION =
  "reddi.marketplace-publication-eligibility.v1" as const;

export type MarketplacePublicationEligibilityStatus = "eligible" | "blocked";

export type MarketplacePublicationQuasarCompatibility = {
  schemaVersion: "reddi.publication-quasar-compatibility.v1";
  issue: 390;
  status: "metadata_only" | "not_required" | "blocked";
  evidenceRef: string;
  quasarBackedClaimAllowed: boolean;
  instructionBuilt: boolean;
};

export type MarketplacePublicationEligibilityProof = MarketplaceReadinessProofMetadata & {
  hostedAttestationClaim?: HostedAttestationClaim;
  hostedSourceProofRef?: string;
  hostedAttestationProofRef?: string;
  publicationGateEvidenceRef?: string;
  quasarCompatibility?: MarketplacePublicationQuasarCompatibility;
};

export type MarketplacePublicationEligibilityReasonCode =
  | "eligible"
  | "record_state_not_published"
  | "public_visibility_false"
  | "readiness_not_publish_ready"
  | "publication_not_allowed"
  | "operator_approval_missing"
  | "operator_approval_evidence_missing"
  | "publish_audit_missing"
  | "unsafe_metadata"
  | "endpoint_binding_missing"
  | "suspended_or_unpublished_state"
  | "payment_proof_missing"
  | "receipt_evidence_missing"
  | "hosted_attestation_missing"
  | "hosted_attestation_not_ready"
  | "hosted_claim_guardrail_escalation"
  | "hosted_claim_buyer_facing_enabled"
  | "hosted_claim_evidence_mismatch"
  | "hosted_claim_operator_evidence_mismatch"
  | "hosted_claim_listing_mismatch"
  | "missing_quasar_compatibility"
  | "quasar_compatibility_blocked"
  | "quasar_instruction_built"
  | "quasar_backed_claim_not_allowed"
  | "live_escalation_not_allowed";

export type MarketplacePublicationEligibilityDecision = {
  schemaVersion: typeof MARKETPLACE_PUBLICATION_ELIGIBILITY_SCHEMA_VERSION;
  listingId: string;
  fixtureKey: string;
  status: MarketplacePublicationEligibilityStatus;
  readiness: MarketplaceReadinessResult;
  reasonCodes: MarketplacePublicationEligibilityReasonCode[];
  blockedReasons: string[];
  evidenceRefs: string[];
  boundaries: MarketplaceReadinessBoundary & {
    hostedExportAllowed: boolean;
    ardCatalogExportAllowed: boolean;
    livePublicationActivated: false;
    paymentActivationAllowed: false;
    trustClaimAllowed: false;
    reputationClaimAllowed: false;
    discoveryRelevanceIsTrust: false;
  };
  claimSources: {
    paymentProof: "readiness_proof" | "missing";
    receiptEvidence: "readiness_proof" | "missing";
    hostedAttestation: "hosted_attestation_claim" | "missing" | "blocked";
    quasarCompatibility: "metadata_only" | "not_required" | "missing" | "blocked";
    discoveryRelevance: "separate_from_trust";
  };
};

export function deriveMarketplacePublicationEligibility(
  record: MarketplaceApprovalRecord,
  proof: MarketplacePublicationEligibilityProof = {},
): MarketplacePublicationEligibilityDecision {
  const readiness = evaluateMarketplaceReadiness(record.id, record.fixtureKey, record.candidate, proof);
  const reasonCodes = uniqueReasonCodes([
    record.state === "published" ? undefined : "record_state_not_published",
    record.publicVisible === true ? undefined : "public_visibility_false",
    readiness.status === "publish_ready" ? undefined : "readiness_not_publish_ready",
    readiness.boundaries.publicationAllowed === true ? undefined : "publication_not_allowed",
    proof.operatorApproval?.approved === true ? undefined : "operator_approval_missing",
    isNonEmptyString(proof.operatorApproval?.evidenceRef) ? undefined : "operator_approval_evidence_missing",
    latestPublishAuditEvidenceRefs(record).length > 0 ? undefined : "publish_audit_missing",
    readiness.gates.find((gate) => gate.id === "safe_metadata")?.passed === false ? "unsafe_metadata" : undefined,
    isNonEmptyString(proof.endpointBindingRef) ? undefined : "endpoint_binding_missing",
    ["suspended", "rejected", "needs_changes", "draft", "approved", "internal", "blocked"].includes(record.state)
      ? "suspended_or_unpublished_state"
      : undefined,
    proof.paymentPlan?.evidenceRef ? undefined : "payment_proof_missing",
    hasReceiptEvidence(proof) ? undefined : "receipt_evidence_missing",
    proof.hostedAttestationClaim ? undefined : "hosted_attestation_missing",
    proof.hostedAttestationClaim && proof.hostedAttestationClaim.status !== "hosted_attestation_ready"
      ? "hosted_attestation_not_ready"
      : undefined,
    proof.hostedAttestationClaim && !hostedClaimGuardrailsAreSafe(proof.hostedAttestationClaim)
      ? "hosted_claim_guardrail_escalation"
      : undefined,
    proof.hostedAttestationClaim && proof.hostedAttestationClaim.display.buyerFacingClaimAllowed !== false
      ? "hosted_claim_buyer_facing_enabled"
      : undefined,
    proof.hostedAttestationClaim && !hostedClaimEvidenceMatchesProof(proof.hostedAttestationClaim, proof)
      ? "hosted_claim_evidence_mismatch"
      : undefined,
    proof.hostedAttestationClaim && !hostedClaimOperatorEvidenceMatchesProof(proof.hostedAttestationClaim, proof)
      ? "hosted_claim_operator_evidence_mismatch"
      : undefined,
    proof.hostedAttestationClaim && !hostedClaimMatchesRecord(proof.hostedAttestationClaim, record)
      ? "hosted_claim_listing_mismatch"
      : undefined,
    proof.quasarCompatibility ? undefined : "missing_quasar_compatibility",
    proof.quasarCompatibility?.status === "blocked" ? "quasar_compatibility_blocked" : undefined,
    proof.quasarCompatibility?.instructionBuilt === true ? "quasar_instruction_built" : undefined,
    proof.quasarCompatibility?.quasarBackedClaimAllowed === true ? "quasar_backed_claim_not_allowed" : undefined,
    proof.quasarCompatibility && !quasarCompatibilityIsSafe(proof.quasarCompatibility)
      ? "live_escalation_not_allowed"
      : undefined,
    liveEscalationRequested(readiness.boundaries, proof.quasarCompatibility) ? "live_escalation_not_allowed" : undefined,
  ]);
  const status: MarketplacePublicationEligibilityStatus = reasonCodes.length === 0 ? "eligible" : "blocked";
  const normalizedReasonCodes = status === "eligible" ? ["eligible" as const] : reasonCodes;

  return {
    schemaVersion: MARKETPLACE_PUBLICATION_ELIGIBILITY_SCHEMA_VERSION,
    listingId: record.id,
    fixtureKey: record.fixtureKey,
    status,
    readiness,
    reasonCodes: normalizedReasonCodes,
    blockedReasons: blockedReasonsFor(normalizedReasonCodes, readiness),
    evidenceRefs: uniqueRefs([
      ...latestPublishAuditEvidenceRefs(record),
      ...readiness.gates.flatMap((gate) => gate.evidenceRefs),
      proof.hostedSourceProofRef,
      proof.hostedAttestationProofRef,
      proof.publicationGateEvidenceRef,
      proof.hostedAttestationClaim?.evidenceSummary.operatorApprovalEvidenceRef,
      proof.quasarCompatibility?.evidenceRef,
    ]),
    boundaries: {
      ...readiness.boundaries,
      hostedExportAllowed: status === "eligible",
      ardCatalogExportAllowed: status === "eligible",
      livePublicationActivated: false,
      paymentActivationAllowed: false,
      trustClaimAllowed: false,
      reputationClaimAllowed: false,
      discoveryRelevanceIsTrust: false,
    },
    claimSources: {
      paymentProof: proof.paymentPlan?.evidenceRef ? "readiness_proof" : "missing",
      receiptEvidence: hasReceiptEvidence(proof) ? "readiness_proof" : "missing",
      hostedAttestation: hostedAttestationClaimSource(proof.hostedAttestationClaim),
      quasarCompatibility: quasarCompatibilityClaimSource(proof.quasarCompatibility),
      discoveryRelevance: "separate_from_trust",
    },
  };
}

function latestPublishAuditEvidenceRefs(record: MarketplaceApprovalRecord) {
  return [...record.auditHistory]
    .reverse()
    .find((entry) =>
      entry.action === "publish"
      && entry.nextState === "published"
      && entry.evidenceRefs.some(isNonEmptyString)
    )?.evidenceRefs ?? [];
}

function hasReceiptEvidence(proof: MarketplacePublicationEligibilityProof) {
  return (proof.dryRunReceiptRefs ?? []).some(isNonEmptyString) && (proof.evidenceRefs ?? []).some(isNonEmptyString);
}

function quasarCompatibilityIsSafe(compatibility: MarketplacePublicationQuasarCompatibility) {
  return compatibility.issue === 390
    && isNonEmptyString(compatibility.evidenceRef)
    && compatibility.quasarBackedClaimAllowed === false
    && compatibility.instructionBuilt === false
    && ["metadata_only", "not_required"].includes(compatibility.status);
}

function hostedClaimGuardrailsAreSafe(claim: HostedAttestationClaim) {
  return claim.guardrails.reputationMutated === false
    && claim.guardrails.quasarInstructionBuilt === false
    && claim.guardrails.walletSigning === false
    && claim.guardrails.rpcCall === false
    && claim.guardrails.hostedRegistryWrite === false
    && claim.guardrails.marketplacePublished === false
    && claim.guardrails.livePaymentExecuted === false
    && claim.guardrails.providerCall === false;
}

function hostedClaimEvidenceMatchesProof(
  claim: HostedAttestationClaim,
  proof: MarketplacePublicationEligibilityProof,
) {
  return claim.evidenceSummary.paymentProofRef === proof.paymentPlan?.evidenceRef
    && (proof.dryRunReceiptRefs ?? []).includes(claim.evidenceSummary.receiptId)
    && (proof.evidenceRefs ?? []).includes(claim.evidenceSummary.evidenceId)
    && claim.evidenceSummary.sourceProofRef === proof.hostedSourceProofRef
    && claim.evidenceSummary.attestationProofRef === proof.hostedAttestationProofRef
    && claim.evidenceSummary.publicationGateEvidenceRef === proof.publicationGateEvidenceRef;
}

function hostedClaimOperatorEvidenceMatchesProof(
  claim: HostedAttestationClaim,
  proof: MarketplacePublicationEligibilityProof,
) {
  return claim.evidenceSummary.operatorApprovalEvidenceRef === proof.operatorApproval?.evidenceRef;
}

function hostedClaimMatchesRecord(
  claim: HostedAttestationClaim,
  record: MarketplaceApprovalRecord,
) {
  const expectedListingId = expectedHostedListingId(record);
  const expectedSourceId = expectedHostedSourceId(record);
  return isNonEmptyString(expectedListingId)
    && isNonEmptyString(expectedSourceId)
    && claim.subject.type === "listing"
    && claim.subject.id === expectedListingId
    && claim.source.listingId === expectedListingId
    && claim.source.sourceId === expectedSourceId
    && isNonEmptyString(claim.source.catalogRef);
}

function expectedHostedListingId(record: MarketplaceApprovalRecord) {
  const corpusId = candidateCorpusId(record);
  return corpusId ? `draft-listing:${corpusId}` : undefined;
}

function expectedHostedSourceId(record: MarketplaceApprovalRecord) {
  const corpusId = candidateCorpusId(record);
  return corpusId ? `source:${corpusId}` : undefined;
}

function candidateCorpusId(record: MarketplaceApprovalRecord) {
  const prefix = "operator-review:";
  const suffix = `:${record.fixtureKey}`;
  if (!record.candidate.id.startsWith(prefix) || !record.candidate.id.endsWith(suffix)) return undefined;
  return record.candidate.id.slice(prefix.length, -suffix.length);
}

function liveEscalationRequested(
  boundaries: MarketplaceReadinessBoundary,
  compatibility?: MarketplacePublicationQuasarCompatibility,
) {
  return boundaries.livePaymentAllowed
    || boundaries.walletSigningAllowed
    || boundaries.rpcProbeAllowed
    || boundaries.mcpCallAllowed
    || boundaries.reputationAssignmentAllowed
    || compatibility?.quasarBackedClaimAllowed !== false
    || compatibility?.instructionBuilt !== false;
}

function hostedAttestationClaimSource(claim?: HostedAttestationClaim) {
  if (!claim) return "missing";
  return claim.status === "hosted_attestation_ready" ? "hosted_attestation_claim" : "blocked";
}

function quasarCompatibilityClaimSource(compatibility?: MarketplacePublicationQuasarCompatibility) {
  if (!compatibility) return "missing";
  return compatibility.status === "blocked" ? "blocked" : compatibility.status;
}

function blockedReasonsFor(
  reasonCodes: MarketplacePublicationEligibilityReasonCode[],
  readiness: MarketplaceReadinessResult,
) {
  if (reasonCodes.includes("eligible")) return [];
  return uniqueRefs([
    ...reasonCodes.map((code) => reasonText[code] ?? code),
    ...readiness.blockReasons,
  ]);
}

const reasonText: Partial<Record<MarketplacePublicationEligibilityReasonCode, string>> = {
  record_state_not_published: "Listing record is not in published state.",
  public_visibility_false: "Listing is not public visible.",
  readiness_not_publish_ready: "Marketplace readiness is not publish_ready.",
  publication_not_allowed: "Readiness boundary does not allow publication.",
  operator_approval_missing: "Operator approval proof is missing.",
  operator_approval_evidence_missing: "Operator approval evidence ref is missing.",
  publish_audit_missing: "Publish audit evidence is missing.",
  unsafe_metadata: "Imported metadata is unsafe or unresolved.",
  endpoint_binding_missing: "Endpoint binding proof is missing.",
  suspended_or_unpublished_state: "Listing is suspended, unpublished, or not in a publishable state.",
  payment_proof_missing: "Payment proof metadata is missing.",
  receipt_evidence_missing: "Receipt/evidence proof metadata is missing.",
  hosted_attestation_missing: "Hosted attestation claim is missing.",
  hosted_attestation_not_ready: "Hosted attestation claim is not ready.",
  hosted_claim_guardrail_escalation: "Hosted attestation claim contains a live or mutation guardrail escalation.",
  hosted_claim_buyer_facing_enabled: "Hosted attestation claim attempted to enable buyer-facing trust/reputation copy.",
  hosted_claim_evidence_mismatch: "Hosted attestation claim evidence refs do not match local proof inputs.",
  hosted_claim_operator_evidence_mismatch: "Hosted attestation claim operator approval evidence does not match local proof inputs.",
  hosted_claim_listing_mismatch: "Hosted attestation claim subject/source does not match the exported listing.",
  missing_quasar_compatibility: "Quasar compatibility metadata is missing.",
  quasar_compatibility_blocked: "Quasar compatibility metadata is blocked.",
  quasar_instruction_built: "Quasar instruction output is not allowed in this eligibility matrix.",
  quasar_backed_claim_not_allowed: "Quasar-backed claim is not allowed in this eligibility matrix.",
  live_escalation_not_allowed: "Live payment, wallet/RPC, MCP, reputation mutation, or Quasar instruction escalation is not allowed.",
};

function uniqueReasonCodes(
  codes: Array<MarketplacePublicationEligibilityReasonCode | undefined>,
): MarketplacePublicationEligibilityReasonCode[] {
  return Array.from(new Set(codes.filter((code): code is MarketplacePublicationEligibilityReasonCode => Boolean(code))));
}

function uniqueRefs(refs: Array<string | undefined>) {
  return Array.from(new Set(refs.filter(isNonEmptyString)));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
