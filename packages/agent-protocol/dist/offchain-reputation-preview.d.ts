import type { ReputationEvent } from './attestation-reputation.js';
import { type ReceiptEvidenceBinding } from './receipt-evidence-binding.js';
export declare const OFFCHAIN_REPUTATION_PREVIEW_SCHEMA_VERSION: "reddi.offchain-reputation-preview.v1";
export type OffchainReputationPreviewStatus = 'preview_ready' | 'blocked' | 'insufficient_evidence' | 'quasar_compatibility_pending';
export type OffchainReputationPreviewReasonCode = 'binding_valid' | 'offchain_preview_only' | 'quasar_compatibility_pending' | 'buyer_facing_claim_disabled' | 'missing_binding_id' | 'malformed_binding' | 'unsafe_live_guardrail' | 'missing_source_ref' | 'policy_denied' | 'payment_preflight_denied' | 'missing_payment_proof' | 'missing_evidence_summary' | 'missing_attestation' | 'attestation_not_passed' | 'missing_reputation_draft' | 'reputation_event_mismatch';
export type OffchainReputationPreview = {
    schemaVersion: typeof OFFCHAIN_REPUTATION_PREVIEW_SCHEMA_VERSION;
    id: string;
    subject: {
        id: string;
        type: 'specialist' | 'provider' | 'listing';
    };
    source: ReceiptEvidenceBinding['source'];
    status: OffchainReputationPreviewStatus;
    backing: {
        reputationKind: 'offchain_preview';
        attestationKind: 'none' | 'self_attested' | 'external_attested' | 'reddi_attested' | 'verified';
        quasarBacking: {
            status: 'not_quasar_backed' | 'compatibility_pending';
            compatibilityIssue: 390;
            instructionFlow: 'not_built';
        };
        hostedAttestationBacking: 'not_published';
    };
    evidenceSummary: {
        bindingId: string;
        receiptId: string;
        evidenceId: string;
        evidenceHash: string;
        evidenceRef: string;
        paymentProofRef: string;
        attestationId?: string;
        reputationEventDraftId?: string;
    };
    previewEvent?: ReputationEvent;
    display: {
        label: 'Off-chain preview' | 'Insufficient evidence' | 'Blocked' | 'Quasar compatibility pending';
        explanation: string;
        buyerFacingClaimAllowed: false;
    };
    reasonCodes: OffchainReputationPreviewReasonCode[];
    guardrails: {
        reputationMutated: false;
        quasarInstructionBuilt: false;
        walletSigning: false;
        rpcCall: false;
        hostedRegistryWrite: false;
        marketplacePublished: false;
        livePaymentExecuted: false;
    };
    createdAt: string;
};
export type OffchainReputationPreviewInput = {
    id: string;
    binding: ReceiptEvidenceBinding;
    subject?: OffchainReputationPreview['subject'];
    createdAt: string;
};
export type OffchainReputationPreviewResult = {
    ok: true;
    preview: OffchainReputationPreview;
} | {
    ok: false;
    preview: OffchainReputationPreview;
};
export declare function deriveOffchainReputationPreview(input: OffchainReputationPreviewInput): OffchainReputationPreviewResult;
