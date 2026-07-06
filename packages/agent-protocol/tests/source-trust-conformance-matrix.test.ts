import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildSourceTrustConformanceMatrix,
  classifySourceTrustCandidate,
  sourceTrustConformanceFixtureCases,
  SOURCE_TRUST_BOUNDARIES_DOC_REF,
  SOURCE_TRUST_REQUIRED_CASES,
  SOURCE_TRUST_STATES,
  type SourceTrustFindingCode,
} from '../dist/index.js';

function assertFindingCodes(actual: SourceTrustFindingCode[], expected: SourceTrustFindingCode[], context: string): void {
  for (const code of expected) {
    assert.ok(actual.includes(code), `${context}: expected findings to include ${code} (got ${actual.join(', ')})`);
  }
}

describe('RAP source/trust conformance matrix (#450)', () => {
  it('classifies every fixture case into its expected state with expected findings', () => {
    for (const [fixtureId, fixture] of Object.entries(sourceTrustConformanceFixtureCases)) {
      const row = classifySourceTrustCandidate(fixture.input);
      assert.equal(row.state, fixture.expectedState, `${fixtureId}: ${fixture.description}`);
      assertFindingCodes(row.findings.map((item) => item.code), fixture.expectedFindingCodes, fixtureId);
      assert.equal(row.schemaVersion, 'reddi.source-trust-conformance-matrix.v1');
    }
  });

  it('covers all #450 states, all #450 required cases, and both source kinds', () => {
    const matrix = buildSourceTrustConformanceMatrix();
    assert.deepEqual(matrix.coverage.missingStates, [], 'all trust states must be covered');
    assert.deepEqual(matrix.coverage.missingRequiredCases, [], 'all required cases must be covered');
    assert.ok(matrix.coverage.sourceKinds['auth-md'] > 0, 'auth.md rows must be present');
    assert.ok(matrix.coverage.sourceKinds['ai-catalog'] > 0, 'ARD/AI Catalog rows must be present');
    assert.equal(matrix.coverage.complete, true);

    for (const state of SOURCE_TRUST_STATES) {
      assert.ok(matrix.coverage.states[state] > 0, `state ${state} must have at least one row`);
    }
    for (const requiredCase of SOURCE_TRUST_REQUIRED_CASES) {
      assert.ok(matrix.coverage.requiredCases[requiredCase] > 0, `required case ${requiredCase} must have at least one row`);
    }
  });

  it('lists every row as untrusted on entry, for both auth.md and ARD/AI Catalog metadata', () => {
    const matrix = buildSourceTrustConformanceMatrix();
    for (const row of matrix.rows) {
      assert.equal(row.entryState, 'listed_untrusted', `${row.candidateId} must enter untrusted`);
      assert.ok(
        row.findings.some((item) => item.code === 'listed_untrusted_on_entry'),
        `${row.candidateId} must record the untrusted-on-entry finding`,
      );
    }
    assert.equal(matrix.boundary.untrustedUntilGated, true);
  });

  it('never lets discovery relevance influence trust: high-relevance candidate with leakage stays blocked', () => {
    const fixture = sourceTrustConformanceFixtureCases.highRelevanceBlockedArd;
    const row = classifySourceTrustCandidate(fixture.input);
    assert.equal(row.state, 'blocked');
    assert.equal(row.discoveryBoundary.relevanceScore, 0.99);
    assert.equal(row.discoveryBoundary.relevanceInfluencedTrust, false);
    assert.equal(row.discoveryBoundary.scoreMeaning, 'relevance_only_not_trust');
    assert.equal(row.discoveryBoundary.boundariesDocRef, SOURCE_TRUST_BOUNDARIES_DOC_REF);
    assert.equal(row.registryProjection.registryEligible, false);
  });

  it('fails closed on malformed metadata, credential leakage, anonymous write scope, and unsupported credential/identity declarations', () => {
    const blockedFixtures = [
      'malformedAuthMdMetadata',
      'malformedArdTrustMetadata',
      'credentialLeakageAuthMd',
      'anonymousWriteScopeAuthMd',
      'anonymousWriteScopeArd',
      'unsupportedCredentialTypeAuthMd',
      'unsupportedIdentityAssertionAuthMd',
      'highRelevanceBlockedArd',
    ];
    for (const fixtureId of blockedFixtures) {
      const fixture = sourceTrustConformanceFixtureCases[fixtureId];
      const row = classifySourceTrustCandidate(fixture.input);
      assert.equal(row.state, 'blocked', fixtureId);
      assert.equal(row.registryProjection.registryEligible, false, `${fixtureId} must not be registry-eligible`);
      assert.equal(row.registryProjection.verificationStatus, 'failed_verification', fixtureId);
      assert.ok(row.findings.some((item) => item.severity === 'blocked'), `${fixtureId} must carry a blocked-severity finding`);
    }
  });

  it('projects onto the #343 provider-trust registry vocabulary for every state', () => {
    const matrix = buildSourceTrustConformanceMatrix();
    const expectedStatusByState: Record<string, string> = {
      trusted: 'verified',
      listed_untrusted: 'unverified',
      claimed: 'claimed',
      unverified: 'unverified',
      failed_verification: 'failed_verification',
      blocked: 'failed_verification',
    };
    for (const row of matrix.rows) {
      const expected = expectedStatusByState[row.state];
      if (expected) {
        assert.equal(row.registryProjection.verificationStatus, expected, `${row.candidateId} (${row.state})`);
      } else {
        assert.equal(row.state, 'needs_human_review');
        assert.notEqual(row.registryProjection.verificationStatus, 'verified', 'needs_human_review must never project as verified');
      }
      assert.ok(row.registryProjection.reasonCodes.length > 0, `${row.candidateId} must carry reason codes`);
    }
  });

  it('carries the normalized provider-trust record for valid ARD/AI Catalog rows', () => {
    const claimed = classifySourceTrustCandidate(sourceTrustConformanceFixtureCases.claimedArd.input);
    assert.ok(claimed.registryProjection.providerTrustRecord, 'claimed ARD row must carry a provider trust record');
    assert.equal(claimed.registryProjection.providerTrustRecord?.schemaVersion, 'reddi.provider-trust.v1');
    assert.equal(claimed.registryProjection.providerTrustRecord?.verification.status, 'claimed');

    const blocked = classifySourceTrustCandidate(sourceTrustConformanceFixtureCases.highRelevanceBlockedArd.input);
    assert.equal(blocked.registryProjection.providerTrustRecord, undefined, 'blocked rows never carry a trust record');
  });

  it('projects onto the #344 source-diagnostics lane and severity vocabulary', () => {
    const matrix = buildSourceTrustConformanceMatrix();
    const allowedLanes = new Set([
      'capability_match',
      'discovery_source',
      'publisher_identity',
      'trust_evidence',
      'policy_decision',
      'payment_fit',
      'reputation_evidence',
    ]);
    const allowedSeverities = new Set(['info', 'warning', 'blocked']);
    for (const row of matrix.rows) {
      assert.ok(row.diagnosticsProjection.length >= 2, `${row.candidateId} must emit diagnostics`);
      for (const message of row.diagnosticsProjection) {
        assert.ok(allowedLanes.has(message.lane), `${row.candidateId}: lane ${message.lane}`);
        assert.ok(allowedSeverities.has(message.severity), `${row.candidateId}: severity ${message.severity}`);
      }
      const relevanceMessage = row.diagnosticsProjection.find((message) => message.code === 'relevance_only_not_trust');
      assert.ok(relevanceMessage, `${row.candidateId} must state relevance is not trust`);
      assert.equal(relevanceMessage?.lane, 'capability_match');
    }
  });

  it('routes self-asserted verification to human review instead of trusting it', () => {
    const row = classifySourceTrustCandidate(sourceTrustConformanceFixtureCases.needsHumanReviewAuthMd.input);
    assert.equal(row.state, 'needs_human_review');
    assert.ok(row.findings.some((item) => item.code === 'self_asserted_verification_ignored'));
    assert.notEqual(row.registryProjection.verificationStatus, 'verified');
    const reviewMessage = row.diagnosticsProjection.find((message) => message.code === 'source_trust_state_needs_human_review');
    assert.ok(reviewMessage?.action, 'human-review rows must carry an operator action');
  });

  it('only reaches trusted through an explicit passing RAP-side verification gate', () => {
    const trusted = classifySourceTrustCandidate(sourceTrustConformanceFixtureCases.trustedAuthMd.input);
    assert.equal(trusted.state, 'trusted');
    assert.equal(trusted.registryProjection.verificationStatus, 'verified');
    assert.ok(trusted.findings.some((item) => item.code === 'rap_verified'));

    // The same metadata without the gate stays claimed — trust is a RAP-side decision.
    const withoutGate = classifySourceTrustCandidate({
      ...sourceTrustConformanceFixtureCases.trustedAuthMd.input,
      candidateId: 'auth-md:reddi.tech:no-gate',
      rapVerification: undefined,
    });
    assert.equal(withoutGate.state, 'claimed');
    assert.equal(withoutGate.registryProjection.verificationStatus, 'claimed');
  });

  it('treats a passing verification with residual warnings as needs-human-review, not trusted', () => {
    const row = classifySourceTrustCandidate({
      candidateId: 'auth-md:example.com:verified-with-warning',
      source: {
        kind: 'auth-md',
        metadata: {
          url: 'https://agents.example.com/.well-known/auth.md',
          authorizationServer: 'https://auth.example.com',
          credentialTypes: ['access_token'],
          scopes: [{ name: 'catalog.read', access: 'read' }],
          trust: {
            trustManifest: 'https://agents.example.com/trust-manifest.json',
            status: 'verified',
          },
        },
      },
      rapVerification: { status: 'verified', verifier: 'rap-fixture-verifier' },
    });
    assert.equal(row.state, 'needs_human_review');
  });
});
