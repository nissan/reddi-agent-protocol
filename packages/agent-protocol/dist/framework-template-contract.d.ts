import { type BuyerAuthorityPolicyExampleKey, type BuyerAuthorityPolicyReasonCode } from './buyer-authority-policy.js';
import { type SellerWrapperBuyerAuthorityPolicyContract, type SellerWrapperConfigExamples } from './seller-wrapper-config.js';
export declare const FRAMEWORK_TEMPLATE_CONTRACT_SCHEMA_VERSION: "reddi.framework-template-contract.v1";
export type FrameworkTemplateId = 'generic' | 'langgraph' | 'strands' | 'adk';
export type FrameworkTemplateMode = 'buyer-enabled' | 'seller-enabled' | 'dual-mode';
export type FrameworkTemplateInvocationMode = 'http-openapi' | 'mcp' | 'a2a-agent-card' | 'local-fixture';
export type FrameworkTemplateScenarioKind = 'discovery' | 'quote' | 'preflight' | 'operator-approval' | 'invocation' | 'receipt-evidence' | 'denial' | 'failure';
export type FrameworkTemplateSupportState = 'fixture' | 'dry-run' | 'proof-metadata-only' | 'devnet-gated';
export type FrameworkTemplateAgentIdentity = {
    agentId: string;
    displayName: string;
    framework: FrameworkTemplateId;
    templateMode: FrameworkTemplateMode;
    capabilityTags: string[];
};
export type FrameworkTemplateSellerProfile = {
    sellerId: string;
    endpointId: string;
    endpointKind: 'http-openapi' | 'mcp' | 'a2a-agent-card';
    quoteRoute: string;
    policyPreflightRoute: string;
    invocationRoute: string;
    receiptHook: string;
    evidenceHook: string;
};
export type FrameworkTemplateExecutionResult = {
    status: 'not-run' | 'allowed' | 'denied' | 'failed';
    invocationId: string;
    outputRef?: string;
};
export type FrameworkTemplateReceiptEvidenceRefs = {
    receiptRequired: boolean;
    evidenceRequired: boolean;
    receiptRef?: string;
    evidenceRef?: string;
};
export type FrameworkTemplateFailureRefundState = {
    failureMode: 'no_charge_on_failure' | 'manual_review_required';
    refundMode: 'manual_review' | 'not_applicable';
    state: 'not-applicable' | 'blocked' | 'manual-review';
};
export type FrameworkTemplateSupportStateMetadata = {
    runtimeState: FrameworkTemplateSupportState;
    livePaymentApproved: false;
    walletRpcProviderCalls: false;
    custodySupported: false;
    settlementFinalityClaimed: false;
};
export type FrameworkTemplateBuyerAuthorityCase = {
    key: BuyerAuthorityPolicyExampleKey;
    expectedAllowed: boolean;
    expectedReasonCodes: BuyerAuthorityPolicyReasonCode[];
};
export type FrameworkTemplateContract = {
    schemaVersion: typeof FRAMEWORK_TEMPLATE_CONTRACT_SCHEMA_VERSION;
    issue: 552;
    parentIssues: {
        frameworkTemplateContract: 543;
        frameworkTemplatesFeature: 542;
        buyerAuthority: 548;
        productCore: 334;
        railNeutralPayments: 338;
    };
    agentIdentity: FrameworkTemplateAgentIdentity;
    invocationModes: FrameworkTemplateInvocationMode[];
    sellerProfile?: FrameworkTemplateSellerProfile;
    buyerAuthorityPolicy?: SellerWrapperBuyerAuthorityPolicyContract;
    buyerAuthorityCases: FrameworkTemplateBuyerAuthorityCase[];
    executionResult: FrameworkTemplateExecutionResult;
    receiptEvidenceRefs: FrameworkTemplateReceiptEvidenceRefs;
    failureRefundState: FrameworkTemplateFailureRefundState;
    supportStateMetadata: FrameworkTemplateSupportStateMetadata;
    sourceContracts: {
        sellerWrapperConfigSchemaVersion: SellerWrapperConfigExamples['schemaVersion'];
        buyerAuthorityPolicySchemaVersion: SellerWrapperBuyerAuthorityPolicyContract['policySchemaVersion'];
        buyerAuthorityFixtureMatrixIssue: 550;
    };
    downstreamConsumption: {
        langGraphIssue: 544;
        strandsIssue: 545;
        adkIssue: 546;
        comparisonDocsIssue: 547;
    };
    notes: string[];
};
export type FrameworkTemplateFixture = {
    kind: FrameworkTemplateScenarioKind;
    description: string;
    contract: FrameworkTemplateContract;
    expectedValid: boolean;
    expectedReasonCodes: FrameworkTemplateValidationReasonCode[];
};
export type FrameworkTemplateValidationReasonCode = 'framework_template_contract_valid' | 'framework_template_contract_malformed' | 'framework_template_contains_credentials' | 'buyer_authority_matrix_mismatch' | 'seller_wrapper_contract_invalid' | 'unsupported_framework_mode' | 'unsafe_support_state' | 'live_payment_rejected' | 'wallet_rpc_provider_call_rejected' | 'custody_claim_rejected' | 'settlement_finality_claim_rejected' | 'missing_receipt_evidence_refs' | 'missing_failure_refund_state';
export type FrameworkTemplateValidationResult = {
    valid: boolean;
    reasonCodes: FrameworkTemplateValidationReasonCode[];
    auditNotes: string[];
};
export declare const frameworkTemplateFixtures: Record<FrameworkTemplateScenarioKind, FrameworkTemplateFixture>;
export declare function listFrameworkTemplateFixtures(): FrameworkTemplateFixture[];
export declare function validateFrameworkTemplateContract(contract: unknown): FrameworkTemplateValidationResult;
