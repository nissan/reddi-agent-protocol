import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  AIRWALLEX_FIAT_RAIL_DRAFT_NAMESPACE,
  AIRWALLEX_HOSTED_CHECKOUT_RAIL_DRAFT,
  AIRWALLEX_HOSTED_CHECKOUT_RAIL_SCHEMA_VERSION,
  AIRWALLEX_RAIL_FIXTURE_GUARDRAILS,
  AIRWALLEX_RAIL_SUPPORT_STATE_MATRIX,
  airwallexHostedCheckoutRailFixture,
  airwallexRailRejectionFixtures,
  getAirwallexHostedCheckoutRail,
  listAirwallexRailRejectionFixtures,
  sellerWrapperFixtureHasCredentialMaterial,
  sellerWrapperRailFixture,
  validateAirwallexHostedCheckoutRailFixture,
} from '../dist/index.js';

test('is draft-flagged and exposes the three Airwallex support-state matrix rows', () => {
  assert.equal(AIRWALLEX_HOSTED_CHECKOUT_RAIL_SCHEMA_VERSION, 'reddi.airwallex-hosted-checkout-rail.v1');
  assert.equal(AIRWALLEX_HOSTED_CHECKOUT_RAIL_DRAFT, true);

  assert.equal(AIRWALLEX_RAIL_SUPPORT_STATE_MATRIX.length, 3);
  for (const row of AIRWALLEX_RAIL_SUPPORT_STATE_MATRIX) {
    assert.equal(row.rail, 'airwallex-hosted-checkout');
    assert.equal(row.draft, true);
    assert.equal(row.confidence, 'low');
    assert.ok(row.claimBoundary.length > 0);
    // Every row carries the shared no-custody/no-MoR/no-finality boundary.
    assert.ok(row.claimBoundary.some((line) => line.includes('no custody, money transmission, MoR status, or settlement finality')));
    assert.ok(row.claimBoundary.some((line) => line.includes('owned by the seller, not by RAP')));
    assert.ok(row.claimBoundary.some((line) => line.includes('fixture-asserted, never verified against a live merchant secret')));
  }
  const states = AIRWALLEX_RAIL_SUPPORT_STATE_MATRIX.map((row) => row.supportState);
  assert.ok(states.includes('airwallex_hosted_checkout_fixture'));
  assert.ok(states.includes('airwallex_webhook_receipt_probe_only'));
  assert.ok(states.includes('unsupported_live_airwallex_settlement'));
});

test('documents the revocable-receipt caveat and the receipt-v1 gap on the probe_only row', () => {
  const probeRow = AIRWALLEX_RAIL_SUPPORT_STATE_MATRIX
    .find((row) => row.supportState === 'airwallex_webhook_receipt_probe_only');
  assert.ok(probeRow);
  if (!probeRow) return;
  assert.match(probeRow.description, /REVOCABLE/);
  assert.match(probeRow.description, /refunded or disputed/);
  assert.match(probeRow.description, /receipt v1 has no representation for a later-revoked\/contested receipt/);
  assert.match(probeRow.description, /#338 receipt-semantics gap/);
  assert.ok(probeRow.claimBoundary.some((line) => line.includes('cap at probe_only')));
});

test('the unsupported row fails closed on every live Airwallex surface', () => {
  const unsupportedRow = AIRWALLEX_RAIL_SUPPORT_STATE_MATRIX
    .find((row) => row.supportState === 'unsupported_live_airwallex_settlement');
  assert.ok(unsupportedRow);
  if (!unsupportedRow) return;
  for (const surface of ['payouts', 'connected accounts / embedded finance', 'Airi', 'stablecoin']) {
    assert.ok(unsupportedRow.surfaces.includes(surface), `unsupported row must cover ${surface}`);
  }
  assert.match(unsupportedRow.description, /fails closed/);
  assert.match(unsupportedRow.description, /operator-approved boundary re-scope/);
});

test('the rail fixture is seller-MoR, fixture-state, draft-namespace fiat metadata', () => {
  const rail = getAirwallexHostedCheckoutRail();
  assert.ok(rail);
  if (!rail) return;

  assert.equal(rail.railKind, 'airwallex-hosted-checkout');
  assert.equal(rail.merchantOfRecord, 'seller');
  assert.equal(rail.state, 'fixture');
  assert.equal(rail.supportState, 'airwallex_hosted_checkout_fixture');
  assert.equal(rail.webhookReceiptExpected, true);
  assert.equal(rail.livePaymentApproved, false);
  assert.equal(rail.custodySupported, false);
  assert.equal(rail.fiatAssetNamespace, AIRWALLEX_FIAT_RAIL_DRAFT_NAMESPACE);
  assert.equal(rail.fiatAssetNamespace, 'reddi.fiat-rail-fixture');
  // The template ref is opaque: not a URL, not credential-shaped.
  assert.doesNotMatch(rail.paymentLinkTemplateRef, /^https?:\/\//i);

  assert.equal(airwallexHostedCheckoutRailFixture.draft, true);
  assert.equal(airwallexHostedCheckoutRailFixture.issue, 579);
  assert.equal(airwallexHostedCheckoutRailFixture.sourceContract.assessmentIssue, 541);
  assert.equal(airwallexHostedCheckoutRailFixture.sourceContract.railNeutralityEpic, 338);
  assert.equal(airwallexHostedCheckoutRailFixture.sourceContract.ap2PrecedentPullRequest, 571);
});

test('guardrails keep every live/custody/MoR/finality flag hard-false', () => {
  assert.equal(AIRWALLEX_RAIL_FIXTURE_GUARDRAILS.fixtureOnly, true);
  const liveFlags = Object.entries(AIRWALLEX_RAIL_FIXTURE_GUARDRAILS).filter(([key]) => key !== 'fixtureOnly');
  assert.ok(liveFlags.length >= 12);
  for (const [key, value] of liveFlags) {
    assert.equal(value, false, `guardrail ${key} must be false`);
  }
  assert.equal(airwallexHostedCheckoutRailFixture.guardrails, AIRWALLEX_RAIL_FIXTURE_GUARDRAILS);
});

test('the valid fixture passes fail-closed validation', () => {
  const result = validateAirwallexHostedCheckoutRailFixture(airwallexHostedCheckoutRailFixture);
  assert.equal(result.valid, true);
  assert.equal(result.supportState, 'airwallex_hosted_checkout_fixture');
  assert.deepEqual(result.reasonCodes, ['airwallex_rail_fixture_valid']);
});

test('validation is deterministic and does not mutate its input', () => {
  const input = structuredClone(airwallexHostedCheckoutRailFixture);
  const first = validateAirwallexHostedCheckoutRailFixture(input);
  const second = validateAirwallexHostedCheckoutRailFixture(input);
  assert.deepEqual(first, second);
  assert.deepEqual(input, airwallexHostedCheckoutRailFixture);
});

test('the fiat rail stays out of the frozen v1 seller-wrapper rail union', () => {
  // The Airwallex metadata reuses the existing seller-wrapper endpoint identity...
  assert.equal(
    airwallexHostedCheckoutRailFixture.endpoints[0].endpointId,
    sellerWrapperRailFixture.endpoints[0].endpointId,
  );
  // ...but the frozen v1 fixture itself is untouched: assets stay SOL/USDC/AUDD only.
  for (const endpoint of sellerWrapperRailFixture.endpoints) {
    for (const rail of endpoint.rails) {
      assert.ok(['SOL', 'USDC', 'AUDD'].includes(rail.asset));
    }
  }
  const serialized = JSON.stringify(sellerWrapperRailFixture);
  assert.doesNotMatch(serialized, /airwallex/i);
});

test('the fixture carries no credential material under the seller-wrapper scanner', () => {
  assert.equal(sellerWrapperFixtureHasCredentialMaterial(airwallexHostedCheckoutRailFixture), false);
});

test('the fixture contains no Airwallex URL, PII, or live-payment-link material', () => {
  const serialized = JSON.stringify(airwallexHostedCheckoutRailFixture);
  assert.doesNotMatch(serialized, /https?:\/\/[^"]*airwallex/i);
  assert.doesNotMatch(serialized, /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i);
  assert.doesNotMatch(serialized, /\b(?:\d[ -]?){13,19}\b/);
});

test('every rejection fixture fails closed into unsupported_live_airwallex_settlement', () => {
  const cases = listAirwallexRailRejectionFixtures();
  assert.equal(cases.length, Object.keys(airwallexRailRejectionFixtures).length);
  for (const { key, fixture, expectedReasonCode } of cases) {
    const result = validateAirwallexHostedCheckoutRailFixture(fixture);
    assert.equal(result.valid, false, `${key} must be rejected`);
    assert.equal(result.supportState, 'unsupported_live_airwallex_settlement', `${key} must fail closed`);
    assert.ok(
      result.reasonCodes.includes(expectedReasonCode),
      `${key} must include ${expectedReasonCode}; got ${result.reasonCodes.join(',')}`,
    );
    assert.ok(result.auditNotes.length > 0, `${key} must carry audit notes`);
  }
});

test('rejects API-key, client-ID, and bearer-token material', () => {
  for (const fixture of [
    airwallexRailRejectionFixtures.apiKeyLeak,
    airwallexRailRejectionFixtures.clientIdLeak,
    airwallexRailRejectionFixtures.bearerTokenLeak,
  ]) {
    const result = validateAirwallexHostedCheckoutRailFixture(fixture);
    assert.equal(result.valid, false);
    assert.ok(result.reasonCodes.includes('credential_material_rejected'));
  }
});

test('rejects live payment-link URLs — Airwallex hosts and URL-shaped template refs alike', () => {
  const airwallexHost = validateAirwallexHostedCheckoutRailFixture(airwallexRailRejectionFixtures.livePaymentLinkUrl);
  assert.ok(airwallexHost.reasonCodes.includes('live_payment_link_rejected'));

  const anyUrlRef = validateAirwallexHostedCheckoutRailFixture(airwallexRailRejectionFixtures.urlTemplateRef);
  assert.ok(anyUrlRef.reasonCodes.includes('live_payment_link_rejected'));
});

test('rejects PAN-shaped and email-shaped strings (shopper PII never enters rail metadata)', () => {
  const pan = validateAirwallexHostedCheckoutRailFixture(airwallexRailRejectionFixtures.panShapedString);
  assert.ok(pan.reasonCodes.includes('pan_shaped_string_rejected'));

  const email = validateAirwallexHostedCheckoutRailFixture(airwallexRailRejectionFixtures.emailShapedString);
  assert.ok(email.reasonCodes.includes('email_shaped_string_rejected'));
});

test('rejects custody and settlement-finality claims — field-shaped and textual', () => {
  const custody = validateAirwallexHostedCheckoutRailFixture(airwallexRailRejectionFixtures.custodyClaim);
  assert.ok(custody.reasonCodes.includes('custody_claim_rejected'));

  const finalityField = validateAirwallexHostedCheckoutRailFixture(airwallexRailRejectionFixtures.settlementFinalityField);
  assert.ok(finalityField.reasonCodes.includes('settlement_finality_claim_rejected'));

  const finalityText = validateAirwallexHostedCheckoutRailFixture(airwallexRailRejectionFixtures.settlementFinalityText);
  assert.ok(finalityText.reasonCodes.includes('settlement_finality_claim_rejected'));
});

test('rejects non-seller MoR, non-fixture states, live approval, and unsafe guardrails', () => {
  const platformMoR = validateAirwallexHostedCheckoutRailFixture(airwallexRailRejectionFixtures.platformMerchantOfRecord);
  assert.ok(platformMoR.reasonCodes.includes('merchant_of_record_not_seller'));

  const liveState = validateAirwallexHostedCheckoutRailFixture(airwallexRailRejectionFixtures.liveStateRail);
  assert.ok(liveState.reasonCodes.includes('non_fixture_state_rejected'));
  assert.ok(liveState.reasonCodes.includes('live_payment_approval_rejected'));

  const badGuardrails = validateAirwallexHostedCheckoutRailFixture(airwallexRailRejectionFixtures.guardrailsLiveFlag);
  assert.ok(badGuardrails.reasonCodes.includes('guardrails_invalid'));
});

test('malformed inputs fail closed as rail_fixture_malformed', () => {
  for (const malformed of [null, undefined, 42, 'fixture', {}, { schemaVersion: 'wrong' }, []]) {
    const result = validateAirwallexHostedCheckoutRailFixture(malformed);
    assert.equal(result.valid, false);
    assert.equal(result.supportState, 'unsupported_live_airwallex_settlement');
    assert.ok(result.reasonCodes.includes('rail_fixture_malformed'));
  }
  const railless = structuredClone(airwallexHostedCheckoutRailFixture) as unknown as { endpoints: Array<{ fiatRailsDraft: unknown[] }> };
  railless.endpoints[0].fiatRailsDraft = [];
  const result = validateAirwallexHostedCheckoutRailFixture(railless);
  assert.equal(result.valid, false);
  assert.ok(result.reasonCodes.includes('rail_fixture_malformed'));
});

test('is offline-only: the module imports nothing from network/fs/exec and contains no async surface', () => {
  const sourcePath = fileURLToPath(new URL('../src/airwallex-hosted-checkout-rail.ts', import.meta.url));
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
  ]) {
    assert.ok(!source.includes(banned), `module must not reference ${banned}`);
  }
  assert.ok(!/\basync\b/.test(source), 'module must not contain async code');
  assert.ok(!/\bawait\b/.test(source), 'module must not contain await');
});

test('tags Airwallex-shaped claims as unverified in source and states the hard boundary', () => {
  const sourcePath = fileURLToPath(new URL('../src/airwallex-hosted-checkout-rail.ts', import.meta.url));
  const source = readFileSync(sourcePath, 'utf8');
  assert.ok(
    (source.match(/\(unverified — Airwallex docs/g) ?? []).length >= 5,
    'Airwallex field shapes must carry the (unverified — Airwallex docs) tag',
  );
  assert.ok(source.includes('HARD BOUNDARY'), 'the no-account/no-API/no-live-call boundary must be stated in source');
  assert.ok(source.includes('RECEIPT-SEMANTICS CAVEAT'), 'the revocable-receipt caveat must be stated in source');
});
