import { type AiCatalogSnapshot } from './ai-catalog.js';
export declare const PROVIDER_TRUST_RECORD_SCHEMA_VERSION: "reddi.provider-trust.v1";
export type ProviderTrustVerificationStatus = 'claimed' | 'verified' | 'unverified' | 'failed_verification';
export type ProviderTrustReasonCode = 'rap_verified' | 'rap_verification_failed' | 'external_claim_not_verified_by_rap' | 'no_trust_metadata' | 'provider_not_found' | 'malformed_trust_metadata' | 'credential_leakage_rejected';
export type ProviderTrustValidationError = {
    code: ProviderTrustReasonCode;
    path: string;
    message: string;
};
export type ProviderTrustRecord = {
    schemaVersion: typeof PROVIDER_TRUST_RECORD_SCHEMA_VERSION;
    provider: {
        id: string;
        name: string;
        mediaType: string;
        url?: string;
    };
    publisher: {
        id: string;
        name?: string;
        domain?: string;
    };
    source: {
        kind: 'ai-catalog';
        rawSnapshotRef?: string;
        catalogPublisherId: string;
    };
    verification: {
        status: ProviderTrustVerificationStatus;
        reasonCodes: ProviderTrustReasonCode[];
        verifier?: string;
        checkedAt?: string;
        failureReasons: string[];
    };
    trustMetadata: {
        trustManifest?: unknown;
        provenanceLinks: unknown[];
        attestations: unknown[];
        detachedSignature?: unknown;
        verificationReferences: unknown[];
        publisherIdentity?: unknown;
    };
};
export type ProviderTrustVerificationInput = {
    status?: Extract<ProviderTrustVerificationStatus, 'verified' | 'failed_verification'>;
    verifier?: string;
    checkedAt?: string;
    failureReasons?: string[];
};
export type NormalizeAiCatalogTrustOptions = {
    verification?: ProviderTrustVerificationInput;
};
export type ProviderTrustNormalizationResult = {
    ok: true;
    record: ProviderTrustRecord;
} | {
    ok: false;
    errors: ProviderTrustValidationError[];
};
export type ProviderTrustFixtureCase = {
    description: string;
    catalog: AiCatalogSnapshot;
    resourceId: string;
    options?: NormalizeAiCatalogTrustOptions;
    expectedValid: boolean;
    expectedStatus?: ProviderTrustVerificationStatus;
    expectedReasonCodes: ProviderTrustReasonCode[];
};
export declare function normalizeAiCatalogProviderTrustRecord(catalog: AiCatalogSnapshot, resourceId: string, options?: NormalizeAiCatalogTrustOptions): ProviderTrustNormalizationResult;
export declare function createAiCatalogProviderTrustRecord(catalog: AiCatalogSnapshot, resourceId: string, options?: NormalizeAiCatalogTrustOptions): ProviderTrustRecord;
export declare const providerTrustFixtures: {
    readonly verifiedCatalog: AiCatalogSnapshot;
    readonly unverifiedCatalog: AiCatalogSnapshot;
    readonly malformedTrustCatalog: AiCatalogSnapshot;
    readonly credentialBearingCatalog: {
        schemaVersion: "ai-catalog.v1";
        publisher: {
            id: string;
        };
        rawSnapshotRef: string;
        resources: {
            id: string;
            type: string;
            mediaType: string;
            name: string;
            url: string;
            trustManifest: {
                identity: string;
            };
            auth: {
                token: string;
            };
            raw: {
                identifier: string;
                displayName: string;
                mediaType: string;
                url: string;
                trustManifest: {
                    identity: string;
                };
                metadata: {
                    trust: {
                        provenance: string[];
                    };
                };
                auth: {
                    token: string;
                };
            };
        }[];
    };
};
export declare const providerTrustFixtureCases: Record<string, ProviderTrustFixtureCase>;
