/**
 * Source/trust conformance matrix for auth.md and ARD/AI Catalog provider
 * metadata (#450, epics #336 / #363).
 *
 * Proves — with deterministic fixtures only — that `auth.md` documents and
 * ARD/AI Catalog provider metadata enter RAP as UNTRUSTED source metadata and
 * stay untrusted until explicit RAP-side trust/evidence gates classify them.
 * Discovery relevance is a search signal and never a trust decision; see
 * `docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md` (#452) — this module references
 * that boundary and enforces it (`relevance_ignored_for_trust`), it does not
 * restate it.
 *
 * This module is PURE: no network, no filesystem access, no live auth.md
 * fetch, no catalog crawl, no LLM/provider call, no MCP/tool call, no wallet
 * or RPC action, no hosted-registry write, no publication, no payment, no
 * trust/reputation mutation. It only classifies in-memory metadata the caller
 * already holds. Fail-closed on malformed input and on every unsafe finding.
 *
 * Vocabulary reuse (no new words where existing ones fit):
 * - Trust states mirror the #343 lane vocabulary stated in the boundaries doc
 *   (trusted / listed-untrusted / claimed / unverified / failed-verification /
 *   blocked / needs-human-review) and overlap with the #506 actionability lane
 *   states (`claimed`, `failed_verification`, `blocked`, `needs_human_review`).
 * - Finding severities reuse the repo static-analysis vocabulary
 *   (`info` / `warning` / `blocked` — `source-diagnostics.ts`, `okf-conformance.ts`).
 * - Finding codes reuse `provider-trust.ts` reason codes wherever one exists
 *   (`malformed_trust_metadata`, `credential_leakage_rejected`,
 *   `no_trust_metadata`, `external_claim_not_verified_by_rap`, `rap_verified`,
 *   `rap_verification_failed`) and add only the auth-surface gates #450 names.
 * - auth.md registration/credential vocabulary aligns with the auth.md
 *   discovery lane (`agent-provider` / `email-verification` / `anonymous`;
 *   `access_token` / `api_key`). Identity-assertion names are DRAFT and
 *   illustrative — auth.md is an external format; confirm before relying.
 *
 * Outputs are projections consumable by:
 * - #343 provider trust registry work (`registryProjection` maps every matrix
 *   state onto the existing `ProviderTrustVerificationStatus` vocabulary and
 *   carries the normalized `ProviderTrustRecord` when one exists), and
 * - #344 source-aware diagnostics (`diagnosticsProjection` uses the
 *   `source-diagnostics.ts` lane + severity vocabulary).
 */
import { type AiCatalogSnapshot } from './ai-catalog.js';
import { type ProviderTrustRecord, type ProviderTrustVerificationInput, type ProviderTrustVerificationStatus } from './provider-trust.js';
import { type SourceDiagnosticLane, type SourceDiagnosticSeverity } from './source-diagnostics.js';
export declare const SOURCE_TRUST_CONFORMANCE_MATRIX_SCHEMA_VERSION: "reddi.source-trust-conformance-matrix.v1";
/** Where the boundary between discovery relevance and trust/policy/payment/evidence/reputation is defined. */
export declare const SOURCE_TRUST_BOUNDARIES_DOC_REF: "docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md";
/**
 * The #450 / #343 trust-state vocabulary.
 *
 * `listed_untrusted` is the mandatory ingress state: every auth.md document
 * and every ARD/AI Catalog provider entry is listed-untrusted until RAP-side
 * gates run. `unverified` means gates ran and found no trust evidence at all;
 * `claimed` means external trust claims exist but RAP has not verified them.
 */
export type SourceTrustState = 'trusted' | 'listed_untrusted' | 'claimed' | 'unverified' | 'failed_verification' | 'blocked' | 'needs_human_review';
export declare const SOURCE_TRUST_STATES: readonly SourceTrustState[];
/** The #450 acceptance-criteria case list; the matrix must cover every one. */
export type SourceTrustRequiredCase = 'malformed_metadata' | 'credential_leakage' | 'anonymous_write_scope' | 'unsupported_credential_type' | 'unsupported_identity_assertion' | 'missing_trust_evidence' | 'high_relevance_blocked_candidate';
export declare const SOURCE_TRUST_REQUIRED_CASES: readonly SourceTrustRequiredCase[];
/** Reuses the repo-wide static-analysis severity vocabulary. */
export type SourceTrustFindingSeverity = SourceDiagnosticSeverity;
export type SourceTrustFindingCode = 'malformed_trust_metadata' | 'credential_leakage_rejected' | 'no_trust_metadata' | 'external_claim_not_verified_by_rap' | 'rap_verified' | 'rap_verification_failed' | 'listed_untrusted_on_entry' | 'malformed_source_metadata' | 'anonymous_write_scope_rejected' | 'unsupported_credential_type' | 'unsupported_identity_assertion' | 'self_asserted_verification_ignored' | 'relevance_ignored_for_trust';
export type SourceTrustFinding = {
    code: SourceTrustFindingCode;
    severity: SourceTrustFindingSeverity;
    path: string;
    message: string;
};
/** Supported auth.md credential types (aligned with the auth.md discovery lane). */
export declare const SUPPORTED_AUTH_MD_CREDENTIAL_TYPES: readonly string[];
/** Supported auth.md registration types (aligned with the auth.md discovery lane). */
export declare const SUPPORTED_AUTH_MD_REGISTRATION_TYPES: readonly string[];
/**
 * Supported identity-assertion mechanisms. DRAFT/illustrative — auth.md is an
 * external format and these names are unconfirmed against a live spec; the
 * fail-closed behavior (unknown assertion ⇒ blocked) is the contract, not the
 * exact allowlist.
 */
export declare const SUPPORTED_AUTH_MD_IDENTITY_ASSERTIONS: readonly string[];
export type AuthMdScopeDeclaration = {
    name: string;
    access: 'read' | 'write';
    /** Registration types this scope is offered to; omitted means all declared types. */
    registrationTypes?: string[];
};
/**
 * Parsed auth.md source metadata as it enters RAP: still just self-asserted
 * provider text. Nothing in this shape is trusted by import.
 */
export type AuthMdSourceMetadata = {
    url?: string;
    authorizationServer?: string;
    registrationTypes?: string[];
    credentialTypes?: string[];
    identityAssertions?: string[];
    scopes?: AuthMdScopeDeclaration[];
    publisher?: {
        id?: string;
        domain?: string;
    };
    trust?: {
        trustManifest?: unknown;
        provenance?: unknown[];
        attestations?: unknown[];
        verificationReferences?: unknown[];
        publisherIdentity?: unknown;
        /** External self-asserted status; RAP ignores it and flags it for review. */
        status?: string;
    };
    raw?: unknown;
};
export type SourceTrustCandidateSource = {
    kind: 'auth-md';
    metadata: unknown;
} | {
    kind: 'ai-catalog';
    catalog: AiCatalogSnapshot;
    resourceId: string;
};
export type ClassifySourceTrustInput = {
    candidateId: string;
    source: SourceTrustCandidateSource;
    /** Discovery relevance — recorded and explicitly ignored for trust. */
    relevance?: {
        score?: number;
        source?: string;
    };
    /** RAP-side verification outcome, when a gate has actually run. */
    rapVerification?: ProviderTrustVerificationInput;
    /**
     * 'not_run' produces the mandatory ingress classification
     * (`listed_untrusted`) without evaluating any gate. Default: 'run'.
     */
    gates?: 'run' | 'not_run';
};
/** #343 registry consumption shape: existing provider-trust vocabulary only. */
export type SourceTrustRegistryProjection = {
    verificationStatus: ProviderTrustVerificationStatus;
    reasonCodes: SourceTrustFindingCode[];
    /** Blocked rows must never be listed as invocable registry candidates. */
    registryEligible: boolean;
    /** Present for ai-catalog sources when provider-trust normalization succeeds. */
    providerTrustRecord?: ProviderTrustRecord;
};
/** #344 diagnostics consumption shape: source-diagnostics lane + severity vocabulary. */
export type SourceTrustDiagnosticsProjectionMessage = {
    lane: SourceDiagnosticLane;
    severity: SourceDiagnosticSeverity;
    code: string;
    summary: string;
    action?: string;
};
export type SourceTrustConformanceRow = {
    schemaVersion: typeof SOURCE_TRUST_CONFORMANCE_MATRIX_SCHEMA_VERSION;
    candidateId: string;
    sourceKind: 'auth-md' | 'ai-catalog';
    /** Constant by construction: both source kinds enter untrusted-until-gated. */
    entryState: 'listed_untrusted';
    state: SourceTrustState;
    stateLabel: string;
    findings: SourceTrustFinding[];
    discoveryBoundary: {
        relevanceScore?: number;
        scoreMeaning: 'relevance_only_not_trust';
        relevanceInfluencedTrust: false;
        boundariesDocRef: typeof SOURCE_TRUST_BOUNDARIES_DOC_REF;
    };
    registryProjection: SourceTrustRegistryProjection;
    diagnosticsProjection: SourceTrustDiagnosticsProjectionMessage[];
};
export type SourceTrustConformanceFixtureCase = {
    description: string;
    requiredCase?: SourceTrustRequiredCase;
    input: ClassifySourceTrustInput;
    expectedState: SourceTrustState;
    expectedFindingCodes: SourceTrustFindingCode[];
};
export type SourceTrustConformanceMatrix = {
    schemaVersion: typeof SOURCE_TRUST_CONFORMANCE_MATRIX_SCHEMA_VERSION;
    boundary: {
        untrustedUntilGated: true;
        /** What the matrix separates trust from — defined in the boundaries doc. */
        distinguishesRelevanceFrom: readonly ['trust', 'policy', 'payment', 'evidence', 'reputation'];
        boundariesDocRef: typeof SOURCE_TRUST_BOUNDARIES_DOC_REF;
    };
    rows: Array<SourceTrustConformanceRow & {
        fixtureId: string;
        description: string;
        requiredCase?: SourceTrustRequiredCase;
    }>;
    coverage: {
        states: Record<SourceTrustState, number>;
        requiredCases: Record<SourceTrustRequiredCase, number>;
        sourceKinds: Record<'auth-md' | 'ai-catalog', number>;
        missingStates: SourceTrustState[];
        missingRequiredCases: SourceTrustRequiredCase[];
        complete: boolean;
    };
};
export declare function classifySourceTrustCandidate(input: ClassifySourceTrustInput): SourceTrustConformanceRow;
/**
 * Fixture cases proving every #450 state and required case, across BOTH
 * source kinds. Deterministic, in-memory, no live fetch anywhere.
 */
export declare const sourceTrustConformanceFixtureCases: Record<string, SourceTrustConformanceFixtureCase>;
export declare function buildSourceTrustConformanceMatrix(cases?: Record<string, SourceTrustConformanceFixtureCase>): SourceTrustConformanceMatrix;
