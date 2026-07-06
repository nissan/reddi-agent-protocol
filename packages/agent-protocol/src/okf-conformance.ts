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

import {
  adaptOpenKbBundleToOkf,
  type OkfAdapterBundle,
  type OkfDiagnostic,
  type OkfDocument,
  type OkfDocumentRole,
  type OkfIndex,
  type OkfLog,
  type OkfProvenance,
  type OkfTrustClassification,
  type OpenKbDocumentInput,
} from './okf-adapter.js';

export const OKF_CONFORMANCE_SCHEMA_VERSION = 'reddi.okf-conformance.v1' as const;

/** The OKF semantics this module enforces are unverified against the live external spec. */
export const OKF_CONFORMANCE_IS_DRAFT = true as const;

/** Severity vocabulary — aligned with the repo's static-analysis severity vocab
 * (`agent-stack-fixtures.ts` and `okf-adapter.ts` both use info/warning/blocked). */
export type OkfConformanceSeverity = 'info' | 'warning' | 'blocked';

/** Deterministic conformance diagnostic codes. Reuses the #511 adapter reason-code
 * vocabulary wherever one exists; adds only index/log expectation codes. */
export type OkfConformanceCode =
  | 'malformed_frontmatter'
  | 'concept_type_missing'
  | 'unsupported_link_syntax'
  | 'missing_provenance'
  | 'unknown_frontmatter_preserved'
  | 'generated_instruction_untrusted'
  | 'execution_not_allowed'
  | 'index_missing'
  | 'log_missing'
  | 'index_semantics_normalized'
  | 'log_semantics_normalized'
  | 'bundle_malformed'
  | 'document_malformed'
  | 'operation_not_permitted';

/**
 * Per-document conformance status — the #504 acceptance-criteria vocabulary:
 * valid, warning, blocked, untrusted_generated_instruction,
 * unsupported_link_syntax, missing_provenance, malformed_frontmatter,
 * execution_not_allowed. The named statuses surface the dominant finding;
 * `valid`/`warning`/`blocked` are the fallbacks by max severity.
 */
export type OkfConformanceStatus =
  | 'valid'
  | 'warning'
  | 'blocked'
  | 'untrusted_generated_instruction'
  | 'unsupported_link_syntax'
  | 'missing_provenance'
  | 'malformed_frontmatter'
  | 'execution_not_allowed';

/** Bundle-level verdict. Even `valid` permits review/analysis only. */
export type OkfConformanceVerdict = 'valid' | 'warning' | 'blocked';

/**
 * Explicit unsafe/generated-instruction artifact classes for producer-toolchain
 * output (AGENTS.md, SKILL.md, prompts, scripts, skills, tools, agent
 * definitions). Mirrors the #503 corpus `generatedArtifacts[].artifactKind`
 * vocabulary (`agent_definition`, `skill_definition`, `script`).
 */
export type OkfGeneratedArtifactClass =
  | 'agent_definition'
  | 'skill_definition'
  | 'prompt'
  | 'script'
  | 'tool'
  | 'generated_instruction_other';

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
export const OKF_CONFORMANCE_PERMITTED_USE = [
  'static_review',
  'static_analysis',
  'operator_review_payload',
  'conformance_reporting',
] as const;

export const OKF_CONFORMANCE_DENIED_USE = [
  'skill_installation',
  'agent_registration',
  'agent_onboarding',
  'marketplace_publication',
  'hosted_registry_write',
  'llm_or_provider_call',
  'script_or_tool_execution',
  'url_ingestion',
  'payment_activation',
  'trust_or_reputation_mutation',
] as const;

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

/* ────────────────────────────────────────────────────────────────────────────
 * #503 fixture-corpus bridge
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Maps the #503 corpus `expectedDiagnostics[].code` vocabulary onto the
 * conformance code vocabulary (which follows the #511 adapter reason codes).
 */
export const OKF_FIXTURE_DIAGNOSTIC_CODE_MAP = {
  unsupported_wikilink_syntax: 'unsupported_link_syntax',
  generated_instruction_untrusted: 'generated_instruction_untrusted',
  generated_skill_untrusted: 'generated_instruction_untrusted',
  script_execution_not_allowed: 'execution_not_allowed',
} as const satisfies Record<string, OkfConformanceCode>;

/** Maps #503 corpus `expectedDiagnostics[].severity` onto acceptable conformance severities. */
export const OKF_FIXTURE_DIAGNOSTIC_SEVERITY_MAP: Record<string, readonly OkfConformanceSeverity[]> = {
  review: ['info', 'warning'],
  blocking: ['blocked'],
};

/**
 * Builds a conformance bundle input from one fixture of the #503 corpus
 * (`reddi.okf-openkb-fixture-corpus.v1`). Read-only over the fixture object:
 * file previews are consumed as static text and never mutated, so the
 * fixture's `contentSha256` digests are preserved. Fail-closed: a fixture that
 * does not carry a usable `files` array yields an empty-documents input, which
 * `runOkfConformanceDiagnostics` blocks as `bundle_malformed`.
 */
export function conformanceInputFromOkfOpenKbFixture(fixture: unknown): OkfConformanceBundleInput {
  if (!isPlainObject(fixture)) {
    return { documents: [] };
  }
  const bundleId = isNonEmptyString(fixture['id']) ? (fixture['id'] as string) : undefined;
  const source = isPlainObject(fixture['source']) ? (fixture['source'] as Record<string, unknown>) : {};
  const provenance: OkfProvenance = {};
  if (isNonEmptyString(source['sourceUrl'])) provenance.sourceUri = source['sourceUrl'] as string;
  if (isNonEmptyString(source['retrievedAt'])) provenance.retrievedAt = source['retrievedAt'] as string;

  const files = fixture['files'];
  if (!Array.isArray(files)) {
    return bundleId === undefined ? { documents: [] } : { bundleId, documents: [] };
  }

  const documents: OkfConformanceDocumentInput[] = [];
  for (const file of files) {
    if (!isPlainObject(file) || !isNonEmptyString(file['path'])) continue;
    const doc: OkfConformanceDocumentInput = {
      path: (file['path'] as string).trim(),
      source: typeof file['contentPreview'] === 'string' ? (file['contentPreview'] as string) : '',
    };
    if (provenance.sourceUri !== undefined) {
      doc.provenance = { ...provenance };
    }
    documents.push(doc);
  }
  return bundleId === undefined ? { documents } : { bundleId, documents };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Raw-source parsing (YAML frontmatter fence + conservative YAML subset)
 * ──────────────────────────────────────────────────────────────────────────── */

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
export function parseOkfDocumentSource(documentId: string, source: string): OkfParsedDocumentSource {
  const lines = source.split(/\r?\n/);
  if ((lines[0] ?? '').trim() !== '---') {
    return { frontmatter: undefined, body: source, diagnostics: [] };
  }

  let closing = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      closing = i;
      break;
    }
  }

  if (closing === -1) {
    return {
      frontmatter: undefined,
      body: source,
      diagnostics: [
        {
          severity: 'warning',
          code: 'malformed_frontmatter',
          documentId,
          summary: `${documentId} opens a YAML frontmatter fence that never closes; the whole document was treated as body (fail-closed).`,
          action: 'Close the frontmatter fence with a `---` line.',
        },
      ],
    };
  }

  const { frontmatter, diagnostics } = parseYamlSubset(lines.slice(1, closing), documentId);
  let bodyStart = closing + 1;
  if (lines[bodyStart] !== undefined && lines[bodyStart].trim() === '') bodyStart += 1;
  return { frontmatter, body: lines.slice(bodyStart).join('\n'), diagnostics };
}

function parseYamlSubset(
  lines: string[],
  documentId: string,
): { frontmatter: Record<string, unknown>; diagnostics: OkfConformanceDiagnostic[] } {
  const frontmatter: Record<string, unknown> = {};
  const diagnostics: OkfConformanceDiagnostic[] = [];
  const keyPattern = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/;
  const listItemPattern = /^\s+-\s+(.*)$/;
  let currentListKey: string | null = null;

  for (const line of lines) {
    if (line.trim().length === 0) continue;
    if (/^\s*#/.test(line)) continue;

    const listMatch = listItemPattern.exec(line);
    if (listMatch !== null && currentListKey !== null) {
      const existing = frontmatter[currentListKey];
      const list = Array.isArray(existing) ? existing : [];
      list.push(coerceScalar(listMatch[1].trim()));
      frontmatter[currentListKey] = list;
      continue;
    }

    const keyMatch = keyPattern.exec(line);
    if (keyMatch === null) {
      currentListKey = null;
      diagnostics.push({
        severity: 'warning',
        code: 'malformed_frontmatter',
        documentId,
        summary: `${documentId} has an unparseable YAML frontmatter line; it was skipped (fail-closed).`,
        action: 'Use `key: value` scalars or `key:` with indented `- item` list lines.',
      });
      continue;
    }

    const key = keyMatch[1];
    const value = keyMatch[2].trim();
    if (value.length === 0) {
      frontmatter[key] = null;
      currentListKey = key;
    } else {
      frontmatter[key] = coerceScalar(value);
      currentListKey = null;
    }
  }

  return { frontmatter, diagnostics };
}

function coerceScalar(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+$/.test(value)) return Number(value);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Conformance run
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Runs deterministic OKF/OpenKB conformance diagnostics over an in-memory
 * bundle. Pure static analysis: delegates document projection to the #511
 * adapter, then layers the #504 conformance vocabulary (statuses, escalated
 * generated-instruction severities, adaptable-wikilink reporting, index/log
 * expectations, review-only boundary) on top.
 */
export function runOkfConformanceDiagnostics(
  input: unknown,
  options: OkfConformanceOptions = {},
): OkfConformanceReport {
  // Preprocess raw `source` documents into the adapter's input shape, collecting
  // deterministic frontmatter-parse diagnostics per document id.
  const sourceDiagnostics = new Map<string, OkfConformanceDiagnostic[]>();
  const adapterInput = preprocessInput(input, sourceDiagnostics);

  const adapterBundle = adaptOpenKbBundleToOkf(adapterInput, {
    requireProvenance: options.requireProvenance,
    execute: options.execute,
    install: options.install,
    ingestUrl: options.ingestUrl,
    invokeLlm: options.invokeLlm,
    generateSkill: options.generateSkill,
  });

  const bundleDiagnostics: OkfConformanceDiagnostic[] = [];

  // Bundle-level adapter diagnostics (no documentId): malformed bundle/documents,
  // refused operations. All are blocking for conformance.
  for (const diag of adapterBundle.diagnostics) {
    if (diag.documentId !== undefined) continue;
    bundleDiagnostics.push({
      severity: 'blocked',
      code: toConformanceCode(diag),
      summary: diag.summary,
      ...(diag.action === undefined ? {} : { action: diag.action }),
    });
  }

  const documents = adapterBundle.documents.map((doc) =>
    buildDocumentReport(doc, sourceDiagnostics.get(doc.id) ?? []),
  );

  // index.md / log.md semantics where applicable.
  bundleDiagnostics.push(...indexLogDiagnostics(adapterBundle, options));

  const allDiagnostics = [
    ...bundleDiagnostics,
    ...documents.flatMap((doc) => doc.diagnostics),
  ];

  const verdict = verdictOf(allDiagnostics, adapterBundle);

  return {
    schemaVersion: OKF_CONFORMANCE_SCHEMA_VERSION,
    draft: true,
    verdict,
    bundleId: adapterBundle.bundleId,
    documents,
    diagnostics: allDiagnostics,
    codes: [...new Set(allDiagnostics.map((diag) => diag.code))],
    index: adapterBundle.index,
    log: adapterBundle.log,
    reviewBoundary: {
      permittedUse: OKF_CONFORMANCE_PERMITTED_USE,
      deniedUse: OKF_CONFORMANCE_DENIED_USE,
    },
    guardrails: {
      network: false,
      fileSystemRead: false,
      executed: false,
      installed: false,
      urlIngested: false,
      llmInvoked: false,
      mcpInvoked: false,
      skillInstalled: false,
      agentRegistered: false,
      hostedWrite: false,
      marketplacePublished: false,
      paymentActivated: false,
      trustMutated: false,
      instructionsTrusted: false,
    },
    notes: [
      'DRAFT/unverified — OKF semantics (concept `type`, index/log, standard-markdown links) are not confirmed against the live external spec.',
      'REVIEW-ONLY: a valid verdict permits static review/analysis only — never skill installation, agent registration, marketplace publication, hosted writes, LLM/provider calls, or execution.',
      'Generated AGENTS.md/SKILL.md/prompts/scripts/skills/tools/agent definitions are untrusted review artifacts regardless of verdict.',
      'Unknown frontmatter fields are preserved verbatim as untrusted review metadata, never policy/runtime configuration.',
    ],
  };
}

function preprocessInput(
  input: unknown,
  sourceDiagnostics: Map<string, OkfConformanceDiagnostic[]>,
): unknown {
  if (!isPlainObject(input)) return input;
  const documents = (input as { documents?: unknown }).documents;
  if (!Array.isArray(documents)) return input;

  const adapted: unknown[] = documents.map((doc) => {
    if (!isPlainObject(doc)) return doc;
    const path = doc['path'];
    const source = doc['source'];
    if (!isNonEmptyString(path) || typeof source !== 'string') return doc;

    const documentId = (path as string).trim();
    const parsed = parseOkfDocumentSource(documentId, source);
    if (parsed.diagnostics.length > 0) {
      sourceDiagnostics.set(documentId, [
        ...(sourceDiagnostics.get(documentId) ?? []),
        ...parsed.diagnostics,
      ]);
    }

    const out: Record<string, unknown> = { ...doc, path: documentId, body: parsed.body };
    delete out['source'];
    delete out['rawFrontmatter'];
    if (parsed.frontmatter !== undefined) {
      out['frontmatter'] = parsed.frontmatter;
    } else {
      delete out['frontmatter'];
    }
    return out;
  });

  const bundleId = (input as { bundleId?: unknown }).bundleId;
  return isNonEmptyString(bundleId) ? { bundleId, documents: adapted } : { documents: adapted };
}

function buildDocumentReport(
  doc: OkfDocument,
  parseDiagnostics: OkfConformanceDiagnostic[],
): OkfConformanceDocumentReport {
  const artifactClass = doc.trustClassification === 'untrusted_generated_instruction'
    ? classifyGeneratedArtifact(doc)
    : null;

  const diagnostics: OkfConformanceDiagnostic[] = [...parseDiagnostics];

  for (const diag of doc.diagnostics) {
    diagnostics.push(mapDocumentDiagnostic(diag, doc, artifactClass));
  }

  // Deterministically-adaptable wikilinks: OKF requires standard markdown links
  // (DRAFT/unverified — OKF, confirm requirement); the #511 adapter already
  // converted these, so they are reported as adaptable info-level findings.
  const wikilinkCount = doc.links.filter((link) => link.origin === 'wikilink').length;
  if (wikilinkCount > 0) {
    diagnostics.push({
      severity: 'info',
      code: 'unsupported_link_syntax',
      documentId: doc.id,
      adaptable: true,
      summary: `${doc.id} used ${wikilinkCount} OpenKB wikilink(s); each was deterministically adapted to a standard markdown link and is reported here.`,
      action: 'Prefer standard markdown links at the source; deterministic adaptation is available via the #511 adapter.',
    });
  }

  return {
    documentId: doc.id,
    documentRole: doc.documentRole,
    trustClassification: doc.trustClassification,
    artifactClass,
    status: statusOf(diagnostics),
    diagnostics,
  };
}

function mapDocumentDiagnostic(
  diag: OkfDiagnostic,
  doc: OkfDocument,
  artifactClass: OkfGeneratedArtifactClass | null,
): OkfConformanceDiagnostic {
  const base: OkfConformanceDiagnostic = {
    severity: diag.severity,
    code: toConformanceCode(diag),
    documentId: doc.id,
    summary: diag.summary,
    ...(diag.action === undefined ? {} : { action: diag.action }),
  };

  switch (diag.code) {
    case 'generated_instruction_untrusted':
      // Conformance escalates generated-instruction findings to blocked: the
      // artifact is quarantined from any use beyond static review (matches the
      // #503 corpus `blocking` expectation).
      return {
        ...base,
        severity: 'blocked',
        ...(artifactClass === null ? {} : { artifactClass }),
      };
    case 'execution_not_allowed':
      return {
        ...base,
        severity: 'blocked',
        ...(artifactClass === null ? {} : { artifactClass }),
      };
    case 'unsupported_link_syntax':
      // Adapter-level link diagnostics are the NON-deterministic cases (embeds,
      // heading/block refs, empty targets) — not adaptable.
      return { ...base, severity: 'warning', adaptable: false };
    default:
      return base;
  }
}

function toConformanceCode(diag: OkfDiagnostic): OkfConformanceCode {
  switch (diag.code) {
    case 'bundle_malformed':
      return 'bundle_malformed';
    case 'document_malformed':
      return 'document_malformed';
    case 'operation_not_permitted':
      return 'operation_not_permitted';
    case 'unsupported_link_syntax':
      return 'unsupported_link_syntax';
    case 'malformed_frontmatter':
      return 'malformed_frontmatter';
    case 'missing_provenance':
      return 'missing_provenance';
    case 'generated_instruction_untrusted':
      return 'generated_instruction_untrusted';
    case 'execution_not_allowed':
      return 'execution_not_allowed';
    case 'concept_type_missing':
      return 'concept_type_missing';
    case 'unknown_frontmatter_preserved':
      return 'unknown_frontmatter_preserved';
    default:
      // Any future adapter code without a conformance mapping is treated as a
      // malformed-document finding (fail-closed rather than silently dropped).
      return 'document_malformed';
  }
}

/** Directory segments / basenames / extensions mirror the #511 adapter's
 * instruction-artifact classification vocabulary. */
const ARTIFACT_EXECUTABLE_EXTENSIONS = new Set(['sh', 'bash', 'zsh', 'js', 'mjs', 'cjs', 'ts', 'py', 'rb', 'ps1', 'bat', 'cmd']);

function classifyGeneratedArtifact(doc: OkfDocument): OkfGeneratedArtifactClass {
  const basename = doc.id.split('/').pop()?.toLowerCase() ?? doc.id.toLowerCase();
  if (basename === 'agents.md') return 'agent_definition';
  if (basename === 'skill.md' || basename === 'skills.md') return 'skill_definition';

  const dirs = doc.id.split('/').slice(0, -1).map((segment) => segment.toLowerCase());
  if (dirs.includes('prompts')) return 'prompt';
  if (dirs.includes('scripts')) return 'script';
  if (dirs.includes('tools')) return 'tool';
  if (dirs.includes('agents')) return 'agent_definition';
  if (dirs.includes('skills')) return 'skill_definition';

  const fmType = typeof doc.frontmatter['type'] === 'string'
    ? (doc.frontmatter['type'] as string).toLowerCase()
    : '';
  if (fmType === 'agent') return 'agent_definition';
  if (fmType === 'skill') return 'skill_definition';
  if (fmType === 'prompt') return 'prompt';
  if (fmType === 'tool') return 'tool';

  const dot = basename.lastIndexOf('.');
  const extension = dot > 0 && dot < basename.length - 1 ? basename.slice(dot + 1) : '';
  if (ARTIFACT_EXECUTABLE_EXTENSIONS.has(extension)) return 'script';

  return 'generated_instruction_other';
}

function indexLogDiagnostics(
  bundle: OkfAdapterBundle,
  options: OkfConformanceOptions,
): OkfConformanceDiagnostic[] {
  const diagnostics: OkfConformanceDiagnostic[] = [];

  if (bundle.index !== null) {
    diagnostics.push({
      severity: 'info',
      code: 'index_semantics_normalized',
      documentId: bundle.index.documentId,
      summary: `index.md normalized: ${bundle.index.entries.length} table-of-contents entr(y/ies); not trusted routing/policy.`,
    });
  } else if (options.expectIndex === true) {
    diagnostics.push({
      severity: 'warning',
      code: 'index_missing',
      summary: 'Bundle was expected to carry an `index.md` but none was found.',
      action: 'Add an `index.md` table of contents, or drop the expectation for this bundle.',
    });
  }

  if (bundle.log !== null) {
    diagnostics.push({
      severity: 'info',
      code: 'log_semantics_normalized',
      documentId: bundle.log.documentId,
      summary: `log.md normalized: ${bundle.log.entryCount} append-only entr(y/ies); recorded, not trusted as runtime state.`,
    });
  } else if (options.expectLog === true) {
    diagnostics.push({
      severity: 'warning',
      code: 'log_missing',
      summary: 'Bundle was expected to carry a `log.md` but none was found.',
      action: 'Add a `log.md` change record, or drop the expectation for this bundle.',
    });
  }

  return diagnostics;
}

/** Named-status priority per the #504 acceptance vocabulary. */
function statusOf(diagnostics: OkfConformanceDiagnostic[]): OkfConformanceStatus {
  const warningPlus = diagnostics.filter((diag) => diag.severity !== 'info');
  const has = (code: OkfConformanceCode): boolean => warningPlus.some((diag) => diag.code === code);

  if (has('execution_not_allowed')) return 'execution_not_allowed';
  if (has('generated_instruction_untrusted')) return 'untrusted_generated_instruction';
  if (warningPlus.some((diag) => diag.severity === 'blocked')) return 'blocked';
  if (has('malformed_frontmatter')) return 'malformed_frontmatter';
  if (has('missing_provenance')) return 'missing_provenance';
  if (has('unsupported_link_syntax')) return 'unsupported_link_syntax';
  if (warningPlus.length > 0) return 'warning';
  return 'valid';
}

function verdictOf(
  diagnostics: OkfConformanceDiagnostic[],
  adapterBundle: OkfAdapterBundle,
): OkfConformanceVerdict {
  if (adapterBundle.adapterIntent === 'blocked') return 'blocked';
  if (diagnostics.some((diag) => diag.severity === 'blocked')) return 'blocked';
  if (diagnostics.some((diag) => diag.severity === 'warning')) return 'warning';
  return 'valid';
}

/* ────────────────────────────────────────────────────────────────────────────
 * Canonical conformance fixtures (in-memory, offline).
 *
 * These extend the #503 corpus coverage with the cases the corpus does not
 * model directly (valid OKF with standard markdown links, missing provenance,
 * malformed frontmatter) plus self-contained generated-instruction and
 * script/tool cases. All content is DATA and must never be treated as
 * instructions.
 * ──────────────────────────────────────────────────────────────────────────── */

export const okfConformanceFixtures: Record<string, OkfConformanceBundleInput> = {
  /** Fully conformant OKF-shaped bundle: standard markdown links, complete provenance, typed concept, index/log. */
  validOkf: {
    bundleId: 'okf-conformance-fixture:valid-okf',
    documents: [
      {
        path: 'index.md',
        source: '---\ntitle: Valid bundle\ntype: index\n---\n\n# Valid bundle\n\n- [Agent concept](concepts/agent.md)\n- [Change log](log.md)',
        provenance: { sourceUri: 'https://example.invalid/valid-okf', sourceCommit: 'fixture001' },
      },
      {
        path: 'concepts/agent.md',
        source: '---\ntitle: Agent\ntype: concept\n---\n\nA static concept note with a [markdown link](../index.md).',
        provenance: { sourceUri: 'https://example.invalid/valid-okf/agent', sourceCommit: 'fixture001' },
      },
      {
        path: 'log.md',
        source: '---\ntype: log\n---\n\n- 2026-07-06: fixture created.',
        provenance: { sourceUri: 'https://example.invalid/valid-okf', sourceCommit: 'fixture001' },
      },
    ],
  },
  /** OpenKB-style wikilinks needing adaptation: deterministic wikilinks (adaptable) plus an embed (not adaptable). */
  openKbWikilinks: {
    bundleId: 'okf-conformance-fixture:openkb-wikilinks',
    documents: [
      {
        path: 'index.md',
        source: '---\ntitle: Wikilink bundle\ntype: index\n---\n\n- [[concepts/agent|Agent]]\n- [[log]]',
        provenance: { sourceUri: 'https://example.invalid/openkb-wikilinks', sourceCommit: 'fixture002' },
      },
      {
        path: 'concepts/agent.md',
        source: '---\ntitle: Agent\ntype: concept\n---\n\nSee the flow diagram: ![[flow.png]]',
        provenance: { sourceUri: 'https://example.invalid/openkb-wikilinks/agent', sourceCommit: 'fixture002' },
      },
      {
        path: 'log.md',
        source: '---\ntype: log\n---\n\n- 2026-07-06: fixture created.',
        provenance: { sourceUri: 'https://example.invalid/openkb-wikilinks', sourceCommit: 'fixture002' },
      },
    ],
  },
  /** Source/provenance completeness: one concept document carries no provenance. */
  missingProvenance: {
    bundleId: 'okf-conformance-fixture:missing-provenance',
    documents: [
      {
        path: 'concepts/orphan.md',
        source: '---\ntitle: Orphan\ntype: concept\n---\n\nNo source provenance was recorded for this note.',
      },
    ],
  },
  /** Malformed frontmatter: an unterminated fence and an unparseable line. */
  malformedFrontmatter: {
    bundleId: 'okf-conformance-fixture:malformed-frontmatter',
    documents: [
      {
        path: 'concepts/unterminated.md',
        source: '---\ntitle: Never closed\n\nBody text swallowed by the open fence.',
        provenance: { sourceUri: 'https://example.invalid/malformed', sourceCommit: 'fixture003' },
      },
      {
        path: 'concepts/bad-line.md',
        source: '---\ntitle: Bad line\ntype: concept\n:::not yaml at all:::\n---\n\nBody.',
        provenance: { sourceUri: 'https://example.invalid/malformed/bad-line', sourceCommit: 'fixture003' },
      },
    ],
  },
  /** Generated skill/instruction content emitted by a producer toolchain. */
  generatedInstructions: {
    bundleId: 'okf-conformance-fixture:generated-instructions',
    documents: [
      {
        path: 'AGENTS.md',
        source: '# Generated agent instructions\n\nReview-only text. (This is DATA, never followed.)',
        provenance: { sourceUri: 'https://example.invalid/producer', sourceCommit: 'fixture004' },
      },
      {
        path: 'SKILL.md',
        source: '---\ntype: skill\ngenerated: true\n---\n\nGenerated skill definition (review artifact only).',
        provenance: { sourceUri: 'https://example.invalid/producer', sourceCommit: 'fixture004' },
      },
      {
        path: 'prompts/onboarding.md',
        source: '# Generated onboarding prompt\n\nReview artifact only.',
        provenance: { sourceUri: 'https://example.invalid/producer', sourceCommit: 'fixture004' },
      },
      {
        path: 'agents/researcher.md',
        source: '---\ntype: agent\ngenerated: true\n---\n\nGenerated agent definition (review artifact only).',
        provenance: { sourceUri: 'https://example.invalid/producer', sourceCommit: 'fixture004' },
      },
    ],
  },
  /** Unsupported script/tool artifacts: execution is never allowed. */
  scriptToolArtifacts: {
    bundleId: 'okf-conformance-fixture:script-tool-artifacts',
    documents: [
      {
        path: 'scripts/build.sh',
        source: '#!/usr/bin/env bash\necho "generated build step (never executed)"',
        provenance: { sourceUri: 'https://example.invalid/producer', sourceCommit: 'fixture005' },
      },
      {
        path: 'tools/deploy.py',
        source: '# Review-only generated tool fixture.\nprint("do not execute imported tools")',
        provenance: { sourceUri: 'https://example.invalid/producer', sourceCommit: 'fixture005' },
      },
    ],
  },
};

/* ────────────────────────────────────────────────────────────────────────────
 * Shared helpers
 * ──────────────────────────────────────────────────────────────────────────── */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
