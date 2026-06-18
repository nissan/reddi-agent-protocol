import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyAttestationToReputation,
  createAttestationRecord,
  createInitialReputationState,
  type AttestationRecord,
} from '../dist/index.js';

const baseAttestation: AttestationRecord = {
  schemaVersion: 'reddi.attestation.v1',
  id: 'attestation:planning-001',
  receiptId: 'job:planning-001',
  evidenceId: 'evidence:planning-001',
  evidenceRef: 'file://fixtures/evidence/planning-001.json',
  evidenceHash: 'sha256:8a9a8a7b6c5d4e3f20112233445566778899aabbccddeeff0011223344556677',
  attestor: {
    id: 'attestor:local',
    type: 'local-fixture',
  },
  trustBoundary: 'reddi_attested',
  verdict: 'passed',
  workStatus: 'completed',
  confidence: 90,
  rubric: {
    dimensions: [
      {
        id: 'evidence_integrity',
        score: 100,
        weight: 2,
        summary: 'Receipt and evidence hashes are present and match the local archive.',
        reasonCodes: ['hashes_match'],
      },
      {
        id: 'policy_compliance',
        score: 90,
        weight: 1,
        summary: 'Policy decision approved the dry-run quote.',
        reasonCodes: ['policy_allowed'],
      },
      {
        id: 'delivery_quality',
        score: 80,
        weight: 1,
        summary: 'Specialist response met the requested planning outcome.',
        reasonCodes: ['task_completed'],
      },
    ],
  },
  createdAt: '2026-06-18T13:20:00.000Z',
};

describe('RAP attestation and reputation v1', () => {
  it('creates an attestation and deterministic positive reputation event', () => {
    const attestation = createAttestationRecord(baseAttestation);
    const initial = createInitialReputationState(
      { id: 'specialist:coder', type: 'specialist' },
      '2026-06-18T13:19:00.000Z',
    );
    const update = applyAttestationToReputation(attestation, initial);

    assert.equal(update.ok, true);
    if (update.ok) {
      assert.equal(update.event.schemaVersion, 'reddi.reputation-event.v1');
      assert.equal(update.event.attestationId, 'attestation:planning-001');
      assert.equal(update.event.evidenceId, 'evidence:planning-001');
      assert.equal(update.event.rubricScore, 93);
      assert.equal(update.event.delta, 27);
      assert.equal(update.state.score, 527);
      assert.equal(update.state.completedJobs, 1);
      assert.equal(update.state.attestedJobs, 1);
      assert.equal(update.state.routingImpact, 'eligible');
      assert.deepEqual(update.event.reasonCodes, ['evidence_attached', 'attestation_passed']);
    }
  });

  it('fails closed for missing rubric dimensions and does not mutate reputation', () => {
    const initial = createInitialReputationState(
      { id: 'specialist:coder', type: 'specialist' },
      '2026-06-18T13:19:00.000Z',
    );
    const update = applyAttestationToReputation({
      ...baseAttestation,
      rubric: {
        dimensions: baseAttestation.rubric.dimensions.filter((dimension) => dimension.id !== 'policy_compliance'),
      },
    }, initial);

    assert.equal(update.ok, false);
    if (!update.ok) {
      assert.deepEqual(update.state, initial);
      assert.ok(update.errors.some((item) => item.code === 'missing_rubric_dimension'));
    }
  });

  it('fails closed for invalid rubric dimensions and credential-bearing metadata', () => {
    const invalidScore = applyAttestationToReputation({
      ...baseAttestation,
      rubric: {
        dimensions: [
          ...baseAttestation.rubric.dimensions.slice(0, 2),
          {
            ...baseAttestation.rubric.dimensions[2],
            score: 120,
          },
        ],
      },
    });
    assert.equal(invalidScore.ok, false);
    if (!invalidScore.ok) {
      assert.ok(invalidScore.errors.some((item) => item.code === 'invalid_rubric_dimension' && item.path.endsWith('.score')));
    }

    const credentialMetadata = applyAttestationToReputation({
      ...baseAttestation,
      metadata: { audit: { accessToken: 'redacted' } },
    });
    assert.equal(credentialMetadata.ok, false);
    if (!credentialMetadata.ok) {
      assert.ok(credentialMetadata.errors.some((item) => item.code === 'credential_leakage_rejected' && item.path === '$.metadata.audit.accessToken'));
    }

    const signedEvidenceRef = applyAttestationToReputation({
      ...baseAttestation,
      evidenceRef: 'https://evidence.example/attestation.json?X-Amz-Signature=redacted',
    });
    assert.equal(signedEvidenceRef.ok, false);
    if (!signedEvidenceRef.ok) {
      assert.ok(signedEvidenceRef.errors.some((item) => item.code === 'credential_leakage_rejected' && item.path === '$.evidenceRef.X-Amz-Signature'));
    }
  });

  it('applies explicit failed, disputed, and refunded routing impacts deterministically', () => {
    const initial = createInitialReputationState(
      { id: 'specialist:coder', type: 'specialist' },
      '2026-06-18T13:19:00.000Z',
    );

    const failed = applyAttestationToReputation({
      ...baseAttestation,
      id: 'attestation:failed',
      verdict: 'failed',
      workStatus: 'failed',
      confidence: 100,
    }, initial);
    assert.equal(failed.ok, true);
    if (failed.ok) {
      assert.equal(failed.event.delta, -80);
      assert.equal(failed.state.failedJobs, 1);
      assert.ok(failed.event.reasonCodes.includes('attestation_failed'));
    }

    const disputed = applyAttestationToReputation({
      ...baseAttestation,
      id: 'attestation:disputed',
      verdict: 'disputed',
      workStatus: 'disputed',
      confidence: 80,
    }, initial);
    assert.equal(disputed.ok, true);
    if (disputed.ok) {
      assert.equal(disputed.event.delta, -40);
      assert.equal(disputed.state.disputedJobs, 1);
      assert.ok(disputed.event.reasonCodes.includes('work_disputed'));
    }

    const refunded = applyAttestationToReputation({
      ...baseAttestation,
      id: 'attestation:refunded',
      verdict: 'refunded',
      workStatus: 'refunded',
      confidence: 80,
    }, initial);
    assert.equal(refunded.ok, true);
    if (refunded.ok) {
      assert.equal(refunded.event.delta, -28);
      assert.equal(refunded.state.refundedJobs, 1);
      assert.ok(refunded.event.reasonCodes.includes('work_refunded'));
    }
  });
});
