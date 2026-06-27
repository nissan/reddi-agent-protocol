import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  generateSellerWrapperConfigExamples,
  runSellerWrapperConfigNoSpendCheck,
  sellerWrapperRailFixture,
  validateSellerWrapperConfigExamples,
  type SellerWrapperConfigExamples,
  type SellerWrapperRailFixture,
} from '../dist/index.js';

describe('seller-wrapper config examples', () => {
  it('generates non-secret MCP and HTTP/OpenAPI wrapper config examples from rail fixtures', () => {
    const config = generateSellerWrapperConfigExamples();

    assert.equal(config.schemaVersion, 'reddi.seller-wrapper-config.v1');
    assert.equal(config.issue, 535);
    assert.equal(config.sourceContract.sellerWrapperIssue, 375);
    assert.equal(config.sourceContract.railFixtureIssue, 529);
    assert.equal(config.sourceContract.railParityIssue, 525);
    assert.equal(config.guardrails.noSecrets, true);
    assert.equal(config.guardrails.noProviderCredentials, true);
    assert.equal(config.guardrails.noLivePaymentInstructions, true);
    assert.equal(config.guardrails.noLivePayment, true);
    assert.equal(config.guardrails.noWalletSigning, true);
    assert.equal(config.guardrails.noRpcCall, true);
    assert.equal(config.buyerAuthorityPolicy.policySchemaVersion, 'reddi.buyer-authority-policy.v1');
    assert.equal(config.buyerAuthorityPolicy.policyIssue, 549);
    assert.equal(config.buyerAuthorityPolicy.fixtureMatrixIssue, 550);
    assert.equal(config.buyerAuthorityPolicy.downstreamIssues.frameworkTemplateContract, 543);
    assert.equal(config.buyerAuthorityPolicy.boundaries.noPrivateKeys, true);
    assert.equal(config.buyerAuthorityPolicy.boundaries.noWalletRpcProviderCalls, true);
    assert.equal(config.buyerAuthorityPolicy.boundaries.noCustodyClaims, true);
    assert.deepEqual(config.buyerAuthorityPolicy.fields, [
      'spendCaps',
      'allowedRails',
      'allowedCurrencies',
      'sellerAllowlist',
      'expiresAt',
      'receiptEvidence',
      'refundFailurePolicy',
      'operatorApproval',
      'supportStateConstraints',
    ]);
    assert.ok(config.buyerAuthorityPolicy.fixtureStates.some((state) => (
      state.key === 'approvalRequired' && state.expectedReasonCodes.includes('operator_approval_required')
    )));
    assert.ok(config.buyerAuthorityPolicy.fixtureStates.some((state) => (
      state.key === 'refundFailurePolicyMismatch' && state.expectedReasonCodes.includes('refund_failure_policy_mismatch')
    )));

    assert.deepEqual(config.endpoints.map((endpoint) => endpoint.kind).sort(), ['http-openapi', 'mcp']);

    const endpoint = config.endpoints.find((item) => item.kind === 'http-openapi');
    assert.ok(endpoint);
    assert.equal(endpoint.kind, 'http-openapi');
    assert.equal(endpoint.wrapper.quoteRoute, '/seller-wrapper/listing-writer-http/quote');
    assert.equal(endpoint.wrapper.policyPreflightRoute, '/seller-wrapper/listing-writer-http/policy-preflight');
    assert.equal(endpoint.wrapper.invocationRoute, '/seller-wrapper/listing-writer-http/invoke-mock');
    assert.equal(endpoint.wrapper.receiptHook, '/seller-wrapper/listing-writer-http/receipt');
    assert.equal(endpoint.wrapper.evidenceHook, '/seller-wrapper/listing-writer-http/evidence');

    const mcpEndpoint = config.endpoints.find((item) => item.kind === 'mcp');
    assert.ok(mcpEndpoint);
    assert.equal(mcpEndpoint.transport.url, 'mcp://local/seller-wrapper/listing-writer');
    assert.equal(mcpEndpoint.wrapper.invocationRoute, '/seller-wrapper/listing-writer-http-mcp/invoke-mock');

    const statesByAsset = new Map(endpoint.rails.map((rail) => [rail.asset, rail.runtimeState]));
    assert.deepEqual([...statesByAsset.keys()].sort(), ['AUDD', 'SOL', 'USDC']);
    assert.equal(statesByAsset.get('AUDD'), 'proof-metadata-only');
    assert.equal(statesByAsset.get('USDC'), 'local-dry-run');
    assert.equal(statesByAsset.get('SOL'), 'devnet-gated');

    const audd = endpoint.rails.find((rail) => rail.asset === 'AUDD');
    assert.ok(audd);
    assert.equal(audd.audd?.mint, 'AUDDdev111111111111111111111111111111111111');
    assert.equal(audd.payee, 'solana:SellerWrapperDemoPayee111111111111111111111');
    assert.equal(audd.settlementAccount, 'solana:SellerWrapperDemoSettlement11111111111111111');
    assert.equal(audd.quote.expiresAt, '2026-07-01T00:00:00.000Z');
    assert.equal(audd.audd?.failurePolicy.mode, 'no_charge_on_failure');
    assert.equal(audd.audd?.refundPolicy.mode, 'manual_review');
    assert.equal(audd.livePaymentApproved, false);
    assert.equal(audd.custodySupported, false);
  });

  it('keeps generated config tied to the no-spend AUDD preflight and receipt/evidence flow', async () => {
    const check = await runSellerWrapperConfigNoSpendCheck();

    assert.equal(check.validation.valid, true);
    assert.deepEqual(check.validation.reasonCodes, ['seller_wrapper_config_valid']);
    assert.equal(check.auddFlow.preflight.allowed, true);
    assert.equal(check.auddFlow.sellerResponse?.status, 200);
    if (check.auddFlow.sellerResponse?.status === 200) {
      assert.equal(check.auddFlow.sellerResponse.receipt.payment.asset, 'AUDD');
      assert.equal(check.auddFlow.sellerResponse.evidence.schemaVersion, 'reddi.evidence-archive.v1');
    }
  });

  it('fails closed for credential-bearing fixtures and unsafe generated config claims', () => {
    const credentialFixture = structuredClone(sellerWrapperRailFixture) as SellerWrapperRailFixture & {
      providerSecret?: string;
    };
    credentialFixture.providerSecret = 'sk-test-secret';
    assert.throws(
      () => generateSellerWrapperConfigExamples({ fixture: credentialFixture }),
      /seller_wrapper_fixture_contains_credentials/,
    );

    const configWithToken = structuredClone(generateSellerWrapperConfigExamples()) as SellerWrapperConfigExamples & {
      apiKey?: string;
    };
    configWithToken.apiKey = 'sk-test-secret';
    assert.deepEqual(validateSellerWrapperConfigExamples(configWithToken).reasonCodes, ['config_contains_credentials']);

    const configWithLivePayment = structuredClone(generateSellerWrapperConfigExamples());
    configWithLivePayment.endpoints[0].rails[0].livePaymentApproved = true;
    assert.deepEqual(validateSellerWrapperConfigExamples(configWithLivePayment).reasonCodes, ['live_payment_not_approved']);

    const configWithLiveRuntimeState = structuredClone(generateSellerWrapperConfigExamples());
    configWithLiveRuntimeState.endpoints[0].rails[0].runtimeState = 'live-payment-approved';
    assert.deepEqual(validateSellerWrapperConfigExamples(configWithLiveRuntimeState).reasonCodes, ['live_payment_not_approved']);

    const configWithCustodyRuntimeState = structuredClone(generateSellerWrapperConfigExamples());
    configWithCustodyRuntimeState.endpoints[0].rails[0].runtimeState = 'custody-supported';
    assert.deepEqual(validateSellerWrapperConfigExamples(configWithCustodyRuntimeState).reasonCodes, ['custody_claim_rejected']);

    const configWithRpcInstruction = structuredClone(generateSellerWrapperConfigExamples());
    configWithRpcInstruction.endpoints[0].rails[0].notes.push('Submit the transaction through RPC after wallet sign.');
    assert.deepEqual(validateSellerWrapperConfigExamples(configWithRpcInstruction).reasonCodes, ['live_payment_instruction_rejected']);

    const configWithCustodyClaim = structuredClone(generateSellerWrapperConfigExamples());
    configWithCustodyClaim.endpoints[0].rails[2].notes.push('AUDD is held in custody by the wrapper.');
    assert.deepEqual(validateSellerWrapperConfigExamples(configWithCustodyClaim).reasonCodes, ['custody_claim_rejected']);

    const configWithoutHook = structuredClone(generateSellerWrapperConfigExamples());
    configWithoutHook.endpoints[0].wrapper.receiptHook = '';
    assert.deepEqual(validateSellerWrapperConfigExamples(configWithoutHook).reasonCodes, ['missing_wrapper_hooks']);

    const configWithoutBuyerAuthority = structuredClone(generateSellerWrapperConfigExamples()) as Partial<SellerWrapperConfigExamples>;
    delete configWithoutBuyerAuthority.buyerAuthorityPolicy;
    assert.deepEqual(validateSellerWrapperConfigExamples(configWithoutBuyerAuthority).reasonCodes, ['missing_buyer_authority_policy']);

    const configWithTruncatedMatrix = structuredClone(generateSellerWrapperConfigExamples());
    const firstFixtureState = configWithTruncatedMatrix.buyerAuthorityPolicy.fixtureStates[0];
    assert.ok(firstFixtureState);
    configWithTruncatedMatrix.buyerAuthorityPolicy.fixtureStates = [firstFixtureState];
    assert.deepEqual(validateSellerWrapperConfigExamples(configWithTruncatedMatrix).reasonCodes, ['missing_buyer_authority_policy']);
  });
});
