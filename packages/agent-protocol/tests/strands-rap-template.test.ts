import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createStrandsRapTemplateFixture,
  runFrameworkTemplateNoLiveConformanceCheck,
  validateStrandsRapTemplate,
  type StrandsRapTemplateState,
} from '../dist/index.js';

describe('Strands RAP template fixture', () => {
  it('exports an allowed local no-live buyer/seller tool-plugin template', () => {
    const template = createStrandsRapTemplateFixture();
    const result = validateStrandsRapTemplate(template);

    assert.equal(template.toolPluginId, 'strands:rap-template:listing-writer');
    assert.equal(template.expectedAllowed, true);
    assert.deepEqual(result.reasonCodes, ['strands_rap_template_valid']);
    assert.equal(runFrameworkTemplateNoLiveConformanceCheck().valid, true);
    assert.deepEqual(template.steps, [
      'discover',
      'quote',
      'buyerPolicyPreflight',
      'operatorApproval',
      'invokePaidAgent',
      'bindReceiptEvidence',
      'sellerWrapperEndpoint',
    ]);
    assert.equal(template.hooks.buyerPolicy, true);
    assert.equal(template.hooks.receiptEvidence, true);
    assert.equal(template.hooks.sellerWrapper, true);
    assert.equal(template.selectedContract.agentIdentity.templateMode, 'dual-mode');
  });

  it('keeps every rail/payment path dry-run/fixture with no live boundaries', () => {
    for (const scenario of [
      'allowed-no-live-invocation',
      'policy-denial',
      'missing-approval',
      'malformed-quote-payment-plan',
      'credential-shaped-output',
      'unsafe-live-custody-provider-claim',
    ] as const) {
      const template = createStrandsRapTemplateFixture({ scenario });
      const support = template.selectedContract.supportStateMetadata;
      assert.equal(support.livePaymentApproved, false);
      assert.equal(support.walletRpcProviderCalls, false);
      assert.equal(support.custodySupported, false);
      assert.equal(support.settlementFinalityClaimed, false);
      assert.ok(['fixture', 'dry-run', 'proof-metadata-only', 'devnet-gated'].includes(support.runtimeState));
    }
    assert.equal(runFrameworkTemplateNoLiveConformanceCheck().valid, true);
  });

  it('keeps policy denial local and reason-coded without making the template malformed', () => {
    const template = createStrandsRapTemplateFixture({ scenario: 'policy-denial' });
    const result = validateStrandsRapTemplate(template);

    assert.equal(template.expectedAllowed, false);
    assert.deepEqual(template.toolState.denialReasonCodes, ['policy_denied']);
    assert.equal(template.toolState.operatorApprovalRef, undefined);
    assert.equal(template.toolState.invocationRef, undefined);
    assert.equal(template.toolState.receiptRef, undefined);
    assert.equal(template.toolState.evidenceRef, undefined);
    assert.deepEqual(result.reasonCodes, ['strands_rap_template_valid']);

    const unsafeDenied = createStrandsRapTemplateFixture({ scenario: 'policy-denial' });
    unsafeDenied.toolState.invocationRef = 'local-fixture:strands:invocation';
    assert.ok(validateStrandsRapTemplate(unsafeDenied).reasonCodes.includes('missing_operator_approval'));
  });

  it('fails closed for missing approval and malformed quote/payment-plan fixtures', () => {
    const missingApproval = createStrandsRapTemplateFixture({ scenario: 'missing-approval' });
    assert.deepEqual(validateStrandsRapTemplate(missingApproval).reasonCodes, ['missing_operator_approval']);

    const malformedQuote = createStrandsRapTemplateFixture({ scenario: 'malformed-quote-payment-plan' });
    assert.deepEqual(validateStrandsRapTemplate(malformedQuote).reasonCodes, ['malformed_quote_payment_plan']);
  });

  it('fails closed for missing tool steps, hooks, endpoint helper, and receipt/evidence refs', () => {
    const missingStep = createStrandsRapTemplateFixture();
    missingStep.steps = missingStep.steps.filter((step) => step !== 'quote');
    assert.ok(validateStrandsRapTemplate(missingStep).reasonCodes.includes('missing_required_tool_step'));

    const missingHook = createStrandsRapTemplateFixture();
    missingHook.hooks.buyerPolicy = false;
    assert.ok(validateStrandsRapTemplate(missingHook).reasonCodes.includes('missing_required_hook'));

    const missingEndpoint = createStrandsRapTemplateFixture();
    missingEndpoint.sellerWrapperEndpointHelper.quoteRoute = '';
    assert.ok(validateStrandsRapTemplate(missingEndpoint).reasonCodes.includes('missing_seller_wrapper_endpoint_helper'));

    const missingEvidence = createStrandsRapTemplateFixture();
    missingEvidence.toolState.evidenceRef = undefined;
    assert.ok(validateStrandsRapTemplate(missingEvidence).reasonCodes.includes('missing_receipt_evidence_refs'));
  });

  it('rejects credential-shaped output and unsafe live/custody/provider claims', () => {
    const credential = createStrandsRapTemplateFixture({ scenario: 'credential-shaped-output' });
    assert.ok(validateStrandsRapTemplate(credential).reasonCodes.includes('template_contains_credentials'));

    const unsafe = createStrandsRapTemplateFixture({ scenario: 'unsafe-live-custody-provider-claim' });
    assert.ok(validateStrandsRapTemplate(unsafe).reasonCodes.includes('unsafe_live_custody_provider_claim'));

    const finality = createStrandsRapTemplateFixture();
    finality.notes.push('Template confirms settlement finality.');
    assert.ok(validateStrandsRapTemplate(finality).reasonCodes.includes('unsafe_live_custody_provider_claim'));
  });

  it('rejects malformed or diverged framework contracts instead of redefining shared RAP semantics', () => {
    const template = createStrandsRapTemplateFixture() as StrandsRapTemplateState & {
      contracts: StrandsRapTemplateState['contracts'];
    };
    template.contracts.preflight.buyerAuthorityCases = [];
    assert.ok(validateStrandsRapTemplate(template).reasonCodes.includes('framework_contract_invalid'));
  });
});
