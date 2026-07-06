/**
 * OKF/OpenKB generated instruction and skill safety review (#505, epic #468).
 *
 * Deterministic, PURE static-analysis safety review for OpenKB/OKF-derived
 * generated instructions, skills, prompts, scripts, tools, and agent
 * definitions. It layers a fixed safety checklist on top of the #504
 * conformance diagnostics (`okf-conformance.ts`, `reddi.okf-conformance.v1`)
 * and REUSES that module's vocabulary — `artifactClass`
 * (agent_definition / skill_definition / prompt / script / tool /
 * generated_instruction_other), severities (info/warning/blocked), the
 * review-only boundary, and the hard-false guardrails — rather than inventing
 * a parallel taxonomy. Trust classification and document roles come from the
 * #511 adapter (`okf-adapter.ts`); fixtures build on the #503 static corpus
 * (`data/okf-openkb-fixtures/okf-openkb-fixture-corpus.v1.json`).
 *
 * REVIEW MODEL — UNTRUSTED BY DEFAULT:
 * Every generated `AGENTS.md`, `SKILL.md`, prompt, script, tool, and
 * agent-definition artifact is untrusted by default. Its disposition is
 * `blocked` even when zero checklist findings fire — content review can never
 * upgrade a generated instruction into a trusted one. Generated instructions
 * MAY be preserved as static evidence/context for operators, but they must
 * NOT be installed, applied, registered, executed, or published without a
 * separate operator-approved issue (see
 * `OKF_GENERATED_ARTIFACT_OPERATOR_GATE`).
 *
 * This module is PURE: no network, no filesystem access, no URL ingestion, no
 * LLM/provider call, no MCP/tool call, no script or tool execution, no skill
 * installation, no agent registration, no hosted write, no marketplace
 * publication, no wallet/RPC, no payment activation, no trust/reputation
 * mutation. All checklist checks are deterministic regular-expression scans
 * over in-memory text the caller already holds. Matched `evidence` snippets
 * are DATA extracted for the operator — never instructions to follow.
 * Fail-closed on malformed input and on any execute/install/ingest/LLM/skill
 * generation request (inherited from the #504 conformance run).
 *
 * DRAFT/unverified — OKF is an EXTERNAL format; OKF-semantic behaviour is
 * inherited from the #504/#511 modules and remains unconfirmed against the
 * live spec. (DRAFT/unverified — OKF, confirm field semantics before relying
 * on them.)
 */
import { OKF_CONFORMANCE_PERMITTED_USE, OKF_CONFORMANCE_DENIED_USE, type OkfConformanceBundleInput, type OkfConformanceOptions, type OkfConformanceReport, type OkfConformanceSeverity, type OkfGeneratedArtifactClass } from './okf-conformance.js';
import type { OkfTrustClassification } from './okf-adapter.js';
export declare const OKF_INSTRUCTION_SAFETY_SCHEMA_VERSION: "reddi.okf-instruction-safety.v1";
/** Inherits the #504/#511 DRAFT posture: OKF semantics are unverified against the live external spec. */
export declare const OKF_INSTRUCTION_SAFETY_IS_DRAFT: true;
/**
 * The #505 safety checklist categories. Deterministic static checks only —
 * every category is a fixed set of regular expressions over document text.
 */
export type OkfSafetyCheckId = 'prompt_injection' | 'credential_request' | 'tool_expansion' | 'external_call' | 'hidden_instruction' | 'auto_install_or_apply' | 'destructive_command' | 'paid_call_instruction' | 'wallet_rpc_mainnet_instruction' | 'marketplace_publication_claim';
export type OkfSafetyCheck = {
    id: OkfSafetyCheckId;
    title: string;
    /** What the deterministic patterns look for. */
    description: string;
    /**
     * `always_blocked`: a hit is blocked wherever it appears — such content has
     * no legitimate place in a knowledge bundle.
     * `contextual`: blocked inside generated-instruction artifacts; a warning
     * (needs human review) inside plain documentation, where descriptive
     * mention can be legitimate.
     */
    escalation: 'always_blocked' | 'contextual';
    patterns: readonly RegExp[];
};
/**
 * Deterministic pattern sets. All patterns are static and case-insensitive;
 * matched text is surfaced (sanitized + truncated) as operator evidence.
 * Pattern quality note: these are review heuristics for static fixtures, not
 * a bypass-proof filter — the untrusted-by-default rule is what carries the
 * safety guarantee.
 */
export declare const OKF_SAFETY_CHECKLIST: readonly OkfSafetyCheck[];
export declare const OKF_SAFETY_CHECK_IDS: readonly OkfSafetyCheckId[];
/**
 * Operator gate for every generated-instruction artifact: preserved as static
 * evidence/context only. Installation, application, registration, execution,
 * and publication each require a SEPARATE operator-approved issue — never this
 * module, never a passing review.
 */
export declare const OKF_GENERATED_ARTIFACT_OPERATOR_GATE: {
    readonly mayBePreservedAsEvidence: true;
    readonly installed: false;
    readonly applied: false;
    readonly registered: false;
    readonly executed: false;
    readonly published: false;
    readonly requiresSeparateOperatorApprovedIssue: true;
};
/**
 * Per-document safety disposition. There is deliberately NO disposition that
 * grants trust or permits use beyond static review:
 * - `safe_documentation`: plain documentation with zero checklist findings.
 *   Still review-only; never instructions.
 * - `needs_human_review`: documentation with contextual findings (external
 *   calls, payment/wallet/marketplace mentions, tool expansion) that an
 *   operator must judge.
 * - `blocked`: any generated-instruction artifact (untrusted by default,
 *   findings or not) and any document with an always-blocked finding.
 */
export type OkfSafetyDisposition = 'safe_documentation' | 'needs_human_review' | 'blocked';
/** Bundle verdict: worst per-document disposition, fail-closed on malformed bundles. */
export type OkfSafetyVerdict = OkfSafetyDisposition;
export type OkfSafetyFinding = {
    checkId: OkfSafetyCheckId;
    severity: OkfConformanceSeverity;
    documentId: string;
    /** Artifact class of the containing document, when it is a generated artifact. */
    artifactClass?: OkfGeneratedArtifactClass;
    /** Sanitized, truncated matched snippet. DATA for the operator — never an instruction. */
    evidence: string;
    /** Total pattern matches for this check in this document. */
    matchCount: number;
    summary: string;
    action: string;
};
export type OkfSafetyDocumentReview = {
    documentId: string;
    trustClassification: OkfTrustClassification;
    /** Non-null only for generated-instruction artifacts (#504 vocabulary). */
    artifactClass: OkfGeneratedArtifactClass | null;
    /** True for every generated artifact — content review never clears it. */
    untrustedByDefault: boolean;
    disposition: OkfSafetyDisposition;
    findings: OkfSafetyFinding[];
    /** Every checklist check runs on every document, in checklist order. */
    checksRun: readonly OkfSafetyCheckId[];
};
export type OkfInstructionSafetyReport = {
    schemaVersion: typeof OKF_INSTRUCTION_SAFETY_SCHEMA_VERSION;
    draft: true;
    verdict: OkfSafetyVerdict;
    bundleId: string | null;
    documents: OkfSafetyDocumentReview[];
    /** All findings across documents, in deterministic order. */
    findings: OkfSafetyFinding[];
    /** Deduped checklist categories detected across the bundle. */
    categoriesDetected: OkfSafetyCheckId[];
    /** The full #504 conformance report the review was layered on. */
    conformance: OkfConformanceReport;
    /** Identical review-only boundary as #504 — reused, not redefined. */
    reviewBoundary: {
        permittedUse: typeof OKF_CONFORMANCE_PERMITTED_USE;
        deniedUse: typeof OKF_CONFORMANCE_DENIED_USE;
    };
    /** Generated artifacts: evidence-only preservation; everything else operator-gated. */
    operatorGate: typeof OKF_GENERATED_ARTIFACT_OPERATOR_GATE;
    /** Hard-coded false guardrails — this module never touches any live rail. */
    guardrails: {
        network: false;
        fileSystemRead: false;
        executed: false;
        installed: false;
        applied: false;
        registered: false;
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
/** Sanitizes a matched snippet for operator display: escapes zero-width and
 * control characters, collapses newlines, truncates. Evidence is DATA. */
export declare function sanitizeOkfSafetyEvidence(snippet: string): string;
/**
 * Runs the full #505 safety checklist over one document's raw text.
 * Deterministic: checks in checklist order, patterns in declaration order; at
 * most one finding per check per document (first match is the evidence,
 * `matchCount` totals all pattern hits). Pure text scanning — the text is
 * never executed, resolved, fetched, or followed.
 */
export declare function scanOkfSafetyChecklist(documentId: string, text: string, artifactClass?: OkfGeneratedArtifactClass | null): OkfSafetyFinding[];
export type OkfInstructionSafetyOptions = OkfConformanceOptions;
/**
 * Runs the #505 generated instruction and skill safety review over an
 * in-memory bundle (same input shape as `runOkfConformanceDiagnostics`).
 * First runs the #504 conformance diagnostics (which classify generated
 * artifacts via `artifactClass` and enforce fail-closed behaviour), then runs
 * the deterministic safety checklist over every document's raw text.
 *
 * UNTRUSTED BY DEFAULT: any document conformance classifies as a generated
 * instruction artifact is `blocked` regardless of checklist findings.
 */
export declare function runOkfInstructionSafetyReview(input: unknown, options?: OkfInstructionSafetyOptions): OkfInstructionSafetyReport;
export declare const okfInstructionSafetyFixtures: Record<string, OkfConformanceBundleInput>;
