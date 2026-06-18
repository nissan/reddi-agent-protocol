import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  aiCatalogFixtureCases,
  aiCatalogFixtures,
  createAiCatalogSnapshot,
  validateAiCatalog,
  type AiCatalogValidationErrorCode,
} from '../dist/index.js';

function assertErrorCodes(actual: AiCatalogValidationErrorCode[], expected: AiCatalogValidationErrorCode[]): void {
  for (const code of expected) {
    assert.ok(actual.includes(code), `expected validation errors to include ${code}`);
  }
}

describe('AI Catalog ingestion', () => {
  it('validates fixture-backed catalog cases with expected outcomes', () => {
    const expectedCases = [
      'happyPath',
      'nestedCatalog',
      'malformedCatalog',
      'unsupportedResourceType',
      'unsafeUrl',
      'credentialLeakage',
    ];

    assert.deepEqual(Object.keys(aiCatalogFixtureCases).sort(), expectedCases.sort());
    for (const fixture of Object.values(aiCatalogFixtureCases)) {
      const result = validateAiCatalog(fixture.catalog, { rawSnapshotRef: `fixture:${fixture.description}` });
      assert.equal(result.ok, fixture.expectedValid, fixture.description);
      if (!result.ok) {
        assertErrorCodes(result.errors.map((item) => item.code), fixture.expectedErrorCodes);
      }
    }
  });

  it('stores valid AI Catalog resources as untrusted external snapshots', () => {
    const result = validateAiCatalog(aiCatalogFixtures.happyPath, {
      rawSnapshotRef: 'sha256:fixture-happy-path',
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.catalog.schemaVersion, 'ai-catalog.v1');
      assert.equal(result.catalog.publisher.id, 'reddi.tech');
      assert.equal(result.catalog.rawSnapshotRef, 'sha256:fixture-happy-path');
      assert.equal(result.catalog.resources.length, 2);
      assert.equal(result.catalog.resources[0].id, 'urn:ai:reddi.tech:specialists:code-review');
      assert.equal(result.catalog.resources[0].type, 'application/mcp-server-card+json');
      assert.equal(result.catalog.resources[0].mediaType, 'application/mcp-server-card+json');
      assert.equal(result.catalog.resources[0].url, 'https://agents.reddi.tech/code-review/mcp.json');
      assert.deepEqual(result.catalog.resources[0].payment, {
        protocol: 'rap',
        quoteMode: 'preflight',
        assets: [{ asset: 'AUDD', network: 'solana-devnet' }],
      });
      assert.deepEqual(result.catalog.resources[0].auth, {
        type: 'oauth',
        scopes: ['repo:read'],
      });
      assert.deepEqual(result.catalog.resources[0].trustManifest, {
        identity: 'urn:ai:reddi.tech:specialists:code-review',
        signature: {
          format: 'dsse',
          status: 'claimed',
        },
      });
    }
  });

  it('accepts localhost HTTP only for local fixtures', () => {
    const result = validateAiCatalog(aiCatalogFixtures.localhostFixture);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.catalog.resources[0].url, 'http://localhost:4317/mcp');
    }
  });

  it('accepts current AI Catalog spec-shaped entries', () => {
    const result = validateAiCatalog({
      specVersion: '1.0',
      entries: [
        {
          identifier: 'urn:example:mcp:weather',
          displayName: 'Weather Service',
          mediaType: 'application/mcp-server-card+json',
          url: 'https://api.example.com/.well-known/mcp/server-card.json',
        },
      ],
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.catalog.publisher.id, 'unknown');
      assert.equal(result.catalog.resources[0].id, 'urn:example:mcp:weather');
      assert.equal(result.catalog.resources[0].name, 'Weather Service');
      assert.equal(result.catalog.resources[0].mediaType, 'application/mcp-server-card+json');
    }
  });

  it('rejects malformed or oversized catalogs before callers can persist them', () => {
    const malformed = validateAiCatalog(null);
    assert.equal(malformed.ok, false);
    if (!malformed.ok) {
      assert.ok(malformed.errors.some((item) => item.code === 'malformed_catalog' && item.path === '$'));
    }

    const oversized = validateAiCatalog(aiCatalogFixtures.happyPath, { maxBytes: 16 });
    assert.equal(oversized.ok, false);
    if (!oversized.ok) {
      assert.ok(oversized.errors.some((item) => item.code === 'catalog_too_large' && item.path === '$'));
    }
  });

  it('rejects unsafe references including embedded credentials and non-HTTPS URLs', () => {
    const probes = [
      {
        expected: 'unsafe_url',
        catalog: {
          specVersion: '1.0',
          host: 'reddi.tech',
          entries: [
            {
              identifier: 'urn:ai:reddi.tech:specialists:embedded-creds',
              mediaType: 'application/mcp-server-card+json',
              displayName: 'Embedded Credentials',
              url: 'https://user:pass@agents.reddi.tech/unsafe',
            },
          ],
        },
      },
      {
        expected: 'unsafe_url',
        catalog: {
          specVersion: '1.0',
          host: 'reddi.tech',
          entries: [
            {
              identifier: 'urn:ai:reddi.tech:specialists:http',
              mediaType: 'application/mcp-server-card+json',
              displayName: 'Plain HTTP',
              url: 'http://agents.reddi.tech/unsafe',
            },
          ],
        },
      },
      {
        expected: 'credential_leakage_rejected',
        catalog: {
          specVersion: '1.0',
          host: 'reddi.tech',
          entries: [
            {
              identifier: 'urn:ai:reddi.tech:specialists:query-secret',
              mediaType: 'application/mcp-server-card+json',
              displayName: 'Query Secret',
              url: 'https://agents.reddi.tech/unsafe?access_token=redacted',
            },
          ],
        },
      },
      {
        expected: 'invalid_reference',
        catalog: {
          specVersion: '1.0',
          host: 'reddi.tech',
          entries: [
            {
              identifier: 'urn:ai:reddi.tech:specialists:not-url',
              mediaType: 'application/mcp-server-card+json',
              displayName: 'Not URL',
              url: 'not-a-url',
            },
          ],
        },
      },
    ] as const;

    for (const probe of probes) {
      const result = validateAiCatalog(probe.catalog);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.ok(result.errors.some((item) => item.code === probe.expected), `${probe.expected} should be present`);
      }
    }
  });

  it('enforces nested catalog and value/reference boundaries', () => {
    const catalogWithEndpoint = validateAiCatalog({
      specVersion: '1.0',
      host: 'reddi.tech',
      entries: [
        {
          identifier: 'urn:ai:reddi.tech:catalogs:bad-boundary',
          mediaType: 'application/ai-catalog+json',
          displayName: 'Bad Boundary',
          endpoint: 'https://agents.reddi.tech/catalog-endpoint',
        },
      ],
    });
    assert.equal(catalogWithEndpoint.ok, false);
    if (!catalogWithEndpoint.ok) {
      assert.ok(catalogWithEndpoint.errors.some((item) => item.code === 'nested_catalog_boundary'));
    }

    const nonCatalogWithCatalogUrl = validateAiCatalog({
      publisher: 'reddi.tech',
      resources: [
        {
          id: 'urn:ai:reddi.tech:specialists:bad-nested-reference',
          type: 'agent',
          name: 'Bad Nested Reference',
          catalogUrl: 'https://agents.reddi.tech/.well-known/catalog.json',
        },
      ],
    });
    assert.equal(nonCatalogWithCatalogUrl.ok, false);
    if (!nonCatalogWithCatalogUrl.ok) {
      assert.ok(nonCatalogWithCatalogUrl.errors.some((item) => item.code === 'nested_catalog_boundary'));
    }

    const mixedInlineAndReference = validateAiCatalog({
      specVersion: '1.0',
      host: 'reddi.tech',
      entries: [
        {
          identifier: 'urn:ai:reddi.tech:specialists:mixed',
          mediaType: 'application/mcp-server-card+json',
          displayName: 'Mixed',
          url: 'https://agents.reddi.tech/mixed',
          data: { transport: 'mcp' },
        },
      ],
    });
    assert.equal(mixedInlineAndReference.ok, false);
    if (!mixedInlineAndReference.ok) {
      assert.ok(mixedInlineAndReference.errors.some((item) => item.code === 'invalid_reference'));
    }

    const multipleReferences = validateAiCatalog({
      specVersion: '1.0',
      host: 'reddi.tech',
      entries: [
        {
          identifier: 'urn:ai:reddi.tech:specialists:multi-ref',
          mediaType: 'application/mcp-server-card+json',
          displayName: 'Multi Reference',
          url: 'https://agents.reddi.tech/multi-ref',
          endpoint: 'https://agents.reddi.tech/multi-ref/invoke',
        },
      ],
    });
    assert.equal(multipleReferences.ok, false);
    if (!multipleReferences.ok) {
      assert.ok(multipleReferences.errors.some((item) => item.code === 'invalid_reference'));
    }
  });

  it('rejects credential-shaped keys and non-serializable malformed catalogs without throwing', () => {
    const bareToken = validateAiCatalog({
      specVersion: '1.0',
      host: 'reddi.tech',
      entries: [
        {
          identifier: 'urn:ai:reddi.tech:specialists:token-key',
          mediaType: 'application/mcp-server-card+json',
          displayName: 'Token Key',
          url: 'https://agents.reddi.tech/token-key',
          metadata: {
            token: 'redacted',
          },
        },
      ],
    });
    assert.equal(bareToken.ok, false);
    if (!bareToken.ok) {
      assert.ok(bareToken.errors.some((item) => item.code === 'credential_leakage_rejected'));
    }

    const circular: Record<string, unknown> = { specVersion: '1.0', entries: [] };
    circular.self = circular;
    assert.doesNotThrow(() => validateAiCatalog(circular));
    const circularResult = validateAiCatalog(circular);
    assert.equal(circularResult.ok, false);
    if (!circularResult.ok) {
      assert.ok(circularResult.errors.some((item) => item.code === 'malformed_catalog'));
    }

    assert.doesNotThrow(() => validateAiCatalog({ specVersion: '1.0', entries: [], metadata: { count: 1n } }));
    const bigintResult = validateAiCatalog({ specVersion: '1.0', entries: [], metadata: { count: 1n } });
    assert.equal(bigintResult.ok, false);
    if (!bigintResult.ok) {
      assert.ok(bigintResult.errors.some((item) => item.code === 'malformed_catalog'));
    }
  });

  it('throws when creating an invalid snapshot', () => {
    assert.throws(
      () => createAiCatalogSnapshot(aiCatalogFixtureCases.credentialLeakage.catalog),
      /invalid_ai_catalog:credential_leakage_rejected/,
    );
  });
});
