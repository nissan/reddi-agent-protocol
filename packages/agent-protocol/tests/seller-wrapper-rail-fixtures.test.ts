import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getSellerWrapperRail,
  runAuddSellerWrapperNoSpendFlow,
  sellerWrapperFixtureHasCredentialMaterial,
  sellerWrapperRailFixture,
  type SellerWrapperRailFixture,
} from '../dist/index.js';

describe('seller-wrapper rail-state fixtures', () => {
  it('declares SOL, USDC, and AUDD rails without secrets or live approval', () => {
    assert.equal(sellerWrapperRailFixture.schemaVersion, 'reddi.seller-wrapper-rail-fixture.v1');
    assert.equal(sellerWrapperRailFixture.sourceContract.railParityIssue, 525);
    assert.equal(sellerWrapperRailFixture.sourceContract.railParityPullRequest, 528);
    assert.equal(sellerWrapperFixtureHasCredentialMaterial(sellerWrapperRailFixture), false);

    const rails = sellerWrapperRailFixture.endpoints.flatMap((endpoint) => endpoint.rails);
    assert.deepEqual(rails.map((rail) => rail.asset).sort(), ['AUDD', 'SOL', 'USDC']);
    assert.equal(rails.every((rail) => rail.livePaymentApproved === false), true);
    assert.equal(rails.every((rail) => rail.evidenceRequired === true), true);

    const audd = getSellerWrapperRail(sellerWrapperRailFixture, 'AUDD', 'solana-devnet');
    assert.ok(audd);
    assert.equal(audd.state, 'proof-metadata-only');
    assert.equal(audd.custodySupported, false);
    assert.equal(audd.auddPaymentPlan?.asset, 'AUDD');
    assert.equal(audd.auddPaymentPlan?.network, 'solana-devnet');
    assert.equal(audd.auddPaymentPlan?.mint, 'AUDDdev111111111111111111111111111111111111');
    assert.equal(audd.auddPaymentPlan?.payee, audd.payee);
    assert.equal(audd.auddPaymentPlan?.settlementAccount, audd.settlementAccount);
    assert.equal(audd.auddPaymentPlan?.evidenceRequired, true);
    assert.equal(audd.auddPaymentPlan?.failurePolicy.mode, 'no_charge_on_failure');
    assert.equal(audd.auddPaymentPlan?.refundPolicy.mode, 'manual_review');
  });

  it('runs a no-spend AUDD quote to buyer preflight to mocked seller invocation to receipt/evidence flow', async () => {
    const flow = await runAuddSellerWrapperNoSpendFlow();

    assert.equal(flow.guardrails.noLivePayment, true);
    assert.equal(flow.guardrails.noWalletSigning, true);
    assert.equal(flow.guardrails.noRpcCall, true);
    assert.equal(flow.guardrails.noCustodyClaim, true);
    assert.equal(flow.guardrails.noSettlementFinalityClaim, true);
    assert.equal(flow.preflight.allowed, true);
    assert.deepEqual(flow.preflight.reasonCodes, ['audd_payment_plan_allowed']);
    assert.equal(flow.preflight.paymentPlan?.asset, 'AUDD');
    assert.equal(flow.preflight.paymentProofRef, 'dry-run:audd-seller-wrapper-001');

    assert.equal(flow.sellerResponse?.status, 200);
    if (flow.sellerResponse?.status === 200) {
      assert.equal(flow.sellerResponse.receipt.payment.asset, 'AUDD');
      assert.equal(flow.sellerResponse.receipt.payment.network, 'solana-devnet');
      assert.equal(flow.sellerResponse.receipt.payment.paymentProofRef, 'dry-run:audd-seller-wrapper-001');
      assert.equal(flow.sellerResponse.receipt.policyDecision.allowed, true);
      assert.equal(flow.sellerResponse.evidence.schemaVersion, 'reddi.evidence-archive.v1');
      assert.equal(Object.prototype.hasOwnProperty.call(flow.sellerResponse.evidence, 'evidencePayload'), false);
      assert.equal(flow.sellerResponse.result && typeof flow.sellerResponse.result === 'object', true);
    }
  });

  it('fails closed for missing approval, expired quote, bad mint, bad payee, bad settlement account, and live mode', async () => {
    assert.deepEqual(
      (await runAuddSellerWrapperNoSpendFlow({ approvalState: 'requires_operator_approval' })).preflight.reasonCodes,
      ['operator_approval_required'],
    );
    assert.equal((await runAuddSellerWrapperNoSpendFlow({ approvalState: 'requires_operator_approval' })).sellerResponse, undefined);

    assert.deepEqual(
      (await runAuddSellerWrapperNoSpendFlow({ now: '2026-07-01T00:00:00.000Z' })).preflight.reasonCodes,
      ['quote_expired'],
    );

    assert.deepEqual(
      (await runAuddSellerWrapperNoSpendFlow({ allowedMint: 'wrong-audd-mint' })).preflight.reasonCodes,
      ['wrong_mint'],
    );

    assert.deepEqual(
      (await runAuddSellerWrapperNoSpendFlow({ allowedPayee: 'solana:wrong-payee' })).preflight.reasonCodes,
      ['missing_payee'],
    );

    assert.deepEqual(
      (await runAuddSellerWrapperNoSpendFlow({ allowedSettlementAccount: 'solana:wrong-settlement' })).preflight.reasonCodes,
      ['missing_payee'],
    );

    assert.deepEqual(
      (await runAuddSellerWrapperNoSpendFlow({ forceLiveChallenge: true })).preflight.reasonCodes,
      ['live_payment_not_approved'],
    );
  });

  it('rejects credential-bearing seller-wrapper fixture metadata before any seller invocation', async () => {
    const credentialFixture = structuredClone(sellerWrapperRailFixture) as SellerWrapperRailFixture & {
      operatorToken?: string;
    };
    credentialFixture.operatorToken = 'Bearer secret-token';
    assert.equal(sellerWrapperFixtureHasCredentialMaterial(credentialFixture), true);

    await assert.rejects(
      () => runAuddSellerWrapperNoSpendFlow({ fixture: credentialFixture }),
      /seller_wrapper_fixture_contains_credentials/,
    );
  });
});
