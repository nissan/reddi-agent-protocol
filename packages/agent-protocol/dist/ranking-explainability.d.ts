/**
 * Source-aware ranking explainability (#344, epic #336).
 *
 * Enriches resolve/ranking output with a typed, per-candidate explainability
 * block so users and operators can see WHY a source/specialist was selected,
 * rejected, or deferred — without ever blending discovery relevance into
 * trust, safety, budget, payment, invocation, or publication decisions
 * (`docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md`, #452).
 *
 * This module is PURE and read-model only: no network, no filesystem, no
 * LLM/provider call, no MCP/tool call, no wallet/RPC action, no registry
 * write, no publication, no payment, no trust or reputation mutation. It only
 * explains in-memory candidates the caller already holds.
 *
 * Vocabulary reuse (no new words where existing ones fit):
 * - Per-candidate lane diagnostics come from `source-diagnostics.ts`
 *   (`reddi.source-diagnostics.v1`, the #344 lane vocabulary incl.
 *   `relevance_only_not_trust`).
 * - Gate/rejection reason codes reuse `discovery-source.ts`
 *   (`DiscoveryCandidateReasonCode`) wherever a code exists there.
 * - The relevance boundary mirrors the #593 conformance matrix
 *   (`discoveryBoundary.scoreMeaning: 'relevance_only_not_trust'`).
 *
 * Fail-closed contract:
 * - Every candidate always carries ALL required gates — including
 *   `settlement` and `attestation` — so no source kind can silently bypass
 *   settlement or attestation constraints (#344 AC).
 * - A gate that has not produced positive evidence is `not_evaluated`, which
 *   is never treated as passed.
 * - Relevance influences ranking ORDER only; it never changes a gate state
 *   and a high-relevance candidate with any failed gate is still `rejected`.
 */
import { type DiscoveryCandidate, type DiscoveryCandidatePolicy, type DiscoveryCandidatePolicyPreflightDecision, type DiscoveryCandidateReasonCode, type DiscoverySourceKind } from './discovery-source.js';
import { type SourceAwareCandidateDiagnostics } from './source-diagnostics.js';
import { type ProviderTrustVerificationStatus } from './provider-trust.js';
export declare const RANKING_EXPLAINABILITY_SCHEMA_VERSION: "reddi.ranking-explainability.v1";
/** Where the relevance-is-never-trust boundary is defined. */
export declare const RANKING_EXPLAINABILITY_BOUNDARIES_DOC_REF: "docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md";
/**
 * The gates every ranked candidate must carry. `settlement` and `attestation`
 * are structural members of this list: they exist for every source kind and
 * cannot be removed or defaulted to passed by any caller option.
 */
export type RankingGateId = 'trust' | 'policy' | 'quote' | 'evidence' | 'payment' | 'budget' | 'settlement' | 'attestation';
export declare const REQUIRED_RANKING_GATES: readonly RankingGateId[];
/** `not_evaluated` is never treated as passed — fail closed. */
export type RankingGateState = 'passed' | 'failed' | 'not_evaluated';
export type RankingGateCell = {
    gate: RankingGateId;
    state: RankingGateState;
    reasonCodes: string[];
    summary: string;
};
/** Why a candidate ended up selected, rejected, or deferred. */
export type RankingSelectionState = 'selected' | 'rejected' | 'deferred';
export type RankingRejectionReason = {
    gate: RankingGateId;
    code: string;
    summary: string;
};
export type RankingCandidateHealthInput = {
    /** Endpoint health as recorded by the discovery surface; never probed here. */
    endpointHealth?: 'pass' | 'fail' | 'degraded' | 'not_probed';
    /** When the discovery snapshot backing this candidate was generated. */
    snapshotGeneratedAt?: string;
};
/**
 * Prior receipt/attestation/settlement EVIDENCE the caller already holds
 * (e.g. from `receipt-evidence-binding` records). References only — this
 * module never creates, verifies, or settles anything.
 */
export type RankingCandidateEvidenceInput = {
    receiptCount?: number;
    attestationCount?: number;
    settlementReceiptRefs?: string[];
    attestationRefs?: string[];
};
export type RankingCandidateExplainabilityOptions = {
    /** RAP policy; when present the policy preflight is evaluated here. */
    policy?: DiscoveryCandidatePolicy;
    /** A preflight decision the caller already evaluated (wins over `policy`). */
    policyDecision?: DiscoveryCandidatePolicyPreflightDecision;
    /** Fields the ranking query matched on, when the search surface knows them. */
    matchedFields?: string[];
    health?: RankingCandidateHealthInput;
    evidence?: RankingCandidateEvidenceInput;
};
export type RankingCandidateExplainability = {
    schemaVersion: typeof RANKING_EXPLAINABILITY_SCHEMA_VERSION;
    /** Source identity: who/where this candidate came from. */
    sourceIdentity: {
        identifier: string;
        name: string;
        sourceKind: DiscoverySourceKind;
        publisher?: {
            id: string;
            name?: string;
            domain?: string;
        };
        url?: string;
        endpoint?: string;
        rawSnapshotRef?: string;
    };
    /** Capability match: search/ranking relevance only — never trust. */
    capabilityMatch: {
        resourceType: string;
        mediaType: string;
        relevanceScore?: number;
        scoreMeaning: 'relevance_only_not_trust';
        matchedFields: string[];
        summary: string;
    };
    /** Trust state as RAP recorded it; external claims are never verified here. */
    trustState: {
        status: ProviderTrustVerificationStatus | 'missing';
        reasonCodes: string[];
        failureReasons: string[];
        summary: string;
    };
    /** Payment policy fit (quote/asset/network/budget) from the Decide lane. */
    paymentPolicyFit: {
        quote?: {
            amount: string;
            asset: string;
            network: string;
        };
        allowed?: boolean;
        reasonCodes: DiscoveryCandidateReasonCode[];
        summary: string;
    };
    /** Health/freshness as recorded by the discovery snapshot; never probed. */
    healthFreshness: {
        endpointHealth: 'pass' | 'fail' | 'degraded' | 'not_probed';
        freshness: 'snapshot_backed' | 'unknown';
        snapshotGeneratedAt?: string;
        snapshotRef?: string;
        summary: string;
    };
    /** All required gates, always present, fail closed. */
    gates: RankingGateCell[];
    /** Failed gates flattened into displayable rejection reasons. */
    rejectionReasons: RankingRejectionReason[];
    selection: {
        state: RankingSelectionState;
        /** Ranking order comes from relevance only; gates never reorder. */
        rankInfluencedByGates: false;
        summary: string;
    };
    /** The composed #344 lane diagnostics (`reddi.source-diagnostics.v1`). */
    diagnostics: SourceAwareCandidateDiagnostics;
    boundary: {
        scoreMeaning: 'relevance_only_not_trust';
        relevanceInfluencedGates: false;
        boundariesDocRef: typeof RANKING_EXPLAINABILITY_BOUNDARIES_DOC_REF;
    };
    /** Explainability is read-only; it authorizes nothing. */
    guardrails: {
        trustGranted: false;
        invocationAuthorized: false;
        paymentAuthorized: false;
        publicationAuthorized: false;
        settlementBypassPossible: false;
        attestationBypassPossible: false;
    };
};
export type RankedCandidateExplanation = {
    /** 1-based position, assigned by relevance ordering only. */
    rank: number;
    explainability: RankingCandidateExplainability;
};
export type SourceRankingExplainabilityReport = {
    schemaVersion: typeof RANKING_EXPLAINABILITY_SCHEMA_VERSION;
    generatedAt?: string;
    ordering: 'relevance_desc_then_identifier_asc';
    total: number;
    candidates: RankedCandidateExplanation[];
    boundary: RankingCandidateExplainability['boundary'];
    guardrails: RankingCandidateExplainability['guardrails'];
};
export type ExplainSourceRankingOptions = {
    policy?: DiscoveryCandidatePolicy;
    generatedAt?: string;
    /** Per-candidate inputs keyed by candidate identifier. */
    perCandidate?: Record<string, Omit<RankingCandidateExplainabilityOptions, 'policy'>>;
};
/**
 * Derive the `reddi.ranking-explainability.v1` block for one candidate.
 *
 * All eight required gates are always emitted; there is no option to omit,
 * override, or pre-pass a gate. Settlement and attestation gates only pass on
 * explicit caller-held evidence references.
 */
export declare function deriveRankingCandidateExplainability(candidate: DiscoveryCandidate, options?: RankingCandidateExplainabilityOptions): RankingCandidateExplainability;
/**
 * Enrich a resolve/ranking candidate list with per-candidate explainability.
 *
 * Ordering is relevance-descending (ties broken by identifier) and is the ONLY
 * thing relevance controls: rejected candidates keep their relevance rank and
 * are marked `rejected` with reasons instead of being silently re-ordered or
 * hidden.
 */
export declare function explainSourceRanking(candidates: DiscoveryCandidate[], options?: ExplainSourceRankingOptions): SourceRankingExplainabilityReport;
