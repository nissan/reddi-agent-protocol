export declare const ATTESTATION_RECORD_SCHEMA_VERSION: "reddi.attestation.v1";
export declare const REPUTATION_EVENT_SCHEMA_VERSION: "reddi.reputation-event.v1";
export declare const REPUTATION_STATE_SCHEMA_VERSION: "reddi.reputation-state.v1";
export declare const DEFAULT_ATTESTATION_RUBRIC_DIMENSIONS: readonly ["evidence_integrity", "policy_compliance", "delivery_quality"];
export type AttestationVerdict = 'passed' | 'failed' | 'disputed' | 'refunded';
export type AttestationWorkStatus = 'completed' | 'failed' | 'disputed' | 'refunded';
export type AttestationTrustBoundary = 'self_attested' | 'external_attested' | 'reddi_attested' | 'verified';
export type ReputationRoutingImpact = 'preferred' | 'eligible' | 'watch' | 'deprioritized' | 'blocked' | 'unproven';
export type AttestationRubricDimension = {
    id: string;
    score: number;
    weight: number;
    summary: string;
    reasonCodes: string[];
};
export type AttestationRecord = {
    schemaVersion: typeof ATTESTATION_RECORD_SCHEMA_VERSION;
    id: string;
    receiptId: string;
    evidenceId: string;
    evidenceRef: string;
    evidenceHash: string;
    attestor: {
        id: string;
        type: 'self' | 'external' | 'reddi' | 'local-fixture';
    };
    trustBoundary: AttestationTrustBoundary;
    verdict: AttestationVerdict;
    workStatus: AttestationWorkStatus;
    confidence: number;
    rubric: {
        dimensions: AttestationRubricDimension[];
    };
    createdAt: string;
    metadata?: Record<string, unknown>;
};
export type ReputationState = {
    schemaVersion: typeof REPUTATION_STATE_SCHEMA_VERSION;
    subject: {
        id: string;
        type: 'specialist' | 'provider' | 'listing';
    };
    score: number;
    routingImpact: ReputationRoutingImpact;
    completedJobs: number;
    attestedJobs: number;
    failedJobs: number;
    disputedJobs: number;
    refundedJobs: number;
    lastEventId?: string;
    updatedAt: string;
};
export type ReputationEventReasonCode = 'attestation_passed' | 'attestation_failed' | 'work_disputed' | 'work_refunded' | 'low_confidence' | 'rubric_below_threshold' | 'evidence_attached';
export type ReputationEvent = {
    schemaVersion: typeof REPUTATION_EVENT_SCHEMA_VERSION;
    id: string;
    subjectId: string;
    receiptId: string;
    attestationId: string;
    evidenceId: string;
    verdict: AttestationVerdict;
    workStatus: AttestationWorkStatus;
    trustBoundary: AttestationTrustBoundary;
    confidence: number;
    rubricScore: number;
    delta: number;
    previousScore: number;
    nextScore: number;
    routingImpact: ReputationRoutingImpact;
    reasonCodes: ReputationEventReasonCode[];
    createdAt: string;
};
export type AttestationValidationErrorCode = 'malformed_attestation' | 'missing_rubric_dimension' | 'invalid_rubric_dimension' | 'credential_leakage_rejected';
export type AttestationValidationError = {
    code: AttestationValidationErrorCode;
    path: string;
    message: string;
};
export type AttestationValidationResult = {
    ok: true;
    attestation: AttestationRecord;
} | {
    ok: false;
    errors: AttestationValidationError[];
};
export type ReputationUpdateResult = {
    ok: true;
    event: ReputationEvent;
    state: ReputationState;
} | {
    ok: false;
    errors: AttestationValidationError[];
    state: ReputationState;
};
export type ReputationApplyOptions = {
    subject?: ReputationState['subject'];
    now?: string;
};
export declare function validateAttestationRecord(input: unknown): AttestationValidationResult;
export declare function createAttestationRecord(input: AttestationRecord): AttestationRecord;
export declare function createInitialReputationState(subject: ReputationState['subject'], updatedAt?: string): ReputationState;
export declare function applyAttestationToReputation(attestationInput: unknown, previousState?: ReputationState, options?: ReputationApplyOptions): ReputationUpdateResult;
