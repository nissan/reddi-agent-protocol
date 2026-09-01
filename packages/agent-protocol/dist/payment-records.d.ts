export declare const REDDI_PAYMENT_CANONICALIZATION: "reddi.canonical-json.sha256.v1";
export declare const REDDI_PAYMENT_JOB_SCHEMA_VERSION: "reddi.payment-job.v1";
export declare const REDDI_PAYMENT_AGREEMENT_SCHEMA_VERSION: "reddi.payment-agreement.v1";
export declare const REDDI_PAYMENT_INTENT_SCHEMA_VERSION: "reddi.payment-intent.v1";
export declare const REDDI_PAYMENT_OBSERVATION_SCHEMA_VERSION: "reddi.payment-observation.v1";
export declare const REDDI_REFUND_RECORD_SCHEMA_VERSION: "reddi.refund-record.v1";
export type ReddiPaymentEnvironmentLabel = 'deterministic-fixture' | 'local-test-mint' | 'devnet-unverified' | 'mainnet-gated' | 'controlled-live';
export type ReddiPaymentEligibilityLabel = 'non_eligible' | 'pending_partner_acceptance' | 'eligible' | 'excluded';
export type ReddiPaymentRecordLabels = {
    environment: ReddiPaymentEnvironmentLabel;
    eligibility: ReddiPaymentEligibilityLabel;
    exclusionReason?: string;
    partnerAcceptanceRef?: string;
};
export type ReddiCanonicalNetworkRef = {
    caip2: string;
    rapAlias?: string;
};
export type ReddiPaymentRecordValidationErrorCode = 'malformed_record' | 'malformed_labels' | 'non_live_evidence_marked_eligible' | 'mainnet_partner_acceptance_missing' | 'model_spend_authority_rejected' | 'audd_rail_identity_mismatch' | 'audd_rail_label_mismatch';
export type ReddiPaymentRecordValidationError = {
    code: ReddiPaymentRecordValidationErrorCode;
    path: string;
    message: string;
};
export type ReddiPaymentRecordValidationResult<T> = {
    ok: true;
    record: T;
} | {
    ok: false;
    errors: ReddiPaymentRecordValidationError[];
};
export type ReddiPaymentJobRecord = {
    schemaVersion: typeof REDDI_PAYMENT_JOB_SCHEMA_VERSION;
    id: string;
    canonicalization: typeof REDDI_PAYMENT_CANONICALIZATION;
    labels: ReddiPaymentRecordLabels;
    requestDisclosureHash: string;
    sourceId: string;
    specialistId: string;
    nonce: string;
    createdAt?: string;
};
export type ReddiPaymentAgreementRecord = {
    schemaVersion: typeof REDDI_PAYMENT_AGREEMENT_SCHEMA_VERSION;
    id: string;
    canonicalization: typeof REDDI_PAYMENT_CANONICALIZATION;
    labels: ReddiPaymentRecordLabels;
    jobId: string;
    signedOfferHash: string;
    buyerPolicyDecisionHash: string;
    sellerTermsHash: string;
    quoteExpiresAt: string;
    createdAt?: string;
};
export type ReddiPaymentIntentAuthorizationState = 'model_draft' | 'policy_approved' | 'operator_approved';
export type ReddiPaymentIntentAuthorization = {
    state: ReddiPaymentIntentAuthorizationState;
    /** The model may draft an intent, but it is never a spending authority. */
    modelMayAuthorize: false;
    operatorApprovalRequired: boolean;
    policyDecisionRef?: string;
    operatorApprovalRef?: string;
    approvedAt?: string;
};
export type ReddiPaymentIntentRecord = {
    schemaVersion: typeof REDDI_PAYMENT_INTENT_SCHEMA_VERSION;
    id: string;
    canonicalization: typeof REDDI_PAYMENT_CANONICALIZATION;
    labels: ReddiPaymentRecordLabels;
    agreementId: string;
    network: ReddiCanonicalNetworkRef;
    asset: {
        symbol: string;
        mint?: string;
        tokenProgram?: string;
        decimals?: number;
        amountBaseUnits: string;
    };
    payTo: string;
    destinationTokenAccount?: string;
    memo?: string;
    evidenceRequired: boolean;
    quoteExpiresAt: string;
    expiresAt: string;
    refundPolicy: {
        mode: 'none' | 'automatic' | 'manual_review';
        description: string;
        refundAddress?: string;
    };
    authorization: ReddiPaymentIntentAuthorization;
    createdAt?: string;
};
export type ReddiPaymentObservationRecord = {
    schemaVersion: typeof REDDI_PAYMENT_OBSERVATION_SCHEMA_VERSION;
    id: string;
    canonicalization: typeof REDDI_PAYMENT_CANONICALIZATION;
    labels: ReddiPaymentRecordLabels;
    paymentIntentId?: string;
    agreementId?: string;
    observedAt: string;
    verifier: {
        name: string;
        version: string;
    };
    payment: {
        rail: string;
        network: ReddiCanonicalNetworkRef;
        asset: string;
        mint?: string;
        tokenProgram?: string;
        amountBaseUnits: string;
        payTo: string;
        sourceTokenAccount?: string;
        destinationTokenAccount: string;
        authority?: string;
        signature: string;
        instructionIndex: string;
        memo?: string;
        paymentProofRef: string;
    };
    confirmation: {
        slot: number;
        blockTime?: number;
        commitment: 'confirmed' | 'finalized';
    };
    status: 'observed_confirmed' | 'observed_failed' | 'observation_inconclusive';
};
export type ReddiRefundRecord = {
    schemaVersion: typeof REDDI_REFUND_RECORD_SCHEMA_VERSION;
    id: string;
    canonicalization: typeof REDDI_PAYMENT_CANONICALIZATION;
    labels: ReddiPaymentRecordLabels;
    originalPaymentObservationId: string;
    refundObservationId?: string;
    refundSignature?: string;
    amountBaseUnits: string;
    reason: string;
    state: 'requested' | 'operator_approved' | 'observed_confirmed' | 'failed' | 'manual_review';
    createdAt: string;
};
export type ReddiPaymentIdKind = 'job' | 'agreement' | 'payment-intent' | 'payment-observation' | 'refund';
export declare function canonicalizePaymentObject(value: unknown): string;
export declare function canonicalPaymentHash(value: unknown): string;
export declare function deriveReddiPaymentId(kind: ReddiPaymentIdKind, payload: unknown): string;
export declare function validatePaymentRecordLabels(labels: unknown, path?: string): ReddiPaymentRecordValidationResult<ReddiPaymentRecordLabels>;
export declare function createPaymentJobRecord(input: Omit<ReddiPaymentJobRecord, 'schemaVersion' | 'id' | 'canonicalization'> & {
    id?: string;
}): ReddiPaymentJobRecord;
export declare function validatePaymentJobRecord(input: unknown): ReddiPaymentRecordValidationResult<ReddiPaymentJobRecord>;
export declare function createPaymentAgreementRecord(input: Omit<ReddiPaymentAgreementRecord, 'schemaVersion' | 'id' | 'canonicalization'> & {
    id?: string;
}): ReddiPaymentAgreementRecord;
export declare function validatePaymentAgreementRecord(input: unknown): ReddiPaymentRecordValidationResult<ReddiPaymentAgreementRecord>;
export declare function createPaymentIntentRecord(input: Omit<ReddiPaymentIntentRecord, 'schemaVersion' | 'id' | 'canonicalization'> & {
    id?: string;
}): ReddiPaymentIntentRecord;
export declare function createPaymentIntentDraft(input: Omit<ReddiPaymentIntentRecord, 'schemaVersion' | 'id' | 'canonicalization' | 'authorization'> & {
    id?: string;
    policyDecisionRef?: string;
    operatorApprovalRequired?: boolean;
}): ReddiPaymentIntentRecord;
export declare function validatePaymentIntentRecord(input: unknown): ReddiPaymentRecordValidationResult<ReddiPaymentIntentRecord>;
export declare function formatPaymentObservationProofRef(input: {
    network: ReddiCanonicalNetworkRef;
    asset: string;
    signature: string;
    instructionIndex: string | number;
    mint?: string;
    amountBaseUnits: string;
}): string;
export declare function createPaymentObservationRecord(input: Omit<ReddiPaymentObservationRecord, 'schemaVersion' | 'id' | 'canonicalization' | 'payment'> & {
    id?: string;
    payment: Omit<ReddiPaymentObservationRecord['payment'], 'paymentProofRef'> & {
        paymentProofRef?: string;
    };
}): ReddiPaymentObservationRecord;
export declare function validatePaymentObservationRecord(input: unknown): ReddiPaymentRecordValidationResult<ReddiPaymentObservationRecord>;
export declare function createRefundRecord(input: Omit<ReddiRefundRecord, 'schemaVersion' | 'id' | 'canonicalization'> & {
    id?: string;
}): ReddiRefundRecord;
export declare function validateRefundRecord(input: unknown): ReddiPaymentRecordValidationResult<ReddiRefundRecord>;
