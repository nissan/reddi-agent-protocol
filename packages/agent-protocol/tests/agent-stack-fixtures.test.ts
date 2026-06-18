import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  agentStackFixtureCases,
  agentStackFixtureCorpora,
  createAgentStackFixtureCorpus,
  validateAgentStackFixtureCorpus,
  type AgentStackFixtureValidationErrorCode,
} from '../dist/index.js';

function assertErrorCodes(
  actual: AgentStackFixtureValidationErrorCode[],
  expected: AgentStackFixtureValidationErrorCode[],
): void {
  for (const code of expected) {
    assert.ok(actual.includes(code), `expected validation errors to include ${code}`);
  }
}

describe('agent-stack fixture corpus', () => {
  it('validates fixture-backed corpus cases with expected outcomes', () => {
    const expectedCases = [
      'anthropicFinancialServices',
      'malformedCorpus',
      'invalidCommit',
      'unsafeSourceUrl',
      'credentialLeakage',
    ];

    assert.deepEqual(Object.keys(agentStackFixtureCases).sort(), expectedCases.sort());
    for (const fixture of Object.values(agentStackFixtureCases)) {
      const result = validateAgentStackFixtureCorpus(fixture.corpus);
      assert.equal(result.ok, fixture.expectedValid, fixture.description);
      if (!result.ok) {
        assertErrorCodes(result.errors.map((item) => item.code), fixture.expectedErrorCodes);
      }
    }
  });

  it('records public source provenance for the Anthropic financial-services fixture', () => {
    const result = validateAgentStackFixtureCorpus(agentStackFixtureCorpora.anthropicFinancialServices);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.corpus.schemaVersion, 'reddi.agent-stack-fixture-corpus.v1');
      assert.equal(result.corpus.source.sourceUrl, 'https://github.com/anthropics/financial-services');
      assert.equal(result.corpus.source.checkedCommit, '4bbabc7cd1a474c1667fa05a2bfe58e411dcf9c1');
      assert.equal(
        result.corpus.source.localResearchArtifactPath,
        'projects/reddi-agent-protocol/research/ANTHROPIC-FINANCIAL-SERVICES-REPO-ANALYSIS-2026-06-18.md',
      );
      assert.equal(result.corpus.source.license, 'Apache-2.0');
      assert.ok(result.corpus.source.authenticityNotes.some((note) => note.includes('anthropic.com')));
      assert.equal(result.corpus.staticOnly, true);
    }
  });

  it('can represent marketplace, plugin, managed-agent, MCP, and validation warning surfaces', () => {
    const corpus = createAgentStackFixtureCorpus(agentStackFixtureCorpora.anthropicFinancialServices);
    const surfaceKinds = new Set(corpus.surfaces.map((surface) => surface.kind));
    const fileKinds = new Set(corpus.files.map((file) => file.kind));

    assert.ok(surfaceKinds.has('repo-marketplace-metadata'));
    assert.ok(surfaceKinds.has('claude-plugin'));
    assert.ok(surfaceKinds.has('managed-agent-cookbook'));
    assert.ok(surfaceKinds.has('mcp-connector-config'));
    assert.ok(surfaceKinds.has('validation-warning'));
    assert.ok(fileKinds.has('repo-marketplace-metadata'));
    assert.ok(fileKinds.has('claude-plugin'));
    assert.ok(fileKinds.has('managed-agent-cookbook'));
    assert.ok(fileKinds.has('mcp-connector-config'));
  });

  it('preserves the known malformed MCP config as a static warning without blocking unrelated surfaces', () => {
    const corpus = createAgentStackFixtureCorpus(agentStackFixtureCorpora.anthropicFinancialServices);
    const malformedFile = corpus.files.find((file) => file.path === 'plugins/vertical-plugins/financial-analysis/.mcp.json');
    const pluginSurface = corpus.surfaces.find((surface) => surface.kind === 'claude-plugin');

    assert.equal(malformedFile?.parseStatus, 'malformed');
    assert.deepEqual(malformedFile?.warningCodes, ['malformed_mcp_json']);
    assert.equal(pluginSurface?.path, 'plugins/');
    assert.equal(corpus.validationWarnings[0].code, 'malformed_mcp_json');
  });

  it('marks public prompt, skill, command, and recipe text as untrusted static content', () => {
    const corpus = createAgentStackFixtureCorpus(agentStackFixtureCorpora.anthropicFinancialServices);
    const textBearingSurfaces = corpus.surfaces.filter((surface) => (
      surface.kind === 'claude-plugin' || surface.kind === 'managed-agent-cookbook'
    ));

    assert.ok(textBearingSurfaces.length >= 2);
    for (const surface of textBearingSurfaces) {
      assert.equal(surface.contentTrustBoundary, 'untrusted_public_text');
    }
    assert.ok(corpus.validationWarnings.some((warning) => warning.code === 'untrusted_prompt_text'));
  });

  it('documents static-only non-goals so tests never imply install, execution, paid calls, or credentials', () => {
    const corpus = createAgentStackFixtureCorpus(agentStackFixtureCorpora.anthropicFinancialServices);
    const nonGoals = corpus.nonGoals.join(' ');

    assert.match(nonGoals, /Do not install Claude plugins/);
    assert.match(nonGoals, /Do not execute repository scripts/);
    assert.match(nonGoals, /Do not fetch paid\/provider data or require credentials/);
    assert.match(nonGoals, /Do not publish imported surfaces as payable RAP listings/);
  });

  it('rejects oversized or non-serializable fixture corpora before persistence', () => {
    const oversized = validateAgentStackFixtureCorpus(agentStackFixtureCorpora.anthropicFinancialServices, { maxBytes: 16 });
    assert.equal(oversized.ok, false);
    if (!oversized.ok) {
      assert.ok(oversized.errors.some((item) => item.code === 'corpus_too_large'));
    }

    const circular: Record<string, unknown> = {
      ...agentStackFixtureCorpora.anthropicFinancialServices,
    };
    circular.self = circular;
    const nonSerializable = validateAgentStackFixtureCorpus(circular);
    assert.equal(nonSerializable.ok, false);
    if (!nonSerializable.ok) {
      assert.ok(nonSerializable.errors.some((item) => item.code === 'malformed_fixture_corpus'));
    }
  });
});
