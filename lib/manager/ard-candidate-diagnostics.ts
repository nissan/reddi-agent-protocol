import {
  validateDiscoveryCandidate,
  type DiscoveryCandidatePolicy,
} from "@reddi/agent-protocol/discovery-source";
import {
  deriveRankingCandidateExplainability,
  type RankingCandidateEvidenceInput,
  type RankingCandidateExplainability,
} from "@reddi/agent-protocol/ranking-explainability";
import type { AttestationReputationBridgeListingProjection } from "@reddi/agent-protocol/attestation-reputation-bridge";
import type {
  SourceTrustConformanceRow,
  SourceTrustDiagnosticsProjectionMessage,
  SourceTrustState,
} from "@reddi/agent-protocol/source-trust-conformance-matrix";

import {
  deriveHostedDiscoveryActionabilityMatrix,
  type DiscoveryActionabilityMatrix,
} from "@/lib/manager/discovery-actionability-matrix";
import type { MarketplaceHostedSearchResultItem } from "@/lib/manager/marketplace-public-search";

/**
 * ARD candidate diagnostics read model (#344, feeding #367 and the #386 UI).
 *
 * Composes the existing projections — the #577 discovery actionability matrix
 * (`lib/manager/discovery-actionability-matrix.ts`), the #593 source/trust
 * conformance projections (`@reddi/agent-protocol/source-trust-conformance-matrix`),
 * the #606 attestation/reputation bridge `listingProjection`, and the #344
 * `reddi.ranking-explainability.v1` block — into one per-candidate view whose
 * sections keep capability relevance STRUCTURALLY separate from publisher
 * identity, trust evidence, policy decision, budget/payment fit,
 * receipt/evidence history, and reputation state.
 *
 * ARD relevance is capability/search relevance only. It is never trust,
 * safety, budget, payment, invocation, or publication approval
 * (`docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md`, #452). This module is a pure,
 * fixture-driven read model: no network, no probe, no publication, no
 * payment, no wallet/RPC action, and no trust or reputation mutation.
 */

export const ARD_CANDIDATE_DIAGNOSTICS_SCHEMA_VERSION =
  "reddi.ard-candidate-diagnostics.v1" as const;

export type ArdCandidateDiagnosticsOptions = {
  /** RAP policy for the Decide-lane preflight; gates fail closed without it. */
  policy?: DiscoveryCandidatePolicy;
  /** #593 conformance row for this candidate's source metadata, when classified. */
  sourceTrustRow?: SourceTrustConformanceRow;
  /** #606 bridge listing projection carrying the candidate's reputation state. */
  reputationProjection?: AttestationReputationBridgeListingProjection;
  /** Prior receipt/attestation/settlement evidence references, if any exist. */
  evidence?: RankingCandidateEvidenceInput;
  /** Snapshot metadata from the discovery surface. */
  generatedAt?: string;
  catalogRef?: string;
};

export type ArdCandidateDiagnostics = {
  schemaVersion: typeof ARD_CANDIDATE_DIAGNOSTICS_SCHEMA_VERSION;
  candidateId: string;
  /** Capability/search relevance only — never a trust or approval signal. */
  relevance: {
    score: number;
    scoreMeaning: "relevance_only_not_trust";
    matchedFields: string[];
    summary: string;
  };
  publisherIdentity: {
    id?: string;
    name?: string;
    domain?: string;
    claimed: boolean;
    summary: string;
  };
  trustEvidence: {
    /** #593 state when a conformance row exists; ingress default otherwise. */
    sourceTrustState: SourceTrustState;
    verificationStatus: RankingCandidateExplainability["trustState"]["status"];
    reasonCodes: string[];
    conformanceFindings: SourceTrustDiagnosticsProjectionMessage[];
    summary: string;
  };
  policyDecision: RankingCandidateExplainability["gates"][number];
  budgetPaymentFit: {
    paymentActivation: MarketplaceHostedSearchResultItem["listing"]["paymentActivation"];
    quoteGate: RankingCandidateExplainability["gates"][number];
    paymentGate: RankingCandidateExplainability["gates"][number];
    budgetGate: RankingCandidateExplainability["gates"][number];
  };
  receiptEvidenceHistory: {
    status: "history_present" | "no_history";
    receiptCount: number;
    attestationCount: number;
    settlementReceiptRefs: string[];
    attestationRefs: string[];
    summary: string;
  };
  reputationState: {
    assigned: boolean;
    offchainPreview: AttestationReputationBridgeListingProjection["offchainPreview"];
    hostedAttestation: AttestationReputationBridgeListingProjection["hostedAttestation"];
    quasar: AttestationReputationBridgeListingProjection["quasar"];
    buyerFacingClaimsAllowed: false;
    blockedReasons: string[];
    summary: string;
  };
  /** The #344 per-candidate explainability block (all gates, fail closed). */
  explainability: RankingCandidateExplainability;
  /** The #577 six-lane actionability matrix for this candidate. */
  actionabilityMatrix: DiscoveryActionabilityMatrix;
  boundary: {
    ardRelevanceIsNever: readonly [
      "trust",
      "safety",
      "budget",
      "payment",
      "invocation",
      "publication",
    ];
    boundariesDocRef: "docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md";
  };
  guardrails: {
    endpointProbed: false;
    trustMutated: false;
    reputationMutated: false;
    paymentExecuted: false;
    publicationTriggered: false;
  };
};

const NO_REPUTATION_PROJECTION: AttestationReputationBridgeListingProjection = {
  offchainPreview: "not_available",
  hostedAttestation: "not_available",
  quasar: "not_backed",
  buyerFacingClaimsAllowed: false,
  evidenceRefs: [],
  blockedReasons: [],
};

function requiredGate(
  explainability: RankingCandidateExplainability,
  gate: RankingCandidateExplainability["gates"][number]["gate"],
): RankingCandidateExplainability["gates"][number] {
  const found = explainability.gates.find((cell) => cell.gate === gate);
  if (!found) {
    throw new Error(`ard candidate diagnostics is missing required gate: ${gate}`);
  }
  return found;
}

/**
 * Derive the composed ARD candidate diagnostics for a hosted-registry search
 * result item (#381/#382 hosted discovery read model shapes).
 */
export function deriveArdCandidateDiagnostics(
  item: MarketplaceHostedSearchResultItem,
  options: ArdCandidateDiagnosticsOptions = {},
): ArdCandidateDiagnostics {
  const validated = validateDiscoveryCandidate(item.candidate);
  if (!validated.ok) {
    throw new Error(
      `ard candidate diagnostics received a malformed discovery candidate: ${validated.errors
        .map((error) => error.code)
        .join(", ")}`,
    );
  }

  const explainability = deriveRankingCandidateExplainability(validated.candidate, {
    policy: options.policy,
    matchedFields: item.match.matchedFields,
    health: {
      endpointHealth: item.listing.endpointHealth,
      snapshotGeneratedAt: options.generatedAt,
    },
    evidence: options.evidence,
  });

  const actionabilityMatrix = deriveHostedDiscoveryActionabilityMatrix(item, {
    generatedAt: options.generatedAt,
    catalogRef: options.catalogRef,
  });

  const reputation = options.reputationProjection ?? NO_REPUTATION_PROJECTION;
  const reputationAssigned = item.listing.reputationAssigned
    || reputation.offchainPreview === "available"
    || reputation.hostedAttestation === "ready";

  const receiptCount = options.evidence?.receiptCount ?? 0;
  const attestationCount = options.evidence?.attestationCount ?? 0;
  const hasHistory = receiptCount > 0 || attestationCount > 0;

  const trustRow = options.sourceTrustRow;
  const sourceTrustState: SourceTrustState = trustRow?.state ?? "listed_untrusted";

  return {
    schemaVersion: ARD_CANDIDATE_DIAGNOSTICS_SCHEMA_VERSION,
    candidateId: item.candidate.identifier,
    relevance: {
      score: item.match.score,
      scoreMeaning: "relevance_only_not_trust",
      matchedFields: item.match.matchedFields,
      summary:
        "ARD relevance is a capability/search signal only; it never grants trust, safety, budget, payment, invocation, or publication approval.",
    },
    publisherIdentity: {
      id: item.candidate.publisher?.id,
      name: item.candidate.publisher?.name,
      domain: item.candidate.publisher?.domain,
      claimed: Boolean(item.candidate.publisher?.id),
      summary: item.candidate.publisher?.id
        ? `Publisher identity is claimed as ${item.candidate.publisher.id}; the claim is not RAP-verified here.`
        : "No publisher identity is attached to this candidate.",
    },
    trustEvidence: {
      sourceTrustState,
      verificationStatus: explainability.trustState.status,
      reasonCodes: trustRow
        ? trustRow.registryProjection.reasonCodes
        : explainability.trustState.reasonCodes,
      conformanceFindings: trustRow?.diagnosticsProjection ?? [],
      summary: trustRow
        ? `Source/trust conformance state: ${trustRow.stateLabel}.`
        : "No conformance row was supplied; the candidate stays at the mandatory listed-untrusted ingress state.",
    },
    policyDecision: requiredGate(explainability, "policy"),
    budgetPaymentFit: {
      paymentActivation: item.listing.paymentActivation,
      quoteGate: requiredGate(explainability, "quote"),
      paymentGate: requiredGate(explainability, "payment"),
      budgetGate: requiredGate(explainability, "budget"),
    },
    receiptEvidenceHistory: {
      status: hasHistory ? "history_present" : "no_history",
      receiptCount,
      attestationCount,
      settlementReceiptRefs: options.evidence?.settlementReceiptRefs ?? [],
      attestationRefs: options.evidence?.attestationRefs ?? [],
      summary: hasHistory
        ? `Prior evidence exists: ${receiptCount} receipt(s), ${attestationCount} attestation(s).`
        : "No prior receipt or attestation history exists for this candidate.",
    },
    reputationState: {
      assigned: reputationAssigned,
      offchainPreview: reputation.offchainPreview,
      hostedAttestation: reputation.hostedAttestation,
      quasar: reputation.quasar,
      buyerFacingClaimsAllowed: false,
      blockedReasons: reputation.blockedReasons,
      summary: reputationAssigned
        ? "Reputation backing exists via the #606 bridge projection; buyer-facing claims stay disabled."
        : "No reputation has been assigned to this candidate.",
    },
    explainability,
    actionabilityMatrix,
    boundary: {
      ardRelevanceIsNever: [
        "trust",
        "safety",
        "budget",
        "payment",
        "invocation",
        "publication",
      ],
      boundariesDocRef: "docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md",
    },
    guardrails: {
      endpointProbed: false,
      trustMutated: false,
      reputationMutated: false,
      paymentExecuted: false,
      publicationTriggered: false,
    },
  };
}
