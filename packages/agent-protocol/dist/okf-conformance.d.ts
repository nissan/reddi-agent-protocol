/**
 * OKF/OpenKB knowledge-bundle conformance diagnostics (#504, epic #468).
 *
 * Deterministic, PURE static-analysis diagnostics that decide whether an
 * OKF-shaped / OpenKB-style knowledge bundle is acceptable as REVIEW/ANALYSIS
 * input for RAP — and nothing more. This module builds directly on the #511
 * adapter spike (`okf-adapter.ts`) and the #503 static fixture corpus
 * (`data/okf-openkb-fixtures/okf-openkb-fixture-corpus.v1.json`): same document
 * roles, trust classifications, and reason-code vocabulary. It does not
 * re-invent either.
 *
 * This module is PURE: no network, no filesystem access, no URL ingestion, no
 * OpenKB install, no LLM/provider call, no MCP/tool call, no script or tool
 * execution, no skill installation, no agent registration, no hosted write,
 * no marketplace publication, no wallet/RPC, no payment activation, no
 * trust/reputation mutation. It only analyses in-memory text the caller
 * already holds. Fail-closed on malformed input and on any request to
 * execute/install/ingest/invoke/generate.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REVIEW-ONLY BOUNDARY: a `valid` conformance verdict permits static
 * review/analysis ONLY. It never permits skill installation, agent
 * registration/onboarding, marketplace publication, hosted writes,
 * LLM/provider calls, or execution of any bundle content. Those remain denied
 * regardless of verdict — see `reviewBoundary` on every report.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * DRAFT/unverified — like the #511 spike, OKF (Open Knowledge Format) is an
 * EXTERNAL format and every OKF-semantic claim below (concept `type`
 * requirement, `index.md`/`log.md` semantics, standard-markdown-link
 * requirement) is illustrative and unconfirmed against the live spec.
 * (DRAFT/unverified — OKF, confirm field semantics before relying on them.)
 */
import { type OkfDocumentRole, type OkfIndex, type OkfLog, type OkfTrustClassification, type OpenKbDocumentInput } from './okf-adapter.js';
export declare const OKF_CONFORMANCE_SCHEMA_VERSION: "reddi.okf-conformance.v1";
/** The OKF semantics this module enforces are unverified against the live external spec. */
export declare const OKF_CONFORMANCE_IS_DRAFT: true;
/** Severity vocabulary — aligned with the repo's static-analysis severity vocab
 * (`agent-stack-fixtures.ts` and `okf-adapter.ts` both use info/warning/blocked). */
export type OkfConformanceSeverity = 'info' | 'warning' | 'blocked';
/** Deterministic conformance diagnostic codes. Reuses the #511 adapter reason-code
 * vocabulary wherever one exists; adds only index/log expectation codes. */
export type OkfConformanceCode = 'malformed_frontmatter' | 'concept_type_missing' | 'unsupported_link_syntax' | 'missing_provenance' | 'unknown_frontmatter_preserved' | 'generated_instruction_untrusted' | 'execution_not_allowed' | 'index_missing' | 'log_missing' | 'index_semantics_normalized' | 'log_semantics_normalized' | 'bundle_malformed' | 'document_malformed' | 'operation_not_permitted';
/**
 * Per-document conformance status — the #504 acceptance-criteria vocabulary:
 * valid, warning, blocked, untrusted_generated_instruction,
 * unsupported_link_syntax, missing_provenance, malformed_frontmatter,
 * execution_not_allowed. The named statuses surface the dominant finding;
 * `valid`/`warning`/`blocked` are the fallbacks by max severity.
 */
export type OkfConformanceStatus = 'valid' | 'warning' | 'blocked' | 'untrusted_generated_instruction' | 'unsupported_link_syntax' | 'missing_provenance' | 'malformed_frontmatter' | 'execution_not_allowed';
/** Bundle-level verdict. Even `valid` permits review/analysis only. */
export type OkfConformanceVerdict = 'valid' | 'warning' | 'blocked';
/**
 * Explicit unsafe/generated-instruction artifact classes for producer-toolchain
 * output (AGENTS.md, SKILL.md, prompts, scripts, skills, tools, agent
 * definitions). Mirrors the #503 corpus `generatedArtifacts[].artifactKind`
 * vocabulary (`agent_definition`, `skill_definition`, `script`).
 */
export type OkfGeneratedArtifactClass = 'agent_definition' | 'skill_definition' | 'prompt' | 'script' | 'tool' | 'generated_instruction_other';
export type OkfConformanceDiagnostic = {
    severity: OkfConformanceSeverity;
    code: OkfConformanceCode;
    /** Document id/path the diagnostic is scoped to, when document-scoped. */
    documentId?: string;
    summary: string;
    action?: string;
    /**
     * For `unsupported_link_syntax`: true when the finding is deterministically
     * adaptable (simple `[[wikilink]]` → standard markdown link, already
     * converted by the #511 adapter); false when it is not (embeds, heading/block
     * refs, empty targets) and must be rewritten at the source.
     */
    adaptable?: boolean;
    /** For generated-instruction / execution findings: the artifact class. */
    artifactClass?: OkfGeneratedArtifactClass;
};
export type OkfConformanceDocumentReport = {
    documentId: string;
    documentRole: OkfDocumentRole;
    trustClassification: OkfTrustClassification;
    /** Non-null only for generated-instruction artifacts. */
    artifactClass: OkfGeneratedArtifactClass | null;
    status: OkfConformanceStatus;
    diagnostics: OkfConformanceDiagnostic[];
};
/** What a passing (or any) conformance report permits — and permanently denies. */
export declare const OKF_CONFORMANCE_PERMITTED_USE: readonly ["static_review", "static_analysis", "operator_review_payload", "conformance_reporting"];
export declare const OKF_CONFORMANCE_DENIED_USE: readonly ["skill_installation", "agent_registration", "agent_onboarding", "marketplace_publication", "hosted_registry_write", "llm_or_provider_call", "script_or_tool_execution", "url_ingestion", "payment_activation", "trust_or_reputation_mutation"];
export type OkfConformanceReport = {
    schemaVersion: typeof OKF_CONFORMANCE_SCHEMA_VERSION;
    /** OKF-semantic checks are drafted against an unverified external format. */
    draft: true;
    verdict: OkfConformanceVerdict;
    bundleId: string | null;
    documents: OkfConformanceDocumentReport[];
    /** Bundle-level + aggregated per-document diagnostics, in deterministic order. */
    diagnostics: OkfConformanceDiagnostic[];
    /** Deduped codes across all diagnostics. */
    codes: OkfConformanceCode[];
    /** Normalized `index.md` semantics from the #511 adapter, when present. */
    index: OkfIndex | null;
    /** Normalized `log.md` semantics from the #511 adapter, when present. */
    log: OkfLog | null;
    /**
     * REVIEW-ONLY boundary: identical on every report, independent of verdict.
     * Passing conformance permits review/analysis only — never installation,
     * registration, publication, hosted writes, provider calls, or execution.
     */
    reviewBoundary: {
        permittedUse: typeof OKF_CONFORMANCE_PERMITTED_USE;
        deniedUse: typeof OKF_CONFORMANCE_DENIED_USE;
    };
    /** Hard-coded false guardrails — this module never touches any live rail. */
    guardrails: {
        network: false;
        fileSystemRead: false;
        executed: false;
        installed: false;
        urlIngested: false;
        llmInvoked: false;
        mcpInvoked: false;
        skillInstalled: false;
        agentRegistered: false;
        hostedWrite: false;
        marketplacePublished: false;
        paymentActivated: false;
        trustMutated: false;
        instructionsTrusted: false;
    };
    notes: string[];
};
/**
 * Input document. Either provide `source` (raw markdown text, optionally
 * starting with a `---` YAML frontmatter fence) or the already-split
 * `frontmatter`/`rawFrontmatter`/`body` fields from the #511 adapter input
 * shape. When `source` is present it wins.
 */
export type OkfConformanceDocumentInput = OpenKbDocumentInput & {
    source?: string;
};
export type OkfConformanceBundleInput = {
    bundleId?: string;
    documents: OkfConformanceDocumentInput[];
};
export type OkfConformanceOptions = {
    /** Escalate `missing_provenance` to `blocked` instead of `warning`. */
    requireProvenance?: boolean;
    /** Emit a warning when the bundle has no `index.md`. */
    expectIndex?: boolean;
    /** Emit a warning when the bundle has no `log.md`. */
    expectLog?: boolean;
    /**
     * FAIL-CLOSED: any attempt to execute, install, ingest a URL, invoke an LLM,
     * or generate/install a skill is rejected with `operation_not_permitted`.
     * These flags exist only so requests can be refused deterministically.
     */
    execute?: boolean;
    install?: boolean;
    ingestUrl?: boolean;
    invokeLlm?: boolean;
    generateSkill?: boolean;
};
/**
 * Maps the #503 corpus `expectedDiagnostics[].code` vocabulary onto the
 * conformance code vocabulary (which follows the #511 adapter reason codes).
 */
export declare const OKF_FIXTURE_DIAGNOSTIC_CODE_MAP: {
    readonly unsupported_wikilink_syntax: "unsupported_link_syntax";
    readonly generated_instruction_untrusted: "generated_instruction_untrusted";
    readonly generated_skill_untrusted: "generated_instruction_untrusted";
    readonly script_execution_not_allowed: "execution_not_allowed";
};
/** Maps #503 corpus `expectedDiagnostics[].severity` onto acceptable conformance severities. */
export declare const OKF_FIXTURE_DIAGNOSTIC_SEVERITY_MAP: Record<string, readonly OkfConformanceSeverity[]>;
/**
 * Builds a conformance bundle input from one fixture of the #503 corpus
 * (`reddi.okf-openkb-fixture-corpus.v1`). Read-only over the fixture object:
 * file previews are consumed as static text and never mutated, so the
 * fixture's `contentSha256` digests are preserved. Fail-closed: a fixture that
 * does not carry a usable `files` array yields an empty-documents input, which
 * `runOkfConformanceDiagnostics` blocks as `bundle_malformed`.
 */
export declare function conformanceInputFromOkfOpenKbFixture(fixture: unknown): OkfConformanceBundleInput;
export type OkfParsedDocumentSource = {
    /** Parsed frontmatter object, or undefined when the source has no fence. */
    frontmatter: Record<string, unknown> | undefined;
    body: string;
    diagnostics: OkfConformanceDiagnostic[];
};
/**
 * Deterministically splits raw markdown into YAML frontmatter and body.
 * Conservative YAML subset only: `key: value` scalars, `# comments`, and
 * `key:` followed by indented `- item` list lines. Anything else raises
 * `malformed_frontmatter` and is skipped (fail-closed: unparseable content is
 * never trusted). An unterminated fence is also `malformed_frontmatter`; the
 * whole source is then treated as body with no trusted frontmatter.
 */
export declare function parseOkfDocumentSource(documentId: string, source: string): OkfParsedDocumentSource;
/**
 * Runs deterministic OKF/OpenKB conformance diagnostics over an in-memory
 * bundle. Pure static analysis: delegates document projection to the #511
 * adapter, then layers the #504 conformance vocabulary (statuses, escalated
 * generated-instruction severities, adaptable-wikilink reporting, index/log
 * expectations, review-only boundary) on top.
 */
export declare function runOkfConformanceDiagnostics(input: unknown, options?: OkfConformanceOptions): OkfConformanceReport;
export declare const okfConformanceFixtures: Record<string, OkfConformanceBundleInput>;
