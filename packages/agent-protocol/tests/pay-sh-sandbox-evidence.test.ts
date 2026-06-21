import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PAY_SH_SANDBOX_EVIDENCE_SCHEMA_VERSION,
  derivePayShSandboxEvidenceFixture,
  payShSandboxEvidenceFixtures,
  payShSandboxEvidenceSummaries,
  type PayShSandboxEvidenceSummary,
} from '../dist/index.js';

test('normalizes proven Pay.sh single-charge sandbox evidence for later receipt/evidence binding', () => {
  const result = derivePayShSandboxEvidenceFixture(payShSandboxEvidenceSummaries.singleCharge);

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.fixture.schemaVersion, PAY_SH_SANDBOX_EVIDENCE_SCHEMA_VERSION);
  assert.equal(result.fixture.case, 'single_charge');
  assert.equal(result.fixture.status, 'proven_single_charge');
  assert.equal(result.fixture.receipt?.status, 'success');
  assert.equal(result.fixture.receipt?.method, 'solana');
  assert.equal(result.fixture.bindingRefs.source.kind, 'source-adapter');
  assert.equal(result.fixture.bindingRefs.source.sourceId, 'pay-sh:reddi-x402:economic-demo');
  assert.equal(result.fixture.bindingRefs.quoteRef, 'pay-sh:quote:reddi-x402-economic-demo:usd-0.01');
  assert.equal(result.fixture.bindingRefs.recipientRef, 'pay-sh:recipient:operator-approved-demo');
  assert.equal(result.fixture.bindingRefs.nonceRef, 'pay-sh:nonce:fixture-20260507');
  assert.equal(result.fixture.bindingRefs.sessionRef, 'pay-sh:session:single-charge');
  assert.equal(result.fixture.bindingRefs.authorizationRef, 'pay-sh:authorization:operator-approval-required');
  assert.match(result.fixture.bindingRefs.paymentProofRef, /^pay-sh-sandbox-receipt:/);
  assert.equal(result.fixture.bindingRefs.receiptRef, result.fixture.bindingRefs.paymentProofRef);
  assert.equal(result.fixture.bindingRefs.operatorApprovalRef, 'github-issue:#454:fixture-only-approval');
  assert.match(result.fixture.bindingRefs.requestHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(result.fixture.bindingRefs.responseHash, /^sha256:[a-f0-9]{64}$/);
});

test('keeps capped-session and split-payment probes blocked without settlement claims', () => {
  for (const fixture of [
    payShSandboxEvidenceFixtures.cappedSessionProbe,
    payShSandboxEvidenceFixtures.splitPaymentProbe,
  ]) {
    assert.equal(fixture.status, 'probe_only');
    assert.equal(fixture.blocker, 'pay_sh_0_16_returns_402_after_payment');
    assert.equal(fixture.receipt, undefined);
    assert.match(fixture.bindingRefs.paymentProofRef, /^pay-sh-sandbox-probe:/);
    assert.equal(fixture.guardrails.livePayShCall, false);
    assert.equal(fixture.guardrails.walletSigning, false);
    assert.equal(fixture.guardrails.rpcCall, false);
    assert.equal(fixture.guardrails.providerCall, false);
    assert.equal(fixture.guardrails.hostedRegistryWrite, false);
    assert.equal(fixture.guardrails.marketplacePublication, false);
    assert.equal(fixture.guardrails.trustUpgrade, false);
    assert.equal(fixture.guardrails.reputationMutation, false);
  }
});

test('fails closed when a successful Pay.sh retry omits a valid receipt', () => {
  const malformed = clone(payShSandboxEvidenceSummaries.singleCharge);
  malformed.paySandboxCurl.receipt = {
    challengeId: '',
    method: 'solana',
    reference: '',
    status: 'success',
    timestamp: 'not-a-date',
  };

  const result = derivePayShSandboxEvidenceFixture(malformed);

  assert.equal(result.ok, false);
  if (result.ok) return;

  assert.deepEqual(
    result.errors.map((item) => item.code),
    ['malformed_receipt', 'malformed_receipt', 'malformed_receipt'],
  );
});

test('rejects live Pay.sh, marketplace, provider, catalog, wallet, RPC, registry, trust, and reputation markers', () => {
  const livePath = clone(payShSandboxEvidenceSummaries.singleCharge);
  livePath.claimBoundary = [
    'mainnet live-payment-enabled wallet_private_key rpc_url hosted-registry-write trust-upgrade reputation-mutation marketplace publication activated provider call performed catalog submission completed live Pay.sh activation',
  ];

  const result = derivePayShSandboxEvidenceFixture(livePath);

  assert.equal(result.ok, false);
  if (result.ok) return;

  assert.ok(result.errors.some((item) => item.code === 'live_path_rejected'));
});

test('serialized fixtures contain no active publication or live-payment guardrail', () => {
  const serialized = JSON.stringify(payShSandboxEvidenceFixtures);

  assert.doesNotMatch(serialized, /live-payment-enabled/i);
  assert.doesNotMatch(serialized, /wallet_private_key/i);
  assert.doesNotMatch(serialized, /rpc_url/i);
  assert.doesNotMatch(serialized, /hosted-registry-write/i);
  assert.doesNotMatch(serialized, /reputation-mutation/i);
  assert.match(serialized, /"livePayShCall":false/);
  assert.match(serialized, /"marketplacePublication":false/);
});

function clone<T>(value: T): T {
  return structuredClone(value) as T;
}
