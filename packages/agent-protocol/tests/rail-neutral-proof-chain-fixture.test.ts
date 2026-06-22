import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRailNeutralProofChainFixture,
  payShSandboxEvidenceFixtures,
  RAIL_NEUTRAL_PROOF_CHAIN_FIXTURE_SCHEMA_VERSION,
  railNeutralProofChainFixtures,
} from '../dist/index.js';

test('bridges Pay.sh rail-neutral receipt metadata into a proof-chain fixture binding', () => {
  const fixture = railNeutralProofChainFixtures.payShSandboxSingleChargeBinding;

  assert.equal(fixture.schemaVersion, RAIL_NEUTRAL_PROOF_CHAIN_FIXTURE_SCHEMA_VERSION);
  assert.equal(fixture.status, 'binding_ready');
  assert.equal(fixture.railNeutralReceipt?.supportState, 'receipt_binding_candidate');
  assert.equal(fixture.railNeutralReceipt?.payment.network, 'solana-devnet');
  assert.equal(fixture.railNeutralReceipt?.payment.asset, 'USDC');
  assert.equal(fixture.binding?.schemaVersion, 'reddi.receipt-evidence-binding.v1');
  assert.equal(fixture.binding?.source.sourceId, fixture.railNeutralReceipt?.source.sourceId);
  assert.equal(fixture.binding?.receipt.paymentProofRef, fixture.railNeutralReceipt?.payment.paymentProofRef);
  assert.equal(fixture.binding?.receipt.requestHash, fixture.railNeutralReceipt?.bindingRefs.requestHash);
  assert.equal(fixture.binding?.receipt.responseHash, fixture.railNeutralReceipt?.bindingRefs.responseHash);
  assert.equal(fixture.binding?.evidence.evidenceRef, fixture.railNeutralReceipt?.bindingRefs.evidenceRef);
  assert.equal(fixture.sourceRef.rail, 'pay-sh-sandbox');
  assert.equal(fixture.sourceRef.case, 'single_charge');
  assert.equal(fixture.bindingRefs.nonceRef, fixture.railNeutralReceipt?.bindingRefs.nonceRef);
  assert.equal(fixture.bindingRefs.recipientRef, fixture.railNeutralReceipt?.bindingRefs.recipientRef);
  assert.equal(fixture.bindingRefs.operatorApprovalRef, fixture.railNeutralReceipt?.bindingRefs.operatorApprovalRef);
  assert.ok(fixture.claimBoundaryLabels.some((label) => label.includes('does not prove settlement finality')));
});

test('keeps proof-chain bridge guardrails false for live and sensitive surfaces', () => {
  const fixture = railNeutralProofChainFixtures.payShSandboxSingleChargeBinding;

  assert.deepEqual(fixture.guardrails, {
    fixtureOnly: true,
    rawPromptStored: false,
    rawOutputStored: false,
    credentialMaterialStored: false,
    walletSigning: false,
    rpcCall: false,
    providerCall: false,
    paidRequest: false,
    sandboxExecution: false,
    hostedRegistryWrite: false,
    marketplacePublication: false,
    trustUpgrade: false,
    reputationMutation: false,
    custodyClaim: false,
    settlementFinalityProof: false,
    livePayment: false,
  });
  assert.equal(fixture.binding?.guardrails.livePaymentExecuted, false);
  assert.equal(fixture.binding?.guardrails.walletSigning, false);
  assert.equal(fixture.binding?.guardrails.rpcCall, false);
  assert.equal(fixture.binding?.guardrails.hostedRegistryRequired, false);
  assert.equal(fixture.binding?.guardrails.reputationMutated, false);
});

test('exposes Tempo unsupported network as a blocked proof-chain state', () => {
  const fixture = railNeutralProofChainFixtures.mppTempoUnsupportedNetwork;

  assert.equal(fixture.status, 'blocked');
  assert.equal(fixture.railNeutralReceipt, undefined);
  assert.equal(fixture.binding, undefined);
  assert.ok(fixture.blockedBy?.some((item) => item.code === 'unsupported_asset_network'));
  assert.ok(fixture.claimBoundaryLabels.some((label) => label.includes('No Reddi receipt v1 settlement proof')));
});

test('exposes fail-closed unsupported asset or network state', () => {
  const fixture = railNeutralProofChainFixtures.unsupportedAssetNetwork;

  assert.equal(fixture.status, 'blocked');
  assert.ok(fixture.blockedBy?.some((item) => item.code === 'unsupported_asset_network'));
  assert.equal(fixture.bindingRefs.paymentProofRef, payShSandboxEvidenceFixtures.singleCharge.bindingRefs.paymentProofRef);
});

test('exposes malformed receipt and policy-denied blocked states', () => {
  const malformed = railNeutralProofChainFixtures.malformedReceipt;
  const denied = railNeutralProofChainFixtures.policyDenied;

  assert.equal(malformed.status, 'blocked');
  assert.ok(malformed.blockedBy?.some((item) => item.code === 'malformed_receipt'));
  assert.equal(denied.status, 'blocked');
  assert.ok(denied.blockedBy?.some((item) => item.code === 'policy_denied'));
});

test('exposes live-path overclaim as a blocked proof-chain state', () => {
  const fixture = railNeutralProofChainFixtures.livePathOverclaim;

  assert.equal(fixture.status, 'blocked');
  assert.ok(fixture.blockedBy?.some((item) => item.code === 'live_path_rejected'));
  assert.equal(JSON.stringify(fixture).includes('provider call performed'), false);
  assert.equal(JSON.stringify(fixture).includes('live Pay.sh activation'), false);
  assert.equal(fixture.guardrails.livePayment, false);
  assert.equal(fixture.guardrails.settlementFinalityProof, false);
});

test('can derive a custom fixture without network calls or spend', () => {
  const fixture = createRailNeutralProofChainFixture({
    case: 'pay_sh_sandbox_single_charge_binding',
    receiptInput: { rail: 'pay-sh-sandbox', fixture: payShSandboxEvidenceFixtures.singleCharge },
    createdAt: '2026-06-22T10:45:00.000Z',
  });

  assert.equal(fixture.status, 'binding_ready');
  assert.equal(fixture.redactedReceipt?.createdAt, '2026-06-22T10:45:00.000Z');
  assert.equal(fixture.evidence?.createdAt, '2026-06-22T10:45:00.000Z');
});
