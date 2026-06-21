import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MPP_TEMPO_RECEIPT_SHAPE_SCHEMA_VERSION,
  deriveMppTempoReceiptShapeFixture,
  mppTempoReceiptShapeFixtures,
  mppTempoReceiptShapeSummaries,
} from '../dist/index.js';

test('normalizes a docs-backed MPP Tempo single-charge receipt shape as a binding candidate', () => {
  const result = deriveMppTempoReceiptShapeFixture(mppTempoReceiptShapeSummaries.tempoSingleChargeCandidate);

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.fixture.schemaVersion, MPP_TEMPO_RECEIPT_SHAPE_SCHEMA_VERSION);
  assert.equal(result.fixture.case, 'mpp_single_charge_tempo_candidate');
  assert.equal(result.fixture.supportState, 'binding_candidate');
  assert.equal(result.fixture.challenge.protocol, 'mpp');
  assert.equal(result.fixture.challenge.status, 402);
  assert.equal(result.fixture.challenge.paymentMethod, 'tempo-stablecoin');
  assert.equal(result.fixture.challenge.network, 'tempo');
  assert.equal(result.fixture.receipt?.status, 'success');
  assert.equal(result.fixture.receipt?.nonce, result.fixture.challenge.nonce);
  assert.equal(result.fixture.bindingRefs.paymentProofRef, 'mpp-tempo-receipt:single-charge-fixture');
  assert.match(result.fixture.bindingRefs.requestHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(result.fixture.bindingRefs.responseHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.fixture.guardrails.fixtureOnly, true);
  assert.equal(result.fixture.guardrails.livePayment, false);
});

test('keeps MPP Tempo session and split shapes probe-only without receipt success claims', () => {
  for (const fixture of [
    mppTempoReceiptShapeFixtures.tempoSessionProbe,
    mppTempoReceiptShapeFixtures.tempoSplitProbe,
  ]) {
    assert.equal(fixture.supportState, 'probe_only');
    assert.equal(fixture.receipt, undefined);
    assert.match(fixture.bindingRefs.paymentProofRef, /^mpp-tempo-probe:/);
    assert.equal(fixture.guardrails.walletSigning, false);
    assert.equal(fixture.guardrails.rpcCall, false);
    assert.equal(fixture.guardrails.providerCall, false);
    assert.equal(fixture.guardrails.hostedRegistryWrite, false);
    assert.equal(fixture.guardrails.trustUpgrade, false);
    assert.equal(fixture.guardrails.reputationMutation, false);
  }
});

test('fails closed when a receipt does not bind to its MPP Tempo challenge', () => {
  const malformed = clone(mppTempoReceiptShapeSummaries.tempoSingleChargeCandidate);
  if (!malformed.receipt) throw new Error('fixture setup failed');
  malformed.receipt.amount = '9999';

  const result = deriveMppTempoReceiptShapeFixture(malformed);

  assert.equal(result.ok, false);
  if (result.ok) return;

  assert.ok(result.errors.some((item) => item.code === 'receipt_challenge_mismatch'));
});

test('rejects malformed and unsupported MPP Tempo challenge shapes', () => {
  const malformed = clone(mppTempoReceiptShapeSummaries.tempoSingleChargeCandidate);
  malformed.challenge.status = 200 as 402;
  malformed.challenge.protocol = 'x402' as 'mpp';
  malformed.challenge.endpoint = 'http://example.invalid/paid/search';

  const result = deriveMppTempoReceiptShapeFixture(malformed);

  assert.equal(result.ok, false);
  if (result.ok) return;

  assert.deepEqual(
    result.errors.map((item) => item.code),
    ['unsupported_protocol', 'malformed_challenge', 'malformed_challenge'],
  );
});

test('rejects live Tempo receipt imports until a separate live verifier lane exists', () => {
  const result = deriveMppTempoReceiptShapeFixture(mppTempoReceiptShapeSummaries.tempoLiveReceiptUnsupported);

  assert.equal(result.ok, false);
  if (result.ok) return;

  assert.ok(result.errors.some((item) => item.code === 'unsupported_live_rail'));
});

test('rejects live-path and secret markers in imported claim text', () => {
  const livePath = clone(mppTempoReceiptShapeSummaries.tempoSingleChargeCandidate);
  livePath.claimBoundary = [
    'provider call completed with wallet_private_key and hosted registry write plus reputation mutation completed',
  ];

  const result = deriveMppTempoReceiptShapeFixture(livePath);

  assert.equal(result.ok, false);
  if (result.ok) return;

  assert.ok(result.errors.some((item) => item.code === 'live_path_rejected'));
});

test('serialized fixtures contain no active live-payment or mutation guardrail', () => {
  const serialized = JSON.stringify(mppTempoReceiptShapeFixtures);

  assert.doesNotMatch(serialized, /wallet_private_key/i);
  assert.doesNotMatch(serialized, /rpc_url/i);
  assert.doesNotMatch(serialized, /hosted-registry-write/i);
  assert.doesNotMatch(serialized, /reputation-mutation/i);
  assert.match(serialized, /"fixtureOnly":true/);
  assert.match(serialized, /"livePayment":false/);
});

function clone<T>(value: T): T {
  return structuredClone(value) as T;
}
