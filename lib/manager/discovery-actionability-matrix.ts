import type {
  HostedMarketplaceDiscoveryCandidate,
  MarketplaceHostedSearchResultItem,
} from "@/lib/manager/marketplace-public-search";
import type { OperatorDiscoveryCandidateView } from "@/lib/manager/static-agent-stack-review";

/**
 * Discovery actionability state matrix (#506).
 *
 * Derives a per-lane state matrix for marketplace/discovery candidates so the
 * UI can show — without a blended score — how discovery relevance differs from
 * identity evidence, payment readiness, reputation/evidence, policy fit, and
 * actionability/hireability.
 *
 * This module is a pure, fixture-driven read model. It performs no network
 * calls, no publication, no payment, no endpoint invocation, no wallet/RPC
 * action, and no hosted registry / trust / reputation mutation.
 */

export const DISCOVERY_ACTIONABILITY_MATRIX_SCHEMA_VERSION =
  "reddi.discovery-actionability-matrix.v1" as const;

export type DiscoveryActionabilityLaneId =
  | "source_provenance"
  | "identity_evidence"
  | "payment_readiness"
  | "reputation_evidence"
  | "policy_fit"
  | "actionability";

export type DiscoveryActionabilityLaneState =
  | "unavailable"
  | "self_asserted"
  | "claimed"
  | "verified"
  | "failed_verification"
  | "blocked"
  | "needs_human_review"
  | "dry_run_ready"
  | "live_gated"
  | "production_disabled";

export type DiscoveryActionabilityLaneCell = {
  lane: DiscoveryActionabilityLaneId;
  laneLabel: string;
  state: DiscoveryActionabilityLaneState;
  stateLabel: string;
  /** Rough tone bucket so UI can style without re-deriving semantics. */
  tone: "neutral" | "caution" | "negative" | "positive";
  summary: string;
  reasonCodes: string[];
};

export type DiscoveryActionabilityProvenance = {
  /** Where the candidate came from (URL or registry identifier). */
  origin: string;
  originKind: "static-import" | "hosted-rap-registry";
  /** Snapshot label, e.g. "main @ <commit>" or a catalog ref. */
  snapshot: string;
  /** Crawl/snapshot timestamp when recorded; null renders as unavailable. */
  crawlTimestamp: string | null;
  /** Imported/discovered metadata is self-asserted until verified. */
  metadataSelfAsserted: true;
};

export type DiscoveryActionabilityMatrix = {
  schemaVersion: typeof DISCOVERY_ACTIONABILITY_MATRIX_SCHEMA_VERSION;
  candidateId: string;
  lanes: DiscoveryActionabilityLaneCell[];
  provenance: DiscoveryActionabilityProvenance;
  /** ARD discovery relevance never implies RAP trust or authorization. */
  discoveryTrustBoundary: {
    ardDiscoveryOnly: true;
    impliesRapTrust: false;
    impliesAuthorization: false;
    note: string;
  };
  /** Every live boundary is hard-disabled for this read model. */
  guardrails: {
    autoPublish: false;
    autoPay: false;
    endpointInvocation: false;
    walletSigning: false;
    rpcCall: false;
    hostedRegistryMutation: false;
    trustMutation: false;
    reputationMutation: false;
  };
};

export const DISCOVERY_ACTIONABILITY_LANE_ORDER: readonly DiscoveryActionabilityLaneId[] = [
  "source_provenance",
  "identity_evidence",
  "payment_readiness",
  "reputation_evidence",
  "policy_fit",
  "actionability",
];

const LANE_LABELS: Record<DiscoveryActionabilityLaneId, string> = {
  source_provenance: "Source provenance",
  identity_evidence: "Identity evidence",
  payment_readiness: "Payment readiness",
  reputation_evidence: "Reputation / evidence",
  policy_fit: "Policy fit",
  actionability: "Actionability / hireability",
};

const STATE_LABELS: Record<DiscoveryActionabilityLaneState, string> = {
  unavailable: "unavailable",
  self_asserted: "self-asserted",
  claimed: "claimed",
  verified: "verified",
  failed_verification: "failed verification",
  blocked: "blocked",
  needs_human_review: "needs human review",
  dry_run_ready: "dry-run ready",
  live_gated: "live-gated",
  production_disabled: "production-disabled",
};

const STATE_TONES: Record<DiscoveryActionabilityLaneState, DiscoveryActionabilityLaneCell["tone"]> = {
  unavailable: "neutral",
  self_asserted: "caution",
  claimed: "caution",
  verified: "positive",
  failed_verification: "negative",
  blocked: "negative",
  needs_human_review: "caution",
  dry_run_ready: "positive",
  live_gated: "caution",
  production_disabled: "negative",
};

export function describeDiscoveryLaneState(state: DiscoveryActionabilityLaneState): {
  stateLabel: string;
  tone: DiscoveryActionabilityLaneCell["tone"];
} {
  return { stateLabel: STATE_LABELS[state], tone: STATE_TONES[state] };
}

export function describeDiscoveryLane(lane: DiscoveryActionabilityLaneId): string {
  return LANE_LABELS[lane];
}

const TRUST_BOUNDARY_NOTE =
  "Discovery relevance (ARD) is not RAP trust, attestation, or authorization. Each lane below is scored separately and never blended.";

const GUARDRAILS: DiscoveryActionabilityMatrix["guardrails"] = {
  autoPublish: false,
  autoPay: false,
  endpointInvocation: false,
  walletSigning: false,
  rpcCall: false,
  hostedRegistryMutation: false,
  trustMutation: false,
  reputationMutation: false,
};

function cell(
  lane: DiscoveryActionabilityLaneId,
  state: DiscoveryActionabilityLaneState,
  summary: string,
  reasonCodes: string[],
): DiscoveryActionabilityLaneCell {
  const { stateLabel, tone } = describeDiscoveryLaneState(state);
  return { lane, laneLabel: LANE_LABELS[lane], state, stateLabel, tone, summary, reasonCodes };
}

function orderLanes(lanes: DiscoveryActionabilityLaneCell[]): DiscoveryActionabilityLaneCell[] {
  return DISCOVERY_ACTIONABILITY_LANE_ORDER.map((laneId) => {
    const found = lanes.find((candidate) => candidate.lane === laneId);
    if (!found) {
      throw new Error(`discovery actionability matrix is missing lane: ${laneId}`);
    }
    return found;
  });
}

/**
 * Derive the actionability matrix for an imported static-stack candidate as
 * rendered on /manager/discovery (#383 operator review workspace).
 */
export function deriveDiscoveryActionabilityMatrix(
  candidate: OperatorDiscoveryCandidateView,
): DiscoveryActionabilityMatrix {
  const hasSnapshot = Boolean(candidate.sourceUrl && candidate.checkedCommit);
  const hasMalformedConnector =
    candidate.requiredStates.includes("rejected_malformed_connector") ||
    candidate.connectorDiagnostics.some((item) => item.severity === "blocked") ||
    candidate.rejectedEntries.length > 0;
  const hasUnsafeMetadata =
    candidate.requiredStates.includes("unsafe_metadata_warning") ||
    candidate.warnings.some((item) => item.state === "unsafe_metadata_warning");
  const riskBlockers = candidate.riskDiagnostics.filter((item) => item.blocksPublication);
  const publicationBlockers = candidate.resourceCounts.blockers;

  const sourceProvenance = hasSnapshot
    ? cell(
        "source_provenance",
        "self_asserted",
        "Snapshot origin and commit are recorded, but imported metadata remains self-asserted and unverified.",
        ["source_snapshot_recorded", "imported_metadata_self_asserted"],
      )
    : cell(
        "source_provenance",
        "unavailable",
        "No source snapshot reference was recorded for this candidate.",
        ["source_snapshot_missing"],
      );

  const identityEvidence = hasMalformedConnector
    ? cell(
        "identity_evidence",
        "failed_verification",
        "Static verification of the imported descriptor failed (malformed or rejected entries).",
        ["static_descriptor_verification_failed"],
      )
    : hasUnsafeMetadata
      ? cell(
          "identity_evidence",
          "needs_human_review",
          "Imported identity metadata carries unsafe-metadata warnings and requires operator review.",
          ["unsafe_metadata_warning"],
        )
      : cell(
          "identity_evidence",
          "self_asserted",
          "Identity metadata is imported and self-asserted; the provider is unverified and not RAP-attested.",
          ["provider_unverified", "not_rap_attested"],
        );

  const paymentReadiness =
    candidate.draftPreview.paymentStatus === "missing_payment_setup"
      ? cell(
          "payment_readiness",
          "unavailable",
          "No payment setup exists for this candidate; payment activation is disabled.",
          ["missing_payment_setup", "payment_activation_disabled"],
        )
      : cell(
          "payment_readiness",
          "live_gated",
          "Payment metadata exists but live activation remains gated behind operator approval.",
          ["payment_activation_gated"],
        );

  const reputationEvidence = cell(
    "reputation_evidence",
    "unavailable",
    "No RAP reputation or receipt-backed evidence exists for an imported discovery candidate.",
    ["no_reputation_for_imported_candidate"],
  );

  const policyFit =
    riskBlockers.length > 0
      ? cell(
          "policy_fit",
          "blocked",
          "Static risk diagnostics block publication until resolved.",
          riskBlockers.flatMap((item) => item.reasonCodes),
        )
      : hasUnsafeMetadata
        ? cell(
            "policy_fit",
            "needs_human_review",
            "Unsafe-metadata warnings require operator policy review before any fit claim.",
            ["unsafe_metadata_warning"],
          )
        : candidate.status === "approve_ready"
          ? cell(
              "policy_fit",
              "self_asserted",
              "Declared capabilities parsed cleanly, but policy fit is self-described and unreviewed.",
              ["capability_inventory_self_described"],
            )
          : cell(
              "policy_fit",
              "needs_human_review",
              "Operator policy review is required before any fit claim.",
              ["operator_review_required"],
            );

  const actionability =
    candidate.status === "rejected"
      ? cell(
          "actionability",
          "blocked",
          "Candidate is rejected; it cannot progress toward listing or hire.",
          ["review_status_rejected"],
        )
      : candidate.status === "suspended"
        ? cell(
            "actionability",
            "production_disabled",
            "Candidate is suspended; any prior draft surface is disabled.",
            ["review_status_suspended"],
          )
        : candidate.status === "request_changes"
          ? cell(
              "actionability",
              "needs_human_review",
              "Changes were requested; the candidate is not hireable until re-reviewed.",
              ["review_status_request_changes"],
            )
          : publicationBlockers > 0
            ? cell(
                "actionability",
                "blocked",
                "Publication-blocking review items must be resolved before any actionability.",
                ["publication_blockers_present"],
              )
            : cell(
                "actionability",
                "dry_run_ready",
                "Approve-ready for fixture-backed dry-run review only; publication and live hire remain gated and disabled.",
                ["dry_run_only", "publication_disabled", "live_activation_gated"],
              );

  return {
    schemaVersion: DISCOVERY_ACTIONABILITY_MATRIX_SCHEMA_VERSION,
    candidateId: candidate.id,
    lanes: orderLanes([
      sourceProvenance,
      identityEvidence,
      paymentReadiness,
      reputationEvidence,
      policyFit,
      actionability,
    ]),
    provenance: {
      origin: candidate.sourceUrl || "unavailable",
      originKind: "static-import",
      snapshot: hasSnapshot ? `${candidate.checkedRef} @ ${candidate.checkedCommit}` : "unavailable",
      crawlTimestamp: null,
      metadataSelfAsserted: true,
    },
    discoveryTrustBoundary: {
      ardDiscoveryOnly: true,
      impliesRapTrust: false,
      impliesAuthorization: false,
      note: TRUST_BOUNDARY_NOTE,
    },
    guardrails: GUARDRAILS,
  };
}

/**
 * Derive the actionability matrix for a hosted-registry discovery candidate
 * (#381/#382 source/trust shapes from the hosted catalog search read model).
 */
export function deriveHostedDiscoveryActionabilityMatrix(
  item: MarketplaceHostedSearchResultItem,
  options?: { generatedAt?: string; catalogRef?: string },
): DiscoveryActionabilityMatrix {
  const candidate: HostedMarketplaceDiscoveryCandidate = item.candidate;
  const publisherClaimed = Boolean(candidate.publisher?.id);

  const lanes = orderLanes([
    cell(
      "source_provenance",
      "self_asserted",
      "Candidate came from the hosted RAP catalog snapshot; catalog metadata is self-asserted by its publisher.",
      ["hosted_catalog_snapshot", "publisher_metadata_self_asserted"],
    ),
    publisherClaimed
      ? cell(
          "identity_evidence",
          "claimed",
          "A publisher identity is claimed in the hosted registry but its verification status is unverified.",
          ["publisher_identity_claimed", "provider_verification_unverified"],
        )
      : cell(
          "identity_evidence",
          "self_asserted",
          "No publisher identity claim exists; listing identity metadata is self-asserted.",
          ["publisher_identity_missing", "provider_verification_unverified"],
        ),
    cell(
      "payment_readiness",
      "live_gated",
      "Listing payment activation is disabled; any live payment path stays gated behind operator approval.",
      ["payment_activation_disabled"],
    ),
    cell(
      "reputation_evidence",
      "unavailable",
      "No reputation has been assigned to this listing.",
      ["reputation_not_assigned"],
    ),
    cell(
      "policy_fit",
      "needs_human_review",
      "Policy preflight is required before this candidate can be considered for any engagement.",
      ["policy_preflight_required"],
    ),
    cell(
      "actionability",
      "live_gated",
      "Listed for discovery only; endpoint health is not probed and hiring stays gated behind policy preflight, payment setup, and RAP attestation.",
      ["endpoint_not_probed", "not_rap_attested", "hire_gated"],
    ),
  ]);

  return {
    schemaVersion: DISCOVERY_ACTIONABILITY_MATRIX_SCHEMA_VERSION,
    candidateId: candidate.identifier,
    lanes,
    provenance: {
      origin: candidate.identifier,
      originKind: "hosted-rap-registry",
      snapshot: candidate.rawSnapshotRef ?? options?.catalogRef ?? "unavailable",
      crawlTimestamp: options?.generatedAt ?? null,
      metadataSelfAsserted: true,
    },
    discoveryTrustBoundary: {
      ardDiscoveryOnly: true,
      impliesRapTrust: false,
      impliesAuthorization: false,
      note: TRUST_BOUNDARY_NOTE,
    },
    guardrails: GUARDRAILS,
  };
}
