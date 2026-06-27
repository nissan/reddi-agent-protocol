import { BUYER_AUTHORITY_POLICY_SCHEMA_VERSION, listBuyerAuthorityPolicyFixtureMatrix, } from './buyer-authority-policy.js';
import { SELLER_WRAPPER_RAIL_FIXTURE_SCHEMA_VERSION, getSellerWrapperRail, runAuddSellerWrapperNoSpendFlow, sellerWrapperFixtureHasCredentialMaterial, sellerWrapperRailFixture, } from './seller-wrapper-rail-fixtures.js';
export const SELLER_WRAPPER_CONFIG_SCHEMA_VERSION = 'reddi.seller-wrapper-config.v1';
const REQUIRED_WRAPPER_HOOKS = [
    'quoteRoute',
    'policyPreflightRoute',
    'invocationRoute',
    'receiptHook',
    'evidenceHook',
];
const LIVE_PAYMENT_INSTRUCTION_PATTERN = /\b(submit|sign|transfer|settle|broadcast)\b.*\b(transaction|payment|audd|usdc|sol)\b|\bwallet\s+sign|\brpc\b/i;
const CUSTODY_CLAIM_PATTERN = /\b(audd|usdc|sol)\b.*\b(is|are|was|were|will be|held|escrowed)\b.*\b(custody|custodied|escrowed|held)\b|\bheld\s+in\s+custody\b/i;
const SETTLEMENT_FINALITY_PATTERN = /\bsettlement\s+finality\b|\bfinal\s+settlement\b/i;
function endpointSlug(endpointId) {
    return endpointId.replace(/^seller-wrapper:/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
}
function amountForRail(rail) {
    if (rail.auddPaymentPlan)
        return rail.auddPaymentPlan.amount;
    if (rail.asset === 'SOL')
        return '1000000';
    return '2500000';
}
function runtimeStateForRail(rail) {
    if (rail.livePaymentApproved)
        return 'live-payment-approved';
    if (rail.state === 'dry-run' || rail.state === 'fixture')
        return 'local-dry-run';
    if (rail.state === 'custody-supported')
        return 'custody-supported';
    if (rail.state === 'proof-metadata-only')
        return 'proof-metadata-only';
    if (rail.state === 'devnet-gated')
        return 'devnet-gated';
    if (rail.state === 'live-gated')
        return 'live-gated';
    return 'unsupported';
}
function railConfigExample(rail) {
    return {
        id: rail.id,
        asset: rail.asset,
        network: rail.network,
        fixtureState: rail.state,
        runtimeState: runtimeStateForRail(rail),
        amountUnits: rail.amountUnits,
        payee: rail.payee,
        settlementAccount: rail.settlementAccount,
        evidenceRequired: rail.evidenceRequired,
        approvalRequired: rail.approvalRequired,
        livePaymentApproved: rail.livePaymentApproved,
        custodySupported: rail.custodySupported,
        quote: {
            amount: amountForRail(rail),
            expiresAt: rail.auddPaymentPlan?.quoteExpiresAt,
            paymentMode: rail.auddPaymentPlan?.paymentMode ?? 'dry-run',
        },
        audd: rail.auddPaymentPlan
            ? {
                mint: rail.auddPaymentPlan.mint,
                failurePolicy: rail.auddPaymentPlan.failurePolicy,
                refundPolicy: rail.auddPaymentPlan.refundPolicy,
            }
            : undefined,
        notes: rail.notes,
    };
}
function endpointConfigExample(endpoint) {
    const slug = endpointSlug(endpoint.endpointId);
    return {
        kind: endpoint.kind,
        endpointId: endpoint.endpointId,
        displayName: endpoint.displayName,
        transport: endpoint.transport,
        wrapper: {
            quoteRoute: `/seller-wrapper/${slug}/quote`,
            policyPreflightRoute: `/seller-wrapper/${slug}/policy-preflight`,
            invocationRoute: `/seller-wrapper/${slug}/invoke-mock`,
            receiptHook: `/seller-wrapper/${slug}/receipt`,
            evidenceHook: `/seller-wrapper/${slug}/evidence`,
        },
        rails: endpoint.rails.map(railConfigExample),
    };
}
function buyerAuthorityPolicyCase(example) {
    return {
        key: example.key,
        expectedAllowed: example.expectedAllowed,
        expectedReasonCodes: [...example.expectedReasonCodes],
    };
}
function buyerAuthorityPolicyContract() {
    return {
        policySchemaVersion: BUYER_AUTHORITY_POLICY_SCHEMA_VERSION,
        policyIssue: 549,
        fixtureMatrixIssue: 550,
        downstreamIssues: {
            sellerWrapperFeature: 375,
            frameworkTemplateContract: 543,
            frameworkTemplatesFeature: 542,
        },
        fields: [
            'spendCaps',
            'allowedRails',
            'allowedCurrencies',
            'sellerAllowlist',
            'expiresAt',
            'receiptEvidence',
            'refundFailurePolicy',
            'operatorApproval',
            'supportStateConstraints',
        ],
        lifecycle: [
            'discovery',
            'quote',
            'buyer-policy-preflight',
            'operator-approval',
            'seller-wrapper-invocation',
            'receipt-evidence',
            'failure-refund',
        ],
        fixtureStates: listBuyerAuthorityPolicyFixtureMatrix().map(buyerAuthorityPolicyCase),
        onboardingSurface: {
            displayStateLater: true,
            currentMode: 'api-contract-only',
            uiEvidenceRequiredWhenVisualized: true,
        },
        boundaries: {
            noPrivateKeys: true,
            noProviderCredentials: true,
            noSigningInstructions: true,
            noWalletRpcProviderCalls: true,
            noLivePaymentExecution: true,
            noCustodyClaims: true,
            noSettlementFinalityClaims: true,
        },
    };
}
function buyerAuthorityFixtureMatrixMatches(contract) {
    if (!contract)
        return false;
    const expectedCases = listBuyerAuthorityPolicyFixtureMatrix().map(buyerAuthorityPolicyCase);
    if (contract.fixtureStates.length !== expectedCases.length)
        return false;
    return expectedCases.every((expected) => {
        const actual = contract.fixtureStates.find((item) => item.key === expected.key);
        return !!actual
            && actual.expectedAllowed === expected.expectedAllowed
            && actual.expectedReasonCodes.length === expected.expectedReasonCodes.length
            && expected.expectedReasonCodes.every((reason) => actual.expectedReasonCodes.includes(reason));
    });
}
function generatedEndpoints(fixture) {
    if (fixture.endpoints.some((endpoint) => endpoint.kind === 'mcp'))
        return fixture.endpoints;
    const first = fixture.endpoints[0];
    if (!first)
        return [];
    return [
        ...fixture.endpoints,
        {
            ...first,
            kind: 'mcp',
            endpointId: `${first.endpointId}:mcp`,
            displayName: `${first.displayName} MCP bridge`,
            transport: {
                url: 'mcp://local/seller-wrapper/listing-writer',
                auth: 'none',
            },
        },
    ];
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
function configLooksStructured(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config))
        return false;
    const candidate = config;
    return candidate.schemaVersion === SELLER_WRAPPER_CONFIG_SCHEMA_VERSION
        && candidate.issue === 535
        && candidate.generatedMode === 'no-spend-config-examples'
        && Array.isArray(candidate.endpoints)
        && !!candidate.guardrails
        && typeof candidate.guardrails === 'object';
}
export function generateSellerWrapperConfigExamples(input = {}) {
    const fixture = input.fixture ?? sellerWrapperRailFixture;
    if (sellerWrapperFixtureHasCredentialMaterial(fixture)) {
        throw new Error('seller_wrapper_fixture_contains_credentials');
    }
    const auddRail = getSellerWrapperRail(fixture, 'AUDD', 'solana-devnet');
    if (!auddRail)
        throw new Error('seller_wrapper_config_missing_audd_rail');
    if (!auddRail.auddPaymentPlan)
        throw new Error('seller_wrapper_config_missing_audd_payment_plan');
    const config = {
        schemaVersion: SELLER_WRAPPER_CONFIG_SCHEMA_VERSION,
        issue: 535,
        sourceContract: {
            ...fixture.sourceContract,
            configIssue: 535,
            railFixtureIssue: fixture.issue,
            railFixtureSchemaVersion: SELLER_WRAPPER_RAIL_FIXTURE_SCHEMA_VERSION,
        },
        generatedMode: 'no-spend-config-examples',
        buyerAuthorityPolicy: buyerAuthorityPolicyContract(),
        endpoints: generatedEndpoints(fixture).map(endpointConfigExample),
        guardrails: {
            ...fixture.guardrails,
            noProviderCredentials: true,
            noLivePaymentInstructions: true,
        },
    };
    const validation = validateSellerWrapperConfigExamples(config);
    if (!validation.valid) {
        throw new Error(`seller_wrapper_config_invalid:${validation.reasonCodes.join(',')}`);
    }
    return config;
}
export function validateSellerWrapperConfigExamples(config) {
    const reasonCodes = [];
    const auditNotes = [];
    if (!configLooksStructured(config)) {
        return {
            valid: false,
            reasonCodes: ['config_malformed'],
            auditNotes: ['Denied: seller-wrapper config is malformed.'],
        };
    }
    if (sellerWrapperFixtureHasCredentialMaterial(config)) {
        reasonCodes.push('config_contains_credentials');
        auditNotes.push('Denied: generated config contains credential-like material.');
    }
    const auddRail = config.endpoints.flatMap((endpoint) => endpoint.rails).find((rail) => (rail.asset === 'AUDD' && rail.network === 'solana-devnet'));
    if (!auddRail) {
        reasonCodes.push('missing_audd_rail');
        auditNotes.push('Denied: AUDD solana-devnet rail is missing from generated config.');
    }
    else if (!auddRail.audd) {
        reasonCodes.push('missing_audd_payment_plan');
        auditNotes.push('Denied: AUDD payment-plan metadata is missing from generated config.');
    }
    if (config.buyerAuthorityPolicy?.policySchemaVersion !== BUYER_AUTHORITY_POLICY_SCHEMA_VERSION
        || config.buyerAuthorityPolicy.fixtureMatrixIssue !== 550
        || !buyerAuthorityFixtureMatrixMatches(config.buyerAuthorityPolicy)) {
        reasonCodes.push('missing_buyer_authority_policy');
        auditNotes.push('Denied: buyer authority policy contract metadata is missing from generated config.');
    }
    const missingHooks = config.endpoints.some((endpoint) => REQUIRED_WRAPPER_HOOKS.some((hook) => (typeof endpoint.wrapper[hook] !== 'string' || endpoint.wrapper[hook].trim().length === 0)));
    if (missingHooks) {
        reasonCodes.push('missing_wrapper_hooks');
        auditNotes.push('Denied: quote, policy, invocation, receipt, and evidence hooks are all required.');
    }
    if (config.endpoints.some((endpoint) => endpoint.rails.some((rail) => rail.livePaymentApproved))) {
        reasonCodes.push('live_payment_not_approved');
        auditNotes.push('Denied: generated examples must not approve live payment.');
    }
    if (config.endpoints.some((endpoint) => endpoint.rails.some((rail) => rail.runtimeState === 'live-payment-approved'))) {
        reasonCodes.push('live_payment_not_approved');
        auditNotes.push('Denied: generated examples must not mark runtime state as live-payment-approved.');
    }
    if (config.endpoints.some((endpoint) => endpoint.rails.some((rail) => rail.runtimeState === 'custody-supported'))) {
        reasonCodes.push('custody_claim_rejected');
        auditNotes.push('Denied: generated examples must not mark runtime state as custody-supported.');
    }
    if (textContains(config, LIVE_PAYMENT_INSTRUCTION_PATTERN)) {
        reasonCodes.push('live_payment_instruction_rejected');
        auditNotes.push('Denied: generated examples must not include wallet, RPC, signing, transfer, broadcast, or settlement instructions.');
    }
    if (textContains(config, CUSTODY_CLAIM_PATTERN)) {
        reasonCodes.push('custody_claim_rejected');
        auditNotes.push('Denied: generated examples must not claim AUDD/USDC/SOL custody.');
    }
    if (textContains(config, SETTLEMENT_FINALITY_PATTERN)) {
        reasonCodes.push('settlement_finality_claim_rejected');
        auditNotes.push('Denied: generated examples must not claim settlement finality.');
    }
    if (reasonCodes.length > 0) {
        return { valid: false, reasonCodes, auditNotes };
    }
    return {
        valid: true,
        reasonCodes: ['seller_wrapper_config_valid'],
        auditNotes: ['Allowed: seller-wrapper config examples are non-secret, no-spend, and include required wrapper hooks.'],
    };
}
export async function runSellerWrapperConfigNoSpendCheck(input = {}) {
    const fixture = input.fixture ?? sellerWrapperRailFixture;
    const config = generateSellerWrapperConfigExamples({ fixture });
    const validation = validateSellerWrapperConfigExamples(config);
    const auddFlow = await runAuddSellerWrapperNoSpendFlow({ fixture });
    return {
        config,
        validation,
        auddFlow,
        guardrails: config.guardrails,
    };
}
