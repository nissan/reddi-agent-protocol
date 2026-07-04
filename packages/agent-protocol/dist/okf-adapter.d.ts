/**
 * DRAFT v1 — SPIKE (#511, under epic #468; scope decision tracked in #513).
 *
 * A PURE, offline adapter that projects an OpenKB-style knowledge-bundle fixture
 * into a strict OKF- (Open Knowledge Format) *shaped* output for RAP review.
 *
 * This module is PURE: no network, no filesystem read of the live bundle, no URL
 * ingestion, no OpenKB install, no LLM/provider call, no script/tool execution,
 * no skill generation/installation. It only re-shapes an in-memory fixture that
 * the caller already holds.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IMPORTANT — DRAFT / UNVERIFIED: OKF is an EXTERNAL Google format
 * (GoogleCloudPlatform/knowledge-catalog `okf/SPEC.md`). EVERY OKF field name and
 * shape below is illustrative and LOW/MEDIUM confidence. Each externally-named
 * OKF field is tagged `(DRAFT/unverified — OKF, confirm field)`. Do NOT treat any
 * of these as authoritative OKF field names, and do NOT rely on this projection
 * for a real OKF import/export without reconciling against the live spec first.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Security posture (mirrors the epic boundaries):
 *  - Generated `AGENTS.md`, `SKILL.md`, prompts, scripts, tools, and agent
 *    definitions are classified UNTRUSTED review artifacts — never trusted policy
 *    or runtime metadata, never executed, never installed.
 *  - Unknown frontmatter fields are permissively PRESERVED but explicitly marked
 *    untrusted (not policy/runtime configuration).
 *  - Instructions embedded in bundle content are DATA, never followed.
 *  - Fail-closed on malformed input and on any request to execute/install/ingest.
 */
export declare const OKF_ADAPTER_SCHEMA_VERSION: "reddi.okf-adapter.v1";
/** Top-level draft flag — the whole schema is unverified against the live OKF spec. */
export declare const OKF_ADAPTER_IS_DRAFT: true;
/**
 * Illustrative OKF format version emitted on the shaped bundle.
 * (DRAFT/unverified — OKF, confirm field.)
 */
export declare const OKF_ADAPTER_ILLUSTRATIVE_OKF_VERSION: "0.1-illustrative";
export type OkfDocumentRole = 'index' | 'log' | 'concept' | 'instruction_artifact' | 'unknown';
export type OkfTrustClassification = 'static_source' | 'untrusted_generated_instruction';
export type OkfAdapterReasonCode = 'okf_adapter_ok' | 'bundle_malformed' | 'document_malformed' | 'unsupported_link_syntax' | 'malformed_frontmatter' | 'missing_provenance' | 'generated_instruction_untrusted' | 'execution_not_allowed' | 'concept_type_missing' | 'unknown_frontmatter_preserved' | 'operation_not_permitted';
export type OkfDiagnosticLane = 'bundle' | 'document_role' | 'link' | 'frontmatter' | 'provenance' | 'instruction_safety';
export type OkfDiagnosticSeverity = 'info' | 'warning' | 'blocked';
export type OkfDiagnostic = {
    lane: OkfDiagnosticLane;
    severity: OkfDiagnosticSeverity;
    code: OkfAdapterReasonCode;
    /** Document id the diagnostic is scoped to, when document-scoped. */
    documentId?: string;
    summary: string;
    action?: string;
};
/**
 * A standard-markdown link in the OKF-shaped body.
 * (DRAFT/unverified — OKF, confirm field: OKF link representation.)
 */
export type OkfLink = {
    /** Visible link text. */
    text: string;
    /** Normalized standard-markdown link target (e.g. `Agent.md`). */
    target: string;
    /** Whether this link was converted from an OpenKB `[[wikilink]]` or was already markdown. */
    origin: 'wikilink' | 'markdown';
};
/**
 * Source provenance for an OKF document.
 * (DRAFT/unverified — OKF, confirm field: OKF provenance / source refs shape.)
 */
export type OkfProvenance = {
    /** Source URI the document was derived from (recorded, never fetched). */
    sourceUri?: string;
    /** Upstream source commit for reproducibility. */
    sourceCommit?: string;
    /** When the source was captured (recorded string, not validated). */
    retrievedAt?: string;
};
export type OkfDocument = {
    /**
     * Stable document id/path within the OKF bundle.
     * (DRAFT/unverified — OKF, confirm field: OKF document id/path convention.)
     */
    id: string;
    /**
     * OKF document role. `index`/`log` are normalized special files; `concept` is a
     * concept document (requires a non-empty `type`); `instruction_artifact` is an
     * UNTRUSTED generated artifact; `unknown` is anything else.
     * (DRAFT/unverified — OKF, confirm field: OKF document-role vocabulary.)
     */
    documentRole: OkfDocumentRole;
    /**
     * `type` frontmatter for concept documents (non-empty required by OKF); null
     * when absent or when the document is not a concept.
     * (DRAFT/unverified — OKF, confirm field: OKF concept `type`.)
     */
    type: string | null;
    /**
     * Title from frontmatter `title` or the first `#` heading; null if neither.
     * (DRAFT/unverified — OKF, confirm field: OKF `title`.)
     */
    title: string | null;
    /**
     * Frontmatter with unknown fields permissively PRESERVED. RAP treats this as
     * UNTRUSTED review metadata — never policy/runtime configuration.
     * (DRAFT/unverified — OKF, confirm field: OKF frontmatter contract.)
     */
    frontmatter: Record<string, unknown>;
    /** Markdown body with `[[wikilinks]]` converted to standard markdown links where deterministic. */
    body: string;
    /**
     * Standard-markdown links extracted from the body (converted + native).
     * (DRAFT/unverified — OKF, confirm field: OKF link representation.)
     */
    links: OkfLink[];
    /**
     * Source provenance (recorded only; never fetched).
     * (DRAFT/unverified — OKF, confirm field: OKF provenance / source refs shape.)
     */
    provenance: OkfProvenance | null;
    /**
     * RAP trust classification — NOT an OKF field. Generated instruction artifacts
     * are `untrusted_generated_instruction`; everything else is `static_source`.
     */
    trustClassification: OkfTrustClassification;
    /** Per-document diagnostics. */
    diagnostics: OkfDiagnostic[];
};
/**
 * Normalized `index.md` semantics.
 * (DRAFT/unverified — OKF, confirm field: OKF index/table-of-contents shape.)
 */
export type OkfIndex = {
    documentId: string;
    entries: Array<{
        text: string;
        target: string;
    }>;
    summary: string;
};
/**
 * Normalized `log.md` semantics (append-only change log — recorded, not trusted).
 * (DRAFT/unverified — OKF, confirm field: OKF log/changelog shape.)
 */
export type OkfLog = {
    documentId: string;
    entryCount: number;
    summary: string;
};
export type OkfAdapterBundle = {
    schemaVersion: typeof OKF_ADAPTER_SCHEMA_VERSION;
    /** The whole schema is a draft projection against an unverified external format. */
    draft: true;
    /**
     * Illustrative OKF format version.
     * (DRAFT/unverified — OKF, confirm field: OKF format/version marker.)
     */
    okfVersion: string;
    adapterIntent: 'okf_shaped' | 'blocked';
    bundleId: string | null;
    documents: OkfDocument[];
    index: OkfIndex | null;
    log: OkfLog | null;
    /** Bundle-level + aggregated document diagnostics. */
    diagnostics: OkfDiagnostic[];
    reasonCodes: OkfAdapterReasonCode[];
    /**
     * Hard-coded false guardrails — this adapter never touches any live rail.
     * Asserting these lets tests prove nothing implies a fetch/exec/install.
     */
    guardrails: {
        network: false;
        fileSystemReadOfBundle: false;
        executed: false;
        installed: false;
        urlIngested: false;
        llmInvoked: false;
        skillGenerated: false;
        instructionsTrusted: false;
    };
    notes: string[];
};
export type OkfAdapterOptions = {
    /** Emit `missing_provenance` at `blocked` severity instead of `warning`. */
    requireProvenance?: boolean;
    /**
     * FAIL-CLOSED: any attempt to actually execute, install, ingest a URL, invoke an
     * LLM, or generate/register a skill is rejected with `operation_not_permitted`.
     * This module never performs any of these — the flags exist only to reject them.
     */
    execute?: boolean;
    install?: boolean;
    ingestUrl?: boolean;
    invokeLlm?: boolean;
    generateSkill?: boolean;
};
/** Input document — an OpenKB-style markdown/frontmatter file (already in memory). */
export type OpenKbDocumentInput = {
    /** Bundle-relative path, e.g. `concepts/agent.md`, `index.md`, `AGENTS.md`. */
    path: string;
    /**
     * Already-parsed frontmatter object (preferred). Unknown fields are preserved.
     * If provided as a non-object, a `malformed_frontmatter` diagnostic is raised.
     */
    frontmatter?: unknown;
    /**
     * Optional raw flat-frontmatter string (`key: value` lines). Parsed conservatively;
     * lines that are neither blank nor `key: value` raise `malformed_frontmatter`.
     * Ignored when `frontmatter` is an object.
     */
    rawFrontmatter?: string;
    /** Markdown body, possibly containing OpenKB `[[wikilinks]]`. */
    body?: string;
    /** Source provenance (recorded only). */
    provenance?: OkfProvenance;
};
/** Input bundle — a set of OpenKB-style documents. */
export type OpenKbBundleInput = {
    bundleId?: string;
    documents: OpenKbDocumentInput[];
};
/**
 * Pure, offline projection of an OpenKB-style bundle fixture into an OKF-shaped
 * output. Never fetches, executes, installs, ingests URLs, invokes an LLM, or
 * generates a skill. Fails closed on malformed input and on any such request.
 */
export declare function adaptOpenKbBundleToOkf(input: unknown, options?: OkfAdapterOptions): OkfAdapterBundle;
/**
 * Canonical OpenKB-style bundle fixture (in-memory, offline). Illustrative only —
 * the frontmatter/body content is DATA and must never be treated as instructions.
 */
export declare const openKbBundleFixtures: Record<string, OpenKbBundleInput>;
