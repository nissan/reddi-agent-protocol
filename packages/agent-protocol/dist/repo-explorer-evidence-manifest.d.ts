/**
 * Repo explorer evidence manifest for static fixture ingestion (#470,
 * epic #468 / #400).
 *
 * FastContext-style (arXiv:2606.14066) exploration/solve split, RAP-owned:
 * repository EXPLORATION is read-only and returns compact file/line citations
 * with short relevance reasons — never broad context dumps and never a
 * full-repo ingest. This module defines the typed contract for that evidence
 * (`reddi.repo-explorer-evidence-manifest.v1`), validates candidate manifests
 * fail-closed, bridges accepted manifests onto the #509/#575 onboarding
 * `static-agent-stack-snapshot` / `snapshotRef` provenance surface by
 * reference, and projects them toward the shipped #403/#404/#421/#405/#406
 * vocabularies.
 *
 * The manifest DESCRIBES exploration evidence a caller already holds; this
 * module never performs exploration. It mirrors the shape of the OpenClaw-side
 * `openclaw.repo-explorer-evidence.v0.1` schema but is RAP-owned and
 * self-contained — not an import, not a runtime dependency.
 *
 * This module is PURE and self-contained (zero imports — the #575/#584/#585
 * pattern): no network, no filesystem access, no repo fetch/clone, no URL
 * ingestion, no dependency install, no LLM/provider call, no MCP/tool call,
 * no script or hook execution, no service startup, no wallet/RPC, no payment
 * activation, no hosted write, no marketplace publication, no
 * trust/reputation mutation. It only analyses in-memory data the caller
 * already holds. Fail-closed on malformed input and on any request to
 * fetch/clone/execute/install/ingest.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REVIEW-ONLY BOUNDARY: explorer evidence is LOCALIZATION EVIDENCE for static
 * review — never approval to install, run, execute, or adopt the explored
 * repository or any content it cites. A `valid` verdict permits static
 * review/analysis and provenance attachment ONLY. Those denials hold
 * regardless of verdict — see `reviewBoundary` on every report.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export declare const REPO_EXPLORER_EVIDENCE_MANIFEST_SCHEMA_VERSION: "reddi.repo-explorer-evidence-manifest.v1";
/** Source trust boundary — hard-coded. Explored repositories are always
 * external and untrusted; imported content can never self-assert trust. */
export declare const REPO_EXPLORER_SOURCE_TRUST: "external_untrusted";
export type RepoExplorerSourceTrust = typeof REPO_EXPLORER_SOURCE_TRUST;
/** The read-only explorer contract statement carried verbatim on every
 * normalized manifest. */
export declare const REPO_EXPLORER_READ_ONLY_CONTRACT: "Read-only exploration evidence: this manifest DESCRIBES observed repository content (file paths, line ranges, short relevance reasons). It is localization evidence for static review only \u2014 never approval to install, run, execute, ingest, or adopt the explored repository or any content it cites.";
/** Severity vocabulary — the repo-wide static-analysis vocabulary shared with
 * `source-diagnostics.ts`, `okf-conformance.ts`, and `okf-instruction-safety.ts`. */
export type RepoExplorerEvidenceSeverity = 'info' | 'warning' | 'blocked';
/** Structured, deterministic reason codes for every diagnostic this module emits. */
export type RepoExplorerEvidenceReasonCode = 'manifest_malformed' | 'operation_not_permitted' | 'source_malformed' | 'unsafe_source_url' | 'commit_unresolved' | 'trust_boundary_invalid' | 'explorer_contract_invalid' | 'timestamp_malformed' | 'query_missing' | 'evidence_empty' | 'evidence_entry_malformed' | 'malformed_evidence_path' | 'unsafe_evidence_path' | 'invalid_line_range' | 'line_window_exceeded' | 'missing_relevance_reason' | 'relevance_reason_too_long' | 'duplicate_evidence_entry' | 'generated_path_cited' | 'excluded_path_cited' | 'exclusion_entry_malformed' | 'open_question_malformed';
export type RepoExplorerEvidenceDiagnostic = {
    severity: RepoExplorerEvidenceSeverity;
    code: RepoExplorerEvidenceReasonCode;
    /** JSON-path-ish locator into the candidate manifest, e.g. `$.evidence[2].path`. */
    path: string;
    message: string;
};
export type RepoExplorerLineRangeInput = {
    start: number;
    end: number;
};
export type RepoExplorerEvidenceEntryInput = {
    /** Repo-root-relative POSIX path. Absolute paths, URI schemes, traversal,
     * backslashes, and control characters all fail closed. */
    path: string;
    lines: RepoExplorerLineRangeInput;
    /** Short, task-specific relevance reason (required, non-empty). */
    reason: string;
    matchedTerms?: string[];
};
export type RepoExplorerExclusionKind = 'generated' | 'noisy' | 'binary' | 'irrelevant' | 'secret_risk';
export type RepoExplorerExclusionInput = {
    /** Repo-root-relative path or directory prefix (a trailing `/**` or `/*`
     * glob suffix is accepted and normalized away). */
    path: string;
    reason: string;
    kind?: RepoExplorerExclusionKind;
};
export type RepoExplorerContractInput = {
    /** Only `read_only` is accepted; anything else fails closed. */
    mode?: string;
    toolsAllowed?: string[];
    toolsForbidden?: string[];
    maxFiles?: number;
    lineWindow?: number;
};
export type RepoExplorerSourceInput = {
    /** Public https repo/source URL. Never fetched here. */
    repoUrl: string;
    /** Resolved commit SHA (7–64 hex). Branch names / `HEAD` are not resolved
     * commits and fail closed. */
    resolvedCommit: string;
    defaultBranch?: string;
};
export type RepoExplorerEvidenceManifestInput = {
    manifestId?: string;
    /** RFC3339 UTC capture timestamp — required: provenance without a capture
     * time is not acceptable evidence. */
    generatedAt: string;
    source: RepoExplorerSourceInput;
    /** Optional in input, but only `external_untrusted` is accepted; the
     * normalized manifest hard-codes it either way. */
    sourceTrust?: string;
    /** Task-specific exploration query the evidence answers. */
    explorationQuery: string;
    explorer?: RepoExplorerContractInput;
    evidence: RepoExplorerEvidenceEntryInput[];
    exclusions?: RepoExplorerExclusionInput[];
    openQuestions?: string[];
};
/**
 * FAIL-CLOSED operation flags: every one of these is refused with
 * `operation_not_permitted`. They exist only so requests can be rejected
 * deterministically — this module never fetches, clones, ingests, executes,
 * or installs anything.
 */
export type RepoExplorerEvidenceOptions = {
    fetchRepo?: boolean;
    cloneRepo?: boolean;
    ingestFullRepo?: boolean;
    executeContent?: boolean;
    installDependencies?: boolean;
    invokeLlm?: boolean;
};
export type RepoExplorerEvidenceEntry = {
    path: string;
    lines: {
        start: number;
        end: number;
    };
    reason: string;
    matchedTerms: string[];
    /** True when the cited path matched the default generated/noisy path set. */
    generatedOrNoisy: boolean;
};
export type RepoExplorerExclusion = {
    path: string;
    reason: string;
    kind?: RepoExplorerExclusionKind;
};
export type RepoExplorerContract = {
    mode: 'read_only';
    toolsAllowed: string[];
    toolsForbidden: string[];
    maxFiles?: number;
    lineWindow?: number;
};
export declare const REPO_EXPLORER_DEFAULT_TOOLS_ALLOWED: readonly ["list_files", "read_file", "search_text"];
export declare const REPO_EXPLORER_DEFAULT_TOOLS_FORBIDDEN: readonly ["execute", "install", "network_fetch", "write_file", "spawn_process"];
export type RepoExplorerEvidenceManifest = {
    schemaVersion: typeof REPO_EXPLORER_EVIDENCE_MANIFEST_SCHEMA_VERSION;
    manifestId: string;
    generatedAt: string;
    source: {
        repoUrl: string;
        resolvedCommit: string;
        defaultBranch?: string;
    };
    /** Hard-coded: explored repositories are always external and untrusted. */
    sourceTrust: RepoExplorerSourceTrust;
    explorationQuery: string;
    explorer: RepoExplorerContract;
    /** Verbatim copy of `REPO_EXPLORER_READ_ONLY_CONTRACT`. */
    readOnlyContract: typeof REPO_EXPLORER_READ_ONLY_CONTRACT;
    evidence: RepoExplorerEvidenceEntry[];
    exclusions: RepoExplorerExclusion[];
    openQuestions: string[];
    /** Static fixture ingestion preserves this manifest as provenance WITHOUT a
     * full-repo ingest — always false, never overridable. */
    fullRepoIngested: false;
    staticOnly: true;
};
export type RepoExplorerEvidenceVerdict = 'valid' | 'warning' | 'blocked';
/** What an accepted manifest permits — and what stays permanently denied. */
export declare const REPO_EXPLORER_EVIDENCE_PERMITTED_USE: readonly ["static_review", "static_analysis", "fixture_ingestion_provenance", "operator_review_payload", "conformance_reporting"];
export declare const REPO_EXPLORER_EVIDENCE_DENIED_USE: readonly ["repo_fetch_or_clone", "full_repo_ingestion", "dependency_install", "script_or_tool_execution", "skill_installation", "agent_registration", "marketplace_publication", "hosted_registry_write", "llm_or_provider_call", "wallet_or_rpc_call", "payment_activation", "trust_or_reputation_mutation"];
export type RepoExplorerEvidenceManifestReport = {
    schemaVersion: typeof REPO_EXPLORER_EVIDENCE_MANIFEST_SCHEMA_VERSION;
    verdict: RepoExplorerEvidenceVerdict;
    /** Normalized manifest — null iff the verdict is `blocked` (fail-closed:
     * a blocked candidate never yields a usable manifest). */
    manifest: RepoExplorerEvidenceManifest | null;
    diagnostics: RepoExplorerEvidenceDiagnostic[];
    /** Deduped codes across all diagnostics, in first-seen order. */
    codes: RepoExplorerEvidenceReasonCode[];
    /**
     * REVIEW-ONLY boundary: identical on every report, independent of verdict.
     * Explorer output is localization evidence, not approval to install/run/adopt.
     */
    reviewBoundary: {
        permittedUse: typeof REPO_EXPLORER_EVIDENCE_PERMITTED_USE;
        deniedUse: typeof REPO_EXPLORER_EVIDENCE_DENIED_USE;
    };
    /** Hard-coded false guardrails — this module never touches any live surface. */
    guardrails: {
        network: false;
        fileSystemRead: false;
        repoFetched: false;
        repoCloned: false;
        fullRepoIngested: false;
        executed: false;
        installed: false;
        urlIngested: false;
        llmInvoked: false;
        mcpInvoked: false;
        hostedWrite: false;
        walletOrRpc: false;
        paymentActivated: false;
        trustMutated: false;
        instructionsTrusted: false;
    };
    notes: string[];
};
/** Directory segments that mark generated/vendored/noisy content. */
export declare const REPO_EXPLORER_NOISY_SEGMENTS: readonly ["node_modules", "dist", "build", "out", ".next", "coverage", "vendor", ".git", "target", "__pycache__", ".venv"];
/** Basename suffixes that mark generated/minified/noisy content. */
export declare const REPO_EXPLORER_NOISY_SUFFIXES: readonly [".lock", ".min.js", ".min.css", ".map", ".snap", ".tsbuildinfo"];
/** Exact basenames that mark generated lockfile/noise content. */
export declare const REPO_EXPLORER_NOISY_BASENAMES: readonly ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "cargo.lock"];
/** Deterministic generated/noisy classification for a repo-relative path. */
export declare function isGeneratedOrNoisyPath(path: string): {
    noisy: boolean;
    matched: string | null;
};
type PathProblem = {
    code: 'malformed_evidence_path' | 'unsafe_evidence_path';
    message: string;
};
/**
 * Deterministic fail-closed safety check for a repo-root-relative citation
 * path. Rejects: empty/non-string paths, control characters, backslash
 * separators, URI schemes (`file://`, `http://`, …) and Windows drive
 * prefixes, absolute paths, home-directory expansion, `..` traversal
 * (literal or percent-encoded), and empty/`.` segments.
 */
export declare function repoRelativePathProblem(value: unknown): PathProblem | null;
/**
 * Validates a candidate repo explorer evidence manifest, fail-closed.
 * Pure static analysis over in-memory data: nothing is fetched, read from
 * disk, executed, or ingested. A `blocked` verdict yields `manifest: null`.
 */
export declare function validateRepoExplorerEvidenceManifest(input: unknown, options?: RepoExplorerEvidenceOptions): RepoExplorerEvidenceManifestReport;
export declare const REPO_EXPLORER_SNAPSHOT_REF_PREFIX: "repo-explorer-evidence:";
/** Stable by-reference snapshot ref for an accepted manifest. */
export declare function repoExplorerSnapshotRef(manifest: RepoExplorerEvidenceManifest): string;
/**
 * Per-citation evidence refs (`repo-explorer-evidence:<id>#<path>:L<start>-L<end>`),
 * suitable as `evidenceRefs` on #575 provenanced fields.
 */
export declare function repoExplorerEvidenceRefs(manifest: RepoExplorerEvidenceManifest): string[];
export type RepoExplorerSnapshotAttachment = {
    /** Structural match for the #575 `OnboardingIntakeSource` intake surface. */
    source: {
        sourceUrl: string;
        snapshotRef: string;
        checkedCommit: string;
        crawlTimestamp: string;
    };
    /** Per-citation refs for #575 provenanced-field verification. */
    evidenceRefs: string[];
    sourceTrust: RepoExplorerSourceTrust;
    /** Provenance is attached BY REFERENCE — the repo is never ingested. */
    fullRepoIngested: false;
    staticOnly: true;
};
/**
 * Bridges an accepted report onto the #509/#575 `snapshotRef` surface.
 * Fail-closed: a blocked report (manifest null) can never become provenance.
 */
export declare function attachRepoExplorerEvidenceToSnapshot(report: RepoExplorerEvidenceManifestReport): {
    ok: true;
    attachment: RepoExplorerSnapshotAttachment;
} | {
    ok: false;
    reasonCode: 'manifest_blocked';
};
/**
 * Toward #403 (`StaticAgentStackCapabilityInventoryEntry`): the provenance
 * block and evidence refs a capability-inventory entry can carry to justify
 * `discovered` fields, plus compact localization hints for capability review.
 */
export type RepoExplorerCapabilityEvidenceProjection = {
    /** Structural match for the #403 entry `provenance` block. */
    provenance: {
        corpusId: string;
        sourceUrl: string;
        checkedCommit: string;
    };
    /** #403 vocabulary: explored repo text is untrusted public text. */
    contentTrustBoundary: 'untrusted_public_text';
    evidenceRefs: string[];
    localizationHints: Array<{
        sourcePath: string;
        lines: {
            start: number;
            end: number;
        };
        relevance: string;
    }>;
};
export declare function capabilityInventoryProjection(manifest: RepoExplorerEvidenceManifest): RepoExplorerCapabilityEvidenceProjection;
/**
 * Toward #404 (`StaticAgentStackConnectorDiagnostic`): field-for-field
 * structural match with our own diagnostic lane literal.
 */
export type RepoExplorerConnectorDiagnosticProjection = {
    path: string;
    diagnosticLane: 'repo_explorer_evidence';
    severity: RepoExplorerEvidenceSeverity;
    warningCodes: string[];
    blocksDraftPayload: boolean;
    operatorReviewRequired: boolean;
    message: string;
};
export declare function connectorDiagnosticsProjection(report: RepoExplorerEvidenceManifestReport): RepoExplorerConnectorDiagnosticProjection[];
/** The #421 nine-value risk-category union, mirrored structurally. */
export type RepoExplorerRiskCategory = 'executable_hook' | 'installer_or_update_script' | 'deploy_capable_command' | 'wallet_rpc_capable_metadata' | 'local_binary_requirement' | 'env_required_connector' | 'mcp_launcher_execution' | 'external_submodule' | 'permission_policy';
/** Toward #421 (`StaticAgentStackRiskDiagnostic`): structural match. */
export type RepoExplorerRiskDiagnosticProjection = {
    path: string;
    diagnosticLane: 'static_fixture_risk_taxonomy';
    category: RepoExplorerRiskCategory;
    severity: RepoExplorerEvidenceSeverity;
    warningCodes: string[];
    blocksDraftPayload: boolean;
    operatorReviewRequired: boolean;
    message: string;
};
/**
 * Deterministic risk-taxonomy projection over cited evidence paths and
 * matched terms. Localization evidence FLAGS risk for operator review — it
 * never auto-blocks (severity `warning`, `blocksDraftPayload: false`),
 * because citing a risky file is observation, not adoption.
 */
export declare function riskTaxonomyProjection(manifest: RepoExplorerEvidenceManifest): RepoExplorerRiskDiagnosticProjection[];
/**
 * Toward #405 (`StaticAgentStackDraftPayloadReadiness`): structural match.
 * `ready` is NEVER emitted — external_untrusted explorer evidence always
 * requires operator review (matches the #575 static path never emitting
 * `publish_ready`).
 */
export type RepoExplorerDraftReadinessProjection = {
    status: 'needs_review' | 'blocked';
    blockers: string[];
    payloadRefs: string[];
};
export declare function draftReadinessProjection(report: RepoExplorerEvidenceManifestReport): RepoExplorerDraftReadinessProjection;
/** Toward #406 (`StaticAgentStackOperatorReviewPayload`): structural subset. */
export type RepoExplorerOperatorReviewItemProjection = {
    id: string;
    severity: RepoExplorerEvidenceSeverity;
    path?: string;
    source: 'repo_explorer_evidence';
    reasonCodes: string[];
    message: string;
    blocksPublication: boolean;
    recommendedAction: 'approve_after_readiness_gates' | 'review_static_risk' | 'review_unsafe_metadata';
};
export type RepoExplorerOperatorReviewProjection = {
    reviewId: string;
    status: 'approve_ready' | 'request_changes' | 'rejected';
    source: {
        sourceUrl: string | null;
        checkedCommit: string | null;
        sourceAuthenticity: 'source_snapshot_recorded';
        providerTrust: 'unverified';
        importedContentTrust: 'untrusted';
    };
    publication: {
        disabled: true;
        requiresOperatorApproval: true;
    };
    reviewItems: RepoExplorerOperatorReviewItemProjection[];
    rawSnapshotRefs: string[];
};
export declare function operatorReviewProjection(report: RepoExplorerEvidenceManifestReport): RepoExplorerOperatorReviewProjection;
/** All projections plus the snapshot attachment, in one deterministic bundle. */
export type RepoExplorerEvidenceProjections = {
    snapshotAttachment: RepoExplorerSnapshotAttachment | null;
    capabilityInventory: RepoExplorerCapabilityEvidenceProjection | null;
    connectorDiagnostics: RepoExplorerConnectorDiagnosticProjection[];
    riskTaxonomy: RepoExplorerRiskDiagnosticProjection[];
    draftReadiness: RepoExplorerDraftReadinessProjection;
    operatorReview: RepoExplorerOperatorReviewProjection;
};
export declare function projectRepoExplorerEvidence(report: RepoExplorerEvidenceManifestReport): RepoExplorerEvidenceProjections;
export declare const repoExplorerEvidenceManifestFixtures: Record<string, RepoExplorerEvidenceManifestInput>;
export {};
