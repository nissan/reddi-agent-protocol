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
export const REPO_EXPLORER_EVIDENCE_MANIFEST_SCHEMA_VERSION = 'reddi.repo-explorer-evidence-manifest.v1';
/** Source trust boundary — hard-coded. Explored repositories are always
 * external and untrusted; imported content can never self-assert trust. */
export const REPO_EXPLORER_SOURCE_TRUST = 'external_untrusted';
/** The read-only explorer contract statement carried verbatim on every
 * normalized manifest. */
export const REPO_EXPLORER_READ_ONLY_CONTRACT = 'Read-only exploration evidence: this manifest DESCRIBES observed repository content (file paths, line ranges, short relevance reasons). It is localization evidence for static review only — never approval to install, run, execute, ingest, or adopt the explored repository or any content it cites.';
export const REPO_EXPLORER_DEFAULT_TOOLS_ALLOWED = Object.freeze([
    'list_files',
    'read_file',
    'search_text',
]);
export const REPO_EXPLORER_DEFAULT_TOOLS_FORBIDDEN = Object.freeze([
    'execute',
    'install',
    'network_fetch',
    'write_file',
    'spawn_process',
]);
/** What an accepted manifest permits — and what stays permanently denied. */
export const REPO_EXPLORER_EVIDENCE_PERMITTED_USE = [
    'static_review',
    'static_analysis',
    'fixture_ingestion_provenance',
    'operator_review_payload',
    'conformance_reporting',
];
export const REPO_EXPLORER_EVIDENCE_DENIED_USE = [
    'repo_fetch_or_clone',
    'full_repo_ingestion',
    'dependency_install',
    'script_or_tool_execution',
    'skill_installation',
    'agent_registration',
    'marketplace_publication',
    'hosted_registry_write',
    'llm_or_provider_call',
    'wallet_or_rpc_call',
    'payment_activation',
    'trust_or_reputation_mutation',
];
/* ────────────────────────────────────────────────────────────────────────────
 * Default generated/noisy path vocabulary
 * ──────────────────────────────────────────────────────────────────────────── */
/** Directory segments that mark generated/vendored/noisy content. */
export const REPO_EXPLORER_NOISY_SEGMENTS = Object.freeze([
    'node_modules',
    'dist',
    'build',
    'out',
    '.next',
    'coverage',
    'vendor',
    '.git',
    'target',
    '__pycache__',
    '.venv',
]);
/** Basename suffixes that mark generated/minified/noisy content. */
export const REPO_EXPLORER_NOISY_SUFFIXES = Object.freeze([
    '.lock',
    '.min.js',
    '.min.css',
    '.map',
    '.snap',
    '.tsbuildinfo',
]);
/** Exact basenames that mark generated lockfile/noise content. */
export const REPO_EXPLORER_NOISY_BASENAMES = Object.freeze([
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'bun.lockb',
    'cargo.lock',
]);
/** Deterministic generated/noisy classification for a repo-relative path. */
export function isGeneratedOrNoisyPath(path) {
    const segments = path.split('/');
    for (const segment of segments.slice(0, -1)) {
        if (REPO_EXPLORER_NOISY_SEGMENTS.includes(segment.toLowerCase())) {
            return { noisy: true, matched: segment.toLowerCase() };
        }
    }
    const basename = (segments[segments.length - 1] ?? '').toLowerCase();
    if (REPO_EXPLORER_NOISY_BASENAMES.includes(basename)) {
        return { noisy: true, matched: basename };
    }
    for (const suffix of REPO_EXPLORER_NOISY_SUFFIXES) {
        if (basename.endsWith(suffix)) {
            return { noisy: true, matched: suffix };
        }
    }
    return { noisy: false, matched: null };
}
/* ────────────────────────────────────────────────────────────────────────────
 * Path safety (fail-closed)
 * ──────────────────────────────────────────────────────────────────────────── */
const URI_SCHEME_OR_DRIVE_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/;
const ENCODED_TRAVERSAL_PATTERN = /%2e%2e|%2f|%5c/i;
const RFC3339_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,64}$/;
/**
 * Deterministic fail-closed safety check for a repo-root-relative citation
 * path. Rejects: empty/non-string paths, control characters, backslash
 * separators, URI schemes (`file://`, `http://`, …) and Windows drive
 * prefixes, absolute paths, home-directory expansion, `..` traversal
 * (literal or percent-encoded), and empty/`.` segments.
 */
export function repoRelativePathProblem(value) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        return { code: 'malformed_evidence_path', message: 'path must be a non-empty string' };
    }
    const path = value.trim();
    if (CONTROL_CHAR_PATTERN.test(path)) {
        return { code: 'malformed_evidence_path', message: 'path contains control characters' };
    }
    if (path.includes('\\')) {
        return { code: 'malformed_evidence_path', message: 'path uses backslash separators; only repo-relative POSIX paths are accepted' };
    }
    if (URI_SCHEME_OR_DRIVE_PATTERN.test(path)) {
        return { code: 'unsafe_evidence_path', message: 'path carries a URI scheme or drive prefix (e.g. file://, https://, C:); only repo-relative paths are accepted' };
    }
    if (path.startsWith('/')) {
        return { code: 'unsafe_evidence_path', message: 'absolute paths are not accepted; paths must be repo-root-relative' };
    }
    if (path.startsWith('~')) {
        return { code: 'unsafe_evidence_path', message: 'home-directory expansion is not accepted; paths must be repo-root-relative' };
    }
    if (ENCODED_TRAVERSAL_PATTERN.test(path)) {
        return { code: 'unsafe_evidence_path', message: 'percent-encoded separators/traversal sequences are not accepted' };
    }
    const segments = path.split('/');
    for (const segment of segments) {
        if (segment === '..') {
            return { code: 'unsafe_evidence_path', message: 'path traversal (`..`) is not accepted' };
        }
        if (segment === '' || segment === '.') {
            return { code: 'malformed_evidence_path', message: 'empty or `.` path segments are not accepted' };
        }
    }
    return null;
}
/* ────────────────────────────────────────────────────────────────────────────
 * Validation (fail-closed)
 * ──────────────────────────────────────────────────────────────────────────── */
const MAX_REASON_LENGTH = 500;
const READ_ONLY_VIOLATION_TOOL_PATTERN = /(execute|exec|install|write|network|fetch|spawn|shell|run|delete|mutate)/i;
const EXCLUSION_KINDS = [
    'generated',
    'noisy',
    'binary',
    'irrelevant',
    'secret_risk',
];
/**
 * Validates a candidate repo explorer evidence manifest, fail-closed.
 * Pure static analysis over in-memory data: nothing is fetched, read from
 * disk, executed, or ingested. A `blocked` verdict yields `manifest: null`.
 */
export function validateRepoExplorerEvidenceManifest(input, options = {}) {
    const diagnostics = [];
    // FAIL-CLOSED operation refusals come first and always block.
    for (const [flag, label] of [
        ['fetchRepo', 'repository fetch'],
        ['cloneRepo', 'repository clone'],
        ['ingestFullRepo', 'full-repo ingestion'],
        ['executeContent', 'content execution'],
        ['installDependencies', 'dependency installation'],
        ['invokeLlm', 'LLM/provider invocation'],
    ]) {
        if (options[flag] === true) {
            diagnostics.push({
                severity: 'blocked',
                code: 'operation_not_permitted',
                path: `$options.${flag}`,
                message: `${label} was requested and is never permitted; this module only validates evidence the caller already holds.`,
            });
        }
    }
    if (!isPlainObject(input)) {
        diagnostics.push({
            severity: 'blocked',
            code: 'manifest_malformed',
            path: '$',
            message: 'manifest must be a plain object',
        });
        return buildReport(null, diagnostics);
    }
    // ── source ────────────────────────────────────────────────────────────────
    let repoUrl = '';
    let resolvedCommit = '';
    let defaultBranch;
    const source = input['source'];
    if (!isPlainObject(source)) {
        diagnostics.push({
            severity: 'blocked',
            code: 'source_malformed',
            path: '$.source',
            message: 'source must be an object with repoUrl and resolvedCommit',
        });
    }
    else {
        const urlProblem = sourceUrlProblem(source['repoUrl']);
        if (urlProblem !== null) {
            diagnostics.push({
                severity: 'blocked',
                code: urlProblem.code,
                path: '$.source.repoUrl',
                message: urlProblem.message,
            });
        }
        else {
            repoUrl = source['repoUrl'].trim();
        }
        const commit = source['resolvedCommit'];
        const normalizedCommit = typeof commit === 'string' ? commit.trim().toLowerCase() : '';
        if (!COMMIT_SHA_PATTERN.test(normalizedCommit)) {
            diagnostics.push({
                severity: 'blocked',
                code: 'commit_unresolved',
                path: '$.source.resolvedCommit',
                message: 'resolvedCommit must be a resolved 7-64 character hex commit SHA (branch names, tags, and HEAD are not resolved commits)',
            });
        }
        else {
            resolvedCommit = normalizedCommit;
        }
        if (source['defaultBranch'] !== undefined) {
            if (isNonEmptyString(source['defaultBranch'])) {
                defaultBranch = source['defaultBranch'].trim();
            }
            else {
                diagnostics.push({
                    severity: 'warning',
                    code: 'source_malformed',
                    path: '$.source.defaultBranch',
                    message: 'defaultBranch must be a non-empty string when present; it was dropped',
                });
            }
        }
    }
    // ── trust boundary ────────────────────────────────────────────────────────
    if (input['sourceTrust'] !== undefined && input['sourceTrust'] !== REPO_EXPLORER_SOURCE_TRUST) {
        diagnostics.push({
            severity: 'blocked',
            code: 'trust_boundary_invalid',
            path: '$.sourceTrust',
            message: `sourceTrust is hard-coded '${REPO_EXPLORER_SOURCE_TRUST}'; explored repositories can never self-assert a higher trust level`,
        });
    }
    // ── timestamp ─────────────────────────────────────────────────────────────
    let generatedAt = '';
    if (typeof input['generatedAt'] !== 'string' || !RFC3339_UTC_PATTERN.test(input['generatedAt'].trim())) {
        diagnostics.push({
            severity: 'blocked',
            code: 'timestamp_malformed',
            path: '$.generatedAt',
            message: 'generatedAt must be an RFC3339 UTC timestamp (e.g. 2026-07-06T00:00:00Z); evidence without a capture time is not acceptable provenance',
        });
    }
    else {
        generatedAt = input['generatedAt'].trim();
    }
    // ── query ─────────────────────────────────────────────────────────────────
    let explorationQuery = '';
    if (!isNonEmptyString(input['explorationQuery'])) {
        diagnostics.push({
            severity: 'blocked',
            code: 'query_missing',
            path: '$.explorationQuery',
            message: 'explorationQuery must be a non-empty, task-specific exploration query',
        });
    }
    else {
        explorationQuery = input['explorationQuery'].trim();
    }
    // ── explorer contract ─────────────────────────────────────────────────────
    const explorer = normalizeExplorerContract(input['explorer'], diagnostics);
    // ── exclusions ────────────────────────────────────────────────────────────
    const exclusions = normalizeExclusions(input['exclusions'], diagnostics);
    // ── evidence ──────────────────────────────────────────────────────────────
    const evidence = normalizeEvidence(input['evidence'], exclusions, explorer, diagnostics);
    // ── open questions ────────────────────────────────────────────────────────
    const openQuestions = normalizeOpenQuestions(input['openQuestions'], diagnostics);
    // ── manifest id ───────────────────────────────────────────────────────────
    let manifestId = '';
    if (input['manifestId'] !== undefined) {
        if (isNonEmptyString(input['manifestId'])) {
            manifestId = input['manifestId'].trim();
        }
        else {
            diagnostics.push({
                severity: 'warning',
                code: 'manifest_malformed',
                path: '$.manifestId',
                message: 'manifestId must be a non-empty string when present; a deterministic id was derived instead',
            });
        }
    }
    if (manifestId === '' && repoUrl !== '' && resolvedCommit !== '') {
        manifestId = deriveManifestId(repoUrl, resolvedCommit);
    }
    const blocked = diagnostics.some((diag) => diag.severity === 'blocked');
    if (blocked) {
        return buildReport(null, diagnostics);
    }
    const manifest = {
        schemaVersion: REPO_EXPLORER_EVIDENCE_MANIFEST_SCHEMA_VERSION,
        manifestId,
        generatedAt,
        source: {
            repoUrl,
            resolvedCommit,
            ...(defaultBranch === undefined ? {} : { defaultBranch }),
        },
        sourceTrust: REPO_EXPLORER_SOURCE_TRUST,
        explorationQuery,
        explorer,
        readOnlyContract: REPO_EXPLORER_READ_ONLY_CONTRACT,
        evidence,
        exclusions,
        openQuestions,
        fullRepoIngested: false,
        staticOnly: true,
    };
    return buildReport(manifest, diagnostics);
}
function buildReport(manifest, diagnostics) {
    const blocked = diagnostics.some((diag) => diag.severity === 'blocked');
    const verdict = blocked
        ? 'blocked'
        : diagnostics.some((diag) => diag.severity === 'warning')
            ? 'warning'
            : 'valid';
    const codes = [];
    for (const diag of diagnostics) {
        if (!codes.includes(diag.code))
            codes.push(diag.code);
    }
    return {
        schemaVersion: REPO_EXPLORER_EVIDENCE_MANIFEST_SCHEMA_VERSION,
        verdict,
        manifest: blocked ? null : manifest,
        diagnostics,
        codes,
        reviewBoundary: {
            permittedUse: REPO_EXPLORER_EVIDENCE_PERMITTED_USE,
            deniedUse: REPO_EXPLORER_EVIDENCE_DENIED_USE,
        },
        guardrails: {
            network: false,
            fileSystemRead: false,
            repoFetched: false,
            repoCloned: false,
            fullRepoIngested: false,
            executed: false,
            installed: false,
            urlIngested: false,
            llmInvoked: false,
            mcpInvoked: false,
            hostedWrite: false,
            walletOrRpc: false,
            paymentActivated: false,
            trustMutated: false,
            instructionsTrusted: false,
        },
        notes: [
            'REVIEW-ONLY: explorer output is localization evidence, not approval to install, run, execute, or adopt the explored repository.',
            'Source trust boundary is hard-coded external_untrusted; imported content can never self-assert trust.',
            'Static fixture ingestion preserves this manifest as provenance BY REFERENCE — no full-repo ingest is performed or permitted.',
            'Cited content, paths, and reasons are DATA under review, never instructions to follow.',
        ],
    };
}
function sourceUrlProblem(value) {
    if (!isNonEmptyString(value)) {
        return { code: 'source_malformed', message: 'repoUrl must be a non-empty string' };
    }
    const url = value.trim();
    if (CONTROL_CHAR_PATTERN.test(url) || /\s/.test(url)) {
        return { code: 'unsafe_source_url', message: 'repoUrl must not contain whitespace or control characters' };
    }
    if (!/^https:\/\//i.test(url)) {
        return {
            code: 'unsafe_source_url',
            message: 'repoUrl must be a public https:// URL (file://, http://, git://, ssh, and bare paths all fail closed)',
        };
    }
    const rest = url.slice('https://'.length);
    const authority = rest.split(/[/?#]/, 1)[0] ?? '';
    if (authority.length === 0) {
        return { code: 'unsafe_source_url', message: 'repoUrl has an empty host' };
    }
    if (authority.includes('@')) {
        return { code: 'unsafe_source_url', message: 'repoUrl must not embed credentials (user@host)' };
    }
    return null;
}
function normalizeExplorerContract(value, diagnostics) {
    const contract = {
        mode: 'read_only',
        toolsAllowed: [...REPO_EXPLORER_DEFAULT_TOOLS_ALLOWED],
        toolsForbidden: [...REPO_EXPLORER_DEFAULT_TOOLS_FORBIDDEN],
    };
    if (value === undefined)
        return contract;
    if (!isPlainObject(value)) {
        diagnostics.push({
            severity: 'blocked',
            code: 'explorer_contract_invalid',
            path: '$.explorer',
            message: 'explorer must be an object when present',
        });
        return contract;
    }
    if (value['mode'] !== undefined && value['mode'] !== 'read_only') {
        diagnostics.push({
            severity: 'blocked',
            code: 'explorer_contract_invalid',
            path: '$.explorer.mode',
            message: "explorer.mode must be 'read_only'; any other exploration mode fails closed",
        });
    }
    for (const key of ['toolsAllowed', 'toolsForbidden']) {
        const list = value[key];
        if (list === undefined)
            continue;
        if (!Array.isArray(list) || list.some((tool) => !isNonEmptyString(tool))) {
            diagnostics.push({
                severity: 'blocked',
                code: 'explorer_contract_invalid',
                path: `$.explorer.${key}`,
                message: `explorer.${key} must be an array of non-empty strings when present`,
            });
            continue;
        }
        contract[key] = list.map((tool) => tool.trim());
    }
    for (const tool of contract.toolsAllowed) {
        if (READ_ONLY_VIOLATION_TOOL_PATTERN.test(tool)) {
            diagnostics.push({
                severity: 'blocked',
                code: 'explorer_contract_invalid',
                path: '$.explorer.toolsAllowed',
                message: `allowed tool '${tool}' contradicts the read-only explorer contract (write/execute/install/network-class tools are never allowed)`,
            });
        }
    }
    for (const key of ['maxFiles', 'lineWindow']) {
        const bound = value[key];
        if (bound === undefined)
            continue;
        if (typeof bound !== 'number' || !Number.isInteger(bound) || bound < 1) {
            diagnostics.push({
                severity: 'blocked',
                code: 'explorer_contract_invalid',
                path: `$.explorer.${key}`,
                message: `explorer.${key} must be a positive integer when present`,
            });
            continue;
        }
        contract[key] = bound;
    }
    return contract;
}
function normalizeExclusions(value, diagnostics) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value)) {
        diagnostics.push({
            severity: 'blocked',
            code: 'exclusion_entry_malformed',
            path: '$.exclusions',
            message: 'exclusions must be an array when present',
        });
        return [];
    }
    const exclusions = [];
    value.forEach((entry, index) => {
        if (!isPlainObject(entry)) {
            diagnostics.push({
                severity: 'blocked',
                code: 'exclusion_entry_malformed',
                path: `$.exclusions[${index}]`,
                message: 'exclusion entries must be objects with path and reason',
            });
            return;
        }
        const rawPath = isNonEmptyString(entry['path']) ? entry['path'].trim() : '';
        const normalizedPath = stripGlobSuffix(rawPath);
        const pathProblem = repoRelativePathProblem(normalizedPath);
        if (pathProblem !== null) {
            diagnostics.push({
                severity: 'blocked',
                code: 'exclusion_entry_malformed',
                path: `$.exclusions[${index}].path`,
                message: `exclusion path is not a safe repo-relative path: ${pathProblem.message}`,
            });
            return;
        }
        if (!isNonEmptyString(entry['reason'])) {
            diagnostics.push({
                severity: 'blocked',
                code: 'exclusion_entry_malformed',
                path: `$.exclusions[${index}].reason`,
                message: 'exclusion entries must carry a non-empty reason',
            });
            return;
        }
        let kind;
        if (entry['kind'] !== undefined) {
            if (EXCLUSION_KINDS.includes(entry['kind'])) {
                kind = entry['kind'];
            }
            else {
                diagnostics.push({
                    severity: 'warning',
                    code: 'exclusion_entry_malformed',
                    path: `$.exclusions[${index}].kind`,
                    message: `exclusion kind must be one of ${EXCLUSION_KINDS.join(', ')} when present; it was dropped`,
                });
            }
        }
        exclusions.push({
            path: normalizedPath,
            reason: entry['reason'].trim(),
            ...(kind === undefined ? {} : { kind }),
        });
    });
    return exclusions;
}
function normalizeEvidence(value, exclusions, explorer, diagnostics) {
    if (!Array.isArray(value) || value.length === 0) {
        diagnostics.push({
            severity: 'blocked',
            code: 'evidence_empty',
            path: '$.evidence',
            message: 'evidence must be a non-empty array — a manifest with no citations is not acceptable exploration evidence',
        });
        return [];
    }
    const entries = [];
    const seen = new Set();
    value.forEach((entry, index) => {
        if (!isPlainObject(entry)) {
            diagnostics.push({
                severity: 'blocked',
                code: 'evidence_entry_malformed',
                path: `$.evidence[${index}]`,
                message: 'evidence entries must be objects with path, lines, and reason',
            });
            return;
        }
        const pathProblem = repoRelativePathProblem(entry['path']);
        if (pathProblem !== null) {
            diagnostics.push({
                severity: 'blocked',
                code: pathProblem.code,
                path: `$.evidence[${index}].path`,
                message: pathProblem.message,
            });
            return;
        }
        const path = entry['path'].trim();
        const range = lineRangeProblem(entry['lines']);
        if (typeof range === 'string') {
            diagnostics.push({
                severity: 'blocked',
                code: 'invalid_line_range',
                path: `$.evidence[${index}].lines`,
                message: range,
            });
            return;
        }
        if (!isNonEmptyString(entry['reason'])) {
            diagnostics.push({
                severity: 'blocked',
                code: 'missing_relevance_reason',
                path: `$.evidence[${index}].reason`,
                message: 'every evidence entry must carry a short, non-empty relevance reason',
            });
            return;
        }
        const reason = entry['reason'].trim();
        if (reason.length > MAX_REASON_LENGTH) {
            diagnostics.push({
                severity: 'warning',
                code: 'relevance_reason_too_long',
                path: `$.evidence[${index}].reason`,
                message: `relevance reasons should be short (≤ ${MAX_REASON_LENGTH} characters); compact citations, not context dumps`,
            });
        }
        let matchedTerms = [];
        if (entry['matchedTerms'] !== undefined) {
            if (Array.isArray(entry['matchedTerms'])) {
                matchedTerms = entry['matchedTerms']
                    .filter((term) => isNonEmptyString(term))
                    .map((term) => term.trim());
                if (matchedTerms.length !== entry['matchedTerms'].length) {
                    diagnostics.push({
                        severity: 'warning',
                        code: 'evidence_entry_malformed',
                        path: `$.evidence[${index}].matchedTerms`,
                        message: 'non-string or empty matchedTerms entries were dropped',
                    });
                }
            }
            else {
                diagnostics.push({
                    severity: 'warning',
                    code: 'evidence_entry_malformed',
                    path: `$.evidence[${index}].matchedTerms`,
                    message: 'matchedTerms must be an array of non-empty strings when present; it was dropped',
                });
            }
        }
        // Excluded-path conflict: a manifest must not cite what it excludes.
        const conflicting = exclusions.find((exclusion) => path === exclusion.path || path.startsWith(`${exclusion.path}/`));
        if (conflicting !== undefined) {
            diagnostics.push({
                severity: 'blocked',
                code: 'excluded_path_cited',
                path: `$.evidence[${index}].path`,
                message: `evidence cites '${path}', which the manifest itself excludes ('${conflicting.path}': ${conflicting.reason}); a self-contradictory manifest fails closed`,
            });
            return;
        }
        // Generated/noisy citation: flagged, not silently accepted.
        const noisy = isGeneratedOrNoisyPath(path);
        if (noisy.noisy) {
            diagnostics.push({
                severity: 'warning',
                code: 'generated_path_cited',
                path: `$.evidence[${index}].path`,
                message: `evidence cites generated/noisy content ('${path}' matched '${noisy.matched}'); prefer source files — generated content is weak localization evidence`,
            });
        }
        const lines = range;
        if (explorer.lineWindow !== undefined && lines.end - lines.start + 1 > explorer.lineWindow) {
            diagnostics.push({
                severity: 'warning',
                code: 'line_window_exceeded',
                path: `$.evidence[${index}].lines`,
                message: `citation spans ${lines.end - lines.start + 1} lines, exceeding the declared explorer line window of ${explorer.lineWindow}`,
            });
        }
        const key = `${path}:${lines.start}-${lines.end}`;
        if (seen.has(key)) {
            diagnostics.push({
                severity: 'warning',
                code: 'duplicate_evidence_entry',
                path: `$.evidence[${index}]`,
                message: `duplicate citation '${key}' was kept but flagged`,
            });
        }
        seen.add(key);
        entries.push({
            path,
            lines,
            reason,
            matchedTerms,
            generatedOrNoisy: noisy.noisy,
        });
    });
    if (explorer.maxFiles !== undefined) {
        const distinctPaths = new Set(entries.map((entry) => entry.path));
        if (distinctPaths.size > explorer.maxFiles) {
            diagnostics.push({
                severity: 'warning',
                code: 'explorer_contract_invalid',
                path: '$.evidence',
                message: `evidence cites ${distinctPaths.size} distinct files, exceeding the declared explorer max_files bound of ${explorer.maxFiles}`,
            });
        }
    }
    return entries;
}
/** Returns the normalized range, or a blocking message string. */
function lineRangeProblem(value) {
    if (!isPlainObject(value)) {
        return 'lines must be an object with integer start and end';
    }
    const start = value['start'];
    const end = value['end'];
    if (typeof start !== 'number' || !Number.isInteger(start) || typeof end !== 'number' || !Number.isInteger(end)) {
        return 'line range start/end must be integers';
    }
    if (start < 1 || end < 1) {
        return 'line ranges are 1-based; zero or negative line numbers are not accepted';
    }
    if (end < start) {
        return `line range is reversed (start ${start} > end ${end})`;
    }
    return { start, end };
}
function normalizeOpenQuestions(value, diagnostics) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value)) {
        diagnostics.push({
            severity: 'warning',
            code: 'open_question_malformed',
            path: '$.openQuestions',
            message: 'openQuestions must be an array of non-empty strings when present; it was dropped',
        });
        return [];
    }
    const questions = [];
    value.forEach((question, index) => {
        if (isNonEmptyString(question)) {
            questions.push(question.trim());
        }
        else {
            diagnostics.push({
                severity: 'warning',
                code: 'open_question_malformed',
                path: `$.openQuestions[${index}]`,
                message: 'non-string or empty open question was dropped',
            });
        }
    });
    return questions;
}
function stripGlobSuffix(path) {
    if (path.endsWith('/**'))
        return path.slice(0, -3);
    if (path.endsWith('/*'))
        return path.slice(0, -2);
    return path;
}
function deriveManifestId(repoUrl, resolvedCommit) {
    const cleaned = repoUrl
        .replace(/^https:\/\//i, '')
        .replace(/[^A-Za-z0-9._/-]+/g, '-')
        .replace(/\/+$/, '');
    return `${cleaned}@${resolvedCommit.slice(0, 12)}`;
}
/* ────────────────────────────────────────────────────────────────────────────
 * #509/#575 snapshot bridge — attach explorer evidence as provenance by
 * reference (criterion 2: no full-repo ingest).
 *
 * `RepoExplorerSnapshotAttachment.source` is a STRUCTURAL match for the #575
 * `OnboardingIntakeSource` shape ({ sourceUrl?, snapshotRef, checkedCommit?,
 * crawlTimestamp }) so it can be dropped into a
 * `sourceKind: 'static-agent-stack-snapshot'` intake descriptor unchanged —
 * no import, per the self-contained module contract. The per-citation
 * `evidenceRefs` satisfy the #575 `OnboardingProvenancedField` rule that
 * `verified` provenance requires non-empty evidence refs.
 * ──────────────────────────────────────────────────────────────────────────── */
export const REPO_EXPLORER_SNAPSHOT_REF_PREFIX = 'repo-explorer-evidence:';
/** Stable by-reference snapshot ref for an accepted manifest. */
export function repoExplorerSnapshotRef(manifest) {
    return `${REPO_EXPLORER_SNAPSHOT_REF_PREFIX}${manifest.manifestId}`;
}
/**
 * Per-citation evidence refs (`repo-explorer-evidence:<id>#<path>:L<start>-L<end>`),
 * suitable as `evidenceRefs` on #575 provenanced fields.
 */
export function repoExplorerEvidenceRefs(manifest) {
    return manifest.evidence.map((entry) => `${REPO_EXPLORER_SNAPSHOT_REF_PREFIX}${manifest.manifestId}#${entry.path}:L${entry.lines.start}-L${entry.lines.end}`);
}
/**
 * Bridges an accepted report onto the #509/#575 `snapshotRef` surface.
 * Fail-closed: a blocked report (manifest null) can never become provenance.
 */
export function attachRepoExplorerEvidenceToSnapshot(report) {
    if (report.verdict === 'blocked' || report.manifest === null) {
        return { ok: false, reasonCode: 'manifest_blocked' };
    }
    const manifest = report.manifest;
    return {
        ok: true,
        attachment: {
            source: {
                sourceUrl: manifest.source.repoUrl,
                snapshotRef: repoExplorerSnapshotRef(manifest),
                checkedCommit: manifest.source.resolvedCommit,
                crawlTimestamp: manifest.generatedAt,
            },
            evidenceRefs: repoExplorerEvidenceRefs(manifest),
            sourceTrust: REPO_EXPLORER_SOURCE_TRUST,
            fullRepoIngested: false,
            staticOnly: true,
        },
    };
}
export function capabilityInventoryProjection(manifest) {
    return {
        provenance: {
            corpusId: manifest.manifestId,
            sourceUrl: manifest.source.repoUrl,
            checkedCommit: manifest.source.resolvedCommit,
        },
        contentTrustBoundary: 'untrusted_public_text',
        evidenceRefs: repoExplorerEvidenceRefs(manifest),
        localizationHints: manifest.evidence.map((entry) => ({
            sourcePath: entry.path,
            lines: { ...entry.lines },
            relevance: entry.reason,
        })),
    };
}
export function connectorDiagnosticsProjection(report) {
    return report.diagnostics.map((diag) => ({
        path: diag.path,
        diagnosticLane: 'repo_explorer_evidence',
        severity: diag.severity,
        warningCodes: [diag.code],
        blocksDraftPayload: diag.severity === 'blocked',
        operatorReviewRequired: diag.severity !== 'info',
        message: diag.message,
    }));
}
const EXECUTABLE_SUFFIXES = ['.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd'];
/** Ordered, deterministic risk classification rules — first match wins. */
const RISK_RULES = [
    {
        category: 'executable_hook',
        code: 'explorer_cited_executable_hook',
        matches: (path, basename) => path.startsWith('.github/workflows/') ||
            path.split('/').slice(0, -1).some((segment) => segment.toLowerCase() === 'hooks') ||
            (basename.startsWith('pre-') || basename.startsWith('post-')) &&
                EXECUTABLE_SUFFIXES.some((suffix) => basename.endsWith(suffix)),
    },
    {
        category: 'installer_or_update_script',
        code: 'explorer_cited_installer_script',
        matches: (_path, basename) => /(install|setup|update|bootstrap)/.test(basename) &&
            EXECUTABLE_SUFFIXES.some((suffix) => basename.endsWith(suffix)),
    },
    {
        category: 'deploy_capable_command',
        code: 'explorer_cited_deploy_surface',
        matches: (_path, basename, terms) => /deploy/.test(basename) || terms.includes('deploy'),
    },
    {
        category: 'wallet_rpc_capable_metadata',
        code: 'explorer_cited_wallet_rpc_surface',
        matches: (path, _basename, terms) => /(wallet|keypair|private[_-]?key)/.test(path.toLowerCase()) ||
            terms.some((term) => ['wallet', 'rpc', 'private_key', 'keypair'].includes(term)),
    },
    {
        category: 'env_required_connector',
        code: 'explorer_cited_env_requirement',
        matches: (_path, basename, terms) => basename === '.env' || basename.startsWith('.env.') || terms.includes('env'),
    },
    {
        category: 'mcp_launcher_execution',
        code: 'explorer_cited_mcp_launcher',
        matches: (path) => /(^|\/)\.?mcp[^/]*\.json$/i.test(path),
    },
    {
        category: 'external_submodule',
        code: 'explorer_cited_external_submodule',
        matches: (_path, basename) => basename === '.gitmodules',
    },
    {
        category: 'permission_policy',
        code: 'explorer_cited_permission_policy',
        matches: (_path, basename) => /(permission|policy)/.test(basename),
    },
];
/**
 * Deterministic risk-taxonomy projection over cited evidence paths and
 * matched terms. Localization evidence FLAGS risk for operator review — it
 * never auto-blocks (severity `warning`, `blocksDraftPayload: false`),
 * because citing a risky file is observation, not adoption.
 */
export function riskTaxonomyProjection(manifest) {
    const projections = [];
    for (const entry of manifest.evidence) {
        const basename = (entry.path.split('/').pop() ?? '').toLowerCase();
        const terms = entry.matchedTerms.map((term) => term.toLowerCase());
        const rule = RISK_RULES.find((candidate) => candidate.matches(entry.path, basename, terms));
        if (rule === undefined)
            continue;
        projections.push({
            path: entry.path,
            diagnosticLane: 'static_fixture_risk_taxonomy',
            category: rule.category,
            severity: 'warning',
            warningCodes: [rule.code],
            blocksDraftPayload: false,
            operatorReviewRequired: true,
            message: `explorer evidence cites '${entry.path}' (${rule.category}); static risk review required before any adoption decision`,
        });
    }
    return projections;
}
export function draftReadinessProjection(report) {
    if (report.verdict === 'blocked' || report.manifest === null) {
        return {
            status: 'blocked',
            blockers: report.diagnostics
                .filter((diag) => diag.severity === 'blocked')
                .map((diag) => diag.code),
            payloadRefs: [],
        };
    }
    return {
        status: 'needs_review',
        blockers: [],
        payloadRefs: [repoExplorerSnapshotRef(report.manifest), ...repoExplorerEvidenceRefs(report.manifest)],
    };
}
export function operatorReviewProjection(report) {
    const manifest = report.manifest;
    const status = report.verdict === 'blocked' ? 'rejected' : report.verdict === 'warning' ? 'request_changes' : 'approve_ready';
    const reviewItems = report.diagnostics.map((diag, index) => ({
        id: `repo-explorer-review-item-${index}`,
        severity: diag.severity,
        path: diag.path,
        source: 'repo_explorer_evidence',
        reasonCodes: [diag.code],
        message: diag.message,
        blocksPublication: diag.severity === 'blocked',
        recommendedAction: diag.severity === 'blocked'
            ? 'review_unsafe_metadata'
            : diag.severity === 'warning'
                ? 'review_static_risk'
                : 'approve_after_readiness_gates',
    }));
    return {
        reviewId: manifest === null ? 'repo-explorer-review:blocked' : `repo-explorer-review:${manifest.manifestId}`,
        status,
        source: {
            sourceUrl: manifest === null ? null : manifest.source.repoUrl,
            checkedCommit: manifest === null ? null : manifest.source.resolvedCommit,
            sourceAuthenticity: 'source_snapshot_recorded',
            providerTrust: 'unverified',
            importedContentTrust: 'untrusted',
        },
        publication: {
            disabled: true,
            requiresOperatorApproval: true,
        },
        reviewItems,
        rawSnapshotRefs: manifest === null ? [] : [repoExplorerSnapshotRef(manifest)],
    };
}
export function projectRepoExplorerEvidence(report) {
    const attachment = attachRepoExplorerEvidenceToSnapshot(report);
    return {
        snapshotAttachment: attachment.ok ? attachment.attachment : null,
        capabilityInventory: report.manifest === null ? null : capabilityInventoryProjection(report.manifest),
        connectorDiagnostics: connectorDiagnosticsProjection(report),
        riskTaxonomy: report.manifest === null ? [] : riskTaxonomyProjection(report.manifest),
        draftReadiness: draftReadinessProjection(report),
        operatorReview: operatorReviewProjection(report),
    };
}
/* ────────────────────────────────────────────────────────────────────────────
 * Canonical fixtures (in-memory, offline). All content is DATA and must never
 * be treated as instructions. `example.invalid` hosts guarantee nothing here
 * is fetchable even by mistake.
 * ──────────────────────────────────────────────────────────────────────────── */
const FIXTURE_COMMIT = 'a3f18c9d02e14b76a3f18c9d02e14b76a3f18c9d';
export const repoExplorerEvidenceManifestFixtures = {
    /** Fully accepted manifest: https source, resolved SHA, bounded read-only contract. */
    happyPath: {
        manifestId: 'example-agent-stack@a3f18c9d02e1',
        generatedAt: '2026-07-06T00:00:00Z',
        source: {
            repoUrl: 'https://example.invalid/orgs/example/agent-stack',
            resolvedCommit: FIXTURE_COMMIT,
            defaultBranch: 'main',
        },
        sourceTrust: 'external_untrusted',
        explorationQuery: 'Where does this agent stack declare MCP connectors and their auth requirements?',
        explorer: {
            mode: 'read_only',
            maxFiles: 20,
            lineWindow: 120,
        },
        evidence: [
            {
                path: 'README.md',
                lines: { start: 1, end: 32 },
                reason: 'Top-level description of the agent stack and its connector list.',
                matchedTerms: ['mcp', 'connector'],
            },
            {
                path: 'src/connectors/registry.ts',
                lines: { start: 44, end: 71 },
                reason: 'Connector registry declaring auth requirements per connector.',
                matchedTerms: ['auth'],
            },
            {
                path: 'docs/configuration.md',
                lines: { start: 10, end: 25 },
                reason: 'Documents required environment configuration for connectors.',
            },
        ],
        exclusions: [
            { path: 'node_modules/**', reason: 'vendored dependencies', kind: 'generated' },
            { path: 'dist/**', reason: 'build output', kind: 'generated' },
        ],
        openQuestions: ['Which connector versions are pinned at this commit?'],
    },
    /** `..` traversal in a citation path — blocked. */
    pathTraversal: {
        generatedAt: '2026-07-06T00:00:00Z',
        source: { repoUrl: 'https://example.invalid/orgs/example/agent-stack', resolvedCommit: FIXTURE_COMMIT },
        explorationQuery: 'traversal fixture',
        evidence: [
            { path: '../../etc/passwd', lines: { start: 1, end: 2 }, reason: 'traversal attempt' },
        ],
    },
    /** Absolute citation path — blocked. */
    absolutePath: {
        generatedAt: '2026-07-06T00:00:00Z',
        source: { repoUrl: 'https://example.invalid/orgs/example/agent-stack', resolvedCommit: FIXTURE_COMMIT },
        explorationQuery: 'absolute path fixture',
        evidence: [{ path: '/etc/passwd', lines: { start: 1, end: 2 }, reason: 'absolute path attempt' }],
    },
    /** `file://` URI citation path — blocked. */
    fileUriPath: {
        generatedAt: '2026-07-06T00:00:00Z',
        source: { repoUrl: 'https://example.invalid/orgs/example/agent-stack', resolvedCommit: FIXTURE_COMMIT },
        explorationQuery: 'file uri fixture',
        evidence: [
            { path: 'file:///etc/passwd', lines: { start: 1, end: 2 }, reason: 'file URI attempt' },
        ],
    },
    /** Reversed line range — blocked. */
    reversedLineRange: {
        generatedAt: '2026-07-06T00:00:00Z',
        source: { repoUrl: 'https://example.invalid/orgs/example/agent-stack', resolvedCommit: FIXTURE_COMMIT },
        explorationQuery: 'reversed range fixture',
        evidence: [{ path: 'src/index.ts', lines: { start: 40, end: 12 }, reason: 'reversed range' }],
    },
    /** Zero/negative line numbers — blocked. */
    nonPositiveLineRange: {
        generatedAt: '2026-07-06T00:00:00Z',
        source: { repoUrl: 'https://example.invalid/orgs/example/agent-stack', resolvedCommit: FIXTURE_COMMIT },
        explorationQuery: 'non-positive range fixture',
        evidence: [
            { path: 'src/index.ts', lines: { start: 0, end: 4 }, reason: 'zero start' },
            { path: 'src/other.ts', lines: { start: -3, end: 4 }, reason: 'negative start' },
        ],
    },
    /** No citations at all — blocked. */
    emptyEvidence: {
        generatedAt: '2026-07-06T00:00:00Z',
        source: { repoUrl: 'https://example.invalid/orgs/example/agent-stack', resolvedCommit: FIXTURE_COMMIT },
        explorationQuery: 'empty evidence fixture',
        evidence: [],
    },
    /** Citation into default generated/noisy content — accepted with warning. */
    generatedNoisyCitation: {
        generatedAt: '2026-07-06T00:00:00Z',
        source: { repoUrl: 'https://example.invalid/orgs/example/agent-stack', resolvedCommit: FIXTURE_COMMIT },
        explorationQuery: 'noisy citation fixture',
        evidence: [
            {
                path: 'node_modules/left-pad/index.js',
                lines: { start: 1, end: 5 },
                reason: 'vendored dependency content',
            },
            { path: 'src/index.ts', lines: { start: 1, end: 5 }, reason: 'real source citation' },
        ],
    },
    /** Manifest cites a path it also excludes — blocked (self-contradictory). */
    excludedPathCited: {
        generatedAt: '2026-07-06T00:00:00Z',
        source: { repoUrl: 'https://example.invalid/orgs/example/agent-stack', resolvedCommit: FIXTURE_COMMIT },
        explorationQuery: 'excluded citation fixture',
        explorer: { mode: 'read_only' },
        evidence: [
            { path: 'generated/api-client.ts', lines: { start: 3, end: 9 }, reason: 'cites excluded content' },
        ],
        exclusions: [{ path: 'generated/**', reason: 'generated API clients', kind: 'generated' }],
    },
    /** Missing relevance reason — blocked. */
    missingRelevanceReason: {
        generatedAt: '2026-07-06T00:00:00Z',
        source: { repoUrl: 'https://example.invalid/orgs/example/agent-stack', resolvedCommit: FIXTURE_COMMIT },
        explorationQuery: 'missing reason fixture',
        evidence: [{ path: 'src/index.ts', lines: { start: 1, end: 4 }, reason: '   ' }],
    },
    /** Self-asserted higher trust level — blocked. */
    trustBoundaryViolation: {
        generatedAt: '2026-07-06T00:00:00Z',
        source: { repoUrl: 'https://example.invalid/orgs/example/agent-stack', resolvedCommit: FIXTURE_COMMIT },
        sourceTrust: 'trusted_internal',
        explorationQuery: 'trust violation fixture',
        evidence: [{ path: 'src/index.ts', lines: { start: 1, end: 4 }, reason: 'citation' }],
    },
    /** Non-read-only explorer mode — blocked. */
    nonReadOnlyExplorer: {
        generatedAt: '2026-07-06T00:00:00Z',
        source: { repoUrl: 'https://example.invalid/orgs/example/agent-stack', resolvedCommit: FIXTURE_COMMIT },
        explorationQuery: 'mode violation fixture',
        explorer: { mode: 'read_write' },
        evidence: [{ path: 'src/index.ts', lines: { start: 1, end: 4 }, reason: 'citation' }],
    },
    /** Branch name instead of a resolved commit SHA — blocked. */
    unresolvedCommit: {
        generatedAt: '2026-07-06T00:00:00Z',
        source: { repoUrl: 'https://example.invalid/orgs/example/agent-stack', resolvedCommit: 'main' },
        explorationQuery: 'unresolved commit fixture',
        evidence: [{ path: 'src/index.ts', lines: { start: 1, end: 4 }, reason: 'citation' }],
    },
    /** Non-https source URL — blocked. */
    unsafeSourceUrl: {
        generatedAt: '2026-07-06T00:00:00Z',
        source: { repoUrl: 'file:///Users/someone/agent-stack', resolvedCommit: FIXTURE_COMMIT },
        explorationQuery: 'unsafe source url fixture',
        evidence: [{ path: 'src/index.ts', lines: { start: 1, end: 4 }, reason: 'citation' }],
    },
    /** Risky cited surfaces for the #421 risk-taxonomy projection. */
    riskyEvidence: {
        generatedAt: '2026-07-06T00:00:00Z',
        source: { repoUrl: 'https://example.invalid/orgs/example/agent-stack', resolvedCommit: FIXTURE_COMMIT },
        explorationQuery: 'risk surface fixture',
        evidence: [
            {
                path: '.github/workflows/deploy.yml',
                lines: { start: 1, end: 18 },
                reason: 'CI workflow with deploy step',
            },
            {
                path: 'scripts/install.sh',
                lines: { start: 1, end: 12 },
                reason: 'installer script cited for review',
            },
            {
                path: 'src/payments/signer.ts',
                lines: { start: 5, end: 20 },
                reason: 'wallet signing surface',
                matchedTerms: ['wallet', 'rpc'],
            },
            {
                path: 'connectors/mcp.config.json',
                lines: { start: 1, end: 9 },
                reason: 'MCP launcher configuration',
                matchedTerms: ['mcp'],
            },
        ],
    },
};
/* ────────────────────────────────────────────────────────────────────────────
 * Shared helpers
 * ──────────────────────────────────────────────────────────────────────────── */
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
