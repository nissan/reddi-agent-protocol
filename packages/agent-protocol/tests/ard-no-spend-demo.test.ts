import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  createAiCatalogSnapshot,
  validateAiCatalog,
} from '../dist/index.js';

describe('ARD no-spend demo', () => {
  it('validates the public AI Catalog fixture', () => {
    const catalog = JSON.parse(readFileSync('examples/ard-no-spend-ai-catalog.json', 'utf8'));
    const validation = validateAiCatalog(catalog, {
      rawSnapshotRef: 'file://examples/ard-no-spend-ai-catalog.json',
    });

    assert.equal(validation.ok, true);
    const snapshot = createAiCatalogSnapshot(catalog, {
      rawSnapshotRef: 'file://examples/ard-no-spend-ai-catalog.json',
    });
    assert.equal(snapshot.publisher.id, 'reddi.local');
    assert.equal(snapshot.resources.length, 1);
    assert.equal(snapshot.resources[0].id, 'urn:ai:reddi.local:specialists:listing-writer');
    assert.deepEqual(snapshot.resources[0].payment, {
      protocol: 'rap',
      quoteMode: 'preflight',
      asset: 'AUDD',
      network: 'solana-devnet',
      amount: '2500000',
    });
  });

  it('runs discover decide prove without spend or hosted services', () => {
    const stdout = execFileSync(process.execPath, ['examples/ard-no-spend-demo.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    const output = JSON.parse(stdout);

    assert.equal(output.ok, true);
    assert.equal(output.mode, 'no-spend');
    assert.equal(output.catalog.valid, true);
    assert.equal(output.discovery.candidate.identifier, 'urn:ai:reddi.local:specialists:listing-writer');
    assert.equal(output.discovery.candidate.trustStatus, 'verified');
    assert.equal(output.discovery.policyDecision.allowed, true);
    assert.equal(output.payment.asset, 'AUDD');
    assert.equal(output.payment.mode, 'dry-run');
    assert.equal(output.payment.allowed, true);
    assert.equal(output.payment.paymentProofRef, 'dry-run:ard-no-spend-001');
    assert.equal(output.execution.status, 200);
    assert.equal(output.execution.receiptId, 'job:ard-no-spend-001');
    assert.equal(output.execution.evidenceId, 'evidence:ard-no-spend-001');
    assert.equal(output.execution.archiveHasEvidence, true);
    assert.equal(output.receiptEvidenceBinding.bindingMode, 'local_fixture_refs_only');
    assert.equal(output.receiptEvidenceBinding.receiptId, output.execution.receiptId);
    assert.equal(output.receiptEvidenceBinding.evidenceId, output.execution.evidenceId);
    assert.equal(output.receiptEvidenceBinding.paymentProofRef, output.payment.paymentProofRef);
    assert.equal(output.receiptEvidenceBinding.requestHash, output.execution.requestHash);
    assert.equal(output.receiptEvidenceBinding.responseHash, output.execution.responseHash);
    assert.equal(output.receiptEvidenceBinding.evidenceRef, output.execution.evidenceRef);
    assert.equal(output.attestation.verdict, 'passed');
    assert.equal(output.failures.policyDenial.allowed, false);
    assert.ok(output.failures.policyDenial.reasonCodes.includes('over_budget'));
    assert.equal(output.failures.malformedChallenge.allowed, false);
    assert.ok(output.failures.malformedChallenge.reasonCodes.includes('challenge_malformed'));
    assert.equal(output.failures.missingEvidence.ok, false);
    assert.ok(output.failures.missingEvidence.errorCodes.includes('evidence_missing'));
    assert.equal(output.failures.missingPaymentSetup.allowed, false);
    assert.ok(output.failures.missingPaymentSetup.reasonCodes.includes('operator_approval_required'));
    assert.equal(output.failures.unsupportedRailNetwork.allowed, false);
    assert.ok(output.failures.unsupportedRailNetwork.reasonCodes.includes('wrong_network'));
    assert.equal(output.failures.unsafeMetadata.ok, false);
    assert.ok(output.failures.unsafeMetadata.errorCodes.includes('credential_leakage_rejected'));
    assert.equal(output.railNeutralProofChain.schemaVersion, 'reddi.rail-neutral-proof-chain-fixture.v1');
    assert.equal(output.railNeutralProofChain.bindingReadyCase, 'pay_sh_sandbox_single_charge_binding');
    assert.deepEqual(output.railNeutralProofChain.blockedCases, [
      'mpp_tempo_unsupported_network',
      'unsupported_asset_network',
      'malformed_receipt',
      'policy_denied',
      'live_path_overclaim',
    ]);
    assert.equal(output.railNeutralProofChain.cases.length, 6);
    const bindingReady = (output.railNeutralProofChain.cases as Array<{
      case: string;
      status: string;
      rail: string;
      paymentProofRef: string;
      evidenceRef: string;
      claimBoundaryLabels: string[];
    }>).find((item) => item.case === 'pay_sh_sandbox_single_charge_binding');
    assert.ok(bindingReady);
    assert.equal(bindingReady.status, 'binding_ready');
    assert.equal(bindingReady.rail, 'pay-sh-sandbox');
    assert.ok(bindingReady.paymentProofRef.startsWith('pay-sh-sandbox-receipt:'));
    assert.ok(bindingReady.evidenceRef.startsWith('file://artifacts/pay-sh-reddi-x402/'));
    for (const item of output.railNeutralProofChain.cases as Array<{ claimBoundaryLabels: string[] }>) {
      assert.ok(item.claimBoundaryLabels.every((label) => !/settlement finality is proven|custody is proven|trust upgrade applied|reputation mutation applied|live payment completed/i.test(label)));
    }
    assert.equal(output.downstreamPublicProofContracts.publicProofPageData, 'reddi.economic-demo.public-proof-page-data.v1');
    assert.equal(output.downstreamPublicProofContracts.paidWorkflowProofUiFixturePack, 'reddi.economic-demo.paid-workflow-proof-ui-fixture-pack.v1');
    assert.ok(output.downstreamPublicProofContracts.stateLabels.includes('fixture_zero_spend'));
    assert.ok(output.downstreamPublicProofContracts.stateLabels.includes('planned_dry_run'));
    assert.ok(output.downstreamPublicProofContracts.stateLabels.includes('devnet_proof_metadata'));
    assert.ok(output.downstreamPublicProofContracts.stateLabels.includes('live_gated'));
    assert.ok(output.downstreamPublicProofContracts.stateLabels.includes('production_live_disabled'));
    assert.deepEqual(output.boundaries, {
      hostedService: false,
      paidProvider: false,
      walletAccess: false,
      rpcCall: false,
      splTransfer: false,
      quasarCustody: false,
      settlementFinalityProof: false,
      trustUpgrade: false,
      reputationMutation: false,
      livePayment: false,
    });
  });
});
