import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  AP2_MANDATE_CONFORMANCE_SCHEMA_VERSION,
  AP2_MANDATE_INGESTION_FIXTURE_NOW,
  ap2MandateFixtures,
  ingestAp2Mandate,
  listAp2ConformanceFixtures,
  runAp2MandateConformanceSuite,
  verifyAp2IngestionAgainstMandate,
} from '../dist/index.js';

const NOW = AP2_MANDATE_INGESTION_FIXTURE_NOW;

test('the full conformance suite passes deterministically', () => {
  const first = runAp2MandateConformanceSuite();
  const second = runAp2MandateConformanceSuite();

  assert.equal(first.schemaVersion, AP2_MANDATE_CONFORMANCE_SCHEMA_VERSION);
  for (const entry of first.cases) {
    assert.equal(entry.pass, true, `case ${entry.case} failed: ${entry.failures.join('; ')}`);
  }
  assert.equal(first.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)));
});

test('the fixture set covers every lane the issue requires', () => {
  const cases = listAp2ConformanceFixtures().map((fixture) => fixture.case);
  for (const required of [
    'valid_mandate_round_trip',
    'tampered_payload_hash_mismatch',
    'expired_mandate_fails_closed',
    'over_cap_mandate_fails_closed',
    'unsupported_currency_fails_closed',
    'unsupported_mandate_type_fails_closed',
    'signature_material_rejected',
    'settlement_finality_claim_rejected',
    'pan_credential_leak_rejected',
    'mandate_wider_cap_local_wins',
    'mandate_tighter_cap_narrows',
    'merchant_not_allowlisted_blocks',
    'currency_not_permitted_blocks',
    'missing_local_cap_blocks',
    'probe_only_mandate_never_composes',
    'human_not_present_escalates_approval',
    'authorizing_ref_binds',
    'probe_only_ref_never_binds',
    'rejected_ref_never_binds',
    'signature_bearing_ref_rejected',
  ]) {
    assert.ok(cases.includes(required), `missing conformance case ${required}`);
  }
});

test('a valid ingestion round-trips field-by-field against its mandate source', () => {
  const mandate = structuredClone(ap2MandateFixtures.checkoutClosedPaymentClosedValid);
  const result = ingestAp2Mandate(mandate, NOW);
  const roundTrip = verifyAp2IngestionAgainstMandate(result, mandate);

  assert.equal(roundTrip.ok, true, roundTrip.checks.filter((c) => !c.ok).map((c) => c.id).join(','));
  const ids = roundTrip.checks.map((c) => c.id);
  for (const required of [
    'promoted_external_standard_honest',
    'guardrails_all_safe',
    'mandate_hash_recomputes',
    'no_signature_leakage',
    'derived_cap_recomputes',
    'derived_merchant_refs_recompute',
  ]) {
    assert.ok(ids.includes(required), `missing round-trip check ${required}`);
  }
});

test('tampering with the mandate after ingestion fails the hash recomputation check', () => {
  const mandate = structuredClone(ap2MandateFixtures.checkoutClosedPaymentClosedValid);
  const result = ingestAp2Mandate(mandate, NOW);

  const tampered = structuredClone(mandate);
  tampered.cart!.total.amount = '26.00';
  const roundTrip = verifyAp2IngestionAgainstMandate(result, tampered);

  assert.equal(roundTrip.ok, false);
  const failed = roundTrip.checks.filter((c) => !c.ok).map((c) => c.id);
  assert.ok(failed.includes('mandate_hash_recomputes'));
});

test('tampering with the result (widened cap) fails a named derived check', () => {
  const mandate = structuredClone(ap2MandateFixtures.checkoutClosedPaymentClosedValid);
  const result = ingestAp2Mandate(mandate, NOW);
  result.derived!.spendCaps[0].maxAmountUnits = '999999';
  const roundTrip = verifyAp2IngestionAgainstMandate(result, mandate);

  assert.equal(roundTrip.ok, false);
  const failed = roundTrip.checks.filter((c) => !c.ok).map((c) => c.id);
  assert.ok(failed.includes('derived_cap_recomputes'));
});

test('a non-authorizing (probe-only) result never round-trips', () => {
  const mandate = structuredClone(ap2MandateFixtures.paymentOpenProbeOnly);
  const result = ingestAp2Mandate(mandate, NOW);
  const roundTrip = verifyAp2IngestionAgainstMandate(result, mandate);

  assert.equal(roundTrip.ok, false);
  assert.equal(roundTrip.checks[0].id, 'ingestion_authorizing');
  assert.equal(roundTrip.checks[0].ok, false);
});

test('both AP2 modules are offline-only: no network/fs/exec imports, no async surface, no live-verification crypto beyond one hash', () => {
  for (const modulePath of ['../src/ap2-mandate-ingestion.ts', '../src/ap2-mandate-conformance.ts']) {
    const sourcePath = fileURLToPath(new URL(modulePath, import.meta.url));
    const source = readFileSync(sourcePath, 'utf8');
    for (const banned of [
      'ethers',
      'web3',
      'viem',
      'node:net',
      'node:http',
      'node:https',
      'node:fs',
      'node:child_process',
      "'child_process'",
      'XMLHttpRequest',
      'fetch(',
      'verify(',
      'createVerify',
      'createPublicKey',
      'subtle',
    ]) {
      assert.ok(!source.includes(banned), `${modulePath} must not reference ${banned}`);
    }
    assert.ok(!/\basync\b/.test(source), `${modulePath} must not contain async code`);
    assert.ok(!/\bawait\b/.test(source), `${modulePath} must not contain await`);
  }
  // The conformance module never touches crypto at all beyond the exported hash helper.
  const conformanceSource = readFileSync(fileURLToPath(new URL('../src/ap2-mandate-conformance.ts', import.meta.url)), 'utf8');
  assert.ok(!conformanceSource.includes('node:crypto'), 'conformance module must not import node:crypto');
});

test('AP2-shaped claims stay tagged unverified in source and the key-handling boundary is stated', () => {
  const sourcePath = fileURLToPath(new URL('../src/ap2-mandate-ingestion.ts', import.meta.url));
  const source = readFileSync(sourcePath, 'utf8');
  assert.ok(
    (source.match(/\(DRAFT\/unverified — /g) ?? []).length >= 10,
    'AP2/FIDO/Visa/Mastercard field shapes must keep their (DRAFT/unverified — …) tags after promotion',
  );
  assert.ok(source.includes('HARD BOUNDARY'), 'the no-verification/no-key-handling boundary must be stated in source');
  assert.ok(source.includes('AP2_EXTERNAL_STANDARD'), 'the external-standard honesty block must exist');
});

test('composition and binding fixtures never leak signature material or claim settlement', () => {
  const suite = runAp2MandateConformanceSuite();
  const serialized = JSON.stringify(suite);
  // The opaque fixture VDC signature must not appear anywhere in suite output.
  assert.ok(!serialized.includes(ap2MandateFixtures.checkoutClosedPaymentClosedValid.vdc.signatureB64));
  assert.ok(!serialized.includes('"settlementFinalityClaimed":true'));
});
