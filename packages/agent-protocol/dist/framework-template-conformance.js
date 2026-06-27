import { frameworkTemplateFixtures, listFrameworkTemplateFixtures, validateFrameworkTemplateContract, } from './framework-template-contract.js';
import { sellerWrapperFixtureHasCredentialMaterial } from './seller-wrapper-rail-fixtures.js';
export const FRAMEWORK_TEMPLATE_CONFORMANCE_CHECK_VERSION = 'reddi.framework-template-conformance.v1';
const REQUIRED_LIFECYCLE = [
    'discovery',
    'quote',
    'preflight',
    'operator-approval',
    'invocation',
    'receipt-evidence',
    'denial',
    'failure',
];
const REQUIRED_PROFILE_MODES = ['buyer-enabled', 'seller-enabled', 'dual-mode'];
const SAFE_SUPPORT_STATES = ['fixture', 'dry-run', 'proof-metadata-only', 'devnet-gated'];
function cloneContract(contract) {
    return structuredClone(contract);
}
function modeCase(mode) {
    const contract = cloneContract(frameworkTemplateFixtures.invocation.contract);
    contract.agentIdentity.templateMode = mode;
    if (mode === 'buyer-enabled')
        contract.sellerProfile = undefined;
    if (mode === 'seller-enabled')
        contract.buyerAuthorityPolicy = undefined;
    return {
        kind: `mode:${mode}`,
        description: `${mode} profile contract conformance case.`,
        contract,
    };
}
export function listFrameworkTemplateConformanceCases(input = {}) {
    const lifecycleFixtures = input.lifecycleFixtures ?? listFrameworkTemplateFixtures();
    return [
        ...lifecycleFixtures.map((fixture) => ({
            kind: `lifecycle:${fixture.kind}`,
            description: fixture.description,
            contract: cloneContract(fixture.contract),
        })),
        ...REQUIRED_PROFILE_MODES.map(modeCase),
    ];
}
function addUnique(items, item) {
    if (!items.includes(item))
        items.push(item);
}
function hasNonEmptyStrings(values) {
    return Array.isArray(values) && values.length > 0 && values.every((item) => typeof item === 'string' && item.trim().length > 0);
}
function requiredFieldsForMode(contract, reasonCodes, auditNotes) {
    const mode = contract.agentIdentity.templateMode;
    if ((mode === 'buyer-enabled' || mode === 'dual-mode') && !contract.buyerAuthorityPolicy) {
        addUnique(reasonCodes, 'missing_mode_required_buyer_authority_policy');
        auditNotes.push(`Denied: ${mode} profile requires buyer authority policy metadata.`);
    }
    if ((mode === 'seller-enabled' || mode === 'dual-mode') && !contract.sellerProfile) {
        addUnique(reasonCodes, 'missing_mode_required_seller_profile');
        auditNotes.push(`Denied: ${mode} profile requires seller profile metadata.`);
    }
}
function boundaryFieldsAreExplicitFalse(contract) {
    return contract.supportStateMetadata.livePaymentApproved === false
        && contract.supportStateMetadata.walletRpcProviderCalls === false
        && contract.supportStateMetadata.custodySupported === false
        && contract.supportStateMetadata.settlementFinalityClaimed === false;
}
function canonicalLifecycleContract(kind) {
    if (!kind.startsWith('lifecycle:'))
        return undefined;
    const lifecycleKind = kind.slice('lifecycle:'.length);
    return frameworkTemplateFixtures[lifecycleKind]?.contract;
}
function contractsMatchCanonicalLifecycle(kind, contract) {
    const canonical = canonicalLifecycleContract(kind);
    if (!canonical)
        return true;
    return JSON.stringify(contract) === JSON.stringify(canonical);
}
function modeMatchesKind(kind, contract) {
    if (!kind.startsWith('mode:'))
        return true;
    return contract.agentIdentity.templateMode === kind.slice('mode:'.length);
}
function evaluateCase(item) {
    const reasonCodes = [];
    const auditNotes = [];
    const validation = validateFrameworkTemplateContract(item.contract);
    if (!validation.valid) {
        addUnique(reasonCodes, 'framework_template_contract_invalid');
        auditNotes.push(...validation.auditNotes);
    }
    if (sellerWrapperFixtureHasCredentialMaterial(item.contract)) {
        addUnique(reasonCodes, 'framework_template_contains_credentials');
        auditNotes.push('Denied: conformance case contains credential-shaped material.');
    }
    if (!contractsMatchCanonicalLifecycle(item.kind, item.contract)) {
        addUnique(reasonCodes, 'conformance_case_kind_mismatch');
        auditNotes.push(`Denied: ${item.kind} must match the canonical #552 lifecycle fixture.`);
    }
    if (!modeMatchesKind(item.kind, item.contract)) {
        addUnique(reasonCodes, 'conformance_case_kind_mismatch');
        auditNotes.push(`Denied: ${item.kind} must match contract agentIdentity.templateMode.`);
    }
    if (!item.contract.agentIdentity.agentId.trim()
        || !item.contract.agentIdentity.displayName.trim()
        || !hasNonEmptyStrings(item.contract.agentIdentity.capabilityTags)) {
        addUnique(reasonCodes, 'missing_agent_identity_fields');
        auditNotes.push('Denied: agent identity requires id, display name, and capability tags.');
    }
    if (!hasNonEmptyStrings(item.contract.invocationModes)) {
        addUnique(reasonCodes, 'missing_invocation_modes');
        auditNotes.push('Denied: at least one invocation mode is required.');
    }
    requiredFieldsForMode(item.contract, reasonCodes, auditNotes);
    if (item.contract.executionResult.status === 'allowed') {
        if (item.contract.receiptEvidenceRefs.receiptRequired && !item.contract.receiptEvidenceRefs.receiptRef) {
            addUnique(reasonCodes, 'missing_receipt_evidence_refs');
            auditNotes.push('Denied: allowed conformance case requires receipt ref.');
        }
        if (item.contract.receiptEvidenceRefs.evidenceRequired && !item.contract.receiptEvidenceRefs.evidenceRef) {
            addUnique(reasonCodes, 'missing_receipt_evidence_refs');
            auditNotes.push('Denied: allowed conformance case requires evidence ref.');
        }
    }
    if (!item.contract.failureRefundState.failureMode || !item.contract.failureRefundState.refundMode || !item.contract.failureRefundState.state) {
        addUnique(reasonCodes, 'missing_failure_refund_state');
        auditNotes.push('Denied: failure/refund state requires mode and state fields.');
    }
    if (!SAFE_SUPPORT_STATES.includes(item.contract.supportStateMetadata.runtimeState) || !boundaryFieldsAreExplicitFalse(item.contract)) {
        addUnique(reasonCodes, 'unsafe_support_state_metadata');
        auditNotes.push('Denied: support-state metadata must be safe and all live boundary fields must be explicitly false.');
    }
    if (item.contract.supportStateMetadata.livePaymentApproved
        || item.contract.supportStateMetadata.walletRpcProviderCalls
        || item.contract.supportStateMetadata.custodySupported
        || item.contract.supportStateMetadata.settlementFinalityClaimed) {
        addUnique(reasonCodes, 'live_boundary_rejected');
        auditNotes.push('Denied: live payment, wallet/RPC/provider, custody, and settlement-finality boundaries must stay false.');
    }
    if (reasonCodes.length === 0) {
        return {
            kind: item.kind,
            valid: true,
            reasonCodes: ['framework_template_conformance_valid'],
            contractReasonCodes: validation.reasonCodes,
            auditNotes: ['Allowed: framework-template conformance case is local, static, no-secret, and no-live.'],
        };
    }
    return {
        kind: item.kind,
        valid: false,
        reasonCodes,
        contractReasonCodes: validation.reasonCodes,
        auditNotes,
    };
}
export function runFrameworkTemplateNoLiveConformanceCheck(input = {}) {
    const cases = input.cases ?? listFrameworkTemplateConformanceCases();
    const checkedCases = cases.map(evaluateCase);
    const reasonCodes = [];
    const lifecycleKinds = new Set(cases.map((item) => item.kind));
    const profileKinds = new Set(cases.map((item) => item.kind));
    for (const lifecycle of REQUIRED_LIFECYCLE) {
        if (!lifecycleKinds.has(`lifecycle:${lifecycle}`))
            addUnique(reasonCodes, 'missing_required_lifecycle_fixture');
    }
    for (const mode of REQUIRED_PROFILE_MODES) {
        if (!profileKinds.has(`mode:${mode}`))
            addUnique(reasonCodes, 'missing_required_profile_mode');
    }
    for (const caseResult of checkedCases) {
        for (const reason of caseResult.reasonCodes) {
            if (reason !== 'framework_template_conformance_valid')
                addUnique(reasonCodes, reason);
        }
    }
    const valid = reasonCodes.length === 0;
    return {
        version: FRAMEWORK_TEMPLATE_CONFORMANCE_CHECK_VERSION,
        issue: 553,
        valid,
        reasonCodes: valid ? ['framework_template_conformance_valid'] : reasonCodes,
        checkedCases,
        requiredLifecycle: [...REQUIRED_LIFECYCLE],
        requiredProfileModes: [...REQUIRED_PROFILE_MODES],
        downstreamIssues: {
            sharedContract: 552,
            langGraphTemplate: 544,
            strandsTemplate: 545,
            adkTemplate: 546,
            comparisonDocs: 547,
        },
        auditNotes: valid
            ? ['Allowed: all framework-template conformance cases passed local no-live checks.']
            : ['Denied: one or more framework-template conformance cases failed local no-live checks.'],
    };
}
