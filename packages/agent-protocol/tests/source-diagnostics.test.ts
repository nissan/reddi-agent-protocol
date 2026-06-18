import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createAiCatalogDiscoveryCandidates,
  createSourceAwareCandidateDiagnostics,
  evaluateDiscoveryCandidatePolicyPreflight,
  providerTrustFixtures,
  type DiscoveryCandidate,
} from '../dist/index.js';

describe('RAP source-aware candidate diagnostics', () => {
  it('separates capability, source, publisher, trust, policy, payment, and reputation lanes', () => {
    const candidates = createAiCatalogDiscoveryCandidates(providerTrustFixtures.verifiedCatalog, {
      relevanceScores: {
        'urn:ai:reddi.tech:specialists:code-review': 0.92,
      },
      trustOptionsByResourceId: {
        'urn:ai:reddi.tech:specialists:code-review': {
          verification: { status: 'verified', verifier: 'rap:unit-test' },
        },
      },
    });
    assert.equal(candidates.ok, true);
    if (!candidates.ok) return;

    const candidate = {
      ...candidates.candidates[0],
      quote: { amount: '5000', asset: 'AUDD', network: 'solana-devnet' },
    };
    const policyDecision = evaluateDiscoveryCandidatePolicyPreflight(candidate, {
      allowedSourceKinds: ['direct-ai-catalog'],
      requireVerifiedTrust: true,
      allowedAssets: ['AUDD'],
      allowedNetworks: ['solana-devnet'],
      maxQuote: { amount: '10000', asset: 'AUDD', network: 'solana-devnet' },
    });

    const diagnostics = createSourceAwareCandidateDiagnostics(candidate, {
      policyDecision,
      reputation: {
        receiptCount: 2,
        attestationCount: 1,
      },
    });

    assert.equal(diagnostics.schemaVersion, 'reddi.source-diagnostics.v1');
    assert.equal(diagnostics.capabilityMatch.relevanceScore, 0.92);
    assert.equal(diagnostics.capabilityMatch.scoreMeaning, 'relevance_only_not_trust');
    assert.equal(diagnostics.discoverySource.sourceKind, 'direct-ai-catalog');
    assert.equal(diagnostics.discoverySource.rawSnapshotRef, 'sha256:verified-catalog-fixture');
    assert.equal(diagnostics.publisherIdentity.id, 'reddi.tech');
    assert.equal(diagnostics.trustEvidence.status, 'verified');
    assert.equal(diagnostics.policyDecision.allowed, true);
    assert.deepEqual(diagnostics.policyDecision.reasonCodes, ['candidate_ready_for_policy_preflight']);
    assert.equal(diagnostics.paymentFit.quote?.asset, 'AUDD');
    assert.equal(diagnostics.reputationEvidence.status, 'history_present');

    const lanes = new Set(diagnostics.messages.map((message) => message.lane));
    assert.deepEqual([...lanes].sort(), [
      'capability_match',
      'discovery_source',
      'payment_fit',
      'policy_decision',
      'publisher_identity',
      'reputation_evidence',
      'trust_evidence',
    ].sort());
  });

  it('labels ARD relevance as relevance only and keeps high relevance from overriding denial lanes', () => {
    const candidates = createAiCatalogDiscoveryCandidates(providerTrustFixtures.unverifiedCatalog, {
      sourceKind: 'ard-registry',
      relevanceScores: {
        'urn:example:agents:summary': 0.99,
      },
    });
    assert.equal(candidates.ok, true);
    if (!candidates.ok) return;

    const candidate: DiscoveryCandidate = {
      ...candidates.candidates[0],
      quote: { amount: '20000', asset: 'AUDD', network: 'solana-mainnet' },
    };
    const policyDecision = evaluateDiscoveryCandidatePolicyPreflight(candidate, {
      allowedSourceKinds: ['ard-registry'],
      requireVerifiedTrust: true,
      allowedAssets: ['AUDD'],
      allowedNetworks: ['solana-devnet'],
      maxQuote: { amount: '10000', asset: 'AUDD', network: 'solana-devnet' },
    });
    assert.equal(policyDecision.allowed, false);

    const diagnostics = createSourceAwareCandidateDiagnostics(candidate, { policyDecision });
    assert.equal(diagnostics.capabilityMatch.relevanceScore, 0.99);
    assert.equal(diagnostics.capabilityMatch.scoreMeaning, 'relevance_only_not_trust');
    assert.equal(diagnostics.trustEvidence.status, 'unverified');
    assert.equal(diagnostics.policyDecision.allowed, false);
    assert.ok(diagnostics.policyDecision.reasonCodes.includes('trust_verification_required'));
    assert.ok(diagnostics.paymentFit.reasonCodes.includes('unsupported_network'));
    assert.ok(diagnostics.paymentFit.reasonCodes.includes('over_budget'));
    assert.equal(diagnostics.reputationEvidence.status, 'no_history');

    const blockedMessages = diagnostics.messages.filter((message) => message.severity === 'blocked');
    assert.ok(blockedMessages.some((message) => message.lane === 'policy_decision'));
    assert.ok(blockedMessages.some((message) => message.lane === 'payment_fit'));
    assert.ok(diagnostics.messages.some((message) => message.summary.includes('not a trust score')));
  });

  it('keeps payment fit separate from source/trust denial and exposes failed verification details', () => {
    const candidates = createAiCatalogDiscoveryCandidates(providerTrustFixtures.verifiedCatalog, {
      relevanceScores: {
        'urn:ai:reddi.tech:specialists:code-review': 0.98,
      },
      trustOptionsByResourceId: {
        'urn:ai:reddi.tech:specialists:code-review': {
          verification: {
            status: 'failed_verification',
            verifier: 'rap:unit-test',
            checkedAt: '2026-06-18T11:58:00.000Z',
            failureReasons: ['signature_ref_unavailable'],
          },
        },
      },
    });
    assert.equal(candidates.ok, true);
    if (!candidates.ok) return;

    const candidate = {
      ...candidates.candidates[0],
      quote: { amount: '5000', asset: 'AUDD', network: 'solana-devnet' },
    };
    const policyDecision = evaluateDiscoveryCandidatePolicyPreflight(candidate, {
      allowedSourceKinds: ['hosted-rap-registry'],
      requireVerifiedTrust: true,
      allowedAssets: ['AUDD'],
      allowedNetworks: ['solana-devnet'],
      maxQuote: { amount: '10000', asset: 'AUDD', network: 'solana-devnet' },
    });

    const diagnostics = createSourceAwareCandidateDiagnostics(candidate, { policyDecision });
    assert.equal(diagnostics.capabilityMatch.relevanceScore, 0.98);
    assert.equal(diagnostics.trustEvidence.status, 'failed_verification');
    assert.equal(diagnostics.trustEvidence.verifier, 'rap:unit-test');
    assert.equal(diagnostics.trustEvidence.checkedAt, '2026-06-18T11:58:00.000Z');
    assert.deepEqual(diagnostics.trustEvidence.failureReasons, ['signature_ref_unavailable']);
    assert.equal(diagnostics.policyDecision.allowed, false);
    assert.ok(diagnostics.policyDecision.reasonCodes.includes('source_not_allowed'));
    assert.ok(diagnostics.policyDecision.reasonCodes.includes('trust_verification_required'));
    assert.equal(diagnostics.paymentFit.allowed, true);
    assert.deepEqual(diagnostics.paymentFit.reasonCodes, []);
  });

  it('emits actionable machine-readable denial summaries', () => {
    const candidates = createAiCatalogDiscoveryCandidates(providerTrustFixtures.unverifiedCatalog);
    assert.equal(candidates.ok, true);
    if (!candidates.ok) return;

    const candidate = candidates.candidates[0];
    const policyDecision = evaluateDiscoveryCandidatePolicyPreflight(candidate, {
      allowedSourceKinds: ['hosted-rap-registry'],
      requireVerifiedTrust: true,
    });

    const diagnostics = createSourceAwareCandidateDiagnostics(candidate, { policyDecision });
    assert.equal(diagnostics.policyDecision.allowed, false);
    assert.ok(diagnostics.policyDecision.reasonCodes.includes('source_not_allowed'));
    assert.ok(diagnostics.policyDecision.reasonCodes.includes('trust_verification_required'));
    assert.ok(diagnostics.policyDecision.reasonCodes.includes('missing_quote'));
    assert.ok(diagnostics.messages.some((message) => message.action?.includes('Resolve the listed policy reason codes')));
    assert.ok(diagnostics.messages.some((message) => message.action?.includes('Complete quote/payment preflight')));
    assert.equal(diagnostics.trustEvidence.status, 'unverified');
  });
});
