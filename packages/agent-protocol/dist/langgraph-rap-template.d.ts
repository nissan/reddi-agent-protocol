import { type FrameworkTemplateContract, type FrameworkTemplateScenarioKind } from './framework-template-contract.js';
export declare const LANGGRAPH_RAP_TEMPLATE_SCHEMA_VERSION: "reddi.langgraph-rap-template.v1";
export type LangGraphRapTemplateScenario = 'allowed-no-live-invocation' | 'policy-denial' | 'missing-approval' | 'malformed-quote-payment-plan' | 'credential-shaped-output' | 'unsafe-live-custody-provider-claim';
export type LangGraphRapGraphNode = 'discover' | 'quote' | 'buyerPolicyPreflight' | 'operatorApproval' | 'invokePaidAgent' | 'bindReceiptEvidence' | 'sellerWrapperEndpoint';
export type LangGraphRapTemplateState = {
    graphId: string;
    scenario: LangGraphRapTemplateScenario;
    nodes: LangGraphRapGraphNode[];
    middleware: {
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
    graphState: {
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
export type LangGraphRapTemplateValidationReasonCode = 'langgraph_rap_template_valid' | 'langgraph_template_malformed' | 'framework_contract_invalid' | 'framework_conformance_invalid' | 'missing_required_graph_node' | 'missing_required_middleware' | 'missing_seller_wrapper_endpoint_helper' | 'missing_receipt_evidence_refs' | 'missing_operator_approval' | 'malformed_quote_payment_plan' | 'template_contains_credentials' | 'unsafe_live_custody_provider_claim';
export type LangGraphRapTemplateValidationResult = {
    valid: boolean;
    reasonCodes: LangGraphRapTemplateValidationReasonCode[];
    auditNotes: string[];
};
export declare function createLangGraphRapTemplateFixture(input?: {
    scenario?: LangGraphRapTemplateScenario;
}): LangGraphRapTemplateState;
export declare function validateLangGraphRapTemplate(template: unknown): LangGraphRapTemplateValidationResult;
