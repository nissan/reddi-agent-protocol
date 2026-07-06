import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  REPO_EXPLORER_EVIDENCE_MANIFEST_SCHEMA_VERSION,
  REPO_EXPLORER_SOURCE_TRUST,
  REPO_EXPLORER_READ_ONLY_CONTRACT,
  REPO_EXPLORER_SNAPSHOT_REF_PREFIX,
  REPO_EXPLORER_EVIDENCE_PERMITTED_USE,
  REPO_EXPLORER_EVIDENCE_DENIED_USE,
  validateRepoExplorerEvidenceManifest,
  attachRepoExplorerEvidenceToSnapshot,
  repoExplorerSnapshotRef,
  repoExplorerEvidenceRefs,
  repoRelativePathProblem,
  isGeneratedOrNoisyPath,
  capabilityInventoryProjection,
  connectorDiagnosticsProjection,
  riskTaxonomyProjection,
  draftReadinessProjection,
  operatorReviewProjection,
  projectRepoExplorerEvidence,
  repoExplorerEvidenceManifestFixtures,
  validateOnboardingIntakeDescriptor,
  ONBOARDING_INTAKE_DESCRIPTOR_SCHEMA_VERSION,
  type RepoExplorerEvidenceManifestInput,
  type RepoExplorerEvidenceManifestReport,
  type RepoExplorerEvidenceReasonCode,
} from '../dist/index.js';

const fixtures = repoExplorerEvidenceManifestFixtures;

function baseInput(overrides: Partial<RepoExplorerEvidenceManifestInput> = {}): RepoExplorerEvidenceManifestInput {
  return {
    generatedAt: '2026-07-06T00:00:00Z',
    source: {
      repoUrl: 'https://example.invalid/orgs/example/agent-stack',
      resolvedCommit: 'a3f18c9d02e14b76a3f18c9d02e14b76a3f18c9d',
    },
    explorationQuery: 'inline test fixture query',
    evidence: [{ path: 'src/index.ts', lines: { start: 1, end: 4 }, reason: 'citation' }],
    ...overrides,
  };
}

function expectBlocked(
  report: RepoExplorerEvidenceManifestReport,
  code: RepoExplorerEvidenceReasonCode,
): void {
  assert.equal(report.verdict, 'blocked');
  assert.equal(report.manifest, null);
  assert.ok(
    report.diagnostics.some((diag) => diag.code === code && diag.severity === 'blocked'),
    `expected blocked diagnostic ${code}; got ${JSON.stringify(report.codes)}`,
  );
}

describe('repo explorer evidence manifest — happy path', () => {
  it('accepts the happy-path fixture as valid with a normalized manifest', () => {
    const report = validateRepoExplorerEvidenceManifest(fixtures.happyPath);
    assert.equal(report.schemaVersion, REPO_EXPLORER_EVIDENCE_MANIFEST_SCHEMA_VERSION);
    assert.equal(report.verdict, 'valid');
    assert.equal(report.diagnostics.length, 0);
    assert.ok(report.manifest);
    const manifest = report.manifest;
    assert.equal(manifest.schemaVersion, REPO_EXPLORER_EVIDENCE_MANIFEST_SCHEMA_VERSION);
    assert.equal(manifest.manifestId, 'example-agent-stack@a3f18c9d02e1');
    assert.equal(manifest.sourceTrust, REPO_EXPLORER_SOURCE_TRUST);
    assert.equal(manifest.sourceTrust, 'external_untrusted');
    assert.equal(manifest.readOnlyContract, REPO_EXPLORER_READ_ONLY_CONTRACT);
    assert.equal(manifest.explorer.mode, 'read_only');
    assert.equal(manifest.evidence.length, 3);
    assert.equal(manifest.evidence[0].path, 'README.md');
    assert.deepEqual(manifest.evidence[0].lines, { start: 1, end: 32 });
    assert.equal(manifest.evidence.every((entry) => !entry.generatedOrNoisy), true);
    assert.equal(manifest.exclusions.length, 2);
    assert.equal(manifest.exclusions[0].path, 'node_modules');
    assert.equal(manifest.fullRepoIngested, false);
    assert.equal(manifest.staticOnly, true);
    assert.equal(manifest.openQuestions.length, 1);
  });

  it('derives a deterministic manifestId when none is provided', () => {
    const report = validateRepoExplorerEvidenceManifest(baseInput());
    assert.equal(report.verdict, 'valid');
    assert.equal(
      report.manifest?.manifestId,
      'example.invalid/orgs/example/agent-stack@a3f18c9d02e1',
    );
  });

  it('carries the review-only boundary and all-false guardrails on every report', () => {
    for (const input of [fixtures.happyPath, fixtures.pathTraversal]) {
      const report = validateRepoExplorerEvidenceManifest(input);
      assert.deepEqual(report.reviewBoundary.permittedUse, REPO_EXPLORER_EVIDENCE_PERMITTED_USE);
      assert.deepEqual(report.reviewBoundary.deniedUse, REPO_EXPLORER_EVIDENCE_DENIED_USE);
      assert.ok(report.reviewBoundary.deniedUse.includes('repo_fetch_or_clone'));
      assert.ok(report.reviewBoundary.deniedUse.includes('full_repo_ingestion'));
      assert.ok(Object.values(report.guardrails).every((flag) => flag === false));
      assert.ok(report.notes.some((note) => note.includes('localization evidence')));
    }
  });
});

describe('repo explorer evidence manifest — fail-closed operations', () => {
  it('refuses every requested live operation with operation_not_permitted', () => {
    for (const flag of [
      'fetchRepo',
      'cloneRepo',
      'ingestFullRepo',
      'executeContent',
      'installDependencies',
      'invokeLlm',
    ] as const) {
      const report = validateRepoExplorerEvidenceManifest(fixtures.happyPath, { [flag]: true });
      expectBlocked(report, 'operation_not_permitted');
    }
  });
});

describe('repo explorer evidence manifest — malformed and unsafe paths', () => {
  it('blocks `..` path traversal', () => {
    expectBlocked(validateRepoExplorerEvidenceManifest(fixtures.pathTraversal), 'unsafe_evidence_path');
  });

  it('blocks absolute paths', () => {
    expectBlocked(validateRepoExplorerEvidenceManifest(fixtures.absolutePath), 'unsafe_evidence_path');
  });

  it('blocks file:// URI paths', () => {
    expectBlocked(validateRepoExplorerEvidenceManifest(fixtures.fileUriPath), 'unsafe_evidence_path');
  });

  it('blocks Windows drive prefixes, home expansion, and encoded traversal', () => {
    for (const path of ['C:/secrets/key.pem', '~/secrets/key.pem', '%2e%2e/secret.txt', 'https://example.invalid/x.ts']) {
      const report = validateRepoExplorerEvidenceManifest(
        baseInput({ evidence: [{ path, lines: { start: 1, end: 2 }, reason: 'unsafe path probe' }] }),
      );
      expectBlocked(report, 'unsafe_evidence_path');
    }
  });

  it('blocks backslash separators, control characters, and empty/dot segments as malformed', () => {
    for (const path of ['src\\index.ts', 'src/\u0007bell.ts', 'src//index.ts', './src/index.ts', '   ']) {
      const report = validateRepoExplorerEvidenceManifest(
        baseInput({ evidence: [{ path, lines: { start: 1, end: 2 }, reason: 'malformed path probe' }] }),
      );
      expectBlocked(report, 'malformed_evidence_path');
    }
  });

  it('exposes the path guard for direct reuse', () => {
    assert.equal(repoRelativePathProblem('src/index.ts'), null);
    assert.equal(repoRelativePathProblem('../x')?.code, 'unsafe_evidence_path');
    assert.equal(repoRelativePathProblem('/x')?.code, 'unsafe_evidence_path');
    assert.equal(repoRelativePathProblem('')?.code, 'malformed_evidence_path');
    assert.equal(repoRelativePathProblem(42)?.code, 'malformed_evidence_path');
  });
});

describe('repo explorer evidence manifest — invalid line ranges', () => {
  it('blocks reversed ranges', () => {
    expectBlocked(validateRepoExplorerEvidenceManifest(fixtures.reversedLineRange), 'invalid_line_range');
  });

  it('blocks zero and negative line numbers', () => {
    expectBlocked(validateRepoExplorerEvidenceManifest(fixtures.nonPositiveLineRange), 'invalid_line_range');
  });

  it('blocks non-integer and missing range fields', () => {
    for (const lines of [
      { start: 1.5, end: 4 },
      { start: 1, end: Number.NaN },
      { start: 1 } as unknown as { start: number; end: number },
      'L1-L4' as unknown as { start: number; end: number },
    ]) {
      const report = validateRepoExplorerEvidenceManifest(
        baseInput({ evidence: [{ path: 'src/index.ts', lines, reason: 'bad range probe' }] }),
      );
      expectBlocked(report, 'invalid_line_range');
    }
  });
});

describe('repo explorer evidence manifest — empty evidence and reasons', () => {
  it('blocks an empty evidence array', () => {
    expectBlocked(validateRepoExplorerEvidenceManifest(fixtures.emptyEvidence), 'evidence_empty');
  });

  it('blocks a missing evidence array', () => {
    const { evidence: _evidence, ...rest } = baseInput();
    expectBlocked(validateRepoExplorerEvidenceManifest(rest), 'evidence_empty');
  });

  it('blocks evidence entries without a relevance reason', () => {
    expectBlocked(
      validateRepoExplorerEvidenceManifest(fixtures.missingRelevanceReason),
      'missing_relevance_reason',
    );
  });

  it('warns on overly long relevance reasons (compact citations, not dumps)', () => {
    const report = validateRepoExplorerEvidenceManifest(
      baseInput({ evidence: [{ path: 'src/index.ts', lines: { start: 1, end: 2 }, reason: 'x'.repeat(501) }] }),
    );
    assert.equal(report.verdict, 'warning');
    assert.ok(report.codes.includes('relevance_reason_too_long'));
    assert.ok(report.manifest);
  });
});

describe('repo explorer evidence manifest — generated/noisy exclusion handling', () => {
  it('classifies generated/noisy paths deterministically', () => {
    assert.equal(isGeneratedOrNoisyPath('node_modules/pkg/index.js').noisy, true);
    assert.equal(isGeneratedOrNoisyPath('dist/index.js').noisy, true);
    assert.equal(isGeneratedOrNoisyPath('package-lock.json').noisy, true);
    assert.equal(isGeneratedOrNoisyPath('app/bundle.min.js').noisy, true);
    assert.equal(isGeneratedOrNoisyPath('src/index.ts').noisy, false);
    assert.equal(isGeneratedOrNoisyPath('docs/README.md').noisy, false);
  });

  it('accepts but flags citations into generated/noisy content', () => {
    const report = validateRepoExplorerEvidenceManifest(fixtures.generatedNoisyCitation);
    assert.equal(report.verdict, 'warning');
    assert.ok(report.codes.includes('generated_path_cited'));
    assert.ok(report.manifest);
    const [noisy, clean] = report.manifest.evidence;
    assert.equal(noisy.generatedOrNoisy, true);
    assert.equal(clean.generatedOrNoisy, false);
  });

  it('blocks a manifest that cites a path it also excludes', () => {
    expectBlocked(validateRepoExplorerEvidenceManifest(fixtures.excludedPathCited), 'excluded_path_cited');
  });

  it('blocks malformed exclusion entries', () => {
    const report = validateRepoExplorerEvidenceManifest(
      baseInput({ exclusions: [{ path: 'dist/**', reason: '' }] }),
    );
    expectBlocked(report, 'exclusion_entry_malformed');

    const unsafe = validateRepoExplorerEvidenceManifest(
      baseInput({ exclusions: [{ path: '../outside/**', reason: 'outside the repo' }] }),
    );
    expectBlocked(unsafe, 'exclusion_entry_malformed');
  });
});

describe('repo explorer evidence manifest — source, trust, query, contract', () => {
  it('hard-codes external_untrusted and blocks self-asserted trust', () => {
    expectBlocked(
      validateRepoExplorerEvidenceManifest(fixtures.trustBoundaryViolation),
      'trust_boundary_invalid',
    );
    const report = validateRepoExplorerEvidenceManifest(baseInput());
    assert.equal(report.manifest?.sourceTrust, 'external_untrusted');
  });

  it('blocks non-https, credentialed, and malformed source URLs', () => {
    expectBlocked(validateRepoExplorerEvidenceManifest(fixtures.unsafeSourceUrl), 'unsafe_source_url');
    for (const repoUrl of ['http://example.invalid/repo', 'https://user@example.invalid/repo', 'git@example.invalid:org/repo.git']) {
      const report = validateRepoExplorerEvidenceManifest(
        baseInput({ source: { repoUrl, resolvedCommit: 'a3f18c9d02e14b76a3f18c9d02e14b76a3f18c9d' } }),
      );
      expectBlocked(report, 'unsafe_source_url');
    }
  });

  it('blocks unresolved commits (branch names, HEAD, empty)', () => {
    expectBlocked(validateRepoExplorerEvidenceManifest(fixtures.unresolvedCommit), 'commit_unresolved');
    for (const resolvedCommit of ['HEAD', 'v1.2.3', '']) {
      const report = validateRepoExplorerEvidenceManifest(
        baseInput({ source: { repoUrl: 'https://example.invalid/repo', resolvedCommit } }),
      );
      expectBlocked(report, 'commit_unresolved');
    }
  });

  it('blocks a missing or malformed capture timestamp', () => {
    const { generatedAt: _generatedAt, ...rest } = baseInput();
    expectBlocked(validateRepoExplorerEvidenceManifest(rest), 'timestamp_malformed');
    expectBlocked(
      validateRepoExplorerEvidenceManifest(baseInput({ generatedAt: 'yesterday' })),
      'timestamp_malformed',
    );
  });

  it('blocks a missing exploration query', () => {
    expectBlocked(
      validateRepoExplorerEvidenceManifest(baseInput({ explorationQuery: '  ' })),
      'query_missing',
    );
  });

  it('blocks non-read-only explorer contracts and write/execute-class allowed tools', () => {
    expectBlocked(
      validateRepoExplorerEvidenceManifest(fixtures.nonReadOnlyExplorer),
      'explorer_contract_invalid',
    );
    expectBlocked(
      validateRepoExplorerEvidenceManifest(
        baseInput({ explorer: { toolsAllowed: ['read_file', 'execute_command'] } }),
      ),
      'explorer_contract_invalid',
    );
    expectBlocked(
      validateRepoExplorerEvidenceManifest(baseInput({ explorer: { maxFiles: 0 } })),
      'explorer_contract_invalid',
    );
  });

  it('warns when citations exceed the declared line window or max files', () => {
    const windowReport = validateRepoExplorerEvidenceManifest(
      baseInput({
        explorer: { lineWindow: 5 },
        evidence: [{ path: 'src/index.ts', lines: { start: 1, end: 40 }, reason: 'wide citation' }],
      }),
    );
    assert.equal(windowReport.verdict, 'warning');
    assert.ok(windowReport.codes.includes('line_window_exceeded'));

    const filesReport = validateRepoExplorerEvidenceManifest(
      baseInput({
        explorer: { maxFiles: 1 },
        evidence: [
          { path: 'src/a.ts', lines: { start: 1, end: 2 }, reason: 'a' },
          { path: 'src/b.ts', lines: { start: 1, end: 2 }, reason: 'b' },
        ],
      }),
    );
    assert.equal(filesReport.verdict, 'warning');
    assert.ok(
      filesReport.diagnostics.some(
        (diag) => diag.code === 'explorer_contract_invalid' && diag.severity === 'warning',
      ),
    );
  });

  it('flags duplicate citations and malformed open questions as warnings', () => {
    const report = validateRepoExplorerEvidenceManifest(
      baseInput({
        evidence: [
          { path: 'src/index.ts', lines: { start: 1, end: 4 }, reason: 'first' },
          { path: 'src/index.ts', lines: { start: 1, end: 4 }, reason: 'second' },
        ],
        openQuestions: ['real question', '', 42 as unknown as string],
      }),
    );
    assert.equal(report.verdict, 'warning');
    assert.ok(report.codes.includes('duplicate_evidence_entry'));
    assert.ok(report.codes.includes('open_question_malformed'));
    assert.deepEqual(report.manifest?.openQuestions, ['real question']);
  });

  it('blocks non-object manifests outright', () => {
    for (const input of [null, undefined, 'manifest', [], 42]) {
      expectBlocked(validateRepoExplorerEvidenceManifest(input), 'manifest_malformed');
    }
  });
});

describe('repo explorer evidence manifest — #575 snapshotRef bridge', () => {
  it('attaches an accepted manifest by reference with per-citation evidence refs', () => {
    const report = validateRepoExplorerEvidenceManifest(fixtures.happyPath);
    const attachment = attachRepoExplorerEvidenceToSnapshot(report);
    assert.equal(attachment.ok, true);
    if (!attachment.ok) return;
    const { source, evidenceRefs, fullRepoIngested, sourceTrust } = attachment.attachment;
    assert.equal(source.snapshotRef, `${REPO_EXPLORER_SNAPSHOT_REF_PREFIX}example-agent-stack@a3f18c9d02e1`);
    assert.equal(source.sourceUrl, 'https://example.invalid/orgs/example/agent-stack');
    assert.equal(source.checkedCommit, 'a3f18c9d02e14b76a3f18c9d02e14b76a3f18c9d');
    assert.equal(source.crawlTimestamp, '2026-07-06T00:00:00Z');
    assert.equal(evidenceRefs.length, 3);
    assert.equal(
      evidenceRefs[0],
      `${REPO_EXPLORER_SNAPSHOT_REF_PREFIX}example-agent-stack@a3f18c9d02e1#README.md:L1-L32`,
    );
    assert.equal(fullRepoIngested, false);
    assert.equal(sourceTrust, 'external_untrusted');
  });

  it('never attaches a blocked manifest (fail-closed)', () => {
    const report = validateRepoExplorerEvidenceManifest(fixtures.pathTraversal);
    const attachment = attachRepoExplorerEvidenceToSnapshot(report);
    assert.deepEqual(attachment, { ok: false, reasonCode: 'manifest_blocked' });
  });

  it('produces a source block accepted verbatim by the #575 static-agent-stack-snapshot intake', () => {
    const report = validateRepoExplorerEvidenceManifest(fixtures.happyPath);
    const attachment = attachRepoExplorerEvidenceToSnapshot(report);
    assert.equal(attachment.ok, true);
    if (!attachment.ok) return;

    const intake = validateOnboardingIntakeDescriptor({
      schemaVersion: ONBOARDING_INTAKE_DESCRIPTOR_SCHEMA_VERSION,
      intakeId: 'intake-repo-explorer-bridge',
      sourceKind: 'static-agent-stack-snapshot',
      ingestionMode: 'static-fixture',
      source: attachment.attachment.source,
      declaredMetadata: {
        displayName: 'Explorer-evidenced agent stack',
        capabilities: [
          { name: 'lookup connector metadata', description: 'read connector registry entries' },
        ],
      },
      staticOnly: true,
    });
    assert.equal(intake.ok, true, `intake rejected: ${JSON.stringify(!intake.ok ? intake.errors : [])}`);
  });

  it('exposes the ref helpers directly', () => {
    const report = validateRepoExplorerEvidenceManifest(fixtures.happyPath);
    assert.ok(report.manifest);
    assert.ok(repoExplorerSnapshotRef(report.manifest).startsWith(REPO_EXPLORER_SNAPSHOT_REF_PREFIX));
    assert.equal(repoExplorerEvidenceRefs(report.manifest).length, 3);
  });
});

describe('repo explorer evidence manifest — projections (#403/#404/#421/#405/#406)', () => {
  it('projects toward the #403 capability-inventory provenance vocabulary', () => {
    const report = validateRepoExplorerEvidenceManifest(fixtures.happyPath);
    assert.ok(report.manifest);
    const projection = capabilityInventoryProjection(report.manifest);
    assert.deepEqual(projection.provenance, {
      corpusId: 'example-agent-stack@a3f18c9d02e1',
      sourceUrl: 'https://example.invalid/orgs/example/agent-stack',
      checkedCommit: 'a3f18c9d02e14b76a3f18c9d02e14b76a3f18c9d',
    });
    assert.equal(projection.contentTrustBoundary, 'untrusted_public_text');
    assert.equal(projection.evidenceRefs.length, 3);
    assert.equal(projection.localizationHints.length, 3);
    assert.equal(projection.localizationHints[1].sourcePath, 'src/connectors/registry.ts');
    assert.equal(projection.localizationHints[1].relevance.length > 0, true);
  });

  it('projects diagnostics toward the #404 connector-diagnostic shape', () => {
    const report = validateRepoExplorerEvidenceManifest(fixtures.generatedNoisyCitation);
    const projections = connectorDiagnosticsProjection(report);
    assert.equal(projections.length, report.diagnostics.length);
    for (const projection of projections) {
      assert.equal(projection.diagnosticLane, 'repo_explorer_evidence');
      assert.equal(projection.blocksDraftPayload, projection.severity === 'blocked');
      assert.equal(projection.operatorReviewRequired, projection.severity !== 'info');
      assert.equal(projection.warningCodes.length, 1);
    }

    const blockedProjections = connectorDiagnosticsProjection(
      validateRepoExplorerEvidenceManifest(fixtures.pathTraversal),
    );
    assert.ok(blockedProjections.some((projection) => projection.blocksDraftPayload));
  });

  it('projects cited risk surfaces toward the #421 risk-taxonomy categories', () => {
    const report = validateRepoExplorerEvidenceManifest(fixtures.riskyEvidence);
    assert.equal(report.verdict, 'valid');
    assert.ok(report.manifest);
    const projections = riskTaxonomyProjection(report.manifest);
    const categories = projections.map((projection) => projection.category);
    assert.deepEqual(categories, [
      'executable_hook',
      'installer_or_update_script',
      'wallet_rpc_capable_metadata',
      'mcp_launcher_execution',
    ]);
    for (const projection of projections) {
      assert.equal(projection.diagnosticLane, 'static_fixture_risk_taxonomy');
      assert.equal(projection.severity, 'warning');
      assert.equal(projection.blocksDraftPayload, false);
      assert.equal(projection.operatorReviewRequired, true);
      assert.equal(projection.warningCodes.length, 1);
    }
  });

  it('does not project risk for benign citations', () => {
    const report = validateRepoExplorerEvidenceManifest(fixtures.happyPath);
    assert.ok(report.manifest);
    assert.deepEqual(riskTaxonomyProjection(report.manifest), []);
  });

  it('projects toward the #405 draft-readiness vocabulary and never emits ready', () => {
    const accepted = draftReadinessProjection(validateRepoExplorerEvidenceManifest(fixtures.happyPath));
    assert.equal(accepted.status, 'needs_review');
    assert.deepEqual(accepted.blockers, []);
    assert.ok(accepted.payloadRefs.length >= 4);
    assert.ok(accepted.payloadRefs[0].startsWith(REPO_EXPLORER_SNAPSHOT_REF_PREFIX));

    const blocked = draftReadinessProjection(validateRepoExplorerEvidenceManifest(fixtures.emptyEvidence));
    assert.equal(blocked.status, 'blocked');
    assert.ok(blocked.blockers.includes('evidence_empty'));
    assert.deepEqual(blocked.payloadRefs, []);
  });

  it('projects toward the #406 operator-review vocabulary with publication disabled', () => {
    const accepted = operatorReviewProjection(validateRepoExplorerEvidenceManifest(fixtures.happyPath));
    assert.equal(accepted.status, 'approve_ready');
    assert.equal(accepted.publication.disabled, true);
    assert.equal(accepted.publication.requiresOperatorApproval, true);
    assert.equal(accepted.source.importedContentTrust, 'untrusted');
    assert.equal(accepted.source.providerTrust, 'unverified');
    assert.equal(accepted.rawSnapshotRefs.length, 1);

    const warned = operatorReviewProjection(
      validateRepoExplorerEvidenceManifest(fixtures.generatedNoisyCitation),
    );
    assert.equal(warned.status, 'request_changes');
    assert.ok(warned.reviewItems.some((item) => item.recommendedAction === 'review_static_risk'));

    const rejected = operatorReviewProjection(validateRepoExplorerEvidenceManifest(fixtures.pathTraversal));
    assert.equal(rejected.status, 'rejected');
    assert.ok(rejected.reviewItems.some((item) => item.blocksPublication));
    assert.ok(rejected.reviewItems.every((item) => item.source === 'repo_explorer_evidence'));
    assert.equal(rejected.source.sourceUrl, null);
  });

  it('bundles all projections deterministically, fail-closed when blocked', () => {
    const accepted = projectRepoExplorerEvidence(validateRepoExplorerEvidenceManifest(fixtures.happyPath));
    assert.ok(accepted.snapshotAttachment);
    assert.ok(accepted.capabilityInventory);
    assert.equal(accepted.draftReadiness.status, 'needs_review');
    assert.equal(accepted.operatorReview.status, 'approve_ready');

    const blocked = projectRepoExplorerEvidence(validateRepoExplorerEvidenceManifest(fixtures.pathTraversal));
    assert.equal(blocked.snapshotAttachment, null);
    assert.equal(blocked.capabilityInventory, null);
    assert.deepEqual(blocked.riskTaxonomy, []);
    assert.equal(blocked.draftReadiness.status, 'blocked');
    assert.equal(blocked.operatorReview.status, 'rejected');
    assert.ok(blocked.connectorDiagnostics.some((projection) => projection.blocksDraftPayload));
  });
});
