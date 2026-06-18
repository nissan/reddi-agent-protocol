import { type DiscoveryCandidate, type DiscoveryCandidatePolicyPreflightDecision, type DiscoveryCandidateReasonCode, type DiscoverySourceKind } from './discovery-source.js';
import { type ProviderTrustVerificationStatus } from './provider-trust.js';
export declare const SOURCE_DIAGNOSTICS_SCHEMA_VERSION: "reddi.source-diagnostics.v1";
export type SourceDiagnosticLane = 'capability_match' | 'discovery_source' | 'publisher_identity' | 'trust_evidence' | 'policy_decision' | 'payment_fit' | 'reputation_evidence';
export type SourceDiagnosticSeverity = 'info' | 'warning' | 'blocked';
export type SourceDiagnosticReasonCode = 'capability_declared' | 'capability_match_unscored' | 'discovery_source_recorded' | 'raw_snapshot_recorded' | 'publisher_identity_recorded' | 'publisher_identity_missing' | 'trust_verified' | 'trust_claimed_unverified' | 'trust_unverified' | 'trust_failed_verification' | 'policy_allowed' | 'policy_denied' | 'payment_quote_present' | 'payment_quote_missing' | 'payment_quote_denied' | 'reputation_history_present' | 'reputation_history_absent';
export type SourceDiagnosticMessage = {
    lane: SourceDiagnosticLane;
    severity: SourceDiagnosticSeverity;
    code: SourceDiagnosticReasonCode | DiscoveryCandidateReasonCode;
    summary: string;
    action?: string;
};
export type SourceAwareCandidateDiagnostics = {
    schemaVersion: typeof SOURCE_DIAGNOSTICS_SCHEMA_VERSION;
    candidate: {
        identifier: string;
        name: string;
        sourceKind: DiscoverySourceKind;
        rawSnapshotRef?: string;
    };
    capabilityMatch: {
        resourceType: string;
        mediaType: string;
        relevanceScore?: number;
        scoreMeaning: 'relevance_only_not_trust';
        summary: string;
    };
    discoverySource: {
        sourceKind: DiscoverySourceKind;
        url?: string;
        endpoint?: string;
        rawSnapshotRef?: string;
        summary: string;
    };
    publisherIdentity: {
        id?: string;
        name?: string;
        domain?: string;
        trustStatus?: ProviderTrustVerificationStatus;
        summary: string;
    };
    trustEvidence: {
        status: ProviderTrustVerificationStatus | 'missing';
        reasonCodes: string[];
        verifier?: string;
        checkedAt?: string;
        failureReasons: string[];
        provenanceCount: number;
        attestationCount: number;
        verificationReferenceCount: number;
        summary: string;
    };
    policyDecision: {
        allowed?: boolean;
        reasonCodes: DiscoveryCandidateReasonCode[];
        summaries: string[];
    };
    paymentFit: {
        quote?: {
            amount: string;
            asset: string;
            network: string;
        };
        allowed?: boolean;
        reasonCodes: DiscoveryCandidateReasonCode[];
        summary: string;
    };
    reputationEvidence: {
        status: 'history_present' | 'no_history';
        receiptCount?: number;
        attestationCount?: number;
        summary: string;
    };
    messages: SourceDiagnosticMessage[];
};
export type SourceAwareDiagnosticsOptions = {
    policyDecision?: DiscoveryCandidatePolicyPreflightDecision;
    reputation?: {
        receiptCount?: number;
        attestationCount?: number;
    };
};
export declare function createSourceAwareCandidateDiagnostics(candidate: DiscoveryCandidate, options?: SourceAwareDiagnosticsOptions): SourceAwareCandidateDiagnostics;
