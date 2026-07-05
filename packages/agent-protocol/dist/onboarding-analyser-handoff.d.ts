/**
 * Onboarding analyser handoff contracts + no-network fixture matrix (#509).
 *
 * Defines the stable typed handoff shapes for the AI onboarding analyser
 * pipeline before implementation splits across endpoint inspection (#459/#371),
 * profile generation (#372), readiness analysis (#373), seller wrapper
 * generation (#375), and operator review UI lanes:
 *
 *   intake descriptor
 *     -> normalized capability inventory
 *     -> generated RAP profile draft
 *     -> readiness result
 *     -> seller wrapper / payment-plan draft
 *     -> listing / export draft
 *
 * This module is PURE and offline-only. It performs no network fetch, plugin
 * install, command execution, MCP call, endpoint invocation, wallet/RPC call,
 * paid call, secret read, hosted write, publication, or reputation mutation.
 * It only validates and re-shapes in-memory fixture descriptors that the
 * caller already holds. All imported metadata is treated as UNTRUSTED data:
 * it can never instruct the analyser to run commands, read secrets, publish
 * listings, enable payments, or upgrade its own trust.
 *
 * Field provenance is separated into exactly five categories:
 * discovered (present in imported metadata), inferred (derived by analyser
 * heuristics), user_provided (supplied by the operator), verified (backed by
 * non-empty evidence refs), and blocked (absent or disallowed until supplied
 * and reviewed).
 */
export declare const ONBOARDING_INTAKE_DESCRIPTOR_SCHEMA_VERSION: "reddi.onboarding-intake-descriptor.v1";
export declare const ONBOARDING_CAPABILITY_INVENTORY_SCHEMA_VERSION: "reddi.onboarding-capability-inventory.v1";
export declare const ONBOARDING_RAP_PROFILE_DRAFT_SCHEMA_VERSION: "reddi.onboarding-rap-profile-draft.v1";
export declare const ONBOARDING_READINESS_RESULT_SCHEMA_VERSION: "reddi.onboarding-readiness-result.v1";
export declare const ONBOARDING_SELLER_WRAPPER_DRAFT_SCHEMA_VERSION: "reddi.onboarding-seller-wrapper-draft.v1";
export declare const ONBOARDING_LISTING_EXPORT_DRAFT_SCHEMA_VERSION: "reddi.onboarding-listing-export-draft.v1";
export declare const ONBOARDING_ANALYSER_HANDOFF_SCHEMA_VERSION: "reddi.onboarding-analyser-handoff.v1";
export declare const ONBOARDING_ANALYSER_FIXTURE_MATRIX_SCHEMA_VERSION: "reddi.onboarding-analyser-fixture-matrix.v1";
/** Issue anchors so downstream implementations can trace contract ownership. */
export declare const ONBOARDING_ANALYSER_HANDOFF_ISSUE: 509;
export declare const ONBOARDING_ANALYSER_HANDOFF_PARENT_ISSUES: Readonly<{
    readonly onboardingAssistantEpic: 370;
    readonly capabilityInventoryFeature: 371;
    readonly rapProfileSchemaTask: 372;
    readonly readinessAnalysisFeature: 373;
    readonly liveAdapterSplitTask: 459;
}>;
/**
 * Hard no-live boundary. Every guardrail is `false` by construction and every
 * emitted payload carries this object so downstream consumers can assert the
 * boundary instead of trusting prose.
 */
export declare const ONBOARDING_ANALYSER_GUARDRAILS: Readonly<{
    readonly networkFetchAllowed: false;
    readonly pluginInstallAllowed: false;
    readonly commandExecutionAllowed: false;
    readonly mcpCallAllowed: false;
    readonly endpointInvocationAllowed: false;
    readonly walletOrRpcAllowed: false;
    readonly paidCallAllowed: false;
    readonly secretReadAllowed: false;
    readonly hostedWriteAllowed: false;
    readonly publicationAllowed: false;
    readonly reputationMutationAllowed: false;
    readonly liveAuthRegistrationAllowed: false;
}>;
export type OnboardingAnalyserGuardrails = typeof ONBOARDING_ANALYSER_GUARDRAILS;
export type OnboardingSourceKind = 'mcp-metadata' | 'openapi' | 'a2a-card' | 'ard-ai-catalog' | 'manual-descriptor' | 'static-agent-stack-snapshot';
/** Golden fixture classes the no-network matrix must cover (issue #509). */
export type OnboardingFixtureClass = OnboardingSourceKind | 'malformed-input' | 'credential-shaped-input' | 'partial-metadata';
export declare const ONBOARDING_FIXTURE_CLASSES: readonly OnboardingFixtureClass[];
/** Fail-closed reasons required by #509. */
export type OnboardingFailClosedReasonCode = 'private_url_blocked' | 'credential_leakage_rejected' | 'command_execution_rejected' | 'paid_call_rejected' | 'wallet_rpc_rejected' | 'missing_payment_metadata' | 'missing_evidence' | 'untrusted_imported_content_rejected';
export type OnboardingIntakeValidationErrorCode = OnboardingFailClosedReasonCode | 'malformed_intake_descriptor' | 'forbidden_operation_rejected';
export type OnboardingIntakeValidationError = {
    code: OnboardingIntakeValidationErrorCode;
    path: string;
    message: string;
};
/**
 * Operations imported metadata (or a caller) may request. Every one of them is
 * forbidden in this contract module and fails closed at intake.
 */
export type OnboardingForbiddenOperation = 'network_fetch' | 'plugin_install' | 'command_execution' | 'mcp_call' | 'endpoint_invocation' | 'wallet_rpc' | 'paid_call' | 'secret_read' | 'hosted_write' | 'publication' | 'reputation_mutation';
export type OnboardingIntakeSource = {
    /** Public HTTPS source URL. Optional for manual descriptors. Never fetched here. */
    sourceUrl?: string;
    /** Reference to the already-captured static snapshot the descriptor came from. */
    snapshotRef: string;
    checkedCommit?: string;
    checkedRef?: string;
    license?: string;
    /** RFC3339 UTC timestamp recorded when the snapshot was captured. */
    crawlTimestamp: string;
};
export type OnboardingDeclaredCapability = {
    name: string;
    description?: string;
    inputShape?: string;
    outputShape?: string;
    examplePrompts?: string[];
    sideEffectHint?: 'none' | 'read' | 'write' | 'execute';
};
export type OnboardingDeclaredPaymentMetadata = {
    settlementAddress?: string;
    network?: string;
    price?: string;
    currency?: string;
};
export type OnboardingIntakeDeclaredMetadata = {
    displayName?: string;
    description?: string;
    capabilities: OnboardingDeclaredCapability[];
    endpointUrls?: string[];
    authHints?: string[];
    pricingHints?: string[];
    paymentMetadata?: OnboardingDeclaredPaymentMetadata;
    rateLimitHints?: string[];
    termsUrl?: string;
    /**
     * Self-asserted trust/verification claims found in imported content.
     * Imported content can never self-assert trust: any non-empty entry fails
     * closed with `untrusted_imported_content_rejected`.
     */
    trustClaims?: string[];
};
export type OnboardingIntakeOperatorProvided = {
    displayName?: string;
    description?: string;
    contactRef?: string;
};
export type OnboardingIntakeDescriptor = {
    schemaVersion: typeof ONBOARDING_INTAKE_DESCRIPTOR_SCHEMA_VERSION;
    intakeId: string;
    sourceKind: OnboardingSourceKind;
    /** This contract module only accepts already-captured static fixtures. */
    ingestionMode: 'static-fixture';
    source: OnboardingIntakeSource;
    declaredMetadata: OnboardingIntakeDeclaredMetadata;
    operatorProvided?: OnboardingIntakeOperatorProvided;
    /** Any recognised forbidden operation here fails closed. */
    requestedOperations?: string[];
    staticOnly: true;
};
export type OnboardingIntakeValidationResult = {
    ok: true;
    descriptor: OnboardingIntakeDescriptor;
} | {
    ok: false;
    errors: OnboardingIntakeValidationError[];
};
export type OnboardingFieldProvenance = 'discovered' | 'inferred' | 'user_provided' | 'verified' | 'blocked';
export type OnboardingProvenancedField<T> = {
    provenance: OnboardingFieldProvenance;
    value?: T;
    /** Non-empty iff provenance is `verified`. */
    evidenceRefs: string[];
    /** Present iff provenance is `blocked`. */
    blockedReason?: OnboardingFailClosedReasonCode;
};
export type OnboardingFieldProvenancePartition = Record<OnboardingFieldProvenance, string[]>;
/**
 * Upgrade a field to `verified` provenance. Fails closed: verification without
 * at least one evidence ref is rejected with `missing_evidence`.
 */
export declare function verifyOnboardingField<T>(field: OnboardingProvenancedField<T>, evidenceRefs: string[]): {
    ok: true;
    field: OnboardingProvenancedField<T>;
} | {
    ok: false;
    reasonCode: 'missing_evidence';
};
export type OnboardingSideEffectRisk = 'none' | 'read' | 'write' | 'execute';
export type OnboardingCapabilityInventoryEntry = {
    capabilityId: string;
    name: OnboardingProvenancedField<string>;
    description: OnboardingProvenancedField<string>;
    inputShape: OnboardingProvenancedField<string>;
    outputShape: OnboardingProvenancedField<string>;
    sideEffectRisk: OnboardingProvenancedField<OnboardingSideEffectRisk>;
    endpointUrl: OnboardingProvenancedField<string>;
    authHints: OnboardingProvenancedField<string[]>;
    pricingHints: OnboardingProvenancedField<string[]>;
    contentTrustBoundary: 'untrusted_imported_content';
};
export type OnboardingInventoryDiagnostic = {
    severity: 'info' | 'warning' | 'blocked';
    code: string;
    path: string;
    message: string;
};
export type OnboardingCapabilityInventory = {
    schemaVersion: typeof ONBOARDING_CAPABILITY_INVENTORY_SCHEMA_VERSION;
    intakeRef: string;
    sourceKind: OnboardingSourceKind;
    source: OnboardingIntakeSource;
    entries: OnboardingCapabilityInventoryEntry[];
    diagnostics: OnboardingInventoryDiagnostic[];
    rawSnapshotRefs: string[];
    staticOnly: true;
};
export type OnboardingRapProfileDraft = {
    schemaVersion: typeof ONBOARDING_RAP_PROFILE_DRAFT_SCHEMA_VERSION;
    profileId: string;
    intakeRef: string;
    identity: {
        displayName: OnboardingProvenancedField<string>;
        sourceKind: OnboardingSourceKind;
        publisherContactRef: OnboardingProvenancedField<string>;
    };
    provenance: OnboardingIntakeSource;
    capabilities: OnboardingCapabilityInventoryEntry[];
    invocation: {
        endpointUrls: string[];
        missingEndpoint: boolean;
        /** Static contract: invocation is never allowed from this module. */
        invocationAllowed: false;
    };
    authRequirements: string[];
    payment: {
        metadata?: OnboardingDeclaredPaymentMetadata;
        status: 'declared_unverified' | 'missing_payment_metadata';
        missingFields: string[];
        activation: 'disabled';
    };
    policyRequirements: string[];
    evidenceExpectations: string[];
    healthChecks: {
        status: 'not_probed';
        probesAllowed: false;
    };
    trust: {
        sourceAuthenticity: 'snapshot_recorded' | 'unrecorded';
        importedContentTrust: 'untrusted';
        verifiedProviderTrust: false;
    };
    reputation: {
        status: 'unproven';
        receiptRefs: string[];
    };
    rawSnapshotRefs: string[];
    staticOnly: true;
};
export type OnboardingReadinessLaneKey = 'capability_fit' | 'source_identity' | 'static_source_authenticity' | 'imported_content_trust' | 'trust_evidence' | 'payment_readiness' | 'policy_fit' | 'endpoint_safety' | 'auth_scope_risk' | 'data_retention_risk' | 'reputation_readiness';
export declare const ONBOARDING_READINESS_LANES: readonly OnboardingReadinessLaneKey[];
export type OnboardingReadinessLaneStatus = 'ready' | 'needs_operator_review' | 'blocked';
export type OnboardingReadinessLane = {
    lane: OnboardingReadinessLaneKey;
    status: OnboardingReadinessLaneStatus;
    reasonCodes: OnboardingFailClosedReasonCode[];
    recommendations: string[];
};
/**
 * `publish_ready` exists for downstream #373 implementations that add
 * verification lanes; the static contract path never emits it because
 * imported content trust cannot be verified without operator review.
 */
export type OnboardingOverallReadiness = 'blocked' | 'needs_operator_review' | 'publish_ready';
export type OnboardingReadinessResult = {
    schemaVersion: typeof ONBOARDING_READINESS_RESULT_SCHEMA_VERSION;
    profileRef: string;
    lanes: OnboardingReadinessLane[];
    overall: OnboardingOverallReadiness;
    failClosedReasons: OnboardingFailClosedReasonCode[];
    staticOnly: true;
};
export type OnboardingSellerWrapperDraft = {
    schemaVersion: typeof ONBOARDING_SELLER_WRAPPER_DRAFT_SCHEMA_VERSION;
    wrapperId: string;
    profileRef: string;
    /** Planned wrapper route names only — nothing is mounted or invoked here. */
    wrapperRoutes: {
        quoteRoute: string;
        policyPreflightRoute: string;
        invocationRoute: string;
        receiptHook: string;
        evidenceHook: string;
    };
    paymentPlan: {
        railAsset?: string;
        network?: string;
        priceUnits?: string;
        settlementAddress?: string;
        status: 'draft_ready_for_review' | 'draft_incomplete';
        missingFields: string[];
        activation: 'disabled';
        livePaymentApproved: false;
    };
    guardrails: OnboardingAnalyserGuardrails;
    staticOnly: true;
};
export type OnboardingListingDraftState = {
    code: 'listing_draft' | 'missing_payment' | 'missing_endpoint' | 'imported_content_untrusted' | 'operator_review_required' | 'readiness_blocked';
    severity: 'info' | 'warning' | 'blocked';
    message: string;
};
export type OnboardingListingExportDraft = {
    schemaVersion: typeof ONBOARDING_LISTING_EXPORT_DRAFT_SCHEMA_VERSION;
    listingId: string;
    profileRef: string;
    readinessRef: string;
    status: 'blocked' | 'needs_operator_review';
    publicationDisabled: true;
    operatorReviewRequired: true;
    exportFragments: {
        aiCatalog: {
            specVersion: '1.0';
            id: string;
            type: 'onboarding-analyser-draft';
            name: string;
            capabilities: string[];
            trust: {
                status: 'unverified';
                note: string;
            };
            payment: {
                status: 'declared_unverified' | 'missing_payment_setup';
            };
        };
    };
    states: OnboardingListingDraftState[];
    staticOnly: true;
};
export type OnboardingAnalyserHandoffSuccess = {
    ok: true;
    schemaVersion: typeof ONBOARDING_ANALYSER_HANDOFF_SCHEMA_VERSION;
    intake: OnboardingIntakeDescriptor;
    capabilityInventory: OnboardingCapabilityInventory;
    rapProfileDraft: OnboardingRapProfileDraft;
    readiness: OnboardingReadinessResult;
    sellerWrapperDraft: OnboardingSellerWrapperDraft;
    listingExportDraft: OnboardingListingExportDraft;
    guardrails: OnboardingAnalyserGuardrails;
    staticOnly: true;
};
export type OnboardingAnalyserHandoffFailure = {
    ok: false;
    schemaVersion: typeof ONBOARDING_ANALYSER_HANDOFF_SCHEMA_VERSION;
    failClosed: true;
    errors: OnboardingIntakeValidationError[];
    guardrails: OnboardingAnalyserGuardrails;
    staticOnly: true;
};
export type OnboardingAnalyserHandoffResult = OnboardingAnalyserHandoffSuccess | OnboardingAnalyserHandoffFailure;
/**
 * Validate an intake descriptor. Fails closed on malformed shapes, private or
 * credential-shaped URLs, credential-shaped metadata, self-asserted trust
 * claims, and any requested forbidden operation.
 */
export declare function validateOnboardingIntakeDescriptor(input: unknown): OnboardingIntakeValidationResult;
/** Normalize a validated intake descriptor into a capability inventory. */
export declare function buildOnboardingCapabilityInventory(descriptor: OnboardingIntakeDescriptor): OnboardingCapabilityInventory;
/** Generate the RAP profile draft handed to readiness analysis and review. */
export declare function buildOnboardingRapProfileDraft(descriptor: OnboardingIntakeDescriptor, inventory: OnboardingCapabilityInventory): OnboardingRapProfileDraft;
/**
 * Analyse readiness lanes for a generated profile draft. Missing or
 * unverifiable data fails closed; ARD/search relevance and source authenticity
 * are never treated as trust in imported content or agent behaviour.
 */
export declare function analyzeOnboardingReadiness(profile: OnboardingRapProfileDraft): OnboardingReadinessResult;
/** Draft the seller wrapper / payment plan. Activation is always disabled. */
export declare function buildOnboardingSellerWrapperDraft(profile: OnboardingRapProfileDraft): OnboardingSellerWrapperDraft;
/** Draft the listing/export payload. Publication is always disabled here. */
export declare function buildOnboardingListingExportDraft(profile: OnboardingRapProfileDraft, readiness: OnboardingReadinessResult): OnboardingListingExportDraft;
/**
 * Run the full contract handoff: intake -> capability inventory -> RAP profile
 * draft -> readiness result -> seller wrapper draft -> listing/export draft.
 * Pure and deterministic; fails closed with intake errors on invalid input.
 */
export declare function runOnboardingAnalyserHandoff(input: unknown): OnboardingAnalyserHandoffResult;
/**
 * Partition every provenanced field in a capability inventory entry into the
 * five provenance buckets required by #509.
 */
export declare function partitionOnboardingEntryFieldsByProvenance(entry: OnboardingCapabilityInventoryEntry): OnboardingFieldProvenancePartition;
export type OnboardingAnalyserFixtureCase = {
    key: string;
    fixtureClass: OnboardingFixtureClass;
    description: string;
    descriptor: unknown;
    expectedValid: boolean;
    expectedErrorCodes: OnboardingIntakeValidationErrorCode[];
    expectedOverallReadiness?: Exclude<OnboardingOverallReadiness, 'publish_ready'>;
    expectedFailClosedReasons?: OnboardingFailClosedReasonCode[];
};
/**
 * Golden no-network fixture matrix. Every fixture class required by #509 is
 * represented, plus negative fail-closed cases for private URLs, credential
 * leakage, command execution, paid calls, wallet/RPC, and imported trust
 * claims. All descriptors are in-memory literals — nothing is fetched.
 */
export declare function listOnboardingAnalyserFixtureMatrix(): OnboardingAnalyserFixtureCase[];
