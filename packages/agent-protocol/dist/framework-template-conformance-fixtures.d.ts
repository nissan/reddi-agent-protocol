import { type FrameworkTemplateContract, type FrameworkTemplateScenarioKind } from './framework-template-contract.js';
import { type FrameworkTemplateConformanceCase, type FrameworkTemplateConformanceReasonCode } from './framework-template-conformance.js';
export declare const FRAMEWORK_TEMPLATE_CONFORMANCE_FIXTURES_VERSION: "reddi.framework-template-conformance-fixtures.v1";
/**
 * The four framework templates that have landed on the shared #552/#553 contract lane. `generic`
 * is the framework-neutral #552 lifecycle fixture set itself; `langgraph`, `adk`, and `strands`
 * are the #544/#546/#545 templates that consume it without redefining any RAP semantics.
 */
export declare const LANDED_FRAMEWORK_TEMPLATE_IDS: readonly ["generic", "langgraph", "adk", "strands"];
export type LandedFrameworkTemplateId = (typeof LANDED_FRAMEWORK_TEMPLATE_IDS)[number];
/**
 * Runtime snapshot of the four no-live boundary booleans, aggregated across every lifecycle
 * contract carried by a landed template. `allFalse` is the fixtures-module invariant: every
 * landed template must keep live payment, wallet/RPC/provider calls, custody, and settlement
 * finality explicitly false.
 */
export type FrameworkTemplateLiveBoundarySnapshot = {
    livePaymentApproved: boolean;
    walletRpcProviderCalls: boolean;
    custodySupported: boolean;
    settlementFinalityClaimed: boolean;
    allFalse: boolean;
};
export type LandedFrameworkTemplateConformanceFixture = {
    framework: LandedFrameworkTemplateId;
    description: string;
    templateValid: boolean;
    templateReasonCodes: string[];
    lifecycleContracts: Record<FrameworkTemplateScenarioKind, FrameworkTemplateContract>;
    conformanceCases: FrameworkTemplateConformanceCase[];
    conformanceValid: boolean;
    conformanceReasonCodes: FrameworkTemplateConformanceReasonCode[];
    liveBoundary: FrameworkTemplateLiveBoundarySnapshot;
};
export type FrameworkTemplateUniformConformanceReasonCode = 'framework_templates_uniformly_conformant' | 'missing_landed_framework_template' | 'framework_template_not_conformant' | 'framework_template_invalid' | 'non_uniform_conformance_reason_codes' | 'non_uniform_live_boundary' | 'live_boundary_not_false';
export type FrameworkTemplateUniformConformanceResult = {
    version: typeof FRAMEWORK_TEMPLATE_CONFORMANCE_FIXTURES_VERSION;
    issue: 547;
    valid: boolean;
    reasonCodes: FrameworkTemplateUniformConformanceReasonCode[];
    frameworks: LandedFrameworkTemplateId[];
    sharedConformanceReasonCodes: FrameworkTemplateConformanceReasonCode[];
    liveBoundary: FrameworkTemplateLiveBoundarySnapshot;
    fixtures: LandedFrameworkTemplateConformanceFixture[];
    auditNotes: string[];
};
/**
 * Builds one conformance fixture per landed framework template. Each fixture runs the shared #553
 * no-live conformance checker against the template's own lifecycle contracts, so uniformity across
 * frameworks is proven from each template's real embedded contracts rather than a shared shortcut.
 */
export declare function listLandedFrameworkTemplateConformanceFixtures(): LandedFrameworkTemplateConformanceFixture[];
/**
 * Asserts that ALL landed framework templates pass the shared conformance checker uniformly:
 * every framework is present, valid, and produces the same conformance reason codes and the same
 * all-false no-live boundary. Fails closed with machine-readable reason codes otherwise.
 */
export declare function runUniformFrameworkTemplateConformance(): FrameworkTemplateUniformConformanceResult;
