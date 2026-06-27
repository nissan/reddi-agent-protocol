import type { AuddSolanaPaymentPlan } from './audd-payment-plan.js';
import { BUYER_AUTHORITY_POLICY_SCHEMA_VERSION, type BuyerAuthorityPolicyExampleKey, type BuyerAuthorityPolicyReasonCode } from './buyer-authority-policy.js';
import { SELLER_WRAPPER_RAIL_FIXTURE_SCHEMA_VERSION, type SellerWrapperEndpointFixture, type SellerWrapperRailConfig, type SellerWrapperRailFixture, type SellerWrapperRailState } from './seller-wrapper-rail-fixtures.js';
export declare const SELLER_WRAPPER_CONFIG_SCHEMA_VERSION: "reddi.seller-wrapper-config.v1";
export type SellerWrapperRuntimeState = 'local-dry-run' | 'devnet-gated' | 'proof-metadata-only' | 'live-gated' | 'custody-supported' | 'unsupported' | 'live-payment-approved';
export type SellerWrapperRailConfigExample = {
    id: string;
    asset: SellerWrapperRailConfig['asset'];
    network: string;
    fixtureState: SellerWrapperRailState;
    runtimeState: SellerWrapperRuntimeState;
    amountUnits: string;
    payee: string;
    settlementAccount?: string;
    evidenceRequired: boolean;
    approvalRequired: boolean;
    livePaymentApproved: boolean;
    custodySupported: boolean;
    quote: {
        amount: string;
        expiresAt?: string;
        paymentMode: 'dry-run' | 'live';
    };
    audd?: {
        mint: string;
        failurePolicy: AuddSolanaPaymentPlan['failurePolicy'];
        refundPolicy: AuddSolanaPaymentPlan['refundPolicy'];
    };
    notes: string[];
};
export type SellerWrapperEndpointConfigExample = {
    kind: SellerWrapperEndpointFixture['kind'];
    endpointId: string;
    displayName: string;
    transport: SellerWrapperEndpointFixture['transport'];
    wrapper: {
        quoteRoute: string;
        policyPreflightRoute: string;
        invocationRoute: string;
        receiptHook: string;
        evidenceHook: string;
    };
    rails: SellerWrapperRailConfigExample[];
};
export type SellerWrapperBuyerAuthorityPolicyCase = {
    key: BuyerAuthorityPolicyExampleKey;
    expectedAllowed: boolean;
    expectedReasonCodes: BuyerAuthorityPolicyReasonCode[];
};
export type SellerWrapperBuyerAuthorityPolicyContract = {
    policySchemaVersion: typeof BUYER_AUTHORITY_POLICY_SCHEMA_VERSION;
    policyIssue: 549;
    fixtureMatrixIssue: 550;
    downstreamIssues: {
        sellerWrapperFeature: 375;
        frameworkTemplateContract: 543;
        frameworkTemplatesFeature: 542;
    };
    fields: readonly string[];
    lifecycle: readonly string[];
    fixtureStates: SellerWrapperBuyerAuthorityPolicyCase[];
    onboardingSurface: {
        displayStateLater: true;
        currentMode: 'api-contract-only';
        uiEvidenceRequiredWhenVisualized: true;
    };
    boundaries: {
        noPrivateKeys: true;
        noProviderCredentials: true;
        noSigningInstructions: true;
        noWalletRpcProviderCalls: true;
        noLivePaymentExecution: true;
        noCustodyClaims: true;
        noSettlementFinalityClaims: true;
    };
};
export type SellerWrapperConfigExamples = {
    schemaVersion: typeof SELLER_WRAPPER_CONFIG_SCHEMA_VERSION;
    issue: 535;
    sourceContract: SellerWrapperRailFixture['sourceContract'] & {
        configIssue: 535;
        railFixtureIssue: SellerWrapperRailFixture['issue'];
        railFixtureSchemaVersion: typeof SELLER_WRAPPER_RAIL_FIXTURE_SCHEMA_VERSION;
    };
    generatedMode: 'no-spend-config-examples';
    buyerAuthorityPolicy: SellerWrapperBuyerAuthorityPolicyContract;
    endpoints: SellerWrapperEndpointConfigExample[];
    guardrails: SellerWrapperRailFixture['guardrails'] & {
        noSecrets: true;
        noProviderCredentials: true;
        noLivePaymentInstructions: true;
    };
};
export type SellerWrapperConfigValidationReasonCode = 'seller_wrapper_config_valid' | 'config_malformed' | 'fixture_contains_credentials' | 'config_contains_credentials' | 'missing_audd_rail' | 'missing_audd_payment_plan' | 'missing_buyer_authority_policy' | 'missing_wrapper_hooks' | 'live_payment_not_approved' | 'live_payment_instruction_rejected' | 'custody_claim_rejected' | 'settlement_finality_claim_rejected';
export type SellerWrapperConfigValidationResult = {
    valid: boolean;
    reasonCodes: SellerWrapperConfigValidationReasonCode[];
    auditNotes: string[];
};
export declare function generateSellerWrapperConfigExamples(input?: {
    fixture?: SellerWrapperRailFixture;
}): SellerWrapperConfigExamples;
export declare function validateSellerWrapperConfigExamples(config: unknown): SellerWrapperConfigValidationResult;
export declare function runSellerWrapperConfigNoSpendCheck(input?: {
    fixture?: SellerWrapperRailFixture;
}): Promise<{
    config: SellerWrapperConfigExamples;
    validation: SellerWrapperConfigValidationResult;
    auddFlow: import("./seller-wrapper-rail-fixtures.js").AuddSellerWrapperNoSpendFlow;
    guardrails: {
        noSecrets: true;
        noLivePayment: true;
        noWalletSigning: true;
        noRpcCall: true;
        noCustodyClaim: true;
        noSettlementFinalityClaim: true;
    } & {
        noSecrets: true;
        noProviderCredentials: true;
        noLivePaymentInstructions: true;
    };
}>;
