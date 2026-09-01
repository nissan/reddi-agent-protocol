import { type AttestationRecord, type ReputationEvent } from './attestation-reputation.js';
import type { AuddPaymentPlanPreflightDecision } from './audd-payment-plan.js';
import { type EvidenceArchiveRecord } from './evidence-archive.js';
import { type ReddiPaymentObservationRecord } from './payment-records.js';
import { type ReddiReceipt } from './receipts.js';
export declare const RECEIPT_EVIDENCE_BINDING_SCHEMA_VERSION: "reddi.receipt-evidence-binding.v1";
export type ReceiptEvidenceSourceKind = 'ai-catalog' | 'ard-registry' | 'hosted-rap-registry' | 'source-adapter' | 'static-fixture';
export type ReceiptEvidenceSourceRef = {
    kind: ReceiptEvidenceSourceKind;
    sourceId: string;
    catalogRef?: string;
    fixtureRef?: string;
    listingId?: string;
    profileId?: string;
    rawSnapshotRef?: string;
};
export type ReceiptEvidenceBindingInput = {
    id: string;
    source: ReceiptEvidenceSourceRef;
    receipt: ReddiReceipt;
    evidence: EvidenceArchiveRecord;
    evidencePayload?: unknown;
    paymentPreflight: AuddPaymentPlanPreflightDecision;
    paymentObservation?: ReddiPaymentObservationRecord;
    attestation?: AttestationRecord;
    reputationEventDraft?: ReputationEvent;
    createdAt: string;
};
export type ReceiptEvidenceBinding = {
    schemaVersion: typeof RECEIPT_EVIDENCE_BINDING_SCHEMA_VERSION;
    id: string;
    source: ReceiptEvidenceSourceRef;
    receipt: {
        id: string;
        sourceId: string;
        policyDecision: ReddiReceipt['policyDecision'];
        paymentProofRef: string;
        requestHash: string;
        responseHash: string;
        evidenceRef: string;
        attestationStatus: ReddiReceipt['attestationStatus'];
    };
    evidence: {
        id: string;
        receiptId: string;
        evidenceRef: string;
        evidenceHash: string;
        externalArchivePointer?: EvidenceArchiveRecord['externalArchivePointer'];
    };
    payment: {
        preflightAllowed: boolean;
        reasonCodes: AuddPaymentPlanPreflightDecision['reasonCodes'];
        paymentProofRef: string;
        planRef: {
            asset: string;
            network: string;
            amount: string;
            paymentMode: 'dry-run' | 'live';
            evidenceRequired: boolean;
        };
        observationRef?: {
            id: string;
            environment: string;
            eligibility: string;
            paymentProofRef: string;
            signature: string;
            mint?: string;
            tokenProgram?: string;
            instructionIndex: string;
        };
    };
    attestation?: {
        id: string;
        status: ReddiReceipt['attestationStatus'];
        verdict: AttestationRecord['verdict'];
        trustBoundary: AttestationRecord['trustBoundary'];
    };
    reputationEventDraft?: ReputationEvent;
    guardrails: {
        rawPromptStored: false;
        rawOutputStored: false;
        livePaymentExecuted: false;
        walletSigning: false;
        rpcCall: false;
        hostedRegistryRequired: false;
        reputationMutated: false;
    };
    createdAt: string;
};
export type ReceiptEvidenceBindingErrorCode = 'malformed_binding' | 'missing_source_ref' | 'missing_payment_preflight' | 'payment_preflight_denied' | 'payment_proof_mismatch' | 'payment_plan_mismatch' | 'payment_observation_mismatch' | 'payment_observation_ineligible' | 'unsupported_network_asset' | 'receipt_invalid' | 'evidence_invalid' | 'evidence_receipt_mismatch' | 'hash_mismatch' | 'attestation_mismatch' | 'reputation_event_mismatch' | 'raw_payload_leakage_rejected' | 'credential_leakage_rejected';
export type ReceiptEvidenceBindingError = {
    code: ReceiptEvidenceBindingErrorCode;
    path: string;
    message: string;
};
export type ReceiptEvidenceBindingResult = {
    ok: true;
    binding: ReceiptEvidenceBinding;
} | {
    ok: false;
    errors: ReceiptEvidenceBindingError[];
};
export declare function createReceiptEvidenceBinding(input: ReceiptEvidenceBindingInput): ReceiptEvidenceBinding;
export declare function deriveReceiptEvidenceBinding(input: ReceiptEvidenceBindingInput): ReceiptEvidenceBindingResult;
