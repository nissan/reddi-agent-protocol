import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AP2_EXTERNAL_STANDARD,
  AP2_MANDATE_FIELD_PROVENANCE,
  AP2_MANDATE_INGESTION_DRAFT,
  AP2_MANDATE_INGESTION_FIXTURE_NOW,
  AP2_MANDATE_INGESTION_SCHEMA_VERSION,
  AP2_RAIL_SUPPORT_STATE_MATRIX,
  AP2_UNSUPPORTED_FIELDS,
  ap2LocalBuyerAuthorityPolicyFixture,
  ap2MandateFixtures,
  bindMandateToReceipt,
  composeAp2MandateWithLocalPolicy,
  evaluateBuyerAuthorityPolicy,
  hashAp2Mandate,
  ingestAp2Mandate,
  listAp2MandateFixtures,
  reddiReceiptFixtures,
  validateBuyerAuthorityPolicy,
  validateReddiReceipt,
} from '../dist/index.js';

const NOW = AP2_MANDATE_INGESTION_FIXTURE_NOW;

test('is promoted with an honest external-standard block and a draft support-state matrix', () => {
  assert.equal(AP2_MANDATE_INGESTION_SCHEMA_VERSION, 'reddi.ap2-mandate-ingestion.v1');
  // RAP-side contract promoted by #563; external AP2 uncertainty is tracked separately.
  assert.equal(AP2_MANDATE_INGESTION_DRAFT, false);
  assert.equal(AP2_EXTERNAL_STANDARD.fieldShapesVerified, false);
  assert.equal(AP2_EXTERNAL_STANDARD.signatureVerification, 'fixture-asserted');
  assert.equal(AP2_EXTERNAL_STANDARD.settlementRail, false);
  assert.equal(AP2_EXTERNAL_STANDARD.governanceLineageVerified, false);

  // The matrix rows describe the EXTERNAL AP2 vocabulary and stay draft/low-confidence.
  assert.ok(AP2_RAIL_SUPPORT_STATE_MATRIX.length >= 3);
  for (const row of AP2_RAIL_SUPPORT_STATE_MATRIX) {
    assert.equal(row.rail, 'google-ap2');
    assert.equal(row.draft, true);
    assert.equal(row.confidence, 'low');
    assert.ok(row.claimBoundary.length > 0);
  }
  const states = AP2_RAIL_SUPPORT_STATE_MATRIX.map((row) => row.supportState);
  assert.ok(states.includes('ap2_mandate_fixture'));
  assert.ok(states.includes('ap2_mandate_probe_only'));
  assert.ok(states.includes('unsupported_live_ap2_settlement'));
});

test('publishes per-field provenance and unsupported-field tables', () => {
  assert.ok(AP2_MANDATE_FIELD_PROVENANCE.length >= 10);
  for (const row of AP2_MANDATE_FIELD_PROVENANCE) {
    assert.ok(row.target.length > 0);
    assert.ok(row.source.length > 0);
    assert.ok(['rap-native', 'ap2-draft-interface'].includes(row.confidence));
  }
  assert.ok(AP2_UNSUPPORTED_FIELDS.length >= 8);
  for (const row of AP2_UNSUPPORTED_FIELDS) {
    assert.ok(['blocked', 'omitted', 'excluded'].includes(row.behavior));
    assert.ok(row.reason.length > 0);
  }
  const surfaces = AP2_UNSUPPORTED_FIELDS.map((row) => row.surface.toLowerCase()).join(' | ');
  assert.ok(surfaces.includes('vdc signature'));
  assert.ok(surfaces.includes('settlement'));
  assert.ok(surfaces.includes('widening local authority'));
});

test('ingests a finalized mandate into correct buyer-authority constraints', () => {
  const result = ingestAp2Mandate(ap2MandateFixtures.checkoutClosedPaymentClosedValid, NOW);

  assert.equal(result.draft, false);
  assert.equal(result.externalStandard.fieldShapesVerified, false);
  assert.equal(result.supportState, 'ap2_mandate_fixture');
  assert.deepEqual(result.reasonCodes, ['ap2_mandate_ingested']);
  assert.ok(result.derived);
  if (!result.derived) return;

  assert.deepEqual(result.derived.allowedCurrencies, ['USDC']);
  assert.equal(result.derived.spendCaps.length, 1);
  assert.equal(result.derived.spendCaps[0].asset, 'USDC');
  // budgetCap 50.00 normalized losslessly to integer centi-units for the BigInt gate.
  assert.equal(result.derived.spendCaps[0].maxAmountUnits, '5000');
  assert.equal(result.derived.spendCaps[0].window, 'per_request');
  assert.deepEqual(result.derived.sellerAllowlistAdditions.sellerIds, ['ap2-merchant:seller:listing-writer']);
  assert.equal(result.derived.expiresAt, '2027-01-01T00:00:00.000Z');
  assert.equal(result.derived.operatorApprovalRequired, false);
});

test('treats the VDC signature as opaque and claims no settlement finality', () => {
  const result = ingestAp2Mandate(ap2MandateFixtures.checkoutClosedPaymentClosedValid, NOW);

  assert.equal(result.mandateRef.vdcVerification, 'fixture-asserted');
  assert.equal(result.mandateRef.settlementFinalityClaimed, false);
  assert.match(result.mandateRef.mandateHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.guardrails.vdcSignatureVerifiedLive, false);
  assert.equal(result.guardrails.keyMaterialHeld, false);
  assert.equal(result.guardrails.settlementFinalityClaim, false);
  assert.equal(result.guardrails.livePaymentExecuted, false);

  // The opaque signature bytes never leak into the derived output or the ref.
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, new RegExp(ap2MandateFixtures.checkoutClosedPaymentClosedValid.vdc.signatureB64));
});

test('mandate hash is deterministic, recomputable, and independent of the opaque signature', () => {
  const a = ingestAp2Mandate(ap2MandateFixtures.checkoutClosedPaymentClosedValid, NOW);
  const withDifferentSignature = structuredClone(ap2MandateFixtures.checkoutClosedPaymentClosedValid);
  withDifferentSignature.vdc.signatureB64 = 'YS1kaWZmZXJlbnQtb3BhcXVlLXNpZ25hdHVyZS12YWx1ZQ';
  const b = ingestAp2Mandate(withDifferentSignature, NOW);

  assert.equal(a.mandateRef.mandateHash, b.mandateRef.mandateHash);
  assert.equal(a.mandateRef.mandateHash, hashAp2Mandate(ap2MandateFixtures.checkoutClosedPaymentClosedValid));
});

test('binds an authorizing mandate ref onto a receipt with no settlement claim, keeping the receipt valid', () => {
  const result = ingestAp2Mandate(ap2MandateFixtures.checkoutClosedPaymentClosedValid, NOW);
  const binding = bindMandateToReceipt(reddiReceiptFixtures.happyPath, result.mandateRef);

  assert.equal(binding.ok, true);
  assert.deepEqual(binding.reasonCodes, ['ap2_mandate_ref_bound']);
  assert.ok(binding.receipt);
  if (!binding.receipt) return;

  const bound = binding.receipt.metadata?.ap2MandateRef as Record<string, unknown>;
  assert.ok(bound);
  assert.equal(bound.mandateType, 'payment_closed');
  assert.equal(bound.mandateHash, result.mandateRef.mandateHash);
  assert.equal(bound.supportState, 'ap2_mandate_fixture');
  assert.equal(bound.settlementFinalityClaimed, false);
  assert.equal(bound.vdcVerification, 'fixture-asserted');

  // Receipt must still validate (no credential leak, no settlement fields).
  const validation = validateReddiReceipt(binding.receipt);
  assert.equal(validation.ok, true);
});

test('probe-only and rejected mandate refs never bind to a receipt', () => {
  const probeOnly = ingestAp2Mandate(ap2MandateFixtures.paymentOpenProbeOnly, NOW);
  const probeBinding = bindMandateToReceipt(reddiReceiptFixtures.happyPath, probeOnly.mandateRef);
  assert.equal(probeBinding.ok, false);
  assert.equal(probeBinding.receipt, null);
  assert.ok(probeBinding.reasonCodes.includes('probe_only_ref_not_bindable'));

  const rejected = ingestAp2Mandate(ap2MandateFixtures.settlementClaimMandate, NOW);
  const rejectedBinding = bindMandateToReceipt(reddiReceiptFixtures.happyPath, rejected.mandateRef);
  assert.equal(rejectedBinding.ok, false);
  assert.equal(rejectedBinding.receipt, null);
  assert.ok(rejectedBinding.reasonCodes.includes('rejected_mandate_ref_not_bindable'));
});

test('a signature-material-bearing ref fails closed at binding', () => {
  const result = ingestAp2Mandate(ap2MandateFixtures.checkoutClosedPaymentClosedValid, NOW);
  const smuggled = {
    ...result.mandateRef,
    mandateSignature: 'eyJhbGciOiJFUzI1NiJ9.eyJyZWYiOiJsZWFrIn0.c2lnbmF0dXJlLWJ5dGVzLWZpeHR1cmU',
  } as unknown as typeof result.mandateRef;
  const binding = bindMandateToReceipt(reddiReceiptFixtures.happyPath, smuggled);
  assert.equal(binding.ok, false);
  assert.equal(binding.receipt, null);
  assert.ok(binding.reasonCodes.includes('signature_material_rejected'));
});

test('open/cart-less mandates are probe-only with no derived authorization', () => {
  const result = ingestAp2Mandate(ap2MandateFixtures.paymentOpenProbeOnly, NOW);

  assert.equal(result.supportState, 'ap2_mandate_probe_only');
  assert.equal(result.derived, null);
  assert.deepEqual(result.reasonCodes, ['probe_only_no_cart_binding']);
});

test('human-not-present mandate flags operator approval required', () => {
  const result = ingestAp2Mandate(ap2MandateFixtures.humanNotPresent, NOW);

  assert.equal(result.supportState, 'ap2_mandate_fixture');
  assert.ok(result.derived);
  if (!result.derived) return;
  assert.equal(result.derived.operatorApprovalRequired, true);
});

test('fails closed on an expired mandate', () => {
  const result = ingestAp2Mandate(ap2MandateFixtures.expiredMandate, NOW);

  assert.equal(result.derived, null);
  assert.equal(result.supportState, 'ap2_mandate_probe_only');
  assert.ok(result.reasonCodes.includes('mandate_expired'));
});

test('fails closed on an over-cap mandate', () => {
  const result = ingestAp2Mandate(ap2MandateFixtures.overBudgetMandate, NOW);

  assert.equal(result.derived, null);
  assert.ok(result.reasonCodes.includes('mandate_over_cap'));
});

test('fails closed on a rail-mismatch (unsupported currency) mandate', () => {
  const result = ingestAp2Mandate(ap2MandateFixtures.railMismatchMandate, NOW);

  assert.equal(result.derived, null);
  assert.ok(result.reasonCodes.includes('unsupported_currency_rail'));
});

test('fails closed on an unsupported mandate type without coercing it', () => {
  const result = ingestAp2Mandate(ap2MandateFixtures.unsupportedTypeMandate, NOW);

  assert.equal(result.derived, null);
  assert.equal(result.supportState, 'ap2_mandate_probe_only');
  assert.deepEqual(result.reasonCodes, ['unsupported_mandate_type']);
});

test('fails closed on signature material outside the opaque VDC slot', () => {
  const result = ingestAp2Mandate(ap2MandateFixtures.signatureMaterialMandate, NOW);

  assert.equal(result.derived, null);
  assert.equal(result.supportState, 'unsupported_live_ap2_settlement');
  assert.ok(result.reasonCodes.includes('signature_material_rejected'));
});

test('fails closed on a PAN/credential leak', () => {
  const result = ingestAp2Mandate(ap2MandateFixtures.panLeakMandate, NOW);

  assert.equal(result.derived, null);
  assert.equal(result.supportState, 'unsupported_live_ap2_settlement');
  assert.ok(result.reasonCodes.includes('mandate_contains_credentials'));
});

test('rejects a settlement-finality claim into the unsupported live state', () => {
  const result = ingestAp2Mandate(ap2MandateFixtures.settlementClaimMandate, NOW);

  assert.equal(result.derived, null);
  assert.equal(result.supportState, 'unsupported_live_ap2_settlement');
  assert.ok(result.reasonCodes.includes('settlement_finality_claim_rejected'));
  assert.equal(result.mandateRef.settlementFinalityClaimed, false);
});

test('malformed mandate fails closed as mandate_malformed', () => {
  const result = ingestAp2Mandate({ mandateType: 'nonsense' } as never, NOW);

  assert.equal(result.derived, null);
  assert.ok(result.reasonCodes.includes('mandate_malformed'));
});

test('composition with a local policy never widens local authority', () => {
  const ingestion = ingestAp2Mandate(ap2MandateFixtures.checkoutClosedPaymentClosedValid, NOW);
  const local = ap2LocalBuyerAuthorityPolicyFixture();
  const composition = composeAp2MandateWithLocalPolicy(local, ingestion);

  assert.equal(composition.ok, true);
  assert.ok(composition.composedPolicy);
  if (!composition.composedPolicy) return;

  // Mandate cap (5000) is wider than local (4000): local wins.
  assert.ok(composition.reasonCodes.includes('mandate_cap_wider_than_local_cap'));
  assert.equal(composition.composedPolicy.spendCaps[0].maxAmountUnits, '4000');
  // Local expiry (2026-12-31) is earlier than the mandate's (2027-01-01): local wins.
  assert.equal(composition.composedPolicy.expiresAt, local.expiresAt);
  // The composed policy is itself a valid buyer-authority policy.
  const validation = validateBuyerAuthorityPolicy(composition.composedPolicy);
  assert.equal(validation.allowed, true);

  // The REAL gate enforces the composed (local-winning) cap end-to-end.
  const overLocalCap = evaluateBuyerAuthorityPolicy(composition.composedPolicy, {
    sellerId: 'ap2-merchant:seller:listing-writer',
    endpointId: 'ap2-merchant-endpoint:seller:listing-writer',
    asset: 'USDC',
    network: 'ap2-authorization-fixture',
    amountUnits: '4001',
    supportState: 'proof-metadata-only',
    receiptPresented: true,
    evidencePresented: true,
    now: NOW,
    operatorApprovalState: 'approved',
  });
  assert.equal(overLocalCap.allowed, false);
  assert.ok(overLocalCap.reasonCodes.includes('spend_cap_exceeded'));

  const withinCap = evaluateBuyerAuthorityPolicy(composition.composedPolicy, {
    sellerId: 'ap2-merchant:seller:listing-writer',
    endpointId: 'ap2-merchant-endpoint:seller:listing-writer',
    asset: 'USDC',
    network: 'ap2-authorization-fixture',
    amountUnits: '2500',
    supportState: 'proof-metadata-only',
    receiptPresented: true,
    evidencePresented: true,
    now: NOW,
    operatorApprovalState: 'approved',
  });
  assert.equal(withinCap.allowed, true);
});

test('composition blocks when the mandate merchant is not allowlisted locally', () => {
  const ingestion = ingestAp2Mandate(ap2MandateFixtures.checkoutClosedPaymentClosedValid, NOW);
  const local = ap2LocalBuyerAuthorityPolicyFixture({
    sellerAllowlist: {
      sellerIds: ['ap2-merchant:seller:someone-else'],
      endpointIds: ['ap2-merchant-endpoint:seller:someone-else'],
    },
  });
  const composition = composeAp2MandateWithLocalPolicy(local, ingestion);

  assert.equal(composition.ok, false);
  assert.equal(composition.composedPolicy, null);
  assert.ok(composition.reasonCodes.includes('mandate_merchant_not_allowlisted_locally'));
});

test('composition blocks probe-only mandates and invalid local policies', () => {
  const probeOnly = ingestAp2Mandate(ap2MandateFixtures.paymentOpenProbeOnly, NOW);
  const blockedProbe = composeAp2MandateWithLocalPolicy(ap2LocalBuyerAuthorityPolicyFixture(), probeOnly);
  assert.equal(blockedProbe.ok, false);
  assert.ok(blockedProbe.reasonCodes.includes('mandate_not_authorizing'));

  const authorizing = ingestAp2Mandate(ap2MandateFixtures.checkoutClosedPaymentClosedValid, NOW);
  const blockedLocal = composeAp2MandateWithLocalPolicy({ nonsense: true }, authorizing);
  assert.equal(blockedLocal.ok, false);
  assert.ok(blockedLocal.reasonCodes.includes('local_policy_invalid'));
});

test('no fixture claims settlement finality or executes live payment', () => {
  for (const { mandate } of listAp2MandateFixtures()) {
    const result = ingestAp2Mandate(mandate, NOW);
    assert.equal(result.mandateRef.settlementFinalityClaimed, false);
    assert.equal(result.guardrails.livePaymentExecuted, false);
    assert.equal(result.guardrails.vdcSignatureVerifiedLive, false);
    assert.equal(result.guardrails.keyMaterialHeld, false);
  }
});
