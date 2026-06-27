import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BUYER_AUTHORITY_POLICY_SCHEMA_VERSION,
  buyerAuthorityPolicyExamples,
  evaluateBuyerAuthorityPolicy,
  listBuyerAuthorityPolicyFixtureMatrix,
  listBuyerAuthorityPolicyExamples,
  validateBuyerAuthorityPolicy,
  type BuyerAuthorityPolicy,
} from '../dist/index.js';

describe('buyer authority policy examples', () => {
  it('exports static no-live buyer authority policy examples', () => {
    const examples = listBuyerAuthorityPolicyExamples();

    assert.equal(examples.length, 11);
    assert.deepEqual(examples.map((example) => example.key).sort(), [
      'allow',
      'approvalRequired',
      'deny',
      'expired',
      'missingEvidenceRequirement',
      'missingReceiptRequirement',
      'refundFailurePolicyMismatch',
      'sellerNotAllowlisted',
      'spendCapExceeded',
      'unsupportedCurrency',
      'unsupportedRail',
    ]);

    for (const example of examples) {
      assert.equal(example.policy.schemaVersion, BUYER_AUTHORITY_POLICY_SCHEMA_VERSION);
      assert.equal(example.policy.issue, 549);
      assert.equal(example.policy.supportStateConstraints.allowLivePayment, false);
      assert.equal(example.policy.supportStateConstraints.forbidCustody, true);
      assert.equal(example.policy.supportStateConstraints.forbidSettlementFinality, true);
      assert.equal(validateBuyerAuthorityPolicy(example.policy).allowed, true);
    }
  });

  it('exports the same cases through the fixture matrix helper for downstream conformance checks', () => {
    assert.deepEqual(
      listBuyerAuthorityPolicyFixtureMatrix().map((example) => example.key),
      listBuyerAuthorityPolicyExamples().map((example) => example.key),
    );
  });

  it('evaluates allow and fail-closed static policy cases', () => {
    for (const example of Object.values(buyerAuthorityPolicyExamples)) {
      const result = evaluateBuyerAuthorityPolicy(example.policy, example.request);

      assert.equal(result.allowed, example.expectedAllowed, example.key);
      assert.deepEqual(result.reasonCodes, example.expectedReasonCodes, example.key);
    }
  });

  it('fails closed for credentials, live calls, custody, transfer, and settlement-finality claims', () => {
    const credentialPolicy = structuredClone(buyerAuthorityPolicyExamples.allow.policy) as BuyerAuthorityPolicy & {
      providerSecret?: string;
    };
    credentialPolicy.providerSecret = 'sk-test-secret';
    assert.deepEqual(validateBuyerAuthorityPolicy(credentialPolicy).reasonCodes, ['policy_contains_credentials']);

    const livePaymentPolicy = structuredClone(buyerAuthorityPolicyExamples.allow.policy) as unknown as {
      supportStateConstraints: { allowLivePayment: boolean };
    };
    livePaymentPolicy.supportStateConstraints.allowLivePayment = true;
    assert.deepEqual(validateBuyerAuthorityPolicy(livePaymentPolicy).reasonCodes, ['live_payment_rejected']);

    const liveGatedPolicy = structuredClone(buyerAuthorityPolicyExamples.allow.policy);
    liveGatedPolicy.allowedRails[0]?.supportStates.push('live-gated');
    assert.deepEqual(validateBuyerAuthorityPolicy(liveGatedPolicy).reasonCodes, ['live_payment_rejected']);

    const unsupportedSupportStatePolicy = structuredClone(buyerAuthorityPolicyExamples.allow.policy) as unknown as {
      allowedRails: { supportStates: string[] }[];
    };
    unsupportedSupportStatePolicy.allowedRails[0]?.supportStates.push('live-payment-approved');
    assert.deepEqual(validateBuyerAuthorityPolicy(unsupportedSupportStatePolicy).reasonCodes, ['policy_malformed']);

    const unsupportedRuntimeStatePolicy = structuredClone(buyerAuthorityPolicyExamples.allow.policy) as unknown as {
      supportStateConstraints: { allowedRuntimeStates: string[] };
    };
    unsupportedRuntimeStatePolicy.supportStateConstraints.allowedRuntimeStates.push('custody-supported');
    assert.deepEqual(validateBuyerAuthorityPolicy(unsupportedRuntimeStatePolicy).reasonCodes, ['policy_malformed']);

    const rpcPolicy = structuredClone(buyerAuthorityPolicyExamples.allow.policy);
    rpcPolicy.notes.push('Use https://api.mainnet-beta.solana.com for the provider call.');
    assert.deepEqual(validateBuyerAuthorityPolicy(rpcPolicy).reasonCodes, ['wallet_rpc_provider_call_rejected']);

    const transferPolicy = structuredClone(buyerAuthorityPolicyExamples.allow.policy);
    transferPolicy.notes.push('Sign and transfer AUDD after approval.');
    assert.deepEqual(validateBuyerAuthorityPolicy(transferPolicy).reasonCodes, ['transfer_instruction_rejected']);

    const custodyPolicy = structuredClone(buyerAuthorityPolicyExamples.allow.policy);
    custodyPolicy.notes.push('AUDD is held in custody by the buyer agent.');
    assert.deepEqual(validateBuyerAuthorityPolicy(custodyPolicy).reasonCodes, ['custody_claim_rejected']);

    const finalityPolicy = structuredClone(buyerAuthorityPolicyExamples.allow.policy);
    finalityPolicy.notes.push('This policy proves settlement finality.');
    assert.deepEqual(validateBuyerAuthorityPolicy(finalityPolicy).reasonCodes, ['settlement_finality_claim_rejected']);
  });

  it('keeps matrix denial reasons machine-readable and single-purpose where possible', () => {
    assert.deepEqual(
      evaluateBuyerAuthorityPolicy(
        buyerAuthorityPolicyExamples.unsupportedRail.policy,
        buyerAuthorityPolicyExamples.unsupportedRail.request,
      ).reasonCodes,
      ['unsupported_rail_currency'],
    );
    assert.deepEqual(
      evaluateBuyerAuthorityPolicy(
        buyerAuthorityPolicyExamples.unsupportedCurrency.policy,
        buyerAuthorityPolicyExamples.unsupportedCurrency.request,
      ).reasonCodes,
      ['unsupported_rail_currency'],
    );
    assert.deepEqual(
      evaluateBuyerAuthorityPolicy(
        buyerAuthorityPolicyExamples.missingReceiptRequirement.policy,
        buyerAuthorityPolicyExamples.missingReceiptRequirement.request,
      ).reasonCodes,
      ['receipt_requirement_missing'],
    );
    assert.deepEqual(
      evaluateBuyerAuthorityPolicy(
        buyerAuthorityPolicyExamples.refundFailurePolicyMismatch.policy,
        buyerAuthorityPolicyExamples.refundFailurePolicyMismatch.request,
      ).reasonCodes,
      ['refund_failure_policy_mismatch'],
    );
    assert.deepEqual(
      evaluateBuyerAuthorityPolicy(
        buyerAuthorityPolicyExamples.spendCapExceeded.policy,
        buyerAuthorityPolicyExamples.spendCapExceeded.request,
      ).reasonCodes,
      ['spend_cap_exceeded'],
    );
  });
});
