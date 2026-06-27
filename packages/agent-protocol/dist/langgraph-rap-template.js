import { frameworkTemplateFixtures, validateFrameworkTemplateContract, } from './framework-template-contract.js';
import { runFrameworkTemplateNoLiveConformanceCheck } from './framework-template-conformance.js';
import { sellerWrapperFixtureHasCredentialMaterial } from './seller-wrapper-rail-fixtures.js';
export const LANGGRAPH_RAP_TEMPLATE_SCHEMA_VERSION = 'reddi.langgraph-rap-template.v1';
const REQUIRED_NODES = [
    'discover',
    'quote',
    'buyerPolicyPreflight',
    'operatorApproval',
    'invokePaidAgent',
    'bindReceiptEvidence',
    'sellerWrapperEndpoint',
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
export function createLangGraphRapTemplateFixture(input = {}) {
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
        throw new Error('langgraph_template_missing_seller_profile');
    const fixture = {
        graphId: 'langgraph:rap-template:listing-writer',
        scenario,
        nodes: [...REQUIRED_NODES],
        middleware: {
            buyerPolicy: true,
            receiptEvidence: true,
            sellerWrapper: true,
        },
        contracts,
        selectedContract: cloneContract(selectedContract),
        sellerWrapperEndpointHelper: {
            endpointId: selectedContract.sellerProfile.endpointId,
            quoteRoute: selectedContract.sellerProfile.quoteRoute,
            policyPreflightRoute: selectedContract.sellerProfile.policyPreflightRoute,
            invocationRoute: selectedContract.sellerProfile.invocationRoute,
            receiptHook: selectedContract.sellerProfile.receiptHook,
            evidenceHook: selectedContract.sellerProfile.evidenceHook,
        },
        graphState: {
            discoveryRef: 'local-fixture:langgraph:discovery',
            quoteRef: 'local-fixture:langgraph:quote',
            buyerPolicyRef: 'local-fixture:langgraph:buyer-policy',
            operatorApprovalRef: 'local-fixture:langgraph:operator-approval',
            invocationRef: 'local-fixture:langgraph:invocation',
            receiptRef: 'local-fixture:receipt:listing-writer',
            evidenceRef: 'local-fixture:evidence:listing-writer',
            denialReasonCodes: scenario === 'policy-denial' ? ['policy_denied'] : [],
            failureMode: scenario === 'malformed-quote-payment-plan' ? 'malformed_quote_payment_plan' : undefined,
        },
        expectedAllowed: scenario === 'allowed-no-live-invocation',
        notes: [
            'This is a local/static LangGraph template fixture, not a LangGraph package scaffold.',
            'Graph state stores framework-neutral RAP refs only; external services and live rails stay disabled.',
        ],
    };
    if (scenario === 'policy-denial') {
        fixture.expectedAllowed = false;
        fixture.graphState.denialReasonCodes = ['policy_denied'];
    }
    if (scenario === 'missing-approval') {
        fixture.expectedAllowed = false;
        fixture.graphState.operatorApprovalRef = undefined;
    }
    if (scenario === 'malformed-quote-payment-plan') {
        fixture.expectedAllowed = false;
        fixture.graphState.quoteRef = '';
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
    return typeof candidate.graphId === 'string'
        && typeof candidate.scenario === 'string'
        && Array.isArray(candidate.nodes)
        && !!candidate.middleware
        && !!candidate.contracts
        && !!candidate.selectedContract
        && !!candidate.sellerWrapperEndpointHelper
        && !!candidate.graphState
        && Array.isArray(candidate.notes);
}
export function validateLangGraphRapTemplate(template) {
    if (!isStructuredTemplate(template)) {
        return {
            valid: false,
            reasonCodes: ['langgraph_template_malformed'],
            auditNotes: ['Denied: LangGraph RAP template fixture is malformed.'],
        };
    }
    const reasonCodes = [];
    const auditNotes = [];
    for (const node of REQUIRED_NODES) {
        if (!template.nodes.includes(node)) {
            reasonCodes.push('missing_required_graph_node');
            auditNotes.push(`Denied: missing LangGraph node ${node}.`);
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
    if (template.scenario === 'allowed-no-live-invocation' && (!template.graphState.receiptRef || !template.graphState.evidenceRef)) {
        reasonCodes.push('missing_receipt_evidence_refs');
        auditNotes.push('Denied: allowed no-live invocation requires receipt and evidence refs.');
    }
    if (template.scenario === 'missing-approval' && !template.graphState.operatorApprovalRef) {
        reasonCodes.push('missing_operator_approval');
        auditNotes.push('Denied: operator approval ref is required before paid-agent invocation.');
    }
    if (template.scenario === 'malformed-quote-payment-plan' && !template.graphState.quoteRef) {
        reasonCodes.push('malformed_quote_payment_plan');
        auditNotes.push('Denied: quote/payment-plan ref is malformed or missing.');
    }
    if (sellerWrapperFixtureHasCredentialMaterial(template)) {
        reasonCodes.push('template_contains_credentials');
        auditNotes.push('Denied: LangGraph RAP template contains credential-shaped material.');
    }
    const templateBoundaryText = {
        graphId: template.graphId,
        scenario: template.scenario,
        nodes: template.nodes,
        middleware: template.middleware,
        sellerWrapperEndpointHelper: template.sellerWrapperEndpointHelper,
        graphState: template.graphState,
        notes: template.notes,
    };
    if (textContains(templateBoundaryText, UNSAFE_LIVE_PATTERN) || textContains(templateBoundaryText, CUSTODY_FINALITY_PATTERN)) {
        reasonCodes.push('unsafe_live_custody_provider_claim');
        auditNotes.push('Denied: LangGraph RAP template contains unsafe live, provider, custody, transfer, or finality material.');
    }
    if (reasonCodes.length > 0)
        return { valid: false, reasonCodes: [...new Set(reasonCodes)], auditNotes };
    return {
        valid: true,
        reasonCodes: ['langgraph_rap_template_valid'],
        auditNotes: ['Allowed: LangGraph RAP template fixture is local, no-live, and consumes shared RAP framework contracts.'],
    };
}
