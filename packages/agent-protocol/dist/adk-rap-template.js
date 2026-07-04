import { frameworkTemplateFixtures, validateFrameworkTemplateContract, } from './framework-template-contract.js';
import { runFrameworkTemplateNoLiveConformanceCheck } from './framework-template-conformance.js';
import { sellerWrapperFixtureHasCredentialMaterial } from './seller-wrapper-rail-fixtures.js';
export const ADK_RAP_TEMPLATE_SCHEMA_VERSION = 'reddi.adk-rap-template.v1';
export const ADK_RAP_TEMPLATE_FRAMEWORK = 'adk';
const REQUIRED_SKILLS = [
    'rap.discover',
    'rap.quote',
    'rap.buyer-policy-preflight',
    'rap.operator-approval',
    'rap.invoke-paid-agent',
    'rap.bind-receipt-evidence',
    'rap.seller-wrapper-endpoint',
];
const REQUIRED_CONTRACTS = [
    'discovery',
    'quote',
    'preflight',
    'operator-approval',
    'invocation',
    'receipt-evidence',
    'denial',
    'failure',
];
const UNSAFE_LIVE_PATTERN = /\bhttps?:\/\/[^\s"]*(rpc|alchemy|helius|quicknode|api\.(mainnet-beta|devnet|testnet)\.solana\.com)[^\s"]*|\b(wallet|provider|sign|transfer|broadcast)\b.*\b(payment|transaction|audd|usdc|sol)\b/i;
const CUSTODY_FINALITY_PATTERN = /\b(custody|custodied|escrowed|settlement finality|final settlement)\b/i;
function cloneContract(contract) {
    return structuredClone(contract);
}
function textContains(value, pattern) {
    if (typeof value === 'string')
        return pattern.test(value);
    if (!value || typeof value !== 'object')
        return false;
    if (Array.isArray(value))
        return value.some((item) => textContains(item, pattern));
    return Object.values(value).some((item) => textContains(item, pattern));
}
function contractMap() {
    return {
        discovery: cloneContract(frameworkTemplateFixtures.discovery.contract),
        quote: cloneContract(frameworkTemplateFixtures.quote.contract),
        preflight: cloneContract(frameworkTemplateFixtures.preflight.contract),
        'operator-approval': cloneContract(frameworkTemplateFixtures['operator-approval'].contract),
        invocation: cloneContract(frameworkTemplateFixtures.invocation.contract),
        'receipt-evidence': cloneContract(frameworkTemplateFixtures['receipt-evidence'].contract),
        denial: cloneContract(frameworkTemplateFixtures.denial.contract),
        failure: cloneContract(frameworkTemplateFixtures.failure.contract),
    };
}
function requiredSkills() {
    return [
        {
            id: 'rap.discover',
            name: 'Discover',
            description: 'Publish framework-neutral RAP discovery metadata for this A2A Agent Card.',
            tags: ['rap', 'discovery'],
        },
        {
            id: 'rap.quote',
            name: 'Quote',
            description: 'Return a fixture quote and payment-plan reference before any buyer preflight.',
            tags: ['rap', 'quote'],
        },
        {
            id: 'rap.buyer-policy-preflight',
            name: 'Buyer policy preflight',
            description: 'Evaluate the shared #550 buyer authority matrix before invocation.',
            tags: ['rap', 'buyer-policy'],
        },
        {
            id: 'rap.operator-approval',
            name: 'Operator approval',
            description: 'Require operator approval before invoking the paid seller-wrapper agent.',
            tags: ['rap', 'operator-approval'],
        },
        {
            id: 'rap.invoke-paid-agent',
            name: 'Invoke paid agent',
            description: 'Invoke the mock seller-wrapper endpoint after buyer policy passes.',
            tags: ['rap', 'invocation'],
        },
        {
            id: 'rap.bind-receipt-evidence',
            name: 'Bind receipt and evidence',
            description: 'Bind receipt and evidence references after a mock invocation.',
            tags: ['rap', 'receipt-evidence'],
        },
        {
            id: 'rap.seller-wrapper-endpoint',
            name: 'Seller-wrapper endpoint',
            description: 'Expose the seller-wrapper quote, preflight, invocation, receipt, and evidence routes.',
            tags: ['rap', 'seller-wrapper'],
        },
    ];
}
/**
 * Returns a clone of the shared #552 invocation contract re-framed for ADK. Consumers use this
 * to prove `validateFrameworkTemplateContract` passes for framework kind 'adk' without redefining
 * any buyer-authority, receipt/evidence, support-state, or no-live semantics.
 */
export function createAdkFrameworkTemplateContract() {
    const contract = cloneContract(frameworkTemplateFixtures.invocation.contract);
    contract.agentIdentity.framework = 'adk';
    contract.agentIdentity.agentId = 'framework-template:adk:listing-writer';
    contract.agentIdentity.displayName = 'ADK A2A listing writer RAP template';
    return contract;
}
export function createAdkRapTemplateFixture(input = {}) {
    const scenario = input.scenario ?? 'allowed-no-live-invocation';
    const contracts = contractMap();
    const selectedContract = scenario === 'policy-denial'
        ? contracts.denial
        : scenario === 'missing-approval'
            ? contracts['operator-approval']
            : scenario === 'malformed-quote-payment-plan'
                ? contracts.quote
                : scenario === 'unsafe-live-custody-provider-claim'
                    ? contracts.preflight
                    : contracts.invocation;
    if (!selectedContract.sellerProfile)
        throw new Error('adk_template_missing_seller_profile');
    const seller = selectedContract.sellerProfile;
    const agentCard = {
        schemaProfile: 'a2a-agent-card',
        framework: 'adk',
        protocolVersion: 'a2a/0.3.0-fixture',
        name: 'adk:rap-template:listing-writer',
        description: 'Local no-live ADK A2A Agent Card carrying RAP discovery, quote, policy, and receipt metadata for a listing-writer agent.',
        preferredTransport: 'a2a-agent-card',
        capabilities: {
            streaming: false,
            pushNotifications: false,
            stateTransitionHistory: false,
        },
        skills: requiredSkills(),
        rapExtension: {
            extensionId: 'reddi.rap.a2a-agent-card-extension/v1',
            discoveryRoute: seller.quoteRoute.replace(/\/quote$/, '/discovery'),
            quoteRoute: seller.quoteRoute,
            policyPreflightRoute: seller.policyPreflightRoute,
            invocationRoute: seller.invocationRoute,
            receiptHook: seller.receiptHook,
            evidenceHook: seller.evidenceHook,
            supportState: 'proof-metadata-only',
            livePaymentApproved: false,
        },
    };
    const fixture = {
        cardId: 'adk:rap-template:listing-writer',
        scenario,
        agentCard,
        middleware: {
            buyerPolicy: true,
            receiptEvidence: true,
            sellerWrapper: true,
        },
        contracts,
        selectedContract: cloneContract(selectedContract),
        sellerWrapperEndpointHelper: {
            endpointId: seller.endpointId,
            quoteRoute: seller.quoteRoute,
            policyPreflightRoute: seller.policyPreflightRoute,
            invocationRoute: seller.invocationRoute,
            receiptHook: seller.receiptHook,
            evidenceHook: seller.evidenceHook,
        },
        cardState: {
            discoveryRef: 'local-fixture:adk:discovery',
            quoteRef: 'local-fixture:adk:quote',
            buyerPolicyRef: 'local-fixture:adk:buyer-policy',
            operatorApprovalRef: 'local-fixture:adk:operator-approval',
            invocationRef: 'local-fixture:adk:invocation',
            receiptRef: 'local-fixture:receipt:listing-writer',
            evidenceRef: 'local-fixture:evidence:listing-writer',
            denialReasonCodes: scenario === 'policy-denial' ? ['policy_denied'] : [],
            failureMode: scenario === 'malformed-quote-payment-plan' ? 'malformed_quote_payment_plan' : undefined,
        },
        expectedAllowed: scenario === 'allowed-no-live-invocation',
        notes: [
            'This is a local/static ADK A2A Agent Card fixture, not a deployed ADK agent or live A2A endpoint.',
            'The Agent Card carries framework-neutral RAP refs only; external services and live rails stay disabled.',
        ],
    };
    if (scenario === 'policy-denial') {
        fixture.expectedAllowed = false;
        fixture.cardState.denialReasonCodes = ['policy_denied'];
        fixture.cardState.operatorApprovalRef = undefined;
        fixture.cardState.invocationRef = undefined;
        fixture.cardState.receiptRef = undefined;
        fixture.cardState.evidenceRef = undefined;
    }
    if (scenario === 'missing-approval') {
        fixture.expectedAllowed = false;
        fixture.cardState.operatorApprovalRef = undefined;
    }
    if (scenario === 'malformed-quote-payment-plan') {
        fixture.expectedAllowed = false;
        fixture.cardState.quoteRef = '';
    }
    if (scenario === 'credential-shaped-output') {
        fixture.expectedAllowed = false;
        fixture.notes.push('Rejected fixture output contains providerSecret=sk-test-secret.');
    }
    if (scenario === 'unsafe-live-custody-provider-claim') {
        fixture.expectedAllowed = false;
        fixture.notes.push('Rejected fixture attempts https://api.mainnet-beta.solana.com and claims AUDD custody.');
    }
    return fixture;
}
function isStructuredTemplate(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const candidate = value;
    return typeof candidate.cardId === 'string'
        && typeof candidate.scenario === 'string'
        && !!candidate.agentCard
        && typeof candidate.agentCard === 'object'
        && Array.isArray(candidate.agentCard.skills)
        && !!candidate.agentCard.rapExtension
        && !!candidate.middleware
        && !!candidate.contracts
        && !!candidate.selectedContract
        && !!candidate.sellerWrapperEndpointHelper
        && !!candidate.cardState
        && Array.isArray(candidate.notes);
}
export function validateAdkRapTemplate(template) {
    if (!isStructuredTemplate(template)) {
        return {
            valid: false,
            reasonCodes: ['adk_template_malformed'],
            auditNotes: ['Denied: ADK RAP Agent Card template fixture is malformed.'],
        };
    }
    const reasonCodes = [];
    const auditNotes = [];
    const skillIds = new Set(template.agentCard.skills.map((skill) => skill.id));
    for (const skill of REQUIRED_SKILLS) {
        if (!skillIds.has(skill)) {
            reasonCodes.push('missing_required_agent_skill');
            auditNotes.push(`Denied: missing required ADK agent card skill ${skill}.`);
            break;
        }
    }
    if (!template.middleware.buyerPolicy || !template.middleware.receiptEvidence || !template.middleware.sellerWrapper) {
        reasonCodes.push('missing_required_middleware');
        auditNotes.push('Denied: buyer policy, receipt/evidence, and seller-wrapper middleware are required.');
    }
    for (const key of REQUIRED_CONTRACTS) {
        const contract = template.contracts[key];
        if (!contract || !validateFrameworkTemplateContract(contract).valid) {
            reasonCodes.push('framework_contract_invalid');
            auditNotes.push(`Denied: ${key} framework contract is invalid.`);
            break;
        }
    }
    if (!validateFrameworkTemplateContract(template.selectedContract).valid) {
        reasonCodes.push('framework_contract_invalid');
        auditNotes.push('Denied: selected framework contract is invalid.');
    }
    const conformance = runFrameworkTemplateNoLiveConformanceCheck();
    if (!conformance.valid) {
        reasonCodes.push('framework_conformance_invalid');
        auditNotes.push(`Denied: shared framework conformance failed: ${conformance.reasonCodes.join(',')}.`);
    }
    if (!template.sellerWrapperEndpointHelper.endpointId
        || !template.sellerWrapperEndpointHelper.quoteRoute
        || !template.sellerWrapperEndpointHelper.policyPreflightRoute
        || !template.sellerWrapperEndpointHelper.invocationRoute
        || !template.sellerWrapperEndpointHelper.receiptHook
        || !template.sellerWrapperEndpointHelper.evidenceHook) {
        reasonCodes.push('missing_seller_wrapper_endpoint_helper');
        auditNotes.push('Denied: seller-wrapper endpoint helper routes are required.');
    }
    const rapExtension = template.agentCard.rapExtension;
    if (!template.agentCard.name
        || !template.agentCard.protocolVersion
        || template.agentCard.preferredTransport !== 'a2a-agent-card'
        || !rapExtension
        || !rapExtension.extensionId
        || !rapExtension.discoveryRoute
        || !rapExtension.quoteRoute
        || !rapExtension.policyPreflightRoute
        || !rapExtension.invocationRoute
        || !rapExtension.receiptHook
        || !rapExtension.evidenceHook
        || rapExtension.livePaymentApproved !== false) {
        reasonCodes.push('missing_agent_card_rap_extension');
        auditNotes.push('Denied: A2A Agent Card must carry RAP discovery/quote/policy/receipt/evidence extension metadata.');
    }
    if (template.scenario === 'allowed-no-live-invocation' && (!template.cardState.receiptRef || !template.cardState.evidenceRef)) {
        reasonCodes.push('missing_receipt_evidence_refs');
        auditNotes.push('Denied: allowed no-live invocation requires receipt and evidence refs.');
    }
    if (template.scenario === 'policy-denial'
        && (template.cardState.operatorApprovalRef
            || template.cardState.invocationRef
            || template.cardState.receiptRef
            || template.cardState.evidenceRef)) {
        reasonCodes.push('missing_operator_approval');
        auditNotes.push('Denied: policy-denial case must stop before approval, invocation, receipt, and evidence refs.');
    }
    if (template.scenario === 'missing-approval' && !template.cardState.operatorApprovalRef) {
        reasonCodes.push('missing_operator_approval');
        auditNotes.push('Denied: operator approval ref is required before paid-agent invocation.');
    }
    if (template.scenario === 'malformed-quote-payment-plan' && !template.cardState.quoteRef) {
        reasonCodes.push('malformed_quote_payment_plan');
        auditNotes.push('Denied: quote/payment-plan ref is malformed or missing.');
    }
    if (sellerWrapperFixtureHasCredentialMaterial(template)) {
        reasonCodes.push('template_contains_credentials');
        auditNotes.push('Denied: ADK RAP Agent Card template contains credential-shaped material.');
    }
    const templateBoundaryText = {
        cardId: template.cardId,
        scenario: template.scenario,
        agentCard: template.agentCard,
        middleware: template.middleware,
        sellerWrapperEndpointHelper: template.sellerWrapperEndpointHelper,
        cardState: template.cardState,
        notes: template.notes,
    };
    if (textContains(templateBoundaryText, UNSAFE_LIVE_PATTERN) || textContains(templateBoundaryText, CUSTODY_FINALITY_PATTERN)) {
        reasonCodes.push('unsafe_live_custody_provider_claim');
        auditNotes.push('Denied: ADK RAP Agent Card template contains unsafe live, provider, custody, transfer, or finality material.');
    }
    if (reasonCodes.length > 0)
        return { valid: false, reasonCodes: [...new Set(reasonCodes)], auditNotes };
    return {
        valid: true,
        reasonCodes: ['adk_rap_template_valid'],
        auditNotes: ['Allowed: ADK RAP Agent Card template fixture is local, no-live, and consumes shared RAP framework contracts.'],
    };
}
