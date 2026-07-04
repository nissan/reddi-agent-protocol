import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AP2_MANDATE_INGESTION_SCHEMA_VERSION,
  AP2_MANDATE_INGESTION_DRAFT,
  AP2_MANDATE_INGESTION_FIXTURE_NOW,
  AP2_RAIL_SUPPORT_STATE_MATRIX,
  ap2MandateFixtures,
  bindMandateToReceipt,
  evaluateBuyerAuthorityPolicy,
  ingestAp2Mandate,
  listAp2MandateFixtures,
  reddiReceiptFixtures,
  validateReddiReceipt,
} from '../dist/index.js';

const NOW = AP2_MANDATE_INGESTION_FIXTURE_NOW;

test('is draft-flagged and exposes an AP2 support-state matrix row', () => {
  assert.equal(AP2_MANDATE_INGESTION_SCHEMA_VERSION, 'reddi.ap2-mandate-ingestion.v1');
  assert.equal(AP2_MANDATE_INGESTION_DRAFT, true);

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

test('ingests a finalized mandate into correct buyer-authority constraints', () => {
  const result = ingestAp2Mandate(ap2MandateFixtures.checkoutClosedPaymentClosedValid, NOW);

  assert.equal(result.draft, true);
  assert.equal(result.supportState, 'ap2_mandate_fixture');
  assert.deepEqual(result.reasonCodes, ['ap2_mandate_ingested']);
  assert.ok(result.derived);
  if (!result.derived) return;

  assert.deepEqual(result.derived.allowedCurrencies, ['USDC']);
  assert.equal(result.derived.spendCaps.length, 1);
  assert.equal(result.derived.spendCaps[0].asset, 'USDC');
  assert.equal(result.derived.spendCaps[0].maxAmountUnits, '50.00'); // budgetCap
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
  assert.equal(result.guardrails.settlementFinalityClaim, false);
  assert.equal(result.guardrails.livePaymentExecuted, false);

  // The opaque signature bytes never leak into the derived output or the ref.
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, new RegExp(ap2MandateFixtures.checkoutClosedPaymentClosedValid.vdc.signatureB64));
});

test('mandate hash is deterministic and independent of the opaque signature', () => {
  const a = ingestAp2Mandate(ap2MandateFixtures.checkoutClosedPaymentClosedValid, NOW);
  const withDifferentSignature = structuredClone(ap2MandateFixtures.checkoutClosedPaymentClosedValid);
  withDifferentSignature.vdc.signatureB64 = 'YS1kaWZmZXJlbnQtb3BhcXVlLXNpZ25hdHVyZS12YWx1ZQ';
  const b = ingestAp2Mandate(withDifferentSignature, NOW);

  assert.equal(a.mandateRef.mandateHash, b.mandateRef.mandateHash);
});

test('binds the mandate ref onto a receipt with no settlement claim, keeping the receipt valid', () => {
  const result = ingestAp2Mandate(ap2MandateFixtures.checkoutClosedPaymentClosedValid, NOW);
  const bound = bindMandateToReceipt(reddiReceiptFixtures.happyPath, result.mandateRef);

  const binding = bound.metadata?.ap2MandateRef as Record<string, unknown>;
  assert.ok(binding);
  assert.equal(binding.mandateType, 'payment_closed');
  assert.equal(binding.mandateHash, result.mandateRef.mandateHash);
  assert.equal(binding.supportState, 'ap2_mandate_fixture');
  assert.equal(binding.settlementFinalityClaimed, false);
  assert.equal(binding.vdcVerification, 'fixture-asserted');

  // Receipt must still validate (no credential leak, no settlement fields).
  const validation = validateReddiReceipt(bound);
  assert.equal(validation.ok, true);
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

test('derived constraints feed the buyer-authority gate end-to-end', () => {
  const result = ingestAp2Mandate(ap2MandateFixtures.checkoutClosedPaymentClosedValid, NOW);
  assert.ok(result.derived);
  if (!result.derived) return;

  // Build a minimal buyer-authority policy that consumes the derived constraints, then
  // assert the existing gate denies an over-cap request against the AP2-derived cap.
  const cap = result.derived.spendCaps[0];
  const policy = {
    schemaVersion: 'reddi.buyer-authority-policy.v1' as const,
    issue: 549 as const,
    policyId: 'buyer-authority:ap2-derived',
    mode: 'allow' as const,
    buyerAgentId: 'buyer-agent:ap2-demo',
    expiresAt: result.derived.expiresAt ?? '2027-01-01T00:00:00.000Z',
    allowedRails: [
      { asset: cap.asset, network: cap.network, supportStates: ['proof-metadata-only' as const] },
    ],
    allowedCurrencies: result.derived.allowedCurrencies,
    spendCaps: result.derived.spendCaps,
    sellerAllowlist: {
      sellerIds: result.derived.sellerAllowlistAdditions.sellerIds,
      endpointIds: result.derived.sellerAllowlistAdditions.endpointIds,
    },
    receiptEvidence: { receiptRequired: true, evidenceRequired: true, evidenceArchiveRequired: true },
    refundFailurePolicy: {
      failureMode: 'no_charge_on_failure' as const,
      refundMode: 'manual_review' as const,
      operatorReviewRequired: true,
    },
    operatorApproval: { required: false, approvalState: 'not_required' as const },
    supportStateConstraints: {
      allowLivePayment: false as const,
      allowedRuntimeStates: ['proof-metadata-only' as const],
      forbidCustody: true as const,
      forbidSettlementFinality: true as const,
    },
    notes: ['AP2-derived buyer-authority constraints, fixture-only, no live settlement.'],
  };

  const overCapRequest = {
    sellerId: 'ap2-merchant:seller:listing-writer',
    endpointId: 'ap2-merchant-endpoint:seller:listing-writer',
    asset: cap.asset,
    network: cap.network,
    amountUnits: '51.00', // above the 50.00 derived cap
    supportState: 'proof-metadata-only',
    receiptPresented: true,
    evidencePresented: true,
    now: '2026-07-05T00:00:00.000Z',
    operatorApprovalState: 'approved' as const,
  };

  const evaluation = evaluateBuyerAuthorityPolicy(policy, overCapRequest);
  assert.equal(evaluation.allowed, false);
  assert.ok(evaluation.reasonCodes.includes('spend_cap_exceeded'));
});

test('no fixture claims settlement finality or executes live payment', () => {
  for (const { mandate } of listAp2MandateFixtures()) {
    const result = ingestAp2Mandate(mandate, NOW);
    assert.equal(result.mandateRef.settlementFinalityClaimed, false);
    assert.equal(result.guardrails.livePaymentExecuted, false);
    assert.equal(result.guardrails.vdcSignatureVerifiedLive, false);
  }
});
