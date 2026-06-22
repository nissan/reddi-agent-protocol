import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createEvidenceArchiveRecord,
  createReceiptEvidenceBinding,
  createReddiReceipt,
  deriveRailNeutralPaymentReceipt,
  mppTempoReceiptShapeFixtures,
  payShSandboxEvidenceFixtures,
  policyDecisionFromBudgetPolicyDecision,
  RAIL_NEUTRAL_PAYMENT_RECEIPT_SCHEMA_VERSION,
  type AuddPaymentPlanPreflightDecision,
} from '../dist/index.js';

const createdAt = '2026-06-22T04:30:00.000Z';

test('normalizes Pay.sh sandbox single-charge evidence as a rail-neutral binding candidate', () => {
  const result = deriveRailNeutralPaymentReceipt({
    rail: 'pay-sh-sandbox',
    fixture: payShSandboxEvidenceFixtures.singleCharge,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.receipt.schemaVersion, RAIL_NEUTRAL_PAYMENT_RECEIPT_SCHEMA_VERSION);
  assert.equal(result.receipt.rail, 'pay-sh-sandbox');
  assert.equal(result.receipt.supportState, 'receipt_binding_candidate');
  assert.equal(result.receipt.payment.network, 'solana-devnet');
  assert.equal(result.receipt.payment.asset, 'USDC');
  assert.equal(result.receipt.payment.amount, '10000');
  assert.equal(result.receipt.bindingIntegration.compatible, true);
  assert.equal(result.receipt.guardrails.fixtureOnly, true);
  assert.equal(result.receipt.guardrails.livePaymentExecuted, false);
  assert.equal(result.receipt.guardrails.walletSigning, false);
  assert.equal(result.receipt.guardrails.rpcCall, false);
  assert.equal(result.receipt.guardrails.providerCall, false);
  assert.equal(result.receipt.guardrails.hostedRegistryWrite, false);
  assert.equal(result.receipt.guardrails.marketplacePublication, false);
  assert.equal(result.receipt.guardrails.trustUpgrade, false);
  assert.equal(result.receipt.guardrails.reputationMutation, false);
  assert.equal(result.receipt.guardrails.settlementProof, false);
  assert.equal(result.receipt.guardrails.custodyClaim, false);
});

test('feeds normalized Pay.sh receipt metadata into receipt/evidence binding without live side effects', () => {
  const normalized = deriveRailNeutralPaymentReceipt({
    rail: 'pay-sh-sandbox',
    fixture: payShSandboxEvidenceFixtures.singleCharge,
  });
  assert.equal(normalized.ok, true);
  if (!normalized.ok) return;

  const paymentProofRef = normalized.receipt.payment.paymentProofRef;
  const policyDecision = policyDecisionFromBudgetPolicyDecision({
    allowed: true,
    reasonCodes: ['allowed'],
    quotedAmount: {
      amount: normalized.receipt.payment.amount,
      asset: normalized.receipt.payment.asset,
      network: normalized.receipt.payment.network,
      source: normalized.receipt.source.sourceId,
      specialist: 'pay-sh:reddi-x402-economic-demo',
    },
    remainingBudget: { perRequest: '20000' },
    auditNotes: ['Allowed by fixture-only rail-neutral payment receipt normalizer.'],
  });

  const receipt = createReddiReceipt({
    schemaVersion: 'reddi.receipt.v1',
    job: { id: 'job:pay-sh-sandbox:single-charge', type: 'fixture-only-payment-normalization' },
    source: {
      id: normalized.receipt.source.sourceId,
      type: normalized.receipt.source.kind,
      uri: normalized.receipt.source.catalogRef,
    },
    payer: { id: 'buyer:fixture' },
    specialist: { id: 'pay-sh:reddi-x402-economic-demo' },
    protocol: { name: 'Reddi Agent Protocol', version: '0.1.0' },
    payment: {
      network: normalized.receipt.payment.network,
      asset: normalized.receipt.payment.asset,
      amount: normalized.receipt.payment.amount,
      paymentProofRef,
    },
    requestHash: normalized.receipt.bindingRefs.requestHash,
    responseHash: normalized.receipt.bindingRefs.responseHash,
    evidenceRef: normalized.receipt.bindingRefs.evidenceRef,
    policyDecision,
    attestationStatus: 'not_requested',
    createdAt,
    metadata: {
      rail: normalized.receipt.rail,
      railNeutralReceiptSchema: normalized.receipt.schemaVersion,
      operatorApprovalRef: normalized.receipt.bindingRefs.operatorApprovalRef,
    },
  });

  const evidencePayload = {
    request: { hash: normalized.receipt.bindingRefs.requestHash },
    response: { hash: normalized.receipt.bindingRefs.responseHash },
    payment: {
      proofRef: paymentProofRef,
      rail: normalized.receipt.rail,
    },
  };
  const evidence = createEvidenceArchiveRecord({
    id: 'evidence:pay-sh-sandbox:single-charge',
    receiptId: receipt.job.id,
    sourceId: normalized.receipt.source.sourceId,
    requestHash: normalized.receipt.bindingRefs.requestHash,
    responseHash: normalized.receipt.bindingRefs.responseHash,
    evidenceRef: normalized.receipt.bindingRefs.evidenceRef,
    evidencePayload,
    createdAt,
  });

  const paymentPreflight: AuddPaymentPlanPreflightDecision = {
    allowed: true,
    reasonCodes: ['audd_payment_plan_allowed'],
    paymentProofRef,
    policyDecision,
    paymentPlan: {
      schemaVersion: 'reddi.audd-payment-plan.v1',
      asset: normalized.receipt.payment.asset,
      network: normalized.receipt.payment.network,
      mint: 'AUDDdev111111111111111111111111111111111111',
      payee: 'solana:payeeFixture111111111111111111111111111111',
      settlementAccount: 'solana:settlementFixture1111111111111111111111',
      amount: normalized.receipt.payment.amount,
      quoteExpiresAt: '2026-06-22T05:30:00.000Z',
      failurePolicy: { mode: 'no_charge_on_failure', description: 'Fixture-only normalization does not charge.' },
      refundPolicy: { mode: 'manual_review', description: 'Refunds require manual review.' },
      evidenceRequired: true,
      paymentMode: 'dry-run',
    },
    auditNotes: ['Fixture-only payment proof ref accepted for binding integration.'],
  } as unknown as AuddPaymentPlanPreflightDecision;

  const binding = createReceiptEvidenceBinding({
    id: 'binding:pay-sh-sandbox:single-charge',
    source: normalized.receipt.source,
    receipt,
    evidence,
    evidencePayload,
    paymentPreflight,
    createdAt,
  });

  assert.equal(binding.receipt.paymentProofRef, paymentProofRef);
  assert.equal(binding.evidence.evidenceRef, normalized.receipt.bindingRefs.evidenceRef);
  assert.equal(binding.guardrails.livePaymentExecuted, false);
  assert.equal(binding.guardrails.walletSigning, false);
  assert.equal(binding.guardrails.rpcCall, false);
  assert.equal(binding.guardrails.reputationMutated, false);
});

test('fails closed for probe-only Pay.sh receipt metadata', () => {
  const result = deriveRailNeutralPaymentReceipt({
    rail: 'pay-sh-sandbox',
    fixture: payShSandboxEvidenceFixtures.cappedSessionProbe,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.some((item) => item.code === 'unsupported_fixture_state'));
});

test('fails closed for malformed receipt candidates', () => {
  const malformed = structuredClone(payShSandboxEvidenceFixtures.singleCharge);
  malformed.receipt = undefined;

  const result = deriveRailNeutralPaymentReceipt({
    rail: 'pay-sh-sandbox',
    fixture: malformed,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.some((item) => item.code === 'malformed_receipt'));
});

test('fails closed for unsupported asset or network before receipt/evidence binding', () => {
  const payShUnsupported = deriveRailNeutralPaymentReceipt({
    rail: 'pay-sh-sandbox',
    fixture: payShSandboxEvidenceFixtures.singleCharge,
  }, { networkOverride: 'base-mainnet' });

  assert.equal(payShUnsupported.ok, false);
  if (!payShUnsupported.ok) {
    assert.ok(payShUnsupported.errors.some((item) => item.code === 'unsupported_asset_network'));
  }

  const tempoUnsupported = deriveRailNeutralPaymentReceipt({
    rail: 'mpp-tempo',
    fixture: mppTempoReceiptShapeFixtures.tempoSingleChargeCandidate,
  });

  assert.equal(tempoUnsupported.ok, false);
  if (!tempoUnsupported.ok) {
    assert.ok(tempoUnsupported.errors.some((item) => item.code === 'unsupported_asset_network'));
  }
});

test('fails closed when policy denies receipt normalization', () => {
  const result = deriveRailNeutralPaymentReceipt({
    rail: 'pay-sh-sandbox',
    fixture: payShSandboxEvidenceFixtures.singleCharge,
  }, {
    policy: {
      allowed: false,
      reasonCodes: ['operator_denied'],
      auditNotes: ['Operator denied this payment receipt binding.'],
    },
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.some((item) => item.code === 'policy_denied'));
});

test('rejects live-path overclaims embedded in imported rail metadata', () => {
  const livePath = structuredClone(payShSandboxEvidenceFixtures.singleCharge);
  livePath.claimBoundary = [
    'provider call performed with hosted registry write completed, trust upgrade performed, reputation mutation performed, settlement finality proven, custody accepted, and live Pay.sh activation',
  ];

  const result = deriveRailNeutralPaymentReceipt({
    rail: 'pay-sh-sandbox',
    fixture: livePath,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.some((item) => item.code === 'live_path_rejected'));
});
