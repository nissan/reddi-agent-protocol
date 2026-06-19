import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  agentStackFixtureCases,
  agentStackFixtureCorpora,
  createAgentStackFixtureCorpus,
  createStaticAgentStackIngestionResult,
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
      'solanaAiKit',
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

  it('records public source provenance for the Solana AI Kit fixture', () => {
    const result = validateAgentStackFixtureCorpus(agentStackFixtureCorpora.solanaAiKit);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.corpus.schemaVersion, 'reddi.agent-stack-fixture-corpus.v1');
      assert.equal(result.corpus.source.sourceUrl, 'https://github.com/solanabr/solana-ai-kit');
      assert.equal(result.corpus.source.checkedCommit, '4fb9d3d619467e068c1cf3120d3933aa933aeb21');
      assert.equal(result.corpus.source.checkedRef, 'main');
      assert.equal(result.corpus.source.license, 'MIT');
      assert.equal(
        result.corpus.source.localResearchArtifactPath,
        'projects/reddi-agent-protocol/research/SOLANABR-SOLANA-AI-KIT-ANALYSIS-2026-06-19.md',
      );
      assert.ok(result.corpus.source.authenticityNotes.some((note) => note.includes('solanabr')));
      assert.equal(result.corpus.staticOnly, true);
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

  it('represents Solana AI Kit plugin, agent, command, MCP, hook, and submodule surfaces statically', () => {
    const corpus = createAgentStackFixtureCorpus(agentStackFixtureCorpora.solanaAiKit);
    const filesByPath = new Map(corpus.files.map((file) => [file.path, file]));
    const surfaceKindForPath = (path: string, kind: string): boolean => corpus.surfaces.some((surface) => (
      surface.path === path && surface.kind === kind
    ));

    assert.equal(surfaceKindForPath('.claude-plugin/marketplace.json', 'repo-marketplace-metadata'), true);
    assert.equal(surfaceKindForPath('plugin/.claude-plugin/plugin.json', 'claude-plugin'), true);
    assert.equal(surfaceKindForPath('.claude/agents/*.md', 'subagent'), true);
    assert.equal(surfaceKindForPath('.claude/commands/*.md', 'command'), true);
    assert.equal(surfaceKindForPath('.mcp.json', 'mcp-connector-config'), true);
    assert.equal(surfaceKindForPath('plugin/hooks/hooks.json', 'command'), true);
    assert.equal(surfaceKindForPath('plugin/hooks/hooks.json', 'validation-warning'), true);
    assert.equal(surfaceKindForPath('.gitmodules', 'skill'), true);
    assert.equal(filesByPath.get('.mcp.json')?.parseStatus, 'valid');
    assert.deepEqual(filesByPath.get('.mcp.json')?.warningCodes, [
      'npx_mcp_execution',
      'env_required_connector',
      'local_binary_required',
    ]);
    assert.equal(filesByPath.get('install.sh')?.warningCodes?.includes('installer_script_non_executable_fixture'), true);
  });

  it('preserves the known malformed MCP config as a static warning without blocking unrelated surfaces', () => {
    const corpus = createAgentStackFixtureCorpus(agentStackFixtureCorpora.anthropicFinancialServices);
    const malformedFile = corpus.files.find((file) => file.path === 'plugins/vertical-plugins/financial-analysis/.mcp.json');
    const pluginSurface = corpus.surfaces.find((surface) => surface.kind === 'claude-plugin');

    assert.equal(malformedFile?.parseStatus, 'malformed');
    assert.equal(malformedFile?.parseErrorLocation, 'line 1 column 1');
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

  it('documents Solana AI Kit non-goals so tests never imply installation, MCP contact, wallet, RPC, or payment behavior', () => {
    const corpus = createAgentStackFixtureCorpus(agentStackFixtureCorpora.solanaAiKit);
    const nonGoals = corpus.nonGoals.join(' ');

    assert.match(nonGoals, /Do not install Solana AI Kit/);
    assert.match(nonGoals, /Do not execute install\.sh/);
    assert.match(nonGoals, /Do not contact MCP servers, Solana RPC, wallets/);
    assert.match(nonGoals, /Do not add Helius, QuickNode, Pyth, Nansen/);
    assert.match(nonGoals, /Do not implement AUDD, x402, Quasar, receipt, or payment behavior/);
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

  it('rejects unsupported surface and file kinds at runtime', () => {
    const unsupportedKinds = validateAgentStackFixtureCorpus({
      ...agentStackFixtureCorpora.anthropicFinancialServices,
      surfaces: [
        {
          ...agentStackFixtureCorpora.anthropicFinancialServices.surfaces[0],
          kind: 'wallet-payment-executor',
        },
      ],
      files: [
        {
          ...agentStackFixtureCorpora.anthropicFinancialServices.files[0],
          kind: 'network-installer',
        },
      ],
    });

    assert.equal(unsupportedKinds.ok, false);
    if (!unsupportedKinds.ok) {
      assert.ok(unsupportedKinds.errors.some((item) => item.path === '$.surfaces[0].kind'));
      assert.ok(unsupportedKinds.errors.some((item) => item.path === '$.files[0].kind'));
    }
  });

  it('rejects malformed validation warning entries before exposing typed warnings', () => {
    const malformedWarning = validateAgentStackFixtureCorpus({
      ...agentStackFixtureCorpora.anthropicFinancialServices,
      validationWarnings: [
        {
          code: '',
          severity: 'approved',
          path: '../escape',
          message: '',
        },
      ],
    });

    assert.equal(malformedWarning.ok, false);
    if (!malformedWarning.ok) {
      assert.ok(malformedWarning.errors.some((item) => item.path === '$.validationWarnings[0].code'));
      assert.ok(malformedWarning.errors.some((item) => item.path === '$.validationWarnings[0].severity'));
      assert.ok(malformedWarning.errors.some((item) => item.path === '$.validationWarnings[0].path'));
      assert.ok(malformedWarning.errors.some((item) => item.path === '$.validationWarnings[0].message'));
    }
  });

  it('rejects absolute URI and drive-style fixture paths', () => {
    const unsafePaths = validateAgentStackFixtureCorpus({
      ...agentStackFixtureCorpora.anthropicFinancialServices,
      surfaces: [
        {
          ...agentStackFixtureCorpora.anthropicFinancialServices.surfaces[0],
          path: '/etc/passwd',
        },
      ],
      files: [
        {
          ...agentStackFixtureCorpora.anthropicFinancialServices.files[0],
          path: 'file:/etc/passwd',
        },
      ],
      validationWarnings: [
        {
          ...agentStackFixtureCorpora.anthropicFinancialServices.validationWarnings[0],
          path: 'C:/Users/loki/secret',
        },
      ],
    });

    assert.equal(unsafePaths.ok, false);
    if (!unsafePaths.ok) {
      assert.ok(unsafePaths.errors.some((item) => item.path === '$.surfaces[0].path'));
      assert.ok(unsafePaths.errors.some((item) => item.path === '$.files[0].path'));
      assert.ok(unsafePaths.errors.some((item) => item.path === '$.validationWarnings[0].path'));
    }
  });

  it('rejects malformed optional typed fields before returning a typed corpus', () => {
    const malformedOptionals = validateAgentStackFixtureCorpus({
      ...agentStackFixtureCorpora.anthropicFinancialServices,
      source: {
        ...agentStackFixtureCorpora.anthropicFinancialServices.source,
        checkedRef: 123,
        license: ['Apache-2.0'],
      },
      surfaces: [
        {
          ...agentStackFixtureCorpora.anthropicFinancialServices.surfaces[1],
          commands: [42],
          writeCapable: 'yes',
          notes: [false],
        },
      ],
      files: [
        {
          ...agentStackFixtureCorpora.anthropicFinancialServices.files[0],
          mediaType: {},
          summary: [],
          warningCodes: [1],
        },
      ],
    });

    assert.equal(malformedOptionals.ok, false);
    if (!malformedOptionals.ok) {
      for (const path of [
        '$.source.checkedRef',
        '$.source.license',
        '$.surfaces[0].commands',
        '$.surfaces[0].writeCapable',
        '$.surfaces[0].notes',
        '$.files[0].mediaType',
        '$.files[0].summary',
        '$.files[0].warningCodes',
      ]) {
        assert.ok(malformedOptionals.errors.some((item) => item.path === path), `${path} should fail validation`);
      }
    }
  });

  it('rejects loose or normalized-invalid crawl timestamps', () => {
    for (const crawlTimestamp of ['June 18, 2026 10:50', '2026', '2026-02-30T00:00:00Z']) {
      const malformedTimestamp = validateAgentStackFixtureCorpus({
        ...agentStackFixtureCorpora.anthropicFinancialServices,
        source: {
          ...agentStackFixtureCorpora.anthropicFinancialServices.source,
          crawlTimestamp,
        },
      });

      assert.equal(malformedTimestamp.ok, false, `${crawlTimestamp} should fail`);
      if (!malformedTimestamp.ok) {
        assert.ok(malformedTimestamp.errors.some((item) => item.path === '$.source.crawlTimestamp'));
      }
    }
  });

  it('creates a deterministic static ingestion result envelope with partial success diagnostics', () => {
    const result = createStaticAgentStackIngestionResult(agentStackFixtureCorpora.anthropicFinancialServices);

    assert.equal(result.schemaVersion, 'reddi.static-agent-stack-ingestion-result.v1');
    assert.equal(result.corpusId, agentStackFixtureCorpora.anthropicFinancialServices.id);
    assert.equal(result.status, 'partial_success');
    assert.equal(result.staticOnly, true);
    assert.equal(result.inventory.some((entry) => entry.kind === 'claude-plugin'), true);
    assert.equal(result.inventory.some((entry) => entry.kind === 'validation-warning'), false);
    assert.equal(result.inventory.find((entry) => entry.kind === 'claude-plugin')?.writeCapable, true);
    assert.deepEqual(
      result.connectorDiagnostics.map((diagnostic) => [
        diagnostic.path,
        diagnostic.sourceKind,
        diagnostic.diagnosticLane,
        diagnostic.parseStatus,
        diagnostic.parseErrorLocation,
        diagnostic.warningCodes,
        diagnostic.blocksDraftPayload,
        diagnostic.operatorReviewRequired,
      ]),
      [[
        'plugins/vertical-plugins/financial-analysis/.mcp.json',
        'mcp-connector-config',
        'mcp_connector_metadata',
        'malformed',
        'line 1 column 1',
        ['malformed_mcp_json'],
        true,
        true,
      ]],
    );
    assert.equal(result.rejectedEntries.length, 0);
    assert.equal(result.draftPayloadReadiness.status, 'blocked');
    assert.ok(result.draftPayloadReadiness.blockers.includes('malformed_connector:plugins/vertical-plugins/financial-analysis/.mcp.json'));
    assert.deepEqual(result.draftPayloadReadiness.payloadRefs, []);
    assert.doesNotThrow(() => JSON.stringify(result));
  });

  it('keeps Solana AI Kit ingestion blocked for executable hooks and deploy-capable command metadata', () => {
    const result = createStaticAgentStackIngestionResult(agentStackFixtureCorpora.solanaAiKit);
    const inventoryKinds = new Set(result.inventory.map((entry) => entry.kind));

    assert.equal(result.schemaVersion, 'reddi.static-agent-stack-ingestion-result.v1');
    assert.equal(result.corpusId, agentStackFixtureCorpora.solanaAiKit.id);
    assert.equal(result.status, 'blocked');
    assert.equal(result.staticOnly, true);
    assert.ok(inventoryKinds.has('subagent'));
    assert.ok(inventoryKinds.has('command'));
    assert.ok(inventoryKinds.has('mcp-connector-config'));
    assert.equal(result.inventory.find((entry) => entry.sourcePath === 'plugin/hooks/hooks.json')?.writeCapable, true);
    assert.deepEqual(
      result.connectorDiagnostics.map((diagnostic) => [
        diagnostic.path,
        diagnostic.sourceKind,
        diagnostic.diagnosticLane,
        diagnostic.parseStatus,
        diagnostic.severity,
        diagnostic.warningCodes,
        diagnostic.blocksDraftPayload,
        diagnostic.operatorReviewRequired,
      ]),
      [
        [
          '.mcp.json',
          'mcp-connector-config',
          'mcp_connector_metadata',
          'valid',
          'warning',
          ['npx_mcp_execution', 'env_required_connector', 'local_binary_required'],
          false,
          true,
        ],
      ],
    );
    assert.deepEqual(
      result.rejectedEntries.map((entry) => entry.reasonCode).sort(),
      ['executable_hooks_require_operator_review', 'solana_deploy_command_requires_operator_review'],
    );
    assert.equal(result.draftPayloadReadiness.status, 'blocked');
    assert.ok(result.draftPayloadReadiness.blockers.includes('executable_hooks_require_operator_review'));
    assert.ok(result.draftPayloadReadiness.blockers.includes('solana_deploy_command_requires_operator_review'));
    assert.deepEqual(result.draftPayloadReadiness.payloadRefs, []);
  });

  it('marks blocked validation warnings as rejected entries without losing unrelated inventory', () => {
    const blockedResult = createStaticAgentStackIngestionResult({
      ...agentStackFixtureCorpora.anthropicFinancialServices,
      validationWarnings: [
        ...agentStackFixtureCorpora.anthropicFinancialServices.validationWarnings,
        {
          code: 'unsafe_metadata',
          severity: 'blocked',
          path: 'plugins/partner-plugins/example/plugin.json',
          message: 'Unsafe imported metadata must not be exposed to draft publication.',
        },
      ],
    });

    assert.equal(blockedResult.status, 'blocked');
    assert.equal(blockedResult.rejectedEntries.length, 1);
    assert.deepEqual(blockedResult.rejectedEntries[0], {
      path: 'plugins/partner-plugins/example/plugin.json',
      reasonCode: 'unsafe_metadata',
      message: 'Unsafe imported metadata must not be exposed to draft publication.',
    });
    assert.ok(blockedResult.inventory.some((entry) => entry.kind === 'managed-agent-cookbook'));
  });

  it('creates ready payload references only when the corpus has no warnings or connector blockers', () => {
    const readyResult = createStaticAgentStackIngestionResult({
      ...agentStackFixtureCorpora.anthropicFinancialServices,
      files: agentStackFixtureCorpora.anthropicFinancialServices.files.map((file) => file.kind === 'mcp-connector-config'
        ? {
          ...file,
          parseStatus: 'valid',
          warningCodes: [],
        }
        : file),
      validationWarnings: [],
    });

    assert.equal(readyResult.status, 'ready_for_draft');
    assert.equal(readyResult.draftPayloadReadiness.status, 'ready');
    assert.deepEqual(readyResult.draftPayloadReadiness.payloadRefs, [
      'static-ingestion:agent-stack-fixture:anthropic-financial-services:2026-06-18:draft-profile',
      'static-ingestion:agent-stack-fixture:anthropic-financial-services:2026-06-18:draft-listing',
    ]);
  });

  it('blocks draft readiness when an MCP connector surface has no matching connector file diagnostic', () => {
    const missingConnectorFileResult = createStaticAgentStackIngestionResult({
      ...agentStackFixtureCorpora.anthropicFinancialServices,
      files: agentStackFixtureCorpora.anthropicFinancialServices.files.filter((file) => file.kind !== 'mcp-connector-config'),
      validationWarnings: [],
    });

    assert.equal(missingConnectorFileResult.status, 'partial_success');
    assert.deepEqual(
      missingConnectorFileResult.connectorDiagnostics.map((diagnostic) => [
        diagnostic.path,
        diagnostic.sourceKind,
        diagnostic.diagnosticLane,
        diagnostic.parseStatus,
        diagnostic.severity,
        diagnostic.warningCodes,
        diagnostic.blocksDraftPayload,
        diagnostic.operatorReviewRequired,
      ]),
      [
        [
          'plugins/vertical-plugins/financial-analysis/.mcp.json',
          'mcp-connector-config',
          'mcp_connector_metadata',
          'missing',
          'blocked',
          ['missing_mcp_connector_config'],
          true,
          true,
        ],
      ],
    );
    assert.equal(missingConnectorFileResult.draftPayloadReadiness.status, 'blocked');
    assert.ok(
      missingConnectorFileResult.draftPayloadReadiness.blockers.includes(
        'missing_connector:plugins/vertical-plugins/financial-analysis/.mcp.json',
      ),
    );
    assert.deepEqual(missingConnectorFileResult.draftPayloadReadiness.payloadRefs, []);
  });

  it('keeps #404 diagnostics scoped to MCP connector metadata and leaves non-MCP risk taxonomy to #421', () => {
    const connectorRiskResult = createStaticAgentStackIngestionResult({
      ...agentStackFixtureCorpora.solanaAiKit,
      files: agentStackFixtureCorpora.solanaAiKit.files.map((file) => file.path === '.mcp.json'
        ? {
          ...file,
          warningCodes: ['unsafe_connector_url', 'credential_shaped_connector_value', 'write_capable_connector_claim'],
        }
        : file),
      validationWarnings: agentStackFixtureCorpora.solanaAiKit.validationWarnings.filter((warning) => (
        warning.path !== '.mcp.json'
      )),
    });
    const diagnostic = connectorRiskResult.connectorDiagnostics.find((item) => item.path === '.mcp.json');

    assert.deepEqual(diagnostic, {
      path: '.mcp.json',
      sourceKind: 'mcp-connector-config',
      diagnosticLane: 'mcp_connector_metadata',
      parseStatus: 'valid',
      severity: 'info',
      warningCodes: ['unsafe_connector_url', 'credential_shaped_connector_value', 'write_capable_connector_claim'],
      blocksDraftPayload: false,
      operatorReviewRequired: true,
      message: 'Connector metadata is statically valid.',
    });
    assert.ok(!diagnostic.warningCodes.includes('executable_hooks'));
    assert.ok(!diagnostic.warningCodes.includes('mainnet_deploy_guard_required'));
    assert.ok(!diagnostic.warningCodes.includes('external_submodules_declared'));
    assert.equal(connectorRiskResult.draftPayloadReadiness.blockers.includes('executable_hooks_require_operator_review'), true);
    assert.equal(connectorRiskResult.draftPayloadReadiness.blockers.includes('solana_deploy_command_requires_operator_review'), true);
  });

  it('does not expose a static ingestion result for invalid or credential-shaped corpora', () => {
    assert.throws(
      () => createStaticAgentStackIngestionResult({
        ...agentStackFixtureCorpora.anthropicFinancialServices,
        surfaces: [
          {
            ...agentStackFixtureCorpora.anthropicFinancialServices.surfaces[0],
            apiKey: 'sk-not-real-but-secret-shaped',
          },
        ],
      }),
      /invalid_agent_stack_fixture_corpus:credential_leakage_rejected/,
    );

    assert.throws(
      () => createStaticAgentStackIngestionResult({
        ...agentStackFixtureCorpora.anthropicFinancialServices,
        files: [
          {
            ...agentStackFixtureCorpora.anthropicFinancialServices.files[0],
            path: '/tmp/secret',
          },
        ],
      }),
      /invalid_agent_stack_fixture_corpus:invalid_source_reference/,
    );
  });
});
