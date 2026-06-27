import { sellerWrapperFixtureHasCredentialMaterial } from './seller-wrapper-rail-fixtures.js';
export const BUYER_AUTHORITY_POLICY_SCHEMA_VERSION = 'reddi.buyer-authority-policy.v1';
const BASE_EXPIRES_AT = '2026-07-01T00:00:00.000Z';
const DEFAULT_REQUEST = {
    sellerId: 'seller:listing-writer',
    endpointId: 'seller-wrapper:listing-writer:http',
    asset: 'AUDD',
    network: 'solana-devnet',
    amountUnits: '2500000',
    supportState: 'proof-metadata-only',
    receiptPresented: true,
    evidencePresented: true,
    now: '2026-06-27T00:00:00.000Z',
    operatorApprovalState: 'approved',
};
const UNSAFE_LIVE_PATTERN = /\bhttps?:\/\/[^\s"]*(rpc|alchemy|helius|quicknode|api\.(mainnet-beta|devnet|testnet)\.solana\.com)[^\s"]*|\b(provider\s+credential|wallet\s+sign|signing\s+authority)\b/i;
const TRANSFER_INSTRUCTION_PATTERN = /\b(submit|sign|transfer|broadcast)\b.*\b(transaction|payment|audd|usdc|sol)\b/i;
const CUSTODY_CLAIM_PATTERN = /\b(audd|usdc|sol)\b.*\b(custody|custodied|escrowed|held)\b|\bheld\s+in\s+custody\b/i;
const SETTLEMENT_FINALITY_PATTERN = /\bsettlement\s+finality\b|\bfinal\s+settlement\b/i;
const KNOWN_SUPPORT_STATES = [
    'fixture',
    'dry-run',
    'proof-metadata-only',
    'devnet-gated',
    'live-gated',
];
function basePolicy(overrides = {}) {
    return {
        schemaVersion: BUYER_AUTHORITY_POLICY_SCHEMA_VERSION,
        issue: 549,
        policyId: 'buyer-authority:listing-writer:audd',
        mode: 'allow',
        buyerAgentId: 'buyer-agent:planning-demo',
        expiresAt: BASE_EXPIRES_AT,
        allowedRails: [
            {
                asset: 'AUDD',
                network: 'solana-devnet',
                supportStates: ['proof-metadata-only', 'dry-run'],
            },
            {
                asset: 'USDC',
                network: 'solana-devnet',
                supportStates: ['dry-run'],
            },
            {
                asset: 'SOL',
                network: 'solana-devnet',
                supportStates: ['devnet-gated'],
            },
        ],
        allowedCurrencies: ['AUDD', 'USDC', 'SOL'],
        spendCaps: [
            {
                asset: 'AUDD',
                network: 'solana-devnet',
                maxAmountUnits: '2500000',
                window: 'per_request',
                approvalRequiredAboveUnits: '1000000',
            },
        ],
        sellerAllowlist: {
            sellerIds: ['seller:listing-writer'],
            endpointIds: ['seller-wrapper:listing-writer:http'],
        },
        receiptEvidence: {
            receiptRequired: true,
            evidenceRequired: true,
            evidenceArchiveRequired: true,
        },
        refundFailurePolicy: {
            failureMode: 'no_charge_on_failure',
            refundMode: 'manual_review',
            operatorReviewRequired: true,
        },
        operatorApproval: {
            required: true,
            approvalState: 'approved',
            thresholdAmountUnits: '1000000',
        },
        supportStateConstraints: {
            allowLivePayment: false,
            allowedRuntimeStates: ['proof-metadata-only', 'dry-run', 'devnet-gated'],
            forbidCustody: true,
            forbidSettlementFinality: true,
        },
        notes: [
            'AUDD, SOL, and USDC are proof/preflight metadata in this policy.',
            'Live settlement requires a separate approved and audited workstream.',
        ],
        ...overrides,
    };
}
function clonePolicy(policy) {
    return structuredClone(policy);
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
function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
function isStringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
function hasOnlyKnownSupportStates(value) {
    return isStringArray(value) && value.every((state) => (KNOWN_SUPPORT_STATES.includes(state)));
}
function isStructuredPolicy(value) {
    if (!isRecord(value))
        return false;
    const candidate = value;
    const sellerAllowlist = candidate.sellerAllowlist;
    const receiptEvidence = candidate.receiptEvidence;
    const refundFailurePolicy = candidate.refundFailurePolicy;
    const operatorApproval = candidate.operatorApproval;
    const supportStateConstraints = candidate.supportStateConstraints;
    return candidate.schemaVersion === BUYER_AUTHORITY_POLICY_SCHEMA_VERSION
        && candidate.issue === 549
        && typeof candidate.policyId === 'string'
        && typeof candidate.buyerAgentId === 'string'
        && typeof candidate.expiresAt === 'string'
        && candidate.mode !== undefined
        && ['allow', 'deny', 'approval-required'].includes(candidate.mode)
        && Array.isArray(candidate.allowedRails)
        && candidate.allowedRails.every((rail) => isRecord(rail)
            && ['SOL', 'USDC', 'AUDD'].includes(String(rail.asset))
            && typeof rail.network === 'string'
            && hasOnlyKnownSupportStates(rail.supportStates))
        && Array.isArray(candidate.allowedCurrencies)
        && candidate.allowedCurrencies.every((asset) => ['SOL', 'USDC', 'AUDD'].includes(asset))
        && Array.isArray(candidate.spendCaps)
        && candidate.spendCaps.every((cap) => isRecord(cap)
            && ['SOL', 'USDC', 'AUDD'].includes(String(cap.asset))
            && typeof cap.network === 'string'
            && typeof cap.maxAmountUnits === 'string'
            && ['per_request', 'daily', 'monthly'].includes(String(cap.window)))
        && isRecord(sellerAllowlist)
        && isStringArray(sellerAllowlist.sellerIds)
        && isStringArray(sellerAllowlist.endpointIds)
        && isRecord(receiptEvidence)
        && typeof receiptEvidence.receiptRequired === 'boolean'
        && typeof receiptEvidence.evidenceRequired === 'boolean'
        && typeof receiptEvidence.evidenceArchiveRequired === 'boolean'
        && isRecord(refundFailurePolicy)
        && ['no_charge_on_failure', 'manual_review_required'].includes(String(refundFailurePolicy.failureMode))
        && ['manual_review', 'not_applicable'].includes(String(refundFailurePolicy.refundMode))
        && typeof refundFailurePolicy.operatorReviewRequired === 'boolean'
        && isRecord(operatorApproval)
        && typeof operatorApproval.required === 'boolean'
        && ['approved', 'denied', 'requires_operator_approval', 'not_required'].includes(String(operatorApproval.approvalState))
        && isRecord(supportStateConstraints)
        && typeof supportStateConstraints.allowLivePayment === 'boolean'
        && hasOnlyKnownSupportStates(supportStateConstraints.allowedRuntimeStates)
        && typeof supportStateConstraints.forbidCustody === 'boolean'
        && typeof supportStateConstraints.forbidSettlementFinality === 'boolean'
        && isStringArray(candidate.notes);
}
function amountGreaterThan(amount, maxAmount) {
    try {
        return BigInt(amount) > BigInt(maxAmount);
    }
    catch {
        return true;
    }
}
function policyMatchesRail(policy, request) {
    return policy.allowedRails.some((rail) => (rail.asset === request.asset
        && rail.network === request.network
        && rail.supportStates.includes(request.supportState)));
}
function policySpendCap(policy, request) {
    return policy.spendCaps.find((cap) => (cap.asset === request.asset && cap.network === request.network && cap.window === 'per_request'));
}
export function validateBuyerAuthorityPolicy(policy) {
    if (!isStructuredPolicy(policy)) {
        return {
            allowed: false,
            reasonCodes: ['policy_malformed'],
            auditNotes: ['Denied: buyer authority policy is malformed.'],
        };
    }
    const reasonCodes = [];
    const auditNotes = [];
    if (sellerWrapperFixtureHasCredentialMaterial(policy)) {
        reasonCodes.push('policy_contains_credentials');
        auditNotes.push('Denied: buyer authority policy contains credential-like material.');
    }
    if (policy.supportStateConstraints.allowLivePayment) {
        reasonCodes.push('live_payment_rejected');
        auditNotes.push('Denied: #549 policies must not approve live payment.');
    }
    if (!policy.supportStateConstraints.forbidCustody) {
        reasonCodes.push('custody_claim_rejected');
        auditNotes.push('Denied: #549 policies must forbid custody.');
    }
    if (!policy.supportStateConstraints.forbidSettlementFinality) {
        reasonCodes.push('settlement_finality_claim_rejected');
        auditNotes.push('Denied: #549 policies must forbid settlement finality claims.');
    }
    if (policy.supportStateConstraints.allowedRuntimeStates.includes('live-gated')
        || policy.allowedRails.some((rail) => rail.supportStates.includes('live-gated'))) {
        reasonCodes.push('live_payment_rejected');
        auditNotes.push('Denied: #549 policies must not include live-gated support states.');
    }
    if (textContains(policy, UNSAFE_LIVE_PATTERN)) {
        reasonCodes.push('wallet_rpc_provider_call_rejected');
        auditNotes.push('Denied: policy contains wallet/RPC/provider-call material.');
    }
    if (textContains(policy, TRANSFER_INSTRUCTION_PATTERN)) {
        reasonCodes.push('transfer_instruction_rejected');
        auditNotes.push('Denied: policy contains signing, broadcast, or transfer instructions.');
    }
    if (textContains(policy, CUSTODY_CLAIM_PATTERN)) {
        reasonCodes.push('custody_claim_rejected');
        auditNotes.push('Denied: policy must not claim custody.');
    }
    if (textContains(policy, SETTLEMENT_FINALITY_PATTERN)) {
        reasonCodes.push('settlement_finality_claim_rejected');
        auditNotes.push('Denied: policy must not claim settlement finality.');
    }
    if (reasonCodes.length > 0)
        return { allowed: false, reasonCodes, auditNotes };
    return {
        allowed: true,
        reasonCodes: ['buyer_authority_policy_valid'],
        auditNotes: ['Allowed: buyer authority policy is static, non-secret, no-spend, and no-live.'],
    };
}
export function evaluateBuyerAuthorityPolicy(policy, request) {
    const structural = validateBuyerAuthorityPolicy(policy);
    if (!structural.allowed || !isStructuredPolicy(policy))
        return structural;
    const reasonCodes = [];
    const auditNotes = [];
    if (policy.mode === 'deny') {
        reasonCodes.push('policy_denied');
        auditNotes.push('Denied: policy mode is deny.');
    }
    if (new Date(request.now).getTime() > new Date(policy.expiresAt).getTime()) {
        reasonCodes.push('policy_expired');
        auditNotes.push('Denied: buyer authority policy has expired.');
    }
    const railCurrencySupported = policy.allowedCurrencies.includes(request.asset)
        && policyMatchesRail(policy, request);
    if (!railCurrencySupported) {
        reasonCodes.push('unsupported_rail_currency');
        auditNotes.push('Denied: requested rail, currency, network, or support state is not allowed.');
    }
    if (!policy.sellerAllowlist.sellerIds.includes(request.sellerId)
        || !policy.sellerAllowlist.endpointIds.includes(request.endpointId)) {
        reasonCodes.push('seller_not_allowlisted');
        auditNotes.push('Denied: requested seller or endpoint is not allowlisted.');
    }
    const cap = policySpendCap(policy, request);
    if (railCurrencySupported && (!cap || amountGreaterThan(request.amountUnits, cap.maxAmountUnits))) {
        reasonCodes.push('spend_cap_exceeded');
        auditNotes.push('Denied: requested amount exceeds the per-request spend cap.');
    }
    if (policy.receiptEvidence.receiptRequired && !request.receiptPresented) {
        reasonCodes.push('receipt_requirement_missing');
        auditNotes.push('Denied: receipt requirement was not satisfied.');
    }
    if ((policy.receiptEvidence.evidenceRequired || policy.receiptEvidence.evidenceArchiveRequired) && !request.evidencePresented) {
        reasonCodes.push('evidence_requirement_missing');
        auditNotes.push('Denied: evidence requirement was not satisfied.');
    }
    if ((request.failureMode !== undefined && request.failureMode !== policy.refundFailurePolicy.failureMode)
        || (request.refundMode !== undefined && request.refundMode !== policy.refundFailurePolicy.refundMode)) {
        reasonCodes.push('refund_failure_policy_mismatch');
        auditNotes.push('Denied: requested refund/failure handling does not match the buyer authority policy.');
    }
    const approvalState = request.operatorApprovalState ?? policy.operatorApproval.approvalState;
    if (policy.mode === 'approval-required' || policy.operatorApproval.required) {
        if (approvalState === 'denied') {
            reasonCodes.push('operator_approval_denied');
            auditNotes.push('Denied: operator approval was denied.');
        }
        else if (approvalState !== 'approved') {
            reasonCodes.push('operator_approval_required');
            auditNotes.push('Denied: operator approval is required before invocation.');
        }
    }
    if (reasonCodes.length > 0)
        return { allowed: false, reasonCodes, auditNotes };
    return {
        allowed: true,
        reasonCodes: ['buyer_authority_policy_valid'],
        auditNotes: ['Allowed: request satisfies buyer authority policy in no-live fixture mode.'],
    };
}
const allowPolicy = basePolicy();
const denyPolicy = basePolicy({ policyId: 'buyer-authority:deny-all', mode: 'deny' });
const expiredPolicy = basePolicy({ policyId: 'buyer-authority:expired', expiresAt: '2026-06-01T00:00:00.000Z' });
const approvalRequiredPolicy = basePolicy({
    policyId: 'buyer-authority:approval-required',
    mode: 'approval-required',
    operatorApproval: {
        required: true,
        approvalState: 'requires_operator_approval',
        thresholdAmountUnits: '1000000',
    },
});
const unsupportedRailPolicy = basePolicy({ policyId: 'buyer-authority:unsupported-rail' });
const unsupportedCurrencyPolicy = basePolicy({ policyId: 'buyer-authority:unsupported-currency' });
const sellerNotAllowlistedPolicy = basePolicy({ policyId: 'buyer-authority:seller-not-allowlisted' });
const missingReceiptPolicy = basePolicy({ policyId: 'buyer-authority:missing-receipt' });
const missingEvidencePolicy = basePolicy({ policyId: 'buyer-authority:missing-evidence' });
const refundFailureMismatchPolicy = basePolicy({ policyId: 'buyer-authority:refund-failure-mismatch' });
const spendCapExceededPolicy = basePolicy({ policyId: 'buyer-authority:spend-cap-exceeded' });
export const buyerAuthorityPolicyExamples = {
    allow: {
        key: 'allow',
        description: 'Allows AUDD proof/preflight metadata when seller, rail, approval, receipt, and evidence requirements are satisfied.',
        policy: allowPolicy,
        request: DEFAULT_REQUEST,
        expectedAllowed: true,
        expectedReasonCodes: ['buyer_authority_policy_valid'],
    },
    deny: {
        key: 'deny',
        description: 'Denies all invocation attempts while keeping policy shape valid and non-secret.',
        policy: denyPolicy,
        request: DEFAULT_REQUEST,
        expectedAllowed: false,
        expectedReasonCodes: ['policy_denied'],
    },
    expired: {
        key: 'expired',
        description: 'Denies when the buyer authority policy is past its expiry.',
        policy: expiredPolicy,
        request: DEFAULT_REQUEST,
        expectedAllowed: false,
        expectedReasonCodes: ['policy_expired'],
    },
    approvalRequired: {
        key: 'approvalRequired',
        description: 'Denies until operator approval is supplied for spend above the approval threshold.',
        policy: approvalRequiredPolicy,
        request: {
            ...DEFAULT_REQUEST,
            operatorApprovalState: 'requires_operator_approval',
        },
        expectedAllowed: false,
        expectedReasonCodes: ['operator_approval_required'],
    },
    unsupportedRail: {
        key: 'unsupportedRail',
        description: 'Denies unsupported network or support-state combinations for an otherwise allowed currency.',
        policy: unsupportedRailPolicy,
        request: {
            ...DEFAULT_REQUEST,
            network: 'solana-mainnet',
        },
        expectedAllowed: false,
        expectedReasonCodes: ['unsupported_rail_currency'],
    },
    unsupportedCurrency: {
        key: 'unsupportedCurrency',
        description: 'Denies unsupported currencies even when the request otherwise resembles an allowed rail.',
        policy: unsupportedCurrencyPolicy,
        request: {
            ...DEFAULT_REQUEST,
            asset: 'EURC',
        },
        expectedAllowed: false,
        expectedReasonCodes: ['unsupported_rail_currency'],
    },
    sellerNotAllowlisted: {
        key: 'sellerNotAllowlisted',
        description: 'Denies when a seller or endpoint is outside the allowlist.',
        policy: sellerNotAllowlistedPolicy,
        request: {
            ...DEFAULT_REQUEST,
            sellerId: 'seller:unknown',
            endpointId: 'seller-wrapper:unknown:http',
        },
        expectedAllowed: false,
        expectedReasonCodes: ['seller_not_allowlisted'],
    },
    missingReceiptRequirement: {
        key: 'missingReceiptRequirement',
        description: 'Denies when receipt requirements are not satisfied.',
        policy: missingReceiptPolicy,
        request: {
            ...DEFAULT_REQUEST,
            receiptPresented: false,
        },
        expectedAllowed: false,
        expectedReasonCodes: ['receipt_requirement_missing'],
    },
    missingEvidenceRequirement: {
        key: 'missingEvidenceRequirement',
        description: 'Denies when evidence requirements are not satisfied.',
        policy: missingEvidencePolicy,
        request: {
            ...DEFAULT_REQUEST,
            evidencePresented: false,
        },
        expectedAllowed: false,
        expectedReasonCodes: ['evidence_requirement_missing'],
    },
    refundFailurePolicyMismatch: {
        key: 'refundFailurePolicyMismatch',
        description: 'Denies when requested failure/refund semantics do not match the policy.',
        policy: refundFailureMismatchPolicy,
        request: {
            ...DEFAULT_REQUEST,
            failureMode: 'manual_review_required',
            refundMode: 'not_applicable',
        },
        expectedAllowed: false,
        expectedReasonCodes: ['refund_failure_policy_mismatch'],
    },
    spendCapExceeded: {
        key: 'spendCapExceeded',
        description: 'Denies when requested spend exceeds the per-request cap.',
        policy: spendCapExceededPolicy,
        request: {
            ...DEFAULT_REQUEST,
            amountUnits: '2500001',
        },
        expectedAllowed: false,
        expectedReasonCodes: ['spend_cap_exceeded'],
    },
};
export function listBuyerAuthorityPolicyExamples() {
    return Object.values(buyerAuthorityPolicyExamples).map((example) => ({
        ...example,
        policy: clonePolicy(example.policy),
        request: structuredClone(example.request),
    }));
}
export function listBuyerAuthorityPolicyFixtureMatrix() {
    return listBuyerAuthorityPolicyExamples();
}
