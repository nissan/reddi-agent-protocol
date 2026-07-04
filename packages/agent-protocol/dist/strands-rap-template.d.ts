import { type FrameworkTemplateContract, type FrameworkTemplateScenarioKind } from './framework-template-contract.js';
export declare const STRANDS_RAP_TEMPLATE_SCHEMA_VERSION: "reddi.strands-rap-template.v1";
export type StrandsRapTemplateScenario = 'allowed-no-live-invocation' | 'policy-denial' | 'missing-approval' | 'malformed-quote-payment-plan' | 'credential-shaped-output' | 'unsafe-live-custody-provider-claim';
export type StrandsRapToolStep = 'discover' | 'quote' | 'buyerPolicyPreflight' | 'operatorApproval' | 'invokePaidAgent' | 'bindReceiptEvidence' | 'sellerWrapperEndpoint';
export type StrandsRapTemplateState = {
    toolPluginId: string;
    scenario: StrandsRapTemplateScenario;
    steps: StrandsRapToolStep[];
    hooks: {
        buyerPolicy: boolean;
        receiptEvidence: boolean;
        sellerWrapper: boolean;
    };
    contracts: Record<FrameworkTemplateScenarioKind, FrameworkTemplateContract>;
    selectedContract: FrameworkTemplateContract;
    sellerWrapperEndpointHelper: {
        endpointId: string;
        quoteRoute: string;
        policyPreflightRoute: string;
        invocationRoute: string;
        receiptHook: string;
        evidenceHook: string;
    };
    toolState: {
        discoveryRef: string;
        quoteRef: string;
        buyerPolicyRef: string;
        operatorApprovalRef?: string;
        invocationRef?: string;
        receiptRef?: string;
        evidenceRef?: string;
        denialReasonCodes: string[];
        failureMode?: string;
    };
    expectedAllowed: boolean;
    notes: string[];
};
export type StrandsRapTemplateValidationReasonCode = 'strands_rap_template_valid' | 'strands_template_malformed' | 'framework_contract_invalid' | 'framework_conformance_invalid' | 'missing_required_tool_step' | 'missing_required_hook' | 'missing_seller_wrapper_endpoint_helper' | 'missing_receipt_evidence_refs' | 'missing_operator_approval' | 'malformed_quote_payment_plan' | 'template_contains_credentials' | 'unsafe_live_custody_provider_claim';
export type StrandsRapTemplateValidationResult = {
    valid: boolean;
    reasonCodes: StrandsRapTemplateValidationReasonCode[];
    auditNotes: string[];
};
export declare function createStrandsRapTemplateFixture(input?: {
    scenario?: StrandsRapTemplateScenario;
}): StrandsRapTemplateState;
export declare function validateStrandsRapTemplate(template: unknown): StrandsRapTemplateValidationResult;
