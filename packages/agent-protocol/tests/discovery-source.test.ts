import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createAiCatalogDiscoveryCandidates,
  discoverySourceFixtures,
  evaluateDiscoveryCandidatePolicyPreflight,
  providerTrustFixtures,
  validateDiscoveryCandidate,
  type DiscoveryCandidate,
  type DiscoveryCandidateReasonCode,
} from '../dist/index.js';

function assertReasonCodes(actual: DiscoveryCandidateReasonCode[], expected: DiscoveryCandidateReasonCode[]): void {
  for (const code of expected) {
    assert.ok(actual.includes(code), `expected discovery reason codes to include ${code}`);
  }
}

describe('RAP discovery source candidates', () => {
  it('normalizes direct AI Catalog resources into policy-preflight candidates with trust records', () => {
    const result = createAiCatalogDiscoveryCandidates(providerTrustFixtures.verifiedCatalog, {
      relevanceScores: {
        'urn:ai:reddi.tech:specialists:code-review': 0.91,
      },
      trustOptionsByResourceId: {
        'urn:ai:reddi.tech:specialists:code-review': {
          verification: {
            status: 'verified',
            verifier: 'rap:unit-test',
          },
        },
      },
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.candidates.length, 1);
      const candidate = result.candidates[0];
      assert.equal(candidate.schemaVersion, 'reddi.discovery-candidate.v1');
      assert.equal(candidate.sourceKind, 'direct-ai-catalog');
      assert.equal(candidate.identifier, 'urn:ai:reddi.tech:specialists:code-review');
      assert.equal(candidate.publisher?.id, 'reddi.tech');
      assert.equal(candidate.resourceType, 'application/mcp-server-card+json');
      assert.equal(candidate.relevance?.score, 0.91);
      assert.equal(candidate.providerTrust?.schemaVersion, 'reddi.provider-trust.v1');
      assert.equal(candidate.providerTrust?.verification.status, 'verified');
      assert.equal(candidate.rawSnapshotRef, 'sha256:verified-catalog-fixture');
      assert.equal(candidate.policyPreflightRequired, true);
      assert.equal(candidate.quote, undefined);
    }
  });

  it('keeps unverified AI Catalog candidates separate from policy approval', () => {
    const result = createAiCatalogDiscoveryCandidates(providerTrustFixtures.unverifiedCatalog, {
      sourceKind: 'ard-registry',
      relevanceScores: {
        'urn:example:agents:summary': 0.84,
      },
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      const candidate = result.candidates[0];
      assert.equal(candidate.sourceKind, 'ard-registry');
      assert.equal(candidate.providerTrust?.verification.status, 'unverified');

      const decision = evaluateDiscoveryCandidatePolicyPreflight(
        {
          ...candidate,
          quote: { amount: '5000', asset: 'AUDD', network: 'solana-devnet' },
        },
        {
          allowedSourceKinds: ['ard-registry'],
          requireVerifiedTrust: true,
          allowedAssets: ['AUDD'],
          allowedNetworks: ['solana-devnet'],
          maxQuote: { amount: '10000', asset: 'AUDD', network: 'solana-devnet' },
        },
      );

      assert.equal(decision.allowed, false);
      assertReasonCodes(decision.reasonCodes, ['trust_verification_required']);
      assert.equal(decision.candidate.relevanceScore, 0.84);
      assert.equal(decision.candidate.trustStatus, 'unverified');
    }
  });

  it('validates local specialist and source-adapter candidate shapes without hosted infrastructure', () => {
    const local = validateDiscoveryCandidate(discoverySourceFixtures.localSpecialistCandidate);
    assert.equal(local.ok, true);
    if (local.ok) {
      assert.equal(local.candidate.sourceKind, 'local-specialist');
      assert.equal(local.candidate.endpoint, 'http://localhost:4100/mcp');
    }

    const sourceAdapter = validateDiscoveryCandidate({
      ...discoverySourceFixtures.localSpecialistCandidate,
      sourceKind: 'source-adapter',
      identifier: 'urn:ai:source-adapter:circle-x402:search',
      url: 'https://example.com/.well-known/source-adapter.json',
      endpoint: undefined,
    });
    assert.equal(sourceAdapter.ok, true);
    if (sourceAdapter.ok) assert.equal(sourceAdapter.candidate.sourceKind, 'source-adapter');
  });

  it('fails closed for malformed candidates and mismatched trust records', () => {
    const malformed = validateDiscoveryCandidate({
      sourceKind: 'direct-ai-catalog',
      identifier: 'urn:ai:bad',
      name: 'Bad Candidate',
      mediaType: 'application/mcp-server-card+json',
      relevance: { score: 2 },
    });
    assert.equal(malformed.ok, false);
    if (!malformed.ok) assertReasonCodes(malformed.errors.map((item) => item.code), ['malformed_candidate']);

    const malformedTrust = validateDiscoveryCandidate({
      ...discoverySourceFixtures.localSpecialistCandidate,
      providerTrust: {
        schemaVersion: 'reddi.provider-trust.v1',
      },
    });
    assert.equal(malformedTrust.ok, false);
    if (!malformedTrust.ok) assertReasonCodes(malformedTrust.errors.map((item) => item.code), ['malformed_candidate']);

    const malformedQuote = validateDiscoveryCandidate({
      ...discoverySourceFixtures.localSpecialistCandidate,
      quote: { amount: 'not-decimal', asset: 'AUDD', network: 'solana-devnet' },
    });
    assert.equal(malformedQuote.ok, false);
    if (!malformedQuote.ok) assertReasonCodes(malformedQuote.errors.map((item) => item.code), ['malformed_candidate']);

    const catalog = createAiCatalogDiscoveryCandidates(providerTrustFixtures.verifiedCatalog);
    assert.equal(catalog.ok, true);
    if (catalog.ok) {
      const mismatched = validateDiscoveryCandidate({
        ...catalog.candidates[0],
        identifier: 'urn:ai:other',
      });
      assert.equal(mismatched.ok, false);
      if (!mismatched.ok) assertReasonCodes(mismatched.errors.map((item) => item.code), ['provider_trust_mismatch']);
    }
  });

  it('requires explicit quote/payment preflight before invocation', () => {
    const candidate = discoverySourceFixtures.localSpecialistCandidate as DiscoveryCandidate;
    const decision = evaluateDiscoveryCandidatePolicyPreflight(
      {
        ...candidate,
        quote: undefined,
      },
      {
        allowedSourceKinds: ['local-specialist'],
        allowedAssets: ['AUDD'],
        allowedNetworks: ['solana-devnet'],
        maxQuote: { amount: '10000', asset: 'AUDD', network: 'solana-devnet' },
      },
    );

    assert.equal(decision.allowed, false);
    assertReasonCodes(decision.reasonCodes, ['missing_quote']);
    assert.ok(decision.auditNotes.some((note) => note.includes('quote/payment preflight')));

    const malformedQuote = evaluateDiscoveryCandidatePolicyPreflight(
      {
        ...candidate,
        quote: { amount: 'not-decimal', asset: 'AUDD', network: 'solana-devnet' },
      },
      {
        allowedSourceKinds: ['local-specialist'],
      },
    );
    assert.equal(malformedQuote.allowed, false);
    assertReasonCodes(malformedQuote.reasonCodes, ['malformed_candidate']);

    const numericQuote = evaluateDiscoveryCandidatePolicyPreflight(
      {
        ...candidate,
        quote: { amount: 5000, asset: 'AUDD', network: 'solana-devnet' } as unknown as DiscoveryCandidate['quote'],
      },
      {
        allowedSourceKinds: ['local-specialist'],
      },
    );
    assert.equal(numericQuote.allowed, false);
    assertReasonCodes(numericQuote.reasonCodes, ['malformed_candidate']);

    const boxedStringQuote = evaluateDiscoveryCandidatePolicyPreflight(
      {
        ...candidate,
        quote: { amount: new String('5000'), asset: 'AUDD', network: 'solana-devnet' } as unknown as DiscoveryCandidate['quote'],
      },
      {
        allowedSourceKinds: ['local-specialist'],
      },
    );
    assert.equal(boxedStringQuote.allowed, false);
    assertReasonCodes(boxedStringQuote.reasonCodes, ['malformed_candidate']);

    const malformedTrust = evaluateDiscoveryCandidatePolicyPreflight(
      {
        ...candidate,
        providerTrust: { schemaVersion: 'reddi.provider-trust.v1' } as DiscoveryCandidate['providerTrust'],
      },
      {
        allowedSourceKinds: ['local-specialist'],
        requireVerifiedTrust: true,
      },
    );
    assert.equal(malformedTrust.allowed, false);
    assertReasonCodes(malformedTrust.reasonCodes, ['trust_verification_required']);
  });

  it('does not let high relevance override budget, network, source, or trust policy', () => {
    const candidate = {
      ...(discoverySourceFixtures.localSpecialistCandidate as DiscoveryCandidate),
      sourceKind: 'direct-ai-catalog' as const,
      relevance: { score: 0.99, source: 'ard-registry' },
      quote: { amount: '20000', asset: 'AUDD', network: 'solana-mainnet' },
    };

    const decision = evaluateDiscoveryCandidatePolicyPreflight(candidate, {
      allowedSourceKinds: ['hosted-rap-registry'],
      requireVerifiedTrust: true,
      allowedAssets: ['AUDD'],
      allowedNetworks: ['solana-devnet'],
      maxQuote: { amount: '10000', asset: 'AUDD', network: 'solana-devnet' },
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.candidate.relevanceScore, 0.99);
    assertReasonCodes(decision.reasonCodes, [
      'source_not_allowed',
      'trust_verification_required',
      'unsupported_network',
      'over_budget',
    ]);
    assert.ok(decision.auditNotes[0].includes('Discovery relevance is informational only'));
  });

  it('allows a candidate only after source, quote, budget, network, asset, and trust policy pass', () => {
    const catalog = createAiCatalogDiscoveryCandidates(providerTrustFixtures.verifiedCatalog, {
      trustOptionsByResourceId: {
        'urn:ai:reddi.tech:specialists:code-review': {
          verification: { status: 'verified', verifier: 'rap:unit-test' },
        },
      },
    });

    assert.equal(catalog.ok, true);
    if (catalog.ok) {
      const candidate = {
        ...catalog.candidates[0],
        quote: { amount: '5000', asset: 'AUDD', network: 'solana-devnet' },
      };
      const decision = evaluateDiscoveryCandidatePolicyPreflight(candidate, {
        allowedSourceKinds: ['direct-ai-catalog'],
        requireVerifiedTrust: true,
        allowedAssets: ['AUDD'],
        allowedNetworks: ['solana-devnet'],
        maxQuote: { amount: '10000', asset: 'AUDD', network: 'solana-devnet' },
      });

      assert.equal(decision.allowed, true);
      assert.deepEqual(decision.reasonCodes, ['candidate_ready_for_policy_preflight']);
      assert.equal(decision.candidate.trustStatus, 'verified');
    }
  });
});
