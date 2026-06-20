export declare const QUASAR_REGISTRY_COMPATIBILITY_SCHEMA_VERSION: "reddi.quasar-registry-compatibility.v1";
export declare const QUASAR_AGENT_ACCOUNT_COMPATIBILITY: {
    readonly discriminator: readonly [20];
    readonly dataSize: 153;
    readonly pdaSeed: "agent";
    readonly modelMaxBytes: 64;
    readonly onchainFieldNames: readonly ["owner", "agentType", "model", "rateLamports", "minReputation", "active", "reputationScore", "jobsCompleted", "jobsFailed", "createdAt", "attestationAccuracy"];
    readonly offchainFieldNames: readonly ["profileId", "listingId", "displayName", "summary", "description", "buyerPreview", "endpoint", "ardUrl", "catalogRefs", "sourceRefs", "authRequirements", "auddTerms", "evidenceRefs", "receiptRefs", "trustBadges", "providerTrustStatus", "capabilities", "tags", "groups", "riskDiagnostics", "reviewStates", "operatorApprovalEvidenceRef"];
};
export type QuasarRegistryAgentType = 'Primary' | 'Attestation' | 'Both';
export type QuasarRegistryRegistrationIntent = 'metadata_only' | 'register' | 'update';
export type QuasarRegistryRegistrationStatus = 'metadata_only' | 'registerable' | 'blocked';
export type QuasarRegistryCompatibilityInput = {
    profileId?: string;
    listingId: string;
    displayName: string;
    summary?: string;
    description?: string;
    owner?: string;
    role?: {
        callable?: boolean;
        attestation?: boolean;
    };
    model?: string;
    nativeSolRateLamports?: string | bigint | number;
    minReputation?: number;
    registrationIntent?: QuasarRegistryRegistrationIntent;
    active?: boolean;
    decodedAggregates?: {
        reputationScore?: number;
        jobsCompleted?: string | bigint | number;
        jobsFailed?: string | bigint | number;
        createdAt?: string | bigint | number;
        attestationAccuracy?: number;
    };
    offchain: {
        buyerPreview?: string;
        endpoint?: {
            url?: string;
            bindingRef?: string;
            healthStatus?: 'not_probed' | 'healthy' | 'unhealthy' | 'unknown';
        };
        ardUrl?: string;
        catalogRefs?: string[];
        sourceRefs?: string[];
        authRequirements?: string[];
        auddTerms?: {
            asset: string;
            network: string;
            amount?: string;
            paymentPlanRef?: string;
            quoteRef?: string;
            settlementAccount?: string;
            refundPolicy?: string;
            failurePolicy?: string;
        };
        evidenceRefs?: string[];
        receiptRefs?: string[];
        trustBadges?: string[];
        providerTrustStatus?: 'unverified' | 'self_attested' | 'external_attested' | 'reddi_attested' | 'verified';
        capabilities?: string[];
        tags?: string[];
        groups?: string[];
        riskDiagnostics?: string[];
        reviewStates?: string[];
        operatorApprovalEvidenceRef?: string;
    };
};
export type QuasarRegistryCompatibilityReport = {
    schemaVersion: typeof QUASAR_REGISTRY_COMPATIBILITY_SCHEMA_VERSION;
    profileId?: string;
    listingId: string;
    registrationStatus: QuasarRegistryRegistrationStatus;
    account: typeof QUASAR_AGENT_ACCOUNT_COMPATIBILITY;
    onchain: {
        owner?: string;
        agentType: QuasarRegistryAgentType;
        model: string;
        rateLamports?: string;
        minReputation: number;
        active: boolean;
        aggregates: {
            source: 'decoded_quasar_account' | 'not_available';
            reputationScore?: number;
            jobsCompleted?: string;
            jobsFailed?: string;
            createdAt?: string;
            attestationAccuracy?: number;
        };
    };
    offchain: QuasarRegistryCompatibilityInput['offchain'] & {
        profileId?: string;
        listingId: string;
        displayName: string;
        summary?: string;
        description?: string;
    };
    blockedReasons: string[];
    reasonCodes: string[];
    guardrails: {
        richMetadataOnchain: false;
        auddCustodyOnchain: false;
        endpointOnchain: false;
        evidencePayloadOnchain: false;
        trustBadgeOnchain: false;
        instructionBuilt: false;
        walletSigning: false;
        rpcCall: false;
        programDeploy: false;
        livePaymentExecuted: false;
    };
};
export declare function deriveQuasarRegistryCompatibility(input: QuasarRegistryCompatibilityInput): QuasarRegistryCompatibilityReport;
