import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createAiCatalogDiscoveryCandidates,
  deriveRankingCandidateExplainability,
  evaluateDiscoveryCandidatePolicyPreflight,
  explainSourceRanking,
  providerTrustFixtures,
  REQUIRED_RANKING_GATES,
  RANKING_EXPLAINABILITY_SCHEMA_VERSION,
  type DiscoveryCandidate,
  type DiscoveryCandidatePolicy,
  type DiscoverySourceKind,
} from '../dist/index.js';

const STRICT_POLICY: DiscoveryCandidatePolicy = {
  allowedSourceKinds: ['direct-ai-catalog', 'ard-registry'],
  requireVerifiedTrust: true,
  allowedAssets: ['AUDD'],
  allowedNetworks: ['solana-devnet'],
  maxQuote: { amount: '10000', asset: 'AUDD', network: 'solana-devnet' },
};

function verifiedCandidate(): DiscoveryCandidate {
  const candidates = createAiCatalogDiscoveryCandidates(providerTrustFixtures.verifiedCatalog, {
    relevanceScores: { 'urn:ai:reddi.tech:specialists:code-review': 0.92 },
    trustOptionsByResourceId: {
      'urn:ai:reddi.tech:specialists:code-review': {
        verification: { status: 'verified', verifier: 'rap:unit-test' },
      },
    },
  });
  assert.equal(candidates.ok, true);
  if (!candidates.ok) throw new Error('fixture candidates failed');
  return {
    ...candidates.candidates[0],
    quote: { amount: '5000', asset: 'AUDD', network: 'solana-devnet' },
  };
}

function unverifiedHighRelevanceCandidate(): DiscoveryCandidate {
  const candidates = createAiCatalogDiscoveryCandidates(providerTrustFixtures.unverifiedCatalog, {
    sourceKind: 'ard-registry',
    relevanceScores: { 'urn:example:agents:summary': 0.99 },
  });
  assert.equal(candidates.ok, true);
  if (!candidates.ok) throw new Error('fixture candidates failed');
  return candidates.candidates[0];
}

describe('RAP ranking explainability (reddi.ranking-explainability.v1)', () => {
  it('enriches a ranked candidate with identity, capability, trust, payment, health, and rejection lanes', () => {
    const candidate = verifiedCandidate();
    const explainability = deriveRankingCandidateExplainability(candidate, {
      policy: STRICT_POLICY,
      matchedFields: ['displayName', 'capabilities'],
      health: { endpointHealth: 'not_probed', snapshotGeneratedAt: '2026-07-16T00:00:00Z' },
      evidence: {
        receiptCount: 2,
        attestationCount: 1,
        settlementReceiptRefs: ['fixture:receipt:code-review:settled-dry-run'],
        attestationRefs: ['fixture:attestation:code-review:release-recommended'],
      },
    });

    assert.equal(explainability.schemaVersion, RANKING_EXPLAINABILITY_SCHEMA_VERSION);
    assert.equal(explainability.sourceIdentity.identifier, 'urn:ai:reddi.tech:specialists:code-review');
    assert.equal(explainability.sourceIdentity.sourceKind, 'direct-ai-catalog');
    assert.equal(explainability.sourceIdentity.publisher?.id, 'reddi.tech');
    assert.equal(explainability.capabilityMatch.relevanceScore, 0.92);
    assert.equal(explainability.capabilityMatch.scoreMeaning, 'relevance_only_not_trust');
    assert.deepEqual(explainability.capabilityMatch.matchedFields, ['displayName', 'capabilities']);
    assert.equal(explainability.trustState.status, 'verified');
    assert.equal(explainability.paymentPolicyFit.quote?.asset, 'AUDD');
    assert.equal(explainability.healthFreshness.endpointHealth, 'not_probed');
    assert.equal(explainability.healthFreshness.freshness, 'snapshot_backed');
    assert.deepEqual(explainability.rejectionReasons, []);
    assert.equal(explainability.selection.state, 'selected');
    assert.equal(explainability.diagnostics.schemaVersion, 'reddi.source-diagnostics.v1');
    assert.equal(explainability.boundary.scoreMeaning, 'relevance_only_not_trust');
    assert.equal(explainability.boundary.relevanceInfluencedGates, false);
  });

  it('keeps a 0.99-relevance candidate rejected when trust, policy, quote, payment, and budget gates fail', () => {
    const candidate: DiscoveryCandidate = {
      ...unverifiedHighRelevanceCandidate(),
      quote: { amount: '20000', asset: 'USDC', network: 'solana-mainnet' },
    };
    const explainability = deriveRankingCandidateExplainability(candidate, { policy: STRICT_POLICY });

    assert.equal(explainability.capabilityMatch.relevanceScore, 0.99);
    assert.equal(explainability.selection.state, 'rejected');
    const failedGates = explainability.gates.filter((cell) => cell.state === 'failed').map((cell) => cell.gate);
    assert.ok(failedGates.includes('trust'));
    assert.ok(failedGates.includes('payment'));
    assert.ok(failedGates.includes('budget'));
    const rejectionCodes = explainability.rejectionReasons.map((reason) => reason.code);
    assert.ok(rejectionCodes.includes('trust_verification_required'));
    assert.ok(rejectionCodes.includes('unsupported_asset'));
    assert.ok(rejectionCodes.includes('unsupported_network'));
    assert.ok(rejectionCodes.includes('over_budget'));
  });

  it('fails closed on a missing quote even for a maximally relevant candidate', () => {
    const candidate = unverifiedHighRelevanceCandidate();
    assert.equal(candidate.quote, undefined);
    const explainability = deriveRankingCandidateExplainability(candidate, { policy: STRICT_POLICY });
    assert.equal(explainability.selection.state, 'rejected');
    const quoteGate = explainability.gates.find((cell) => cell.gate === 'quote');
    assert.equal(quoteGate?.state, 'failed');
    assert.ok(quoteGate?.reasonCodes.includes('missing_quote'));
  });

  it('defers (never selects) a passing candidate whose evidence, settlement, and attestation lanes are unproven', () => {
    const candidate = verifiedCandidate();
    const explainability = deriveRankingCandidateExplainability(candidate, { policy: STRICT_POLICY });
    assert.equal(explainability.selection.state, 'deferred');
    for (const gate of ['evidence', 'settlement', 'attestation'] as const) {
      const cell = explainability.gates.find((item) => item.gate === gate);
      assert.equal(cell?.state, 'not_evaluated');
    }
  });

  it('structurally prevents any source kind from bypassing settlement or attestation constraints', () => {
    const sourceKinds: DiscoverySourceKind[] = [
      'local-specialist',
      'direct-ai-catalog',
      'ard-registry',
      'source-adapter',
      'hosted-rap-registry',
    ];
    for (const sourceKind of sourceKinds) {
      const candidate: DiscoveryCandidate = {
        ...verifiedCandidate(),
        sourceKind,
        relevance: { score: 0.99, source: sourceKind },
      };
      const explainability = deriveRankingCandidateExplainability(candidate, { policy: STRICT_POLICY });

      // Every required gate — including settlement and attestation — is present.
      assert.deepEqual(
        explainability.gates.map((cell) => cell.gate),
        [...REQUIRED_RANKING_GATES],
        `source kind ${sourceKind} must carry every required gate`,
      );
      // Without explicit evidence, settlement/attestation never pass and the
      // candidate can never be 'selected' regardless of relevance.
      const settlement = explainability.gates.find((cell) => cell.gate === 'settlement');
      const attestation = explainability.gates.find((cell) => cell.gate === 'attestation');
      assert.equal(settlement?.state, 'not_evaluated');
      assert.equal(attestation?.state, 'not_evaluated');
      assert.notEqual(explainability.selection.state, 'selected');
      assert.equal(explainability.guardrails.settlementBypassPossible, false);
      assert.equal(explainability.guardrails.attestationBypassPossible, false);
      assert.equal(explainability.guardrails.invocationAuthorized, false);
      assert.equal(explainability.guardrails.paymentAuthorized, false);
    }
  });

  it('ranks by relevance only and marks — rather than reorders or hides — gate-failing candidates', () => {
    const blocked = unverifiedHighRelevanceCandidate(); // 0.99, unverified trust
    const allowed = verifiedCandidate(); // 0.92, verified trust + fitting quote
    const report = explainSourceRanking([allowed, blocked], { policy: STRICT_POLICY, generatedAt: '2026-07-16T00:00:00Z' });

    assert.equal(report.schemaVersion, RANKING_EXPLAINABILITY_SCHEMA_VERSION);
    assert.equal(report.ordering, 'relevance_desc_then_identifier_asc');
    assert.equal(report.total, 2);
    // The rejected candidate keeps its relevance rank (#1); it is not hidden.
    assert.equal(report.candidates[0].rank, 1);
    assert.equal(report.candidates[0].explainability.sourceIdentity.identifier, 'urn:example:agents:summary');
    assert.equal(report.candidates[0].explainability.selection.state, 'rejected');
    assert.equal(report.candidates[1].rank, 2);
    assert.equal(report.candidates[1].explainability.sourceIdentity.identifier, 'urn:ai:reddi.tech:specialists:code-review');
    assert.notEqual(report.candidates[1].explainability.selection.state, 'rejected');
  });

  it('accepts a caller-evaluated policy decision and reuses discovery-source reason codes', () => {
    const candidate = unverifiedHighRelevanceCandidate();
    const policyDecision = evaluateDiscoveryCandidatePolicyPreflight(candidate, {
      allowedSourceKinds: ['local-specialist'],
    });
    assert.equal(policyDecision.allowed, false);
    const explainability = deriveRankingCandidateExplainability(candidate, { policyDecision });
    const policyGate = explainability.gates.find((cell) => cell.gate === 'policy');
    assert.equal(policyGate?.state, 'failed');
    assert.ok(policyGate?.reasonCodes.includes('source_not_allowed'));
    assert.equal(explainability.selection.state, 'rejected');
  });
});
