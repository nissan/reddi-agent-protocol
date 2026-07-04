import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createAdkFrameworkTemplateContract,
  createAdkRapTemplateFixture,
  runFrameworkTemplateNoLiveConformanceCheck,
  validateAdkRapTemplate,
  validateFrameworkTemplateContract,
  type AdkRapTemplateState,
} from '../dist/index.js';

describe('ADK A2A RAP Agent Card template fixture', () => {
  it('exports an allowed local no-live A2A Agent Card carrying RAP metadata', () => {
    const template = createAdkRapTemplateFixture();
    const result = validateAdkRapTemplate(template);

    assert.equal(template.cardId, 'adk:rap-template:listing-writer');
    assert.equal(template.expectedAllowed, true);
    assert.deepEqual(result.reasonCodes, ['adk_rap_template_valid']);
    assert.equal(runFrameworkTemplateNoLiveConformanceCheck().valid, true);

    assert.equal(template.agentCard.schemaProfile, 'a2a-agent-card');
    assert.equal(template.agentCard.framework, 'adk');
    assert.equal(template.agentCard.preferredTransport, 'a2a-agent-card');
    assert.deepEqual(template.agentCard.skills.map((skill) => skill.id), [
      'rap.discover',
      'rap.quote',
      'rap.buyer-policy-preflight',
      'rap.operator-approval',
      'rap.invoke-paid-agent',
      'rap.bind-receipt-evidence',
      'rap.seller-wrapper-endpoint',
    ]);
    // A2A card must carry RAP discovery/quote/policy/receipt/evidence extension metadata.
    assert.ok(template.agentCard.rapExtension.discoveryRoute.length > 0);
    assert.ok(template.agentCard.rapExtension.quoteRoute.length > 0);
    assert.ok(template.agentCard.rapExtension.policyPreflightRoute.length > 0);
    assert.ok(template.agentCard.rapExtension.receiptHook.length > 0);
    assert.ok(template.agentCard.rapExtension.evidenceHook.length > 0);
    assert.equal(template.middleware.buyerPolicy, true);
    assert.equal(template.middleware.receiptEvidence, true);
    assert.equal(template.middleware.sellerWrapper, true);
    assert.equal(template.selectedContract.agentIdentity.templateMode, 'dual-mode');
  });

  it('proves the shared framework-template contract passes for framework kind adk (fixture/dry-run only)', () => {
    const contract = createAdkFrameworkTemplateContract();
    const result = validateFrameworkTemplateContract(contract);

    assert.equal(contract.agentIdentity.framework, 'adk');
    assert.deepEqual(result.reasonCodes, ['framework_template_contract_valid']);

    // Payment paths stay fixture/dry-run only: every live boundary must be explicitly false and
    // the runtime support state must be a safe local/static state.
    assert.equal(contract.supportStateMetadata.livePaymentApproved, false);
    assert.equal(contract.supportStateMetadata.walletRpcProviderCalls, false);
    assert.equal(contract.supportStateMetadata.custodySupported, false);
    assert.equal(contract.supportStateMetadata.settlementFinalityClaimed, false);
    assert.ok(['fixture', 'dry-run', 'proof-metadata-only', 'devnet-gated'].includes(contract.supportStateMetadata.runtimeState));

    const template = createAdkRapTemplateFixture();
    assert.equal(template.agentCard.rapExtension.livePaymentApproved, false);
    assert.equal(template.agentCard.rapExtension.supportState, 'proof-metadata-only');
    for (const scenarioContract of Object.values(template.contracts)) {
      assert.equal(scenarioContract.supportStateMetadata.livePaymentApproved, false);
      assert.equal(scenarioContract.supportStateMetadata.walletRpcProviderCalls, false);
      assert.equal(scenarioContract.supportStateMetadata.custodySupported, false);
      assert.equal(scenarioContract.supportStateMetadata.settlementFinalityClaimed, false);
    }
  });

  it('keeps policy denial local and reason-coded without making the template malformed', () => {
    const template = createAdkRapTemplateFixture({ scenario: 'policy-denial' });
    const result = validateAdkRapTemplate(template);

    assert.equal(template.expectedAllowed, false);
    assert.deepEqual(template.cardState.denialReasonCodes, ['policy_denied']);
    assert.equal(template.cardState.operatorApprovalRef, undefined);
    assert.equal(template.cardState.invocationRef, undefined);
    assert.equal(template.cardState.receiptRef, undefined);
    assert.equal(template.cardState.evidenceRef, undefined);
    assert.deepEqual(result.reasonCodes, ['adk_rap_template_valid']);

    const unsafeDenied = createAdkRapTemplateFixture({ scenario: 'policy-denial' });
    unsafeDenied.cardState.invocationRef = 'local-fixture:adk:invocation';
    assert.ok(validateAdkRapTemplate(unsafeDenied).reasonCodes.includes('missing_operator_approval'));
  });

  it('fails closed for missing approval and malformed quote/payment-plan fixtures', () => {
    const missingApproval = createAdkRapTemplateFixture({ scenario: 'missing-approval' });
    assert.deepEqual(validateAdkRapTemplate(missingApproval).reasonCodes, ['missing_operator_approval']);

    const malformedQuote = createAdkRapTemplateFixture({ scenario: 'malformed-quote-payment-plan' });
    assert.deepEqual(validateAdkRapTemplate(malformedQuote).reasonCodes, ['malformed_quote_payment_plan']);
  });

  it('fails closed for missing skills, middleware, endpoint helper, card extension, and receipt/evidence refs', () => {
    const missingSkill = createAdkRapTemplateFixture();
    missingSkill.agentCard.skills = missingSkill.agentCard.skills.filter((skill) => skill.id !== 'rap.quote');
    assert.ok(validateAdkRapTemplate(missingSkill).reasonCodes.includes('missing_required_agent_skill'));

    const missingMiddleware = createAdkRapTemplateFixture();
    missingMiddleware.middleware.buyerPolicy = false;
    assert.ok(validateAdkRapTemplate(missingMiddleware).reasonCodes.includes('missing_required_middleware'));

    const missingEndpoint = createAdkRapTemplateFixture();
    missingEndpoint.sellerWrapperEndpointHelper.quoteRoute = '';
    assert.ok(validateAdkRapTemplate(missingEndpoint).reasonCodes.includes('missing_seller_wrapper_endpoint_helper'));

    const missingExtension = createAdkRapTemplateFixture();
    missingExtension.agentCard.rapExtension.receiptHook = '';
    assert.ok(validateAdkRapTemplate(missingExtension).reasonCodes.includes('missing_agent_card_rap_extension'));

    const missingEvidence = createAdkRapTemplateFixture();
    missingEvidence.cardState.evidenceRef = undefined;
    assert.ok(validateAdkRapTemplate(missingEvidence).reasonCodes.includes('missing_receipt_evidence_refs'));
  });

  it('rejects credential-shaped output and unsafe live/custody/provider claims', () => {
    const credential = createAdkRapTemplateFixture({ scenario: 'credential-shaped-output' });
    assert.ok(validateAdkRapTemplate(credential).reasonCodes.includes('template_contains_credentials'));

    const unsafe = createAdkRapTemplateFixture({ scenario: 'unsafe-live-custody-provider-claim' });
    assert.ok(validateAdkRapTemplate(unsafe).reasonCodes.includes('unsafe_live_custody_provider_claim'));

    const finality = createAdkRapTemplateFixture();
    finality.notes.push('Template confirms settlement finality.');
    assert.ok(validateAdkRapTemplate(finality).reasonCodes.includes('unsafe_live_custody_provider_claim'));
  });

  it('rejects malformed or diverged framework contracts instead of redefining shared RAP semantics', () => {
    const template = createAdkRapTemplateFixture() as AdkRapTemplateState & {
      contracts: AdkRapTemplateState['contracts'];
    };
    template.contracts.preflight.buyerAuthorityCases = [];
    assert.ok(validateAdkRapTemplate(template).reasonCodes.includes('framework_contract_invalid'));
  });

  it('fails closed on a malformed (non-structured) template input', () => {
    assert.deepEqual(validateAdkRapTemplate({ cardId: 'x' }).reasonCodes, ['adk_template_malformed']);
    assert.deepEqual(validateAdkRapTemplate(null).reasonCodes, ['adk_template_malformed']);
  });
});
