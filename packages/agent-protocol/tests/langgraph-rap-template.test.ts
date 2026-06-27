import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createLangGraphRapTemplateFixture,
  runFrameworkTemplateNoLiveConformanceCheck,
  validateLangGraphRapTemplate,
  type LangGraphRapTemplateState,
} from '../dist/index.js';

describe('LangGraph RAP template fixture', () => {
  it('exports an allowed local no-live buyer/seller graph template', () => {
    const template = createLangGraphRapTemplateFixture();
    const result = validateLangGraphRapTemplate(template);

    assert.equal(template.graphId, 'langgraph:rap-template:listing-writer');
    assert.equal(template.expectedAllowed, true);
    assert.deepEqual(result.reasonCodes, ['langgraph_rap_template_valid']);
    assert.equal(runFrameworkTemplateNoLiveConformanceCheck().valid, true);
    assert.deepEqual(template.nodes, [
      'discover',
      'quote',
      'buyerPolicyPreflight',
      'operatorApproval',
      'invokePaidAgent',
      'bindReceiptEvidence',
      'sellerWrapperEndpoint',
    ]);
    assert.equal(template.middleware.buyerPolicy, true);
    assert.equal(template.middleware.receiptEvidence, true);
    assert.equal(template.middleware.sellerWrapper, true);
    assert.equal(template.selectedContract.agentIdentity.templateMode, 'dual-mode');
  });

  it('keeps policy denial local and reason-coded without making the template malformed', () => {
    const template = createLangGraphRapTemplateFixture({ scenario: 'policy-denial' });
    const result = validateLangGraphRapTemplate(template);

    assert.equal(template.expectedAllowed, false);
    assert.deepEqual(template.graphState.denialReasonCodes, ['policy_denied']);
    assert.equal(template.graphState.operatorApprovalRef, undefined);
    assert.equal(template.graphState.invocationRef, undefined);
    assert.equal(template.graphState.receiptRef, undefined);
    assert.equal(template.graphState.evidenceRef, undefined);
    assert.deepEqual(result.reasonCodes, ['langgraph_rap_template_valid']);

    const unsafeDenied = createLangGraphRapTemplateFixture({ scenario: 'policy-denial' });
    unsafeDenied.graphState.invocationRef = 'local-fixture:langgraph:invocation';
    assert.ok(validateLangGraphRapTemplate(unsafeDenied).reasonCodes.includes('missing_operator_approval'));
  });

  it('fails closed for missing approval and malformed quote/payment-plan fixtures', () => {
    const missingApproval = createLangGraphRapTemplateFixture({ scenario: 'missing-approval' });
    assert.deepEqual(validateLangGraphRapTemplate(missingApproval).reasonCodes, ['missing_operator_approval']);

    const malformedQuote = createLangGraphRapTemplateFixture({ scenario: 'malformed-quote-payment-plan' });
    assert.deepEqual(validateLangGraphRapTemplate(malformedQuote).reasonCodes, ['malformed_quote_payment_plan']);
  });

  it('fails closed for missing graph nodes, middleware, endpoint helper, and receipt/evidence refs', () => {
    const missingNode = createLangGraphRapTemplateFixture();
    missingNode.nodes = missingNode.nodes.filter((node) => node !== 'quote');
    assert.ok(validateLangGraphRapTemplate(missingNode).reasonCodes.includes('missing_required_graph_node'));

    const missingMiddleware = createLangGraphRapTemplateFixture();
    missingMiddleware.middleware.buyerPolicy = false;
    assert.ok(validateLangGraphRapTemplate(missingMiddleware).reasonCodes.includes('missing_required_middleware'));

    const missingEndpoint = createLangGraphRapTemplateFixture();
    missingEndpoint.sellerWrapperEndpointHelper.quoteRoute = '';
    assert.ok(validateLangGraphRapTemplate(missingEndpoint).reasonCodes.includes('missing_seller_wrapper_endpoint_helper'));

    const missingEvidence = createLangGraphRapTemplateFixture();
    missingEvidence.graphState.evidenceRef = undefined;
    assert.ok(validateLangGraphRapTemplate(missingEvidence).reasonCodes.includes('missing_receipt_evidence_refs'));
  });

  it('rejects credential-shaped output and unsafe live/custody/provider claims', () => {
    const credential = createLangGraphRapTemplateFixture({ scenario: 'credential-shaped-output' });
    assert.ok(validateLangGraphRapTemplate(credential).reasonCodes.includes('template_contains_credentials'));

    const unsafe = createLangGraphRapTemplateFixture({ scenario: 'unsafe-live-custody-provider-claim' });
    assert.ok(validateLangGraphRapTemplate(unsafe).reasonCodes.includes('unsafe_live_custody_provider_claim'));

    const finality = createLangGraphRapTemplateFixture();
    finality.notes.push('Template confirms settlement finality.');
    assert.ok(validateLangGraphRapTemplate(finality).reasonCodes.includes('unsafe_live_custody_provider_claim'));
  });

  it('rejects malformed or diverged framework contracts instead of redefining shared RAP semantics', () => {
    const template = createLangGraphRapTemplateFixture() as LangGraphRapTemplateState & {
      contracts: LangGraphRapTemplateState['contracts'];
    };
    template.contracts.preflight.buyerAuthorityCases = [];
    assert.ok(validateLangGraphRapTemplate(template).reasonCodes.includes('framework_contract_invalid'));
  });
});
