import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createAiCatalogProviderTrustRecord,
  normalizeAiCatalogProviderTrustRecord,
  providerTrustFixtureCases,
  providerTrustFixtures,
  type ProviderTrustReasonCode,
} from '../dist/index.js';

function assertReasonCodes(actual: ProviderTrustReasonCode[], expected: ProviderTrustReasonCode[]): void {
  for (const code of expected) {
    assert.ok(actual.includes(code), `expected provider trust reason codes to include ${code}`);
  }
}

describe('RAP provider trust records', () => {
  it('validates exported fixture cases with expected outcomes', () => {
    const expectedCases = [
      'verified',
      'claimed',
      'unverified',
      'failedVerification',
      'malformedTrustManifest',
      'credentialBearingMetadata',
    ];

    assert.deepEqual(Object.keys(providerTrustFixtureCases).sort(), expectedCases.sort());
    for (const fixture of Object.values(providerTrustFixtureCases)) {
      const result = normalizeAiCatalogProviderTrustRecord(fixture.catalog, fixture.resourceId, fixture.options);
      assert.equal(result.ok, fixture.expectedValid, fixture.description);
      if (result.ok) {
        assert.equal(result.record.verification.status, fixture.expectedStatus, fixture.description);
        assertReasonCodes(result.record.verification.reasonCodes, fixture.expectedReasonCodes);
      } else {
        assertReasonCodes(result.errors.map((item) => item.code), fixture.expectedReasonCodes);
      }
    }
  });

  it('upgrades claimed trust metadata only when RAP-side verification says it is verified', () => {
    const claimed = normalizeAiCatalogProviderTrustRecord(
      providerTrustFixtures.verifiedCatalog,
      'urn:ai:reddi.tech:specialists:code-review',
    );
    assert.equal(claimed.ok, true);
    if (claimed.ok) {
      assert.equal(claimed.record.schemaVersion, 'reddi.provider-trust.v1');
      assert.equal(claimed.record.verification.status, 'claimed');
      assert.ok(claimed.record.verification.reasonCodes.includes('external_claim_not_verified_by_rap'));
      assert.equal(claimed.record.publisher.id, 'reddi.tech');
      assert.equal(claimed.record.source.rawSnapshotRef, 'sha256:verified-catalog-fixture');
      assert.equal(claimed.record.trustMetadata.provenanceLinks.length, 1);
      assert.equal(claimed.record.trustMetadata.attestations.length, 1);
      assert.deepEqual(claimed.record.trustMetadata.publisherIdentity, { domain: 'reddi.tech', status: 'claimed' });
    }

    const verified = createAiCatalogProviderTrustRecord(
      providerTrustFixtures.verifiedCatalog,
      'urn:ai:reddi.tech:specialists:code-review',
      {
        verification: {
          status: 'verified',
          verifier: 'rap:unit-test',
          checkedAt: '2026-06-18T10:55:00.000Z',
        },
      },
    );
    assert.equal(verified.verification.status, 'verified');
    assert.deepEqual(verified.verification.reasonCodes, ['rap_verified']);
    assert.equal(verified.verification.verifier, 'rap:unit-test');
  });

  it('preserves failed verification reasons without converting them to policy denials', () => {
    const result = normalizeAiCatalogProviderTrustRecord(
      providerTrustFixtures.verifiedCatalog,
      'urn:ai:reddi.tech:specialists:code-review',
      {
        verification: {
          status: 'failed_verification',
          verifier: 'rap:unit-test',
          checkedAt: '2026-06-18T10:55:00.000Z',
          failureReasons: ['signature_ref_not_available'],
        },
      },
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.record.verification.status, 'failed_verification');
      assert.deepEqual(result.record.verification.reasonCodes, ['rap_verification_failed']);
      assert.deepEqual(result.record.verification.failureReasons, ['signature_ref_not_available']);
    }
  });

  it('keeps providers without trust metadata explicitly unverified', () => {
    const result = normalizeAiCatalogProviderTrustRecord(providerTrustFixtures.unverifiedCatalog, 'urn:example:agents:summary');
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.record.verification.status, 'unverified');
      assert.deepEqual(result.record.verification.reasonCodes, ['no_trust_metadata']);
      assert.deepEqual(result.record.trustMetadata.provenanceLinks, []);
      assert.deepEqual(result.record.trustMetadata.attestations, []);
    }
  });

  it('fails closed for missing providers, malformed trust manifests, and credential-bearing metadata', () => {
    const missing = normalizeAiCatalogProviderTrustRecord(providerTrustFixtures.verifiedCatalog, 'urn:ai:missing');
    assert.equal(missing.ok, false);
    if (!missing.ok) assertReasonCodes(missing.errors.map((item) => item.code), ['provider_not_found']);

    const malformed = normalizeAiCatalogProviderTrustRecord(
      providerTrustFixtures.malformedTrustCatalog,
      'urn:example:agents:malformed-trust',
    );
    assert.equal(malformed.ok, false);
    if (!malformed.ok) assertReasonCodes(malformed.errors.map((item) => item.code), ['malformed_trust_metadata']);

    const credentialBearing = normalizeAiCatalogProviderTrustRecord(
      providerTrustFixtures.credentialBearingCatalog,
      'urn:example:agents:credential-bearing',
    );
    assert.equal(credentialBearing.ok, false);
    if (!credentialBearing.ok) assertReasonCodes(credentialBearing.errors.map((item) => item.code), ['credential_leakage_rejected']);
  });

  it('throws when creating an invalid provider trust record', () => {
    assert.throws(
      () => createAiCatalogProviderTrustRecord(providerTrustFixtures.verifiedCatalog, 'urn:ai:missing'),
      /invalid_provider_trust_record:provider_not_found/,
    );
  });
});
