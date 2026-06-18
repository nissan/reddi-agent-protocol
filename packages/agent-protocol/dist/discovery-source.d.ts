import { type AiCatalogSnapshot } from './ai-catalog.js';
import { type NormalizeAiCatalogTrustOptions, type ProviderTrustRecord, type ProviderTrustVerificationStatus } from './provider-trust.js';
export declare const DISCOVERY_CANDIDATE_SCHEMA_VERSION: "reddi.discovery-candidate.v1";
export type DiscoverySourceKind = 'local-specialist' | 'direct-ai-catalog' | 'ard-registry' | 'source-adapter' | 'hosted-rap-registry';
export type DiscoveryCandidateReasonCode = 'candidate_ready_for_policy_preflight' | 'malformed_candidate' | 'provider_trust_mismatch' | 'missing_quote' | 'source_not_allowed' | 'trust_verification_required' | 'unsupported_asset' | 'unsupported_network' | 'over_budget';
export type DiscoveryCandidateDiagnostic = {
    code: DiscoveryCandidateReasonCode;
    path: string;
    message: string;
};
export type DiscoveryCandidateQuote = {
    amount: string;
    asset: string;
    network: string;
    expiresAt?: string;
    payee?: string;
};
export type DiscoveryCandidate = {
    schemaVersion: typeof DISCOVERY_CANDIDATE_SCHEMA_VERSION;
    sourceKind: DiscoverySourceKind;
    identifier: string;
    publisher?: {
        id: string;
        name?: string;
        domain?: string;
    };
    name: string;
    description?: string;
    resourceType: string;
    mediaType: string;
    url?: string;
    endpoint?: string;
    trustMetadata?: ProviderTrustRecord['trustMetadata'];
    providerTrust?: ProviderTrustRecord;
    relevance?: {
        score?: number;
        reason?: string;
        source?: string;
    };
    rawSnapshotRef?: string;
    quote?: DiscoveryCandidateQuote;
    policyPreflightRequired: true;
};
export type DiscoveryCandidateNormalizationResult = {
    ok: true;
    candidates: DiscoveryCandidate[];
    diagnostics: DiscoveryCandidateDiagnostic[];
} | {
    ok: false;
    errors: DiscoveryCandidateDiagnostic[];
};
export type DiscoveryCandidateValidationResult = {
    ok: true;
    candidate: DiscoveryCandidate;
    diagnostics: DiscoveryCandidateDiagnostic[];
} | {
    ok: false;
    errors: DiscoveryCandidateDiagnostic[];
};
export type CreateAiCatalogDiscoveryCandidatesOptions = {
    sourceKind?: Extract<DiscoverySourceKind, 'direct-ai-catalog' | 'ard-registry' | 'hosted-rap-registry'>;
    trustOptionsByResourceId?: Record<string, NormalizeAiCatalogTrustOptions>;
    relevanceScores?: Record<string, number>;
};
export type DiscoveryCandidatePolicy = {
    allowedSourceKinds?: DiscoverySourceKind[];
    requireVerifiedTrust?: boolean;
    allowedAssets?: string[];
    allowedNetworks?: string[];
    maxQuote?: {
        amount: string;
        asset: string;
        network: string;
    };
};
export type DiscoveryCandidatePolicyPreflightDecision = {
    allowed: boolean;
    reasonCodes: DiscoveryCandidateReasonCode[];
    auditNotes: string[];
    candidate: {
        identifier: string;
        sourceKind: DiscoverySourceKind;
        relevanceScore?: number;
        trustStatus?: ProviderTrustVerificationStatus;
    };
    quote?: DiscoveryCandidateQuote;
};
export declare function validateDiscoveryCandidate(input: unknown): DiscoveryCandidateValidationResult;
export declare function createAiCatalogDiscoveryCandidates(catalog: AiCatalogSnapshot, options?: CreateAiCatalogDiscoveryCandidatesOptions): DiscoveryCandidateNormalizationResult;
export declare function evaluateDiscoveryCandidatePolicyPreflight(candidate: DiscoveryCandidate, policy: DiscoveryCandidatePolicy): DiscoveryCandidatePolicyPreflightDecision;
export declare const discoverySourceFixtures: {
    readonly localSpecialistCandidate: {
        readonly schemaVersion: "reddi.discovery-candidate.v1";
        readonly sourceKind: "local-specialist";
        readonly identifier: "urn:ai:local:specialists:lint";
        readonly publisher: {
            readonly id: "local";
        };
        readonly name: "Local Lint Specialist";
        readonly resourceType: "application/mcp-server-card+json";
        readonly mediaType: "application/mcp-server-card+json";
        readonly endpoint: "http://localhost:4100/mcp";
        readonly relevance: {
            readonly score: 0.4;
            readonly source: "local-fixture";
        };
        readonly rawSnapshotRef: "sha256:local-specialist-fixture";
        readonly quote: {
            readonly amount: "1000";
            readonly asset: "AUDD";
            readonly network: "solana-devnet";
        };
        readonly policyPreflightRequired: true;
    };
};
