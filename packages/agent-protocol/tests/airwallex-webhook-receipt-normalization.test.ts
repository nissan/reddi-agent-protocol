import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  AIRWALLEX_NORMALIZABLE_EVENT_NAMES,
  AIRWALLEX_REVOCATION_EVENT_NAMES,
  AIRWALLEX_WEBHOOK_RECEIPT_DRAFT,
  AIRWALLEX_WEBHOOK_RECEIPT_ISSUE,
  AIRWALLEX_WEBHOOK_RECEIPT_SCHEMA_VERSION,
  RECEIPT_V1_REVOCATION_GAP_ISSUE,
  airwallexWebhookFixtures,
  airwallexWebhookRejectionFixtures,
  createRailNeutralProofChainFixture,
  deriveRailNeutralPaymentReceipt,
  listAirwallexWebhookRejectionFixtures,
  normalizeAirwallexWebhookFixture,
  railNeutralProofChainFixtures,
  type AirwallexWebhookFixture,
} from '../dist/index.js';

test('is draft-flagged, issue-pinned, and routes the receipt-v1 gap to #338', () => {
  assert.equal(AIRWALLEX_WEBHOOK_RECEIPT_SCHEMA_VERSION, 'reddi.airwallex-webhook-receipt.v1');
  assert.equal(AIRWALLEX_WEBHOOK_RECEIPT_DRAFT, true);
  assert.equal(AIRWALLEX_WEBHOOK_RECEIPT_ISSUE, 580);
  assert.equal(RECEIPT_V1_REVOCATION_GAP_ISSUE, 338);
});

test('successful synthetic payment events normalize to probe_only receipt shapes — never final/settled', () => {
  for (const fixture of [airwallexWebhookFixtures.paymentIntentSucceeded, airwallexWebhookFixtures.paymentLinkPaid]) {
    const result = normalizeAirwallexWebhookFixture(fixture);
    assert.equal(result.ok, true, `${fixture.event.name} must normalize`);
    if (!result.ok) continue;

    const receipt = result.receipt;
    assert.equal(receipt.schemaVersion, AIRWALLEX_WEBHOOK_RECEIPT_SCHEMA_VERSION);
    assert.equal(receipt.draft, true);
    assert.equal(receipt.rail, 'airwallex-hosted-checkout');
    // The probe-only cap, in both vocabularies.
    assert.equal(receipt.supportState, 'airwallex_webhook_receipt_probe_only');
    assert.equal(receipt.railNeutralSupportState, 'probe_only');
    // Never a settled/final claim anywhere in the emitted shape.
    const serialized = JSON.stringify(receipt).toLowerCase();
    assert.doesNotMatch(serialized, /"settled":true|"final":true|"finalized":true|settlement finality proven/);
    assert.equal(receipt.guardrails.settlementFinalityClaim, false);
    assert.equal(receipt.guardrails.custodyClaim, false);
    assert.equal(receipt.guardrails.merchantSecretHeld, false);
    assert.equal(receipt.guardrails.hmacVerifiedLive, false);

    assert.equal(receipt.payment.fiatAssetNamespace, 'reddi.fiat-rail-fixture');
    assert.equal(receipt.payment.currency, 'AUD');
    assert.equal(receipt.payment.unit, 'fiat-minor-units');
    assert.ok(receipt.payment.paymentProofRef.startsWith('airwallex-webhook-probe:'));
    assert.equal(receipt.eventRef.eventId, fixture.event.id);
  }
});

test('the signature model is fixture-asserted only — no HMAC verification, no merchant secret', () => {
  const result = normalizeAirwallexWebhookFixture(airwallexWebhookFixtures.paymentIntentSucceeded);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.receipt.signature.fixture_asserted, true);
  assert.equal(result.receipt.signature.signatureVerifiedLive, false);
  assert.equal(result.receipt.signature.merchantSecretHeld, false);
  assert.ok(result.receipt.claimBoundary.some((line) => line.includes('fixture-asserted, never verified against a live merchant secret')));
});

test('every emitted receipt documents the revocability gap and pins it to #338', () => {
  const result = normalizeAirwallexWebhookFixture(airwallexWebhookFixtures.paymentIntentSucceeded);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const revocability = result.receipt.revocability;
  assert.equal(revocability.revocable, true);
  assert.equal(revocability.receiptV1RevocationRepresentable, false);
  assert.equal(revocability.gapTrackedInIssue, 338);
  assert.match(revocability.note, /refunded, disputed, or reversed/);
  assert.match(revocability.note, /no revoked\/contested state/);
  assert.match(revocability.note, /NOT widened/);
  assert.ok(result.receipt.claimBoundary.some((line) => line.includes('#338 gap')));
});

test('refund, dispute, and reversal events are explicitly NOT receipts (revocability gap, fail closed)', () => {
  for (const fixture of [
    airwallexWebhookRejectionFixtures.refundSucceeded,
    airwallexWebhookRejectionFixtures.disputeCreated,
    airwallexWebhookRejectionFixtures.reversalSucceeded,
  ]) {
    const result = normalizeAirwallexWebhookFixture(fixture);
    assert.equal(result.ok, false, `${fixture.event.name} must never normalize into a receipt`);
    if (result.ok) continue;
    assert.equal(result.supportState, 'unsupported_live_airwallex_settlement');
    assert.ok(result.reasonCodes.includes('revocation_event_not_receipt'));
    // The rejection itself documents the receipt-v1 gap and routes it to #338.
    const note = result.auditNotes.join(' ');
    assert.match(note, /explicitly NOT a receipt/);
    assert.match(note, /no revoked\/contested state/);
    assert.match(note, /#338/);
  }
});

test('every revocation-family event name fails closed, not just the shipped fixtures', () => {
  for (const name of AIRWALLEX_REVOCATION_EVENT_NAMES) {
    const fixture = structuredClone(airwallexWebhookFixtures.paymentIntentSucceeded);
    fixture.event.name = name;
    const result = normalizeAirwallexWebhookFixture(fixture);
    assert.equal(result.ok, false, `${name} must be rejected`);
    if (result.ok) continue;
    assert.ok(result.reasonCodes.includes('revocation_event_not_receipt'), `${name} must carry revocation_event_not_receipt`);
  }
  // The two vocabularies never overlap.
  for (const name of AIRWALLEX_NORMALIZABLE_EVENT_NAMES) {
    assert.ok(!(AIRWALLEX_REVOCATION_EVENT_NAMES as readonly string[]).includes(name));
  }
});

test('every rejection fixture fails closed into unsupported_live_airwallex_settlement', () => {
  const cases = listAirwallexWebhookRejectionFixtures();
  assert.equal(cases.length, Object.keys(airwallexWebhookRejectionFixtures).length);
  for (const { key, fixture, expectedReasonCode } of cases) {
    const result = normalizeAirwallexWebhookFixture(fixture);
    assert.equal(result.ok, false, `${key} must be rejected`);
    if (result.ok) continue;
    assert.equal(result.supportState, 'unsupported_live_airwallex_settlement', `${key} must fail closed`);
    assert.ok(
      result.reasonCodes.includes(expectedReasonCode),
      `${key} must include ${expectedReasonCode}; got ${result.reasonCodes.join(',')}`,
    );
    assert.ok(result.auditNotes.length > 0, `${key} must carry audit notes`);
  }
});

test('malformed and missing-signature fixtures are rejected', () => {
  for (const malformed of [null, undefined, 42, 'fixture', {}, { schemaVersion: 'wrong' }, []]) {
    const result = normalizeAirwallexWebhookFixture(malformed);
    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.ok(result.reasonCodes.includes('webhook_fixture_malformed'));
  }
  const missing = normalizeAirwallexWebhookFixture(airwallexWebhookRejectionFixtures.missingSignature);
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.ok(missing.reasonCodes.includes('signature_missing_or_not_fixture_asserted'));
  }
});

test('credential-bearing, live-URL, and real-looking-secret content is rejected', () => {
  const apiKey = normalizeAirwallexWebhookFixture(airwallexWebhookRejectionFixtures.apiKeyLeak);
  assert.equal(apiKey.ok, false);
  if (!apiKey.ok) assert.ok(apiKey.reasonCodes.includes('credential_material_rejected'));

  const clientId = normalizeAirwallexWebhookFixture(airwallexWebhookRejectionFixtures.clientIdLeak);
  assert.equal(clientId.ok, false);
  if (!clientId.ok) assert.ok(clientId.reasonCodes.includes('credential_material_rejected'));

  const url = normalizeAirwallexWebhookFixture(airwallexWebhookRejectionFixtures.liveUrl);
  assert.equal(url.ok, false);
  if (!url.ok) assert.ok(url.reasonCodes.includes('live_url_rejected'));

  const whsec = normalizeAirwallexWebhookFixture(airwallexWebhookRejectionFixtures.merchantSecretValue);
  assert.equal(whsec.ok, false);
  if (!whsec.ok) assert.ok(whsec.reasonCodes.includes('merchant_secret_material_rejected'));

  const digest = normalizeAirwallexWebhookFixture(airwallexWebhookRejectionFixtures.realLookingSignatureDigest);
  assert.equal(digest.ok, false);
  if (!digest.ok) assert.ok(digest.reasonCodes.includes('merchant_secret_material_rejected'));

  const liveVerified = normalizeAirwallexWebhookFixture(airwallexWebhookRejectionFixtures.liveVerifiedSignature);
  assert.equal(liveVerified.ok, false);
  if (!liveVerified.ok) assert.ok(liveVerified.reasonCodes.includes('live_signature_verification_rejected'));
});

test('PII-shaped, custody-claiming, finality-claiming, and non-synthetic fixtures are rejected', () => {
  const pan = normalizeAirwallexWebhookFixture(airwallexWebhookRejectionFixtures.panShapedString);
  assert.equal(pan.ok, false);
  if (!pan.ok) assert.ok(pan.reasonCodes.includes('pan_shaped_string_rejected'));

  const email = normalizeAirwallexWebhookFixture(airwallexWebhookRejectionFixtures.emailShapedString);
  assert.equal(email.ok, false);
  if (!email.ok) assert.ok(email.reasonCodes.includes('email_shaped_string_rejected'));

  const custody = normalizeAirwallexWebhookFixture(airwallexWebhookRejectionFixtures.custodyClaim);
  assert.equal(custody.ok, false);
  if (!custody.ok) assert.ok(custody.reasonCodes.includes('custody_claim_rejected'));

  const finality = normalizeAirwallexWebhookFixture(airwallexWebhookRejectionFixtures.settlementFinalityClaim);
  assert.equal(finality.ok, false);
  if (!finality.ok) assert.ok(finality.reasonCodes.includes('settlement_finality_claim_rejected'));

  const nonSynthetic = normalizeAirwallexWebhookFixture(airwallexWebhookRejectionFixtures.nonSyntheticFlag);
  assert.equal(nonSynthetic.ok, false);
  if (!nonSynthetic.ok) assert.ok(nonSynthetic.reasonCodes.includes('non_synthetic_fixture_rejected'));

  const realIds = normalizeAirwallexWebhookFixture(airwallexWebhookRejectionFixtures.realLookingIds);
  assert.equal(realIds.ok, false);
  if (!realIds.ok) assert.ok(realIds.reasonCodes.includes('non_synthetic_fixture_rejected'));
});

test('normalization is deterministic and does not mutate its input', () => {
  const input = structuredClone(airwallexWebhookFixtures.paymentIntentSucceeded);
  const first = normalizeAirwallexWebhookFixture(input);
  const second = normalizeAirwallexWebhookFixture(input);
  assert.deepEqual(first, second);
  assert.deepEqual(input, airwallexWebhookFixtures.paymentIntentSucceeded);
});

test('the valid fixtures contain no URL, PII, PAN, or credential-shaped material', () => {
  for (const fixture of Object.values(airwallexWebhookFixtures)) {
    const serialized = JSON.stringify(fixture);
    assert.doesNotMatch(serialized, /https?:\/\//i);
    assert.doesNotMatch(serialized, /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i);
    assert.doesNotMatch(serialized, /\b(?:\d[ -]?){13,19}\b/);
    assert.doesNotMatch(serialized, /whsec_|ak_(live|test)_|bearer\s+[a-z0-9._-]{8,}/i);
    // Synthetic markers everywhere identifiers appear.
    assert.ok(fixture.event.id.includes('fixture'));
    assert.ok(fixture.event.data.object.id.includes('fixture'));
    assert.ok(fixture.signature.valueRef.startsWith('fixture:'));
  }
});

test('rail-neutral derivation caps Airwallex webhook fixtures at probe_only with a non-bindable integration', () => {
  const result = deriveRailNeutralPaymentReceipt({
    rail: 'airwallex-hosted-checkout',
    fixture: airwallexWebhookFixtures.paymentIntentSucceeded,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const receipt = result.receipt;
  assert.equal(receipt.rail, 'airwallex-hosted-checkout');
  assert.equal(receipt.supportState, 'probe_only');
  assert.notEqual(receipt.supportState, 'receipt_binding_candidate');
  assert.equal(receipt.payment.unit, 'fiat-minor-units');
  assert.equal(receipt.payment.asset, 'AUD');
  assert.equal(receipt.bindingIntegration.compatible, false);
  if (receipt.bindingIntegration.compatible === false) {
    const reasons = receipt.bindingIntegration.incompatibilityReasons.join(' ');
    assert.match(reasons, /receipt v1 network table/);
    assert.match(reasons, /revoked\/contested state/);
    assert.match(reasons, /#338/);
    assert.match(reasons, /fixture-asserted/);
  }
  assert.ok(receipt.claimBoundary.some((line) => line.includes('never produces a final, settled, or binding receipt')));
  assert.equal(receipt.guardrails.settlementProof, false);
  assert.equal(receipt.guardrails.custodyClaim, false);
});

test('rail-neutral derivation fails closed on revocation events with revocable_event_rejected', () => {
  const result = deriveRailNeutralPaymentReceipt({
    rail: 'airwallex-hosted-checkout',
    fixture: airwallexWebhookRejectionFixtures.refundSucceeded as AirwallexWebhookFixture,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.some((item) => item.code === 'revocable_event_rejected'));
  assert.ok(result.errors.some((item) => item.message.includes('#338')));
});

test('rail-neutral derivation maps PII and live-path rejections onto the shared error vocabulary', () => {
  const pii = deriveRailNeutralPaymentReceipt({
    rail: 'airwallex-hosted-checkout',
    fixture: airwallexWebhookRejectionFixtures.emailShapedString as AirwallexWebhookFixture,
  });
  assert.equal(pii.ok, false);
  if (!pii.ok) assert.ok(pii.errors.some((item) => item.code === 'pii_rejected'));

  const secret = deriveRailNeutralPaymentReceipt({
    rail: 'airwallex-hosted-checkout',
    fixture: airwallexWebhookRejectionFixtures.merchantSecretValue as AirwallexWebhookFixture,
  });
  assert.equal(secret.ok, false);
  if (!secret.ok) assert.ok(secret.errors.some((item) => item.code === 'live_path_rejected'));
});

test('the proof-chain bridge never mints a reddi.receipt.v1 envelope from a probe_only receipt', () => {
  const fixture = railNeutralProofChainFixtures.airwallexWebhookProbeOnlyCap;
  assert.equal(fixture.status, 'blocked');
  assert.equal(fixture.redactedReceipt, undefined);
  assert.equal(fixture.evidence, undefined);
  assert.equal(fixture.binding, undefined);
  assert.ok(fixture.blockedBy);
  if (!fixture.blockedBy) return;
  assert.ok(fixture.blockedBy.some((item) => item.code === 'unsupported_fixture_state'));
  assert.ok(fixture.blockedBy.some((item) => item.message.includes('probe_only receipts never bridge into reddi.receipt.v1')));

  // Same guard holds for a freshly constructed bridge input.
  const fresh = createRailNeutralProofChainFixture({
    case: 'airwallex_webhook_probe_only_cap',
    receiptInput: { rail: 'airwallex-hosted-checkout', fixture: airwallexWebhookFixtures.paymentLinkPaid },
  });
  assert.equal(fresh.status, 'blocked');
  assert.equal(fresh.redactedReceipt, undefined);
});

test('is offline-only: the module imports nothing from network/fs/exec and contains no async surface', () => {
  const sourcePath = fileURLToPath(new URL('../src/airwallex-webhook-receipt-normalization.ts', import.meta.url));
  const source = readFileSync(sourcePath, 'utf8');
  for (const banned of [
    'ethers',
    'web3',
    'viem',
    'node:net',
    'node:http',
    'node:https',
    'node:fs',
    'node:crypto',
    'node:child_process',
    "'child_process'",
    'createHmac',
    'XMLHttpRequest',
    'fetch(',
  ]) {
    assert.ok(!source.includes(banned), `module must not reference ${banned}`);
  }
  assert.ok(!/\basync\b/.test(source), 'module must not contain async code');
  assert.ok(!/\bawait\b/.test(source), 'module must not contain await');
});

test('tags Airwallex-shaped claims as unverified in source and states the hard boundary and gap', () => {
  const sourcePath = fileURLToPath(new URL('../src/airwallex-webhook-receipt-normalization.ts', import.meta.url));
  const source = readFileSync(sourcePath, 'utf8');
  assert.ok(
    (source.match(/\(unverified — Airwallex docs/g) ?? []).length >= 5,
    'Airwallex field shapes must carry the (unverified — Airwallex docs) tag',
  );
  assert.ok(source.includes('HARD BOUNDARY'), 'the no-account/no-API/no-live-call boundary must be stated in source');
  assert.ok(source.includes('PROBE-ONLY CAP'), 'the probe-only cap must be stated in source');
  assert.ok(source.includes('SIGNATURE MODEL'), 'the fixture-asserted signature model must be stated in source');
  assert.ok(source.includes('RECEIPT-V1 GAP'), 'the receipt-v1 revocation gap must be documented in source');
  assert.ok(source.includes('#338') || source.includes('338'), 'the gap must route to issue #338');
});
