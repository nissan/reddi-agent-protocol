import { listBuyerAuthorityPolicyFixtureMatrix, } from './buyer-authority-policy.js';
import { generateSellerWrapperConfigExamples, validateSellerWrapperConfigExamples, } from './seller-wrapper-config.js';
import { sellerWrapperFixtureHasCredentialMaterial } from './seller-wrapper-rail-fixtures.js';
export const FRAMEWORK_TEMPLATE_CONTRACT_SCHEMA_VERSION = 'reddi.framework-template-contract.v1';
const UNSAFE_LIVE_PATTERN = /\bhttps?:\/\/[^\s"]*(rpc|alchemy|helius|quicknode|api\.(mainnet-beta|devnet|testnet)\.solana\.com)[^\s"]*|\b(provider\s+credential|wallet\s+sign|signing\s+authority)\b/i;
const TRANSFER_INSTRUCTION_PATTERN = /\b(submit|sign|transfer|broadcast)\b.*\b(transaction|payment|audd|usdc|sol)\b/i;
const CUSTODY_CLAIM_PATTERN = /\b(audd|usdc|sol)\b.*\b(custody|custodied|escrowed|held)\b|\bheld\s+in\s+custody\b/i;
const SETTLEMENT_FINALITY_PATTERN = /\bsettlement\s+finality\b|\bfinal\s+settlement\b/i;
const SAFE_SUPPORT_STATES = ['fixture', 'dry-run', 'proof-metadata-only', 'devnet-gated'];
function textContains(value, pattern) {
    if (typeof value === 'string')
        return pattern.test(value);
    if (!value || typeof value !== 'object')
        return false;
    if (Array.isArray(value))
        return value.some((item) => textContains(item, pattern));
    return Object.values(value).some((item) => textContains(item, pattern));
}
function cloneContract(contract) {
    return structuredClone(contract);
}
function buyerAuthorityCases() {
    return listBuyerAuthorityPolicyFixtureMatrix().map((example) => ({
        key: example.key,
        expectedAllowed: example.expectedAllowed,
        expectedReasonCodes: [...example.expectedReasonCodes],
    }));
}
function buyerAuthorityCasesMatch(cases) {
    const expectedCases = buyerAuthorityCases();
    if (cases.length !== expectedCases.length)
        return false;
    return expectedCases.every((expected) => {
        const actual = cases.find((item) => item.key === expected.key);
        return !!actual
            && actual.expectedAllowed === expected.expectedAllowed
            && actual.expectedReasonCodes.length === expected.expectedReasonCodes.length
            && expected.expectedReasonCodes.every((reason) => actual.expectedReasonCodes.includes(reason));
    });
}
function buyerAuthorityPolicyMatches(contract) {
    if (!contract)
        return false;
    const expectedCases = buyerAuthorityCases();
    if (contract.policyIssue !== 549
        || contract.fixtureMatrixIssue !== 550
        || contract.fixtureStates.length !== expectedCases.length) {
        return false;
    }
    return expectedCases.every((expected) => {
        const actual = contract.fixtureStates.find((item) => item.key === expected.key);
        return !!actual
            && actual.expectedAllowed === expected.expectedAllowed
            && actual.expectedReasonCodes.length === expected.expectedReasonCodes.length
            && expected.expectedReasonCodes.every((reason) => actual.expectedReasonCodes.includes(reason));
    });
}
function supportStateBoundariesExplicitlyFalse(metadata) {
    return metadata.livePaymentApproved === false
        && metadata.walletRpcProviderCalls === false
        && metadata.custodySupported === false
        && metadata.settlementFinalityClaimed === false;
}
function isStructuredContract(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const candidate = value;
    return candidate.schemaVersion === FRAMEWORK_TEMPLATE_CONTRACT_SCHEMA_VERSION
        && candidate.issue === 552
        && !!candidate.agentIdentity
        && typeof candidate.agentIdentity === 'object'
        && typeof candidate.agentIdentity.agentId === 'string'
        && typeof candidate.agentIdentity.displayName === 'string'
        && ['generic', 'langgraph', 'strands', 'adk'].includes(String(candidate.agentIdentity.framework))
        && ['buyer-enabled', 'seller-enabled', 'dual-mode'].includes(String(candidate.agentIdentity.templateMode))
        && Array.isArray(candidate.agentIdentity.capabilityTags)
        && Array.isArray(candidate.invocationModes)
        && Array.isArray(candidate.buyerAuthorityCases)
        && !!candidate.executionResult
        && !!candidate.receiptEvidenceRefs
        && !!candidate.failureRefundState
        && !!candidate.supportStateMetadata
        && !!candidate.sourceContracts
        && !!candidate.downstreamConsumption
        && Array.isArray(candidate.notes);
}
function sellerProfileFromConfig(config) {
    const endpoint = config.endpoints.find((item) => item.kind === 'http-openapi') ?? config.endpoints[0];
    if (!endpoint)
        throw new Error('framework_template_missing_seller_endpoint');
    return {
        sellerId: 'seller:listing-writer',
        endpointId: endpoint.endpointId,
        endpointKind: endpoint.kind,
        quoteRoute: endpoint.wrapper.quoteRoute,
        policyPreflightRoute: endpoint.wrapper.policyPreflightRoute,
        invocationRoute: endpoint.wrapper.invocationRoute,
        receiptHook: endpoint.wrapper.receiptHook,
        evidenceHook: endpoint.wrapper.evidenceHook,
    };
}
function baseContract(overrides = {}) {
    const sellerWrapperConfig = generateSellerWrapperConfigExamples();
    return {
        schemaVersion: FRAMEWORK_TEMPLATE_CONTRACT_SCHEMA_VERSION,
        issue: 552,
        parentIssues: {
            frameworkTemplateContract: 543,
            frameworkTemplatesFeature: 542,
            buyerAuthority: 548,
            productCore: 334,
            railNeutralPayments: 338,
        },
        agentIdentity: {
            agentId: 'framework-template:generic:listing-writer',
            displayName: 'Generic listing writer RAP template',
            framework: 'generic',
            templateMode: 'dual-mode',
            capabilityTags: ['listing-writing', 'seller-wrapper', 'buyer-authority'],
        },
        invocationModes: ['http-openapi', 'mcp', 'local-fixture'],
        sellerProfile: sellerProfileFromConfig(sellerWrapperConfig),
        buyerAuthorityPolicy: sellerWrapperConfig.buyerAuthorityPolicy,
        buyerAuthorityCases: buyerAuthorityCases(),
        executionResult: {
            status: 'allowed',
            invocationId: 'local-fixture:framework-template:allowed',
            outputRef: 'local-fixture:framework-template:output',
        },
        receiptEvidenceRefs: {
            receiptRequired: true,
            evidenceRequired: true,
            receiptRef: 'local-fixture:receipt:listing-writer',
            evidenceRef: 'local-fixture:evidence:listing-writer',
        },
        failureRefundState: {
            failureMode: 'no_charge_on_failure',
            refundMode: 'manual_review',
            state: 'not-applicable',
        },
        supportStateMetadata: {
            runtimeState: 'proof-metadata-only',
            livePaymentApproved: false,
            walletRpcProviderCalls: false,
            custodySupported: false,
            settlementFinalityClaimed: false,
        },
        sourceContracts: {
            sellerWrapperConfigSchemaVersion: sellerWrapperConfig.schemaVersion,
            buyerAuthorityPolicySchemaVersion: sellerWrapperConfig.buyerAuthorityPolicy.policySchemaVersion,
            buyerAuthorityFixtureMatrixIssue: 550,
        },
        downstreamConsumption: {
            langGraphIssue: 544,
            strandsIssue: 545,
            adkIssue: 546,
            comparisonDocsIssue: 547,
        },
        notes: [
            'Framework templates consume this contract without inventing framework-specific payment semantics.',
            'No framework template may activate live payment, custody, wallet/RPC/provider calls, or finality claims.',
        ],
        ...overrides,
    };
}
const discoveryContract = baseContract({
    executionResult: { status: 'not-run', invocationId: 'local-fixture:framework-template:discovery' },
});
const quoteContract = baseContract({
    executionResult: { status: 'not-run', invocationId: 'local-fixture:framework-template:quote' },
});
const preflightContract = baseContract({
    executionResult: { status: 'allowed', invocationId: 'local-fixture:framework-template:preflight' },
});
const operatorApprovalContract = baseContract({
    executionResult: { status: 'denied', invocationId: 'local-fixture:framework-template:operator-approval' },
    notes: [
        'Operator approval is required before invocation for over-threshold buyer authority cases.',
        'This fixture remains local and does not execute a payment.',
    ],
});
const invocationContract = baseContract();
const receiptEvidenceContract = baseContract({
    executionResult: { status: 'allowed', invocationId: 'local-fixture:framework-template:receipt-evidence', outputRef: 'local-fixture:output:receipt-evidence' },
});
const denialContract = baseContract({
    executionResult: { status: 'denied', invocationId: 'local-fixture:framework-template:denial' },
    receiptEvidenceRefs: { receiptRequired: true, evidenceRequired: true },
});
const failureContract = baseContract({
    executionResult: { status: 'failed', invocationId: 'local-fixture:framework-template:failure' },
    failureRefundState: {
        failureMode: 'no_charge_on_failure',
        refundMode: 'manual_review',
        state: 'manual-review',
    },
});
export const frameworkTemplateFixtures = {
    discovery: {
        kind: 'discovery',
        description: 'Framework-neutral discovery fixture with seller profile and buyer authority matrix references.',
        contract: discoveryContract,
        expectedValid: true,
        expectedReasonCodes: ['framework_template_contract_valid'],
    },
    quote: {
        kind: 'quote',
        description: 'Framework-neutral quote fixture before buyer authority preflight.',
        contract: quoteContract,
        expectedValid: true,
        expectedReasonCodes: ['framework_template_contract_valid'],
    },
    preflight: {
        kind: 'preflight',
        description: 'Buyer authority preflight fixture using the shared #550 matrix.',
        contract: preflightContract,
        expectedValid: true,
        expectedReasonCodes: ['framework_template_contract_valid'],
    },
    'operator-approval': {
        kind: 'operator-approval',
        description: 'Operator approval required fixture with no payment execution.',
        contract: operatorApprovalContract,
        expectedValid: true,
        expectedReasonCodes: ['framework_template_contract_valid'],
    },
    invocation: {
        kind: 'invocation',
        description: 'Mock seller-wrapper invocation fixture after buyer policy passes.',
        contract: invocationContract,
        expectedValid: true,
        expectedReasonCodes: ['framework_template_contract_valid'],
    },
    'receipt-evidence': {
        kind: 'receipt-evidence',
        description: 'Receipt/evidence binding fixture with local references only.',
        contract: receiptEvidenceContract,
        expectedValid: true,
        expectedReasonCodes: ['framework_template_contract_valid'],
    },
    denial: {
        kind: 'denial',
        description: 'Denial fixture preserving machine-readable buyer authority reason codes.',
        contract: denialContract,
        expectedValid: true,
        expectedReasonCodes: ['framework_template_contract_valid'],
    },
    failure: {
        kind: 'failure',
        description: 'Failure/refund fixture using no-charge-on-failure and manual review semantics.',
        contract: failureContract,
        expectedValid: true,
        expectedReasonCodes: ['framework_template_contract_valid'],
    },
};
export function listFrameworkTemplateFixtures() {
    return Object.values(frameworkTemplateFixtures).map((fixture) => ({
        ...fixture,
        contract: cloneContract(fixture.contract),
    }));
}
export function validateFrameworkTemplateContract(contract) {
    if (!isStructuredContract(contract)) {
        return {
            valid: false,
            reasonCodes: ['framework_template_contract_malformed'],
            auditNotes: ['Denied: framework-template contract is malformed.'],
        };
    }
    const reasonCodes = [];
    const auditNotes = [];
    if (sellerWrapperFixtureHasCredentialMaterial(contract)) {
        reasonCodes.push('framework_template_contains_credentials');
        auditNotes.push('Denied: framework-template contract contains credential-like material.');
    }
    const sellerWrapperConfig = generateSellerWrapperConfigExamples();
    const sellerValidation = validateSellerWrapperConfigExamples(sellerWrapperConfig);
    if (!sellerValidation.valid) {
        reasonCodes.push('seller_wrapper_contract_invalid');
        auditNotes.push('Denied: source seller-wrapper contract is invalid.');
    }
    if (!buyerAuthorityCasesMatch(contract.buyerAuthorityCases)) {
        reasonCodes.push('buyer_authority_matrix_mismatch');
        auditNotes.push('Denied: buyer authority fixture matrix does not match #550.');
    }
    if (contract.agentIdentity.templateMode !== 'seller-enabled'
        && !buyerAuthorityPolicyMatches(contract.buyerAuthorityPolicy)) {
        reasonCodes.push('seller_wrapper_contract_invalid');
        auditNotes.push('Denied: buyer authority policy contract does not match #551 seller-wrapper contract metadata.');
    }
    if (contract.agentIdentity.templateMode === 'seller-enabled'
        && contract.buyerAuthorityPolicy
        && !buyerAuthorityPolicyMatches(contract.buyerAuthorityPolicy)) {
        reasonCodes.push('seller_wrapper_contract_invalid');
        auditNotes.push('Denied: seller-only buyer authority policy contract is present but does not match #551 metadata.');
    }
    if (!SAFE_SUPPORT_STATES.includes(contract.supportStateMetadata.runtimeState)) {
        reasonCodes.push('unsafe_support_state');
        auditNotes.push('Denied: framework-template support state is not a safe local/static state.');
    }
    if (!supportStateBoundariesExplicitlyFalse(contract.supportStateMetadata)) {
        reasonCodes.push('framework_template_contract_malformed');
        auditNotes.push('Denied: framework-template runtime boundary booleans must be explicitly false.');
    }
    if (contract.supportStateMetadata.livePaymentApproved) {
        reasonCodes.push('live_payment_rejected');
        auditNotes.push('Denied: framework templates must not approve live payment.');
    }
    if (contract.supportStateMetadata.walletRpcProviderCalls || textContains(contract, UNSAFE_LIVE_PATTERN)) {
        reasonCodes.push('wallet_rpc_provider_call_rejected');
        auditNotes.push('Denied: framework-template contract contains wallet/RPC/provider-call material.');
    }
    if (textContains(contract, TRANSFER_INSTRUCTION_PATTERN)) {
        reasonCodes.push('live_payment_rejected');
        auditNotes.push('Denied: framework-template contract contains signing, transfer, broadcast, or payment execution instructions.');
    }
    if (contract.supportStateMetadata.custodySupported || textContains(contract, CUSTODY_CLAIM_PATTERN)) {
        reasonCodes.push('custody_claim_rejected');
        auditNotes.push('Denied: framework-template contract must not claim custody.');
    }
    if (contract.supportStateMetadata.settlementFinalityClaimed || textContains(contract, SETTLEMENT_FINALITY_PATTERN)) {
        reasonCodes.push('settlement_finality_claim_rejected');
        auditNotes.push('Denied: framework-template contract must not claim settlement finality.');
    }
    if (contract.receiptEvidenceRefs.receiptRequired && !contract.receiptEvidenceRefs.receiptRef && contract.executionResult.status === 'allowed') {
        reasonCodes.push('missing_receipt_evidence_refs');
        auditNotes.push('Denied: allowed invocations require receipt refs.');
    }
    if (contract.receiptEvidenceRefs.evidenceRequired && !contract.receiptEvidenceRefs.evidenceRef && contract.executionResult.status === 'allowed') {
        reasonCodes.push('missing_receipt_evidence_refs');
        auditNotes.push('Denied: allowed invocations require evidence refs.');
    }
    if (!contract.failureRefundState.failureMode || !contract.failureRefundState.refundMode) {
        reasonCodes.push('missing_failure_refund_state');
        auditNotes.push('Denied: failure/refund state is required.');
    }
    if (reasonCodes.length > 0)
        return { valid: false, reasonCodes, auditNotes };
    return {
        valid: true,
        reasonCodes: ['framework_template_contract_valid'],
        auditNotes: ['Allowed: framework-template contract is static, non-secret, no-spend, and no-live.'],
    };
}
