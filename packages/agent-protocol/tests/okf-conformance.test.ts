import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  runOkfConformanceDiagnostics,
  conformanceInputFromOkfOpenKbFixture,
  parseOkfDocumentSource,
  okfConformanceFixtures,
  openKbBundleFixtures,
  OKF_CONFORMANCE_SCHEMA_VERSION,
  OKF_CONFORMANCE_IS_DRAFT,
  OKF_CONFORMANCE_PERMITTED_USE,
  OKF_CONFORMANCE_DENIED_USE,
  OKF_FIXTURE_DIAGNOSTIC_CODE_MAP,
  OKF_FIXTURE_DIAGNOSTIC_SEVERITY_MAP,
  type OkfConformanceBundleInput,
  type OkfConformanceReport,
} from '../dist/index.js';

// #503 static fixture corpus — loaded ONCE by the TEST (never by the module
// under test, which is pure and does no filesystem access).
const corpusPath = fileURLToPath(
  new URL('../../../data/okf-openkb-fixtures/okf-openkb-fixture-corpus.v1.json', import.meta.url),
);
const corpusRaw = readFileSync(corpusPath, 'utf8');

type CorpusFile = {
  path: string;
  type: string;
  contentClass: string;
  trustBoundary: string;
  contentPreview: string;
};
type CorpusFixture = {
  id: string;
  files: CorpusFile[];
  expectedDiagnostics: Array<{ code: string; severity: string; path: string }>;
  contentSha256: string;
};
type Corpus = { fixtures: CorpusFixture[] };

function loadCorpus(): Corpus {
  return JSON.parse(corpusRaw) as Corpus;
}

function corpusFixture(corpus: Corpus, id: string): CorpusFixture {
  const fixture = corpus.fixtures.find((f) => f.id === id);
  assert.ok(fixture, `expected corpus fixture ${id}`);
  return fixture;
}

/** Same digest recipe as scripts/check-okf-openkb-fixture-corpus.mjs. */
function fixtureContentHash(files: CorpusFile[]): string {
  const hashInput = JSON.stringify(files.map((file) => ({
    path: file.path,
    type: file.type,
    contentClass: file.contentClass,
    trustBoundary: file.trustBoundary,
    contentPreview: file.contentPreview,
  })), null, 2);
  return createHash('sha256').update(hashInput).digest('hex');
}

function fixture(name: keyof typeof okfConformanceFixtures): OkfConformanceBundleInput {
  return structuredClone(okfConformanceFixtures[name]);
}

function docReport(report: OkfConformanceReport, documentId: string) {
  const doc = report.documents.find((d) => d.documentId === documentId);
  assert.ok(doc, `expected document report for ${documentId}`);
  return doc;
}

describe('OKF/OpenKB conformance diagnostics (#504)', () => {
  describe('report shape and review-only boundary', () => {
    it('emits the schema version, draft flag, and hard-false guardrails', () => {
      const report = runOkfConformanceDiagnostics(fixture('validOkf'));
      assert.equal(report.schemaVersion, OKF_CONFORMANCE_SCHEMA_VERSION);
      assert.equal(report.schemaVersion, 'reddi.okf-conformance.v1');
      assert.equal(report.draft, true);
      assert.equal(OKF_CONFORMANCE_IS_DRAFT, true);
      for (const [key, value] of Object.entries(report.guardrails)) {
        assert.equal(value, false, `guardrail ${key} must be hard-false`);
      }
    });

    it('permits review/analysis only — denied uses are identical on every verdict', () => {
      const valid = runOkfConformanceDiagnostics(fixture('validOkf'));
      const blocked = runOkfConformanceDiagnostics(fixture('generatedInstructions'));
      assert.equal(valid.verdict, 'valid');
      assert.equal(blocked.verdict, 'blocked');
      for (const report of [valid, blocked]) {
        assert.deepEqual(report.reviewBoundary.permittedUse, OKF_CONFORMANCE_PERMITTED_USE);
        assert.deepEqual(report.reviewBoundary.deniedUse, OKF_CONFORMANCE_DENIED_USE);
        for (const denied of [
          'skill_installation',
          'agent_registration',
          'marketplace_publication',
          'hosted_registry_write',
          'llm_or_provider_call',
          'script_or_tool_execution',
        ]) {
          assert.ok(
            (report.reviewBoundary.deniedUse as readonly string[]).includes(denied),
            `deniedUse must include ${denied}`,
          );
        }
      }
    });

    it('is deterministic — identical input yields identical output', () => {
      const a = runOkfConformanceDiagnostics(fixture('openKbWikilinks'));
      const b = runOkfConformanceDiagnostics(fixture('openKbWikilinks'));
      assert.deepEqual(a, b);
    });
  });

  describe('valid OKF bundle', () => {
    it('reports every document valid with a valid verdict', () => {
      const report = runOkfConformanceDiagnostics(fixture('validOkf'));
      assert.equal(report.verdict, 'valid');
      assert.equal(report.documents.length, 3);
      for (const doc of report.documents) {
        assert.equal(doc.status, 'valid', `${doc.documentId} should be valid`);
        assert.equal(doc.trustClassification, 'static_source');
        assert.equal(doc.artifactClass, null);
      }
    });

    it('normalizes index.md and log.md semantics', () => {
      const report = runOkfConformanceDiagnostics(fixture('validOkf'));
      assert.ok(report.index);
      assert.equal(report.index.documentId, 'index.md');
      assert.equal(report.index.entries.length, 2);
      assert.ok(report.log);
      assert.equal(report.log.documentId, 'log.md');
      assert.ok(report.codes.includes('index_semantics_normalized'));
      assert.ok(report.codes.includes('log_semantics_normalized'));
    });

    it('warns when an expected index.md or log.md is absent', () => {
      const input = fixture('missingProvenance');
      const report = runOkfConformanceDiagnostics(input, { expectIndex: true, expectLog: true });
      assert.ok(report.codes.includes('index_missing'));
      assert.ok(report.codes.includes('log_missing'));
      assert.notEqual(report.verdict, 'valid');
    });

    it('preserves unknown frontmatter verbatim as untrusted review metadata (info only)', () => {
      const input = fixture('validOkf');
      input.documents[1].source = '---\ntitle: Agent\ntype: concept\ncustom_unknown_field: preserved-verbatim\n---\n\nBody.';
      const report = runOkfConformanceDiagnostics(input);
      assert.equal(report.verdict, 'valid');
      const doc = docReport(report, 'concepts/agent.md');
      const preserved = doc.diagnostics.find((d) => d.code === 'unknown_frontmatter_preserved');
      assert.ok(preserved);
      assert.equal(preserved.severity, 'info');
    });

    it('flags concept documents with no non-empty type', () => {
      const input = fixture('validOkf');
      input.documents[1].source = '---\ntitle: Agent\n---\n\nBody with no type.';
      const report = runOkfConformanceDiagnostics(input);
      assert.equal(report.verdict, 'warning');
      assert.ok(report.codes.includes('concept_type_missing'));
    });
  });

  describe('link syntax', () => {
    it('reports deterministic wikilinks as adaptable info without failing conformance', () => {
      const report = runOkfConformanceDiagnostics(fixture('openKbWikilinks'));
      const indexDoc = docReport(report, 'index.md');
      const linkDiag = indexDoc.diagnostics.find((d) => d.code === 'unsupported_link_syntax');
      assert.ok(linkDiag);
      assert.equal(linkDiag.severity, 'info');
      assert.equal(linkDiag.adaptable, true);
      assert.equal(indexDoc.status, 'valid');
    });

    it('reports non-deterministic wikilink syntax as an unadaptable warning', () => {
      const report = runOkfConformanceDiagnostics(fixture('openKbWikilinks'));
      const conceptDoc = docReport(report, 'concepts/agent.md');
      const embed = conceptDoc.diagnostics.find(
        (d) => d.code === 'unsupported_link_syntax' && d.severity === 'warning',
      );
      assert.ok(embed, 'embed ![[...]] must raise a warning');
      assert.equal(embed.adaptable, false);
      assert.equal(conceptDoc.status, 'unsupported_link_syntax');
      assert.equal(report.verdict, 'warning');
    });
  });

  describe('provenance', () => {
    it('warns on documents with no source provenance', () => {
      const report = runOkfConformanceDiagnostics(fixture('missingProvenance'));
      assert.equal(report.verdict, 'warning');
      const doc = docReport(report, 'concepts/orphan.md');
      assert.equal(doc.status, 'missing_provenance');
    });

    it('escalates missing provenance to blocked when required', () => {
      const report = runOkfConformanceDiagnostics(fixture('missingProvenance'), { requireProvenance: true });
      assert.equal(report.verdict, 'blocked');
      const diag = report.diagnostics.find((d) => d.code === 'missing_provenance');
      assert.ok(diag);
      assert.equal(diag.severity, 'blocked');
    });
  });

  describe('frontmatter parsing', () => {
    it('parses a YAML frontmatter fence with scalars and list values', () => {
      const parsed = parseOkfDocumentSource(
        'concepts/x.md',
        '---\ntitle: X\ntype: concept\nsourceRefs:\n  - index.md\n  - log.md\ncount: 3\nflag: true\n---\n\nBody.',
      );
      assert.deepEqual(parsed.frontmatter, {
        title: 'X',
        type: 'concept',
        sourceRefs: ['index.md', 'log.md'],
        count: 3,
        flag: true,
      });
      assert.equal(parsed.body, 'Body.');
      assert.equal(parsed.diagnostics.length, 0);
    });

    it('fails closed on an unterminated fence and on unparseable lines', () => {
      const report = runOkfConformanceDiagnostics(fixture('malformedFrontmatter'));
      assert.equal(report.verdict, 'warning');
      assert.equal(docReport(report, 'concepts/unterminated.md').status, 'malformed_frontmatter');
      assert.equal(docReport(report, 'concepts/bad-line.md').status, 'malformed_frontmatter');
      // The bad line is skipped, not trusted; parsed keys around it survive.
      const badLine = docReport(report, 'concepts/bad-line.md');
      assert.ok(badLine.diagnostics.some((d) => d.code === 'malformed_frontmatter' && d.severity === 'warning'));
    });
  });

  describe('generated instruction and execution safety', () => {
    it('classifies producer-toolchain artifacts with explicit unsafe classes and blocks them', () => {
      const report = runOkfConformanceDiagnostics(fixture('generatedInstructions'));
      assert.equal(report.verdict, 'blocked');
      assert.equal(docReport(report, 'AGENTS.md').artifactClass, 'agent_definition');
      assert.equal(docReport(report, 'SKILL.md').artifactClass, 'skill_definition');
      assert.equal(docReport(report, 'prompts/onboarding.md').artifactClass, 'prompt');
      assert.equal(docReport(report, 'agents/researcher.md').artifactClass, 'agent_definition');
      for (const doc of report.documents) {
        assert.equal(doc.trustClassification, 'untrusted_generated_instruction');
        assert.equal(doc.status, 'untrusted_generated_instruction');
        const diag = doc.diagnostics.find((d) => d.code === 'generated_instruction_untrusted');
        assert.ok(diag, `${doc.documentId} must carry generated_instruction_untrusted`);
        assert.equal(diag.severity, 'blocked');
      }
    });

    it('marks script and tool artifacts execution_not_allowed', () => {
      const report = runOkfConformanceDiagnostics(fixture('scriptToolArtifacts'));
      assert.equal(report.verdict, 'blocked');
      const script = docReport(report, 'scripts/build.sh');
      const tool = docReport(report, 'tools/deploy.py');
      assert.equal(script.status, 'execution_not_allowed');
      assert.equal(script.artifactClass, 'script');
      assert.equal(tool.status, 'execution_not_allowed');
      assert.equal(tool.artifactClass, 'tool');
      for (const doc of [script, tool]) {
        const diag = doc.diagnostics.find((d) => d.code === 'execution_not_allowed');
        assert.ok(diag);
        assert.equal(diag.severity, 'blocked');
      }
    });

    it('handles the #511 adapter representative fixture without re-inventing its vocabulary', () => {
      const report = runOkfConformanceDiagnostics(structuredClone(openKbBundleFixtures.representative));
      assert.equal(report.verdict, 'blocked');
      assert.equal(docReport(report, 'AGENTS.md').status, 'untrusted_generated_instruction');
      assert.equal(docReport(report, 'scripts/build.sh').status, 'execution_not_allowed');
      assert.equal(docReport(report, 'concepts/payment.md').status, 'unsupported_link_syntax');
      assert.equal(docReport(report, 'AGENTS.md').artifactClass, 'agent_definition');
    });
  });

  describe('fail-closed behaviour', () => {
    it('blocks non-bundle input and empty bundles', () => {
      for (const bad of [null, 42, 'bundle', { documents: [] }, {}]) {
        const report = runOkfConformanceDiagnostics(bad);
        assert.equal(report.verdict, 'blocked');
        assert.ok(report.codes.includes('bundle_malformed'));
        assert.equal(report.documents.length, 0);
      }
    });

    it('rejects every execute/install/ingest/LLM/skill-generation request', () => {
      for (const opt of [
        { execute: true },
        { install: true },
        { ingestUrl: true },
        { invokeLlm: true },
        { generateSkill: true },
      ] as const) {
        const report = runOkfConformanceDiagnostics(fixture('validOkf'), opt);
        assert.equal(report.verdict, 'blocked');
        assert.deepEqual(report.codes, ['operation_not_permitted']);
        assert.equal(report.documents.length, 0);
      }
    });
  });

  describe('#503 fixture corpus integration', () => {
    it('accepts the okf-minimal-concept-bundle fixture as valid (review-only)', () => {
      const corpus = loadCorpus();
      const minimal = corpusFixture(corpus, 'okf-minimal-concept-bundle');
      const report = runOkfConformanceDiagnostics(conformanceInputFromOkfOpenKbFixture(minimal));
      assert.equal(report.verdict, 'valid');
      assert.equal(report.documents.length, 3);
      assert.ok(report.index, 'index.md semantics must normalize');
      assert.ok(report.log, 'log.md semantics must normalize');
      assert.equal(docReport(report, 'concepts/agent-marketplace.md').documentRole, 'concept');
      // Deterministic wikilinks are reported (adaptable) without failing conformance.
      const indexDoc = docReport(report, 'index.md');
      assert.ok(indexDoc.diagnostics.some((d) => d.code === 'unsupported_link_syntax' && d.adaptable === true));
    });

    it('covers every expectedDiagnostic of the openkb-style-generated-agent-bundle fixture', () => {
      const corpus = loadCorpus();
      const generated = corpusFixture(corpus, 'openkb-style-generated-agent-bundle');
      const report = runOkfConformanceDiagnostics(conformanceInputFromOkfOpenKbFixture(generated));
      assert.equal(report.verdict, 'blocked');

      for (const expected of generated.expectedDiagnostics) {
        const mappedCode = OKF_FIXTURE_DIAGNOSTIC_CODE_MAP[
          expected.code as keyof typeof OKF_FIXTURE_DIAGNOSTIC_CODE_MAP
        ];
        assert.ok(mappedCode, `corpus code ${expected.code} must map to a conformance code`);
        const allowedSeverities = OKF_FIXTURE_DIAGNOSTIC_SEVERITY_MAP[expected.severity];
        assert.ok(allowedSeverities, `corpus severity ${expected.severity} must map`);
        const match = report.diagnostics.find(
          (d) => d.code === mappedCode
            && d.documentId === expected.path
            && (allowedSeverities as readonly string[]).includes(d.severity),
        );
        assert.ok(
          match,
          `expected ${expected.code}@${expected.path} (${expected.severity}) to surface as ${mappedCode}`,
        );
      }

      assert.equal(docReport(report, 'AGENTS.md').artifactClass, 'agent_definition');
      assert.equal(docReport(report, 'SKILL.md').artifactClass, 'skill_definition');
      assert.equal(docReport(report, 'scripts/refresh.py').status, 'execution_not_allowed');
    });

    it('consumes fixture previews read-only and preserves contentSha256 digests', () => {
      const corpus = loadCorpus();
      const before = structuredClone(corpus);
      for (const f of corpus.fixtures) {
        runOkfConformanceDiagnostics(conformanceInputFromOkfOpenKbFixture(f));
        assert.equal(
          fixtureContentHash(f.files),
          f.contentSha256,
          `${f.id} contentSha256 must still match the checker recipe after conformance consumption`,
        );
      }
      assert.deepEqual(corpus, before, 'conformance must never mutate the corpus fixtures');
    });

    it('fails closed on a fixture without usable files', () => {
      const report = runOkfConformanceDiagnostics(conformanceInputFromOkfOpenKbFixture({ id: 'broken' }));
      assert.equal(report.verdict, 'blocked');
      assert.ok(report.codes.includes('bundle_malformed'));
    });
  });

  it('is offline-only: the module imports nothing from network/fs/exec and contains no async surface', () => {
    const sourcePath = fileURLToPath(new URL('../src/okf-conformance.ts', import.meta.url));
    const source = readFileSync(sourcePath, 'utf8');
    for (const banned of [
      'ethers',
      'web3',
      'viem',
      'node:net',
      'node:http',
      'node:https',
      'node:fs',
      'node:child_process',
      'child_process',
      'fetch(',
      'XMLHttpRequest',
    ]) {
      assert.ok(!source.includes(banned), `module must not reference ${banned}`);
    }
    assert.ok(!/\basync\b/.test(source), 'module must not contain async code');
    assert.ok(!/\bawait\b/.test(source), 'module must not contain await');
  });

  it('tags OKF-semantic claims as DRAFT/unverified in source', () => {
    const sourcePath = fileURLToPath(new URL('../src/okf-conformance.ts', import.meta.url));
    const source = readFileSync(sourcePath, 'utf8');
    assert.ok(source.includes('DRAFT/unverified — OKF'), 'OKF semantics must carry the draft/unverified tag');
  });
});
