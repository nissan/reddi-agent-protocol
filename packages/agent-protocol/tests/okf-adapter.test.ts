import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  adaptOpenKbBundleToOkf,
  openKbBundleFixtures,
  OKF_ADAPTER_SCHEMA_VERSION,
  OKF_ADAPTER_IS_DRAFT,
  type OpenKbBundleInput,
  type OkfAdapterBundle,
} from '../dist/index.js';

function representative(): OpenKbBundleInput {
  return structuredClone(openKbBundleFixtures.representative);
}

function findDoc(bundle: OkfAdapterBundle, id: string) {
  const doc = bundle.documents.find((d) => d.id === id);
  assert.ok(doc, `expected document ${id} in bundle`);
  return doc;
}

describe('OKF adapter (DRAFT v1 spike, #511)', () => {
  it('projects the representative fixture into a shape-valid OKF bundle with the draft flag', () => {
    const bundle = adaptOpenKbBundleToOkf(representative());

    assert.equal(bundle.schemaVersion, OKF_ADAPTER_SCHEMA_VERSION);
    assert.equal(bundle.schemaVersion, 'reddi.okf-adapter.v1');
    assert.equal(bundle.draft, true);
    assert.equal(OKF_ADAPTER_IS_DRAFT, true);
    assert.equal(bundle.adapterIntent, 'okf_shaped');
    assert.equal(bundle.bundleId, 'openkb-fixture:representative');
    assert.ok(bundle.reasonCodes.includes('okf_adapter_ok'));
    assert.equal(bundle.documents.length, 7);
  });

  it('is deterministic — identical input yields identical output', () => {
    const a = adaptOpenKbBundleToOkf(representative());
    const b = adaptOpenKbBundleToOkf(representative());
    assert.deepEqual(a, b);
  });

  it('converts deterministic wikilinks into standard markdown links', () => {
    const bundle = adaptOpenKbBundleToOkf(representative());
    const indexDoc = findDoc(bundle, 'index.md');

    // [[Agent Concept|Agents]] -> [Agents](<Agent Concept.md>)
    assert.match(indexDoc.body, /\[Agents\]\(<Agent Concept\.md>\)/);
    // [[Payment Concept]] -> [Payment Concept](<Payment Concept.md>)
    assert.match(indexDoc.body, /\[Payment Concept\]\(<Payment Concept\.md>\)/);
    assert.ok(!indexDoc.body.includes('[['), 'no raw wikilinks should remain for supported syntax');

    const wikiLinks = indexDoc.links.filter((l) => l.origin === 'wikilink');
    assert.equal(wikiLinks.length, 2);
    assert.ok(wikiLinks.some((l) => l.text === 'Agents' && l.target === 'Agent Concept.md'));
    // Native markdown link is preserved and tagged.
    assert.ok(indexDoc.links.some((l) => l.origin === 'markdown' && l.target === 'https://example.invalid/spec'));
  });

  it('emits diagnostics for unsupported wikilink syntax (embed + heading ref) and leaves them literal', () => {
    const bundle = adaptOpenKbBundleToOkf(representative());

    const agent = findDoc(bundle, 'concepts/agent.md');
    // heading-ref wikilink is unsupported and left literal
    assert.ok(agent.body.includes('[[Agent Concept#overview]]'));
    assert.ok(agent.diagnostics.some((d) => d.code === 'unsupported_link_syntax'));

    const payment = findDoc(bundle, 'concepts/payment.md');
    // embed/transclusion is unsupported and left literal
    assert.ok(payment.body.includes('![[diagram.png]]'));
    assert.ok(payment.diagnostics.some((d) => d.code === 'unsupported_link_syntax'));

    assert.ok(bundle.reasonCodes.includes('unsupported_link_syntax'));
  });

  it('preserves unknown frontmatter fields without treating them as trusted policy', () => {
    const bundle = adaptOpenKbBundleToOkf(representative());
    const agent = findDoc(bundle, 'concepts/agent.md');
    assert.equal(agent.frontmatter.custom_unknown_field, 'preserved-verbatim');
    assert.ok(agent.diagnostics.some((d) => d.code === 'unknown_frontmatter_preserved'));
  });

  it('requires a non-empty type for concept documents and flags the missing case', () => {
    const bundle = adaptOpenKbBundleToOkf(representative());
    const agent = findDoc(bundle, 'concepts/agent.md');
    assert.equal(agent.documentRole, 'concept');
    assert.equal(agent.type, 'concept');

    const payment = findDoc(bundle, 'concepts/payment.md');
    assert.equal(payment.documentRole, 'concept');
    assert.equal(payment.type, null);
    assert.ok(payment.diagnostics.some((d) => d.code === 'concept_type_missing'));
  });

  it('normalizes index.md and log.md into dedicated OKF sections', () => {
    const bundle = adaptOpenKbBundleToOkf(representative());

    assert.ok(bundle.index);
    assert.equal(bundle.index.documentId, 'index.md');
    assert.ok(bundle.index.entries.length >= 2);

    assert.ok(bundle.log);
    assert.equal(bundle.log.documentId, 'log.md');
    assert.equal(bundle.log.entryCount, 3); // heading + two list items
  });

  it('classifies AGENTS.md / SKILL.md / scripts as untrusted generated instruction artifacts', () => {
    const bundle = adaptOpenKbBundleToOkf(representative());

    for (const id of ['AGENTS.md', 'SKILL.md', 'scripts/build.sh']) {
      const doc = findDoc(bundle, id);
      assert.equal(doc.documentRole, 'instruction_artifact');
      assert.equal(doc.trustClassification, 'untrusted_generated_instruction');
      assert.ok(doc.diagnostics.some((d) => d.code === 'generated_instruction_untrusted'));
    }

    // Script/tool artifacts are additionally execution-not-allowed.
    const script = findDoc(bundle, 'scripts/build.sh');
    assert.ok(script.diagnostics.some((d) => d.code === 'execution_not_allowed' && d.severity === 'blocked'));
    assert.ok(bundle.reasonCodes.includes('execution_not_allowed'));
    assert.ok(bundle.reasonCodes.includes('generated_instruction_untrusted'));
  });

  it('never treats embedded instructions as trusted (guardrails all false)', () => {
    const bundle = adaptOpenKbBundleToOkf(representative());
    assert.deepEqual(bundle.guardrails, {
      network: false,
      fileSystemReadOfBundle: false,
      executed: false,
      installed: false,
      urlIngested: false,
      llmInvoked: false,
      skillGenerated: false,
      instructionsTrusted: false,
    });
  });

  it('emits missing_provenance when a document has no source refs', () => {
    const bundle = adaptOpenKbBundleToOkf(representative());
    const agents = findDoc(bundle, 'AGENTS.md');
    assert.equal(agents.provenance, null);
    assert.ok(agents.diagnostics.some((d) => d.code === 'missing_provenance'));
  });

  it('escalates missing provenance to blocked when requireProvenance is set', () => {
    const bundle = adaptOpenKbBundleToOkf(representative(), { requireProvenance: true });
    const agents = findDoc(bundle, 'AGENTS.md');
    assert.ok(agents.diagnostics.some((d) => d.code === 'missing_provenance' && d.severity === 'blocked'));
  });

  it('parses conservative flat rawFrontmatter and flags malformed lines', () => {
    const bundle = adaptOpenKbBundleToOkf({
      bundleId: 'b',
      documents: [
        {
          path: 'concepts/thing.md',
          rawFrontmatter: 'type: concept\ntitle: Thing\nthis line is not valid frontmatter\ncount: 3',
          body: 'body',
        },
      ],
    });
    const doc = findDoc(bundle, 'concepts/thing.md');
    assert.equal(doc.frontmatter.type, 'concept');
    assert.equal(doc.frontmatter.title, 'Thing');
    assert.equal(doc.frontmatter.count, 3);
    assert.ok(doc.diagnostics.some((d) => d.code === 'malformed_frontmatter'));
  });

  it('fails closed on non-object frontmatter (dropped, not trusted)', () => {
    const bundle = adaptOpenKbBundleToOkf({
      bundleId: 'b',
      documents: [{ path: 'concepts/x.md', frontmatter: 'not-an-object', body: '' }],
    });
    const doc = findDoc(bundle, 'concepts/x.md');
    assert.deepEqual(doc.frontmatter, {});
    assert.ok(doc.diagnostics.some((d) => d.code === 'malformed_frontmatter'));
  });

  describe('fail-closed cases', () => {
    it('blocks non-object input', () => {
      for (const bad of [null, undefined, 42, 'x', []]) {
        const bundle = adaptOpenKbBundleToOkf(bad);
        assert.equal(bundle.adapterIntent, 'blocked');
        assert.ok(bundle.reasonCodes.includes('bundle_malformed'));
        assert.equal(bundle.documents.length, 0);
      }
    });

    it('blocks a bundle with no documents', () => {
      const bundle = adaptOpenKbBundleToOkf({ bundleId: 'empty', documents: [] });
      assert.equal(bundle.adapterIntent, 'blocked');
      assert.ok(bundle.reasonCodes.includes('bundle_malformed'));
    });

    it('drops documents lacking a usable path and blocks when all are malformed', () => {
      const bundle = adaptOpenKbBundleToOkf({
        bundleId: 'b',
        documents: [{ frontmatter: {} }, { path: '' }, 123],
      });
      assert.equal(bundle.adapterIntent, 'blocked');
      assert.ok(bundle.reasonCodes.includes('document_malformed'));
    });

    it('fails closed on any request to execute/install/ingest/invoke/generate', () => {
      for (const opt of [
        { execute: true },
        { install: true },
        { ingestUrl: true },
        { invokeLlm: true },
        { generateSkill: true },
      ] as const) {
        const bundle = adaptOpenKbBundleToOkf(representative(), opt);
        assert.equal(bundle.adapterIntent, 'blocked');
        assert.deepEqual(bundle.reasonCodes, ['operation_not_permitted']);
        assert.equal(bundle.documents.length, 0);
      }
    });
  });

  it('is offline-only: imports nothing from network/fs/exec and contains no async surface', () => {
    const sourcePath = fileURLToPath(new URL('../src/okf-adapter.ts', import.meta.url));
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

  it('tags every externally-named OKF field as DRAFT/unverified in source', () => {
    const sourcePath = fileURLToPath(new URL('../src/okf-adapter.ts', import.meta.url));
    const source = readFileSync(sourcePath, 'utf8');
    assert.ok(source.includes('(DRAFT/unverified — OKF, confirm field'), 'OKF fields must carry the draft/unverified tag');
  });
});
