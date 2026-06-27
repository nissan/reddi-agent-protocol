import { type FrameworkTemplateContract, type FrameworkTemplateFixture, type FrameworkTemplateMode, type FrameworkTemplateScenarioKind } from './framework-template-contract.js';
export declare const FRAMEWORK_TEMPLATE_CONFORMANCE_CHECK_VERSION: "reddi.framework-template-conformance.v1";
export type FrameworkTemplateConformanceCaseKind = `lifecycle:${FrameworkTemplateScenarioKind}` | `mode:${FrameworkTemplateMode}`;
export type FrameworkTemplateConformanceCase = {
    kind: FrameworkTemplateConformanceCaseKind;
    description: string;
    contract: FrameworkTemplateContract;
};
export type FrameworkTemplateConformanceReasonCode = 'framework_template_conformance_valid' | 'framework_template_contract_invalid' | 'framework_template_contains_credentials' | 'missing_required_lifecycle_fixture' | 'missing_required_profile_mode' | 'missing_agent_identity_fields' | 'missing_invocation_modes' | 'missing_mode_required_buyer_authority_policy' | 'missing_mode_required_seller_profile' | 'missing_receipt_evidence_refs' | 'missing_failure_refund_state' | 'unsafe_support_state_metadata' | 'live_boundary_rejected' | 'conformance_case_kind_mismatch';
export type FrameworkTemplateConformanceCaseResult = {
    kind: FrameworkTemplateConformanceCaseKind;
    valid: boolean;
    reasonCodes: FrameworkTemplateConformanceReasonCode[];
    contractReasonCodes: string[];
    auditNotes: string[];
};
export type FrameworkTemplateConformanceResult = {
    version: typeof FRAMEWORK_TEMPLATE_CONFORMANCE_CHECK_VERSION;
    issue: 553;
    valid: boolean;
    reasonCodes: FrameworkTemplateConformanceReasonCode[];
    checkedCases: FrameworkTemplateConformanceCaseResult[];
    requiredLifecycle: FrameworkTemplateScenarioKind[];
    requiredProfileModes: FrameworkTemplateMode[];
    downstreamIssues: {
        sharedContract: 552;
        langGraphTemplate: 544;
        strandsTemplate: 545;
        adkTemplate: 546;
        comparisonDocs: 547;
    };
    auditNotes: string[];
};
export declare function listFrameworkTemplateConformanceCases(input?: {
    lifecycleFixtures?: FrameworkTemplateFixture[];
}): FrameworkTemplateConformanceCase[];
export declare function runFrameworkTemplateNoLiveConformanceCheck(input?: {
    cases?: FrameworkTemplateConformanceCase[];
}): FrameworkTemplateConformanceResult;
