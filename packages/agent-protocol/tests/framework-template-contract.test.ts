import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FRAMEWORK_TEMPLATE_CONTRACT_SCHEMA_VERSION,
  frameworkTemplateFixtures,
  listBuyerAuthorityPolicyFixtureMatrix,
  listFrameworkTemplateFixtures,
  validateFrameworkTemplateContract,
  type FrameworkTemplateContract,
} from '../dist/index.js';

describe('framework-template contract fixtures', () => {
  it('exports framework-neutral lifecycle fixtures for template authors', () => {
    const fixtures = listFrameworkTemplateFixtures();

    assert.equal(fixtures.length, 8);
    assert.deepEqual(fixtures.map((fixture) => fixture.kind).sort(), [
      'denial',
      'discovery',
      'failure',
      'invocation',
      'operator-approval',
      'preflight',
      'quote',
      'receipt-evidence',
    ]);

    for (const fixture of fixtures) {
      assert.equal(fixture.contract.schemaVersion, FRAMEWORK_TEMPLATE_CONTRACT_SCHEMA_VERSION);
      assert.equal(fixture.contract.issue, 552);
      assert.equal(fixture.contract.parentIssues.frameworkTemplateContract, 543);
      assert.equal(fixture.contract.parentIssues.frameworkTemplatesFeature, 542);
      assert.equal(fixture.contract.parentIssues.buyerAuthority, 548);
      assert.equal(fixture.contract.downstreamConsumption.langGraphIssue, 544);
      assert.equal(fixture.contract.downstreamConsumption.strandsIssue, 545);
      assert.equal(fixture.contract.downstreamConsumption.adkIssue, 546);
      assert.equal(validateFrameworkTemplateContract(fixture.contract).valid, fixture.expectedValid);
      assert.deepEqual(validateFrameworkTemplateContract(fixture.contract).reasonCodes, fixture.expectedReasonCodes);
    }
  });

  it('keeps buyer, seller, and dual-mode template profiles representable', () => {
    const base = frameworkTemplateFixtures.invocation.contract;
    const buyerOnly: FrameworkTemplateContract = structuredClone(base);
    buyerOnly.agentIdentity.templateMode = 'buyer-enabled';
    buyerOnly.sellerProfile = undefined;

    const sellerOnly: FrameworkTemplateContract = structuredClone(base);
    sellerOnly.agentIdentity.templateMode = 'seller-enabled';
    sellerOnly.buyerAuthorityPolicy = undefined;

    const dualMode: FrameworkTemplateContract = structuredClone(base);
    dualMode.agentIdentity.templateMode = 'dual-mode';

    assert.equal(validateFrameworkTemplateContract(buyerOnly).valid, true);
    assert.equal(validateFrameworkTemplateContract(sellerOnly).valid, true);
    assert.equal(validateFrameworkTemplateContract(dualMode).valid, true);
  });

  it('binds the full buyer authority fixture matrix into shared templates', () => {
    const expected = listBuyerAuthorityPolicyFixtureMatrix().map((example) => ({
      key: example.key,
      expectedAllowed: example.expectedAllowed,
      expectedReasonCodes: example.expectedReasonCodes,
    }));
    const actual = frameworkTemplateFixtures.preflight.contract.buyerAuthorityCases;

    assert.deepEqual(actual, expected);
  });

  it('requires buyer-enabled and dual-mode contracts to carry the #551 buyer authority payload', () => {
    const missingPolicy = structuredClone(frameworkTemplateFixtures.preflight.contract);
    missingPolicy.buyerAuthorityPolicy = undefined;
    assert.deepEqual(validateFrameworkTemplateContract(missingPolicy).reasonCodes, ['seller_wrapper_contract_invalid']);

    const truncatedPolicy = structuredClone(frameworkTemplateFixtures.preflight.contract);
    const firstState = truncatedPolicy.buyerAuthorityPolicy?.fixtureStates[0];
    assert.ok(truncatedPolicy.buyerAuthorityPolicy);
    assert.ok(firstState);
    truncatedPolicy.buyerAuthorityPolicy.fixtureStates = [firstState];
    assert.deepEqual(validateFrameworkTemplateContract(truncatedPolicy).reasonCodes, ['seller_wrapper_contract_invalid']);
  });

  it('fails closed for truncated matrices, unsafe states, credentials, live calls, custody, and finality claims', () => {
    const truncated = structuredClone(frameworkTemplateFixtures.preflight.contract);
    const firstCase = truncated.buyerAuthorityCases[0];
    assert.ok(firstCase);
    truncated.buyerAuthorityCases = [firstCase];
    assert.deepEqual(validateFrameworkTemplateContract(truncated).reasonCodes, ['buyer_authority_matrix_mismatch']);

    const unsafeState = structuredClone(frameworkTemplateFixtures.preflight.contract) as unknown as {
      supportStateMetadata: { runtimeState: string };
    };
    unsafeState.supportStateMetadata.runtimeState = 'live-payment-approved';
    assert.deepEqual(validateFrameworkTemplateContract(unsafeState).reasonCodes, ['unsafe_support_state']);

    const livePayment = structuredClone(frameworkTemplateFixtures.preflight.contract) as unknown as {
      supportStateMetadata: { livePaymentApproved: boolean };
    };
    livePayment.supportStateMetadata.livePaymentApproved = true;
    assert.deepEqual(validateFrameworkTemplateContract(livePayment).reasonCodes, [
      'framework_template_contract_malformed',
      'live_payment_rejected',
    ]);

    const missingBoundary = structuredClone(frameworkTemplateFixtures.preflight.contract);
    const missingBoundaryMetadata = missingBoundary.supportStateMetadata as Partial<FrameworkTemplateContract['supportStateMetadata']>;
    delete missingBoundaryMetadata.walletRpcProviderCalls;
    assert.deepEqual(validateFrameworkTemplateContract(missingBoundary).reasonCodes, ['framework_template_contract_malformed']);

    const credentialContract = structuredClone(frameworkTemplateFixtures.preflight.contract) as FrameworkTemplateContract & {
      providerSecret?: string;
    };
    credentialContract.providerSecret = 'sk-test-secret';
    assert.deepEqual(validateFrameworkTemplateContract(credentialContract).reasonCodes, ['framework_template_contains_credentials']);

    const rpcContract = structuredClone(frameworkTemplateFixtures.preflight.contract);
    rpcContract.notes.push('Use https://api.mainnet-beta.solana.com as the provider call.');
    assert.deepEqual(validateFrameworkTemplateContract(rpcContract).reasonCodes, ['wallet_rpc_provider_call_rejected']);

    const custodyContract = structuredClone(frameworkTemplateFixtures.preflight.contract);
    custodyContract.notes.push('AUDD is held in custody by the template.');
    assert.deepEqual(validateFrameworkTemplateContract(custodyContract).reasonCodes, ['custody_claim_rejected']);

    const finalityContract = structuredClone(frameworkTemplateFixtures.preflight.contract);
    finalityContract.notes.push('Template confirms settlement finality.');
    assert.deepEqual(validateFrameworkTemplateContract(finalityContract).reasonCodes, ['settlement_finality_claim_rejected']);
  });

  it('requires receipt and evidence refs for allowed invocation contracts', () => {
    const missingReceipt = structuredClone(frameworkTemplateFixtures.invocation.contract);
    missingReceipt.receiptEvidenceRefs.receiptRef = undefined;
    assert.deepEqual(validateFrameworkTemplateContract(missingReceipt).reasonCodes, ['missing_receipt_evidence_refs']);

    const missingEvidence = structuredClone(frameworkTemplateFixtures.invocation.contract);
    missingEvidence.receiptEvidenceRefs.evidenceRef = undefined;
    assert.deepEqual(validateFrameworkTemplateContract(missingEvidence).reasonCodes, ['missing_receipt_evidence_refs']);
  });
});
