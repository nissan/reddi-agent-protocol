import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createEvidenceArchiveRecord,
  createLocalEvidenceArchive,
  evidenceArchiveFixtureRecord,
  evidenceArchiveFixtures,
  validateEvidenceArchiveRecord,
} from '../dist/index.js';

describe('RAP EvidenceArchive v1', () => {
  it('creates and validates a local evidence archive record without exposing private payload in the record', () => {
    const record = createEvidenceArchiveRecord({
      id: 'evidence:unit:001',
      receiptId: 'receipt:unit:001',
      sourceId: 'source:unit',
      requestHash: 'sha256:7b2d0ef8455d0f0f41a37ea5e6a47f52c0d73d97f426097f159a98f8c8fb6b15',
      responseHash: 'sha256:8c9d1f1e3d0f02b5afcbb31dfbb3ab3de70ce1b84ff3ca856d272b2f4f7f4501',
      evidenceRef: 'file://fixtures/evidence/unit-001.json',
      createdAt: '2026-06-18T12:18:00.000Z',
      evidencePayload: evidenceArchiveFixtures.evidencePayload,
      metadata: {
        publicNote: 'payload hash only; private payload is not embedded',
      },
    });

    assert.equal(record.schemaVersion, 'reddi.evidence-archive.v1');
    assert.equal(record.receiptId, 'receipt:unit:001');
    assert.ok(record.evidenceHash.startsWith('sha256:'));
    assert.equal(Object.prototype.hasOwnProperty.call(record, 'evidencePayload'), false);

    const validation = validateEvidenceArchiveRecord(record, evidenceArchiveFixtures.evidencePayload);
    assert.equal(validation.ok, true);
  });

  it('stores and looks up deterministic local fixture records', () => {
    const archive = createLocalEvidenceArchive();
    const put = archive.put(evidenceArchiveFixtureRecord);
    assert.equal(put.ok, true);
    assert.equal(archive.has('evidence:planning-001'), true);

    const lookup = archive.get('evidence:planning-001');
    assert.equal(lookup.ok, true);
    if (lookup.ok) {
      assert.equal(lookup.record.receiptId, 'job:planning-001');
      assert.equal(lookup.record.sourceId, 'source:planning');
      assert.equal(lookup.record.attestationId, 'attestation:planning-001');
    }

    assert.equal(archive.list().length, 1);
  });

  it('fails closed for tampered evidence payload hashes', () => {
    const tampered = validateEvidenceArchiveRecord(evidenceArchiveFixtureRecord, {
      ...evidenceArchiveFixtures.evidencePayload,
      resultSummary: 'tampered result',
    });

    assert.equal(tampered.ok, false);
    if (!tampered.ok) {
      assert.ok(tampered.errors.some((item) => item.code === 'hash_mismatch' && item.path === '$.evidenceHash'));
    }
  });

  it('fails closed for missing evidence when no external pointer is present', () => {
    const missing = validateEvidenceArchiveRecord(evidenceArchiveFixtureRecord);
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.ok(missing.errors.some((item) => item.code === 'evidence_missing' && item.path === '$.evidencePayload'));
    }

    const archive = createLocalEvidenceArchive([evidenceArchiveFixtureRecord]);
    const lookup = archive.get('evidence:missing');
    assert.equal(lookup.ok, false);
    if (!lookup.ok) assert.equal(lookup.error.code, 'evidence_missing');
  });

  it('allows external archive pointer placeholders without product-core dependencies', () => {
    const pointerRecord = createEvidenceArchiveRecord({
      id: 'evidence:pointer:001',
      receiptId: 'receipt:pointer:001',
      sourceId: 'source:pointer',
      requestHash: 'sha256:7b2d0ef8455d0f0f41a37ea5e6a47f52c0d73d97f426097f159a98f8c8fb6b15',
      responseHash: 'sha256:8c9d1f1e3d0f02b5afcbb31dfbb3ab3de70ce1b84ff3ca856d272b2f4f7f4501',
      evidenceHash: 'sha256:8a9a8a7b6c5d4e3f20112233445566778899aabbccddeeff0011223344556677',
      evidenceRef: 'walrus://future-sidecar/blob-fixture',
      externalArchivePointer: {
        provider: 'walrus',
        uri: 'walrus://future-sidecar/blob-fixture',
        contentHash: 'sha256:8a9a8a7b6c5d4e3f20112233445566778899aabbccddeeff0011223344556677',
      },
      createdAt: '2026-06-18T12:18:00.000Z',
    });

    assert.equal(pointerRecord.externalArchivePointer?.provider, 'walrus');
    const validation = validateEvidenceArchiveRecord(pointerRecord);
    assert.equal(validation.ok, true);
  });

  it('rejects malformed records and credential-bearing evidence material', () => {
    const malformed = validateEvidenceArchiveRecord({
      ...evidenceArchiveFixtureRecord,
      schemaVersion: 'reddi.evidence-archive.v2',
      evidenceHash: 'not-a-hash',
    }, evidenceArchiveFixtures.evidencePayload);
    assert.equal(malformed.ok, false);
    if (!malformed.ok) {
      assert.ok(malformed.errors.some((item) => item.code === 'malformed_evidence_record'));
    }

    const secretPayload = validateEvidenceArchiveRecord(evidenceArchiveFixtureRecord, {
      apiKey: 'sk-should-not-be-here',
    });
    assert.equal(secretPayload.ok, false);
    if (!secretPayload.ok) {
      assert.ok(secretPayload.errors.some((item) => item.code === 'credential_leakage_rejected'));
    }

    const leakyEvidenceRef = validateEvidenceArchiveRecord({
      ...evidenceArchiveFixtureRecord,
      evidenceRef: 'https://evidence.example/archive.json?access_token=redacted',
    }, evidenceArchiveFixtures.evidencePayload);
    assert.equal(leakyEvidenceRef.ok, false);
    if (!leakyEvidenceRef.ok) {
      assert.ok(leakyEvidenceRef.errors.some((item) => item.code === 'credential_leakage_rejected' && item.path === '$.evidenceRef.access_token'));
    }

    const leakyExternalPointer = validateEvidenceArchiveRecord({
      ...evidenceArchiveFixtureRecord,
      externalArchivePointer: {
        provider: 'custom',
        uri: 'https://evidence.example/archive.json?api_key=redacted',
      },
    });
    assert.equal(leakyExternalPointer.ok, false);
    if (!leakyExternalPointer.ok) {
      assert.ok(leakyExternalPointer.errors.some((item) => item.code === 'credential_leakage_rejected' && item.path === '$.externalArchivePointer.uri.api_key'));
    }

    const signedEvidenceRef = validateEvidenceArchiveRecord({
      ...evidenceArchiveFixtureRecord,
      evidenceRef: 'https://evidence.example/archive.json?X-Goog-Signature=redacted',
    }, evidenceArchiveFixtures.evidencePayload);
    assert.equal(signedEvidenceRef.ok, false);
    if (!signedEvidenceRef.ok) {
      assert.ok(signedEvidenceRef.errors.some((item) => item.code === 'credential_leakage_rejected' && item.path === '$.evidenceRef.X-Goog-Signature'));
    }

    const signedExternalPointer = validateEvidenceArchiveRecord({
      ...evidenceArchiveFixtureRecord,
      externalArchivePointer: {
        provider: 'custom',
        uri: 'https://evidence.example/archive.json?sig=redacted',
      },
    });
    assert.equal(signedExternalPointer.ok, false);
    if (!signedExternalPointer.ok) {
      assert.ok(signedExternalPointer.errors.some((item) => item.code === 'credential_leakage_rejected' && item.path === '$.externalArchivePointer.uri.sig'));
    }
  });
});
