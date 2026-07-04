import { type FrameworkTemplateContract, type FrameworkTemplateId, type FrameworkTemplateScenarioKind, type FrameworkTemplateSupportState } from './framework-template-contract.js';
export declare const ADK_RAP_TEMPLATE_SCHEMA_VERSION: "reddi.adk-rap-template.v1";
export declare const ADK_RAP_TEMPLATE_FRAMEWORK: FrameworkTemplateId;
export type AdkRapTemplateScenario = 'allowed-no-live-invocation' | 'policy-denial' | 'missing-approval' | 'malformed-quote-payment-plan' | 'credential-shaped-output' | 'unsafe-live-custody-provider-claim';
export type AdkRapAgentSkillId = 'rap.discover' | 'rap.quote' | 'rap.buyer-policy-preflight' | 'rap.operator-approval' | 'rap.invoke-paid-agent' | 'rap.bind-receipt-evidence' | 'rap.seller-wrapper-endpoint';
export type AdkRapAgentSkill = {
    id: AdkRapAgentSkillId;
    name: string;
    description: string;
    tags: string[];
};
export type AdkA2aAgentCard = {
    schemaProfile: 'a2a-agent-card';
    framework: FrameworkTemplateId;
    protocolVersion: string;
    name: string;
    description: string;
    preferredTransport: 'a2a-agent-card';
    capabilities: {
        streaming: false;
        pushNotifications: false;
        stateTransitionHistory: false;
    };
    skills: AdkRapAgentSkill[];
    rapExtension: {
        extensionId: string;
        discoveryRoute: string;
        quoteRoute: string;
        policyPreflightRoute: string;
        invocationRoute: string;
        receiptHook: string;
        evidenceHook: string;
        supportState: FrameworkTemplateSupportState;
        livePaymentApproved: false;
    };
};
export type AdkRapTemplateState = {
    cardId: string;
    scenario: AdkRapTemplateScenario;
    agentCard: AdkA2aAgentCard;
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
    cardState: {
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
export type AdkRapTemplateValidationReasonCode = 'adk_rap_template_valid' | 'adk_template_malformed' | 'framework_contract_invalid' | 'framework_conformance_invalid' | 'missing_required_agent_skill' | 'missing_required_middleware' | 'missing_seller_wrapper_endpoint_helper' | 'missing_agent_card_rap_extension' | 'missing_receipt_evidence_refs' | 'missing_operator_approval' | 'malformed_quote_payment_plan' | 'template_contains_credentials' | 'unsafe_live_custody_provider_claim';
export type AdkRapTemplateValidationResult = {
    valid: boolean;
    reasonCodes: AdkRapTemplateValidationReasonCode[];
    auditNotes: string[];
};
/**
 * Returns a clone of the shared #552 invocation contract re-framed for ADK. Consumers use this
 * to prove `validateFrameworkTemplateContract` passes for framework kind 'adk' without redefining
 * any buyer-authority, receipt/evidence, support-state, or no-live semantics.
 */
export declare function createAdkFrameworkTemplateContract(): FrameworkTemplateContract;
export declare function createAdkRapTemplateFixture(input?: {
    scenario?: AdkRapTemplateScenario;
}): AdkRapTemplateState;
export declare function validateAdkRapTemplate(template: unknown): AdkRapTemplateValidationResult;
