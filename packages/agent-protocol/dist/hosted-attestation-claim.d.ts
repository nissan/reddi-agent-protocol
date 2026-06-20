import { type OffchainReputationPreview } from './offchain-reputation-preview.js';
import { type ReceiptEvidenceBinding } from './receipt-evidence-binding.js';
export declare const HOSTED_ATTESTATION_CLAIM_SCHEMA_VERSION: "reddi.hosted-attestation-claim.v1";
export type HostedAttestationClaimStatus = 'hosted_attestation_ready' | 'publication_gate_pending' | 'insufficient_evidence' | 'blocked';
export type HostedAttestationPublicationGate = {
    issue: 395;
    state: 'claim_contract_ready' | 'pending' | 'blocked';
    evidenceRef?: string;
    reviewedAt?: string;
};
export type HostedAttestationOperatorApproval = {
    approved: boolean;
    evidenceRef: string;
    approvedAt?: string;
};
export type HostedAttestationProofRef = {
    sourceProofRef: string;
    attestationProofRef: string;
    hostedBy: 'reddi';
    reviewedAt?: string;
};
export type HostedAttestationClaimReasonCode = 'binding_valid' | 'preview_ready' | 'hosted_attestation_evidence_present' | 'operator_approval_present' | 'publication_gate_present' | 'buyer_facing_claim_disabled' | 'not_quasar_backed' | 'missing_claim_id' | 'malformed_claim' | 'malformed_binding' | 'malformed_preview' | 'preview_not_ready' | 'insufficient_evidence' | 'unsafe_live_guardrail' | 'source_not_hosted' | 'attestation_not_hosted_backed' | 'missing_source_proof' | 'missing_hosted_attestation_proof' | 'missing_attestation' | 'attestation_not_passed' | 'source_mismatch' | 'evidence_mismatch' | 'missing_operator_approval' | 'publication_gate_missing' | 'publication_gate_blocked';
export type HostedAttestationClaim = {
    schemaVersion: typeof HOSTED_ATTESTATION_CLAIM_SCHEMA_VERSION;
    id: string;
    status: HostedAttestationClaimStatus;
    subject: OffchainReputationPreview['subject'];
    source: ReceiptEvidenceBinding['source'];
    backing: {
        claimKind: 'hosted_attestation_backed';
        attestationKind: NonNullable<ReceiptEvidenceBinding['attestation']>['trustBoundary'] | 'none';
        reputationKind: 'offchain_preview';
        quasarBacking: {
            status: 'not_quasar_backed';
            instructionFlow: 'not_built';
            promotionChecklistIssue: 441;
        };
        hostedAttestationBacking: {
            status: 'ready' | 'pending' | 'blocked';
            sourceProofRef?: string;
            attestationProofRef?: string;
            hostedBy?: 'reddi';
            operatorApprovalEvidenceRef?: string;
            publicationGateEvidenceRef?: string;
            publicationGateIssue: 395;
        };
    };
    evidenceSummary: OffchainReputationPreview['evidenceSummary'] & {
        previewId: string;
        sourceProofRef?: string;
        attestationProofRef?: string;
        operatorApprovalEvidenceRef?: string;
        publicationGateEvidenceRef?: string;
    };
    previewEvent?: OffchainReputationPreview['previewEvent'];
    display: {
        label: 'Hosted attestation ready' | 'Publication gate pending' | 'Insufficient evidence' | 'Blocked';
        explanation: string;
        buyerFacingClaimAllowed: false;
    };
    reasonCodes: HostedAttestationClaimReasonCode[];
    guardrails: {
        reputationMutated: false;
        quasarInstructionBuilt: false;
        walletSigning: false;
        rpcCall: false;
        hostedRegistryWrite: false;
        marketplacePublished: false;
        livePaymentExecuted: false;
        providerCall: false;
    };
    createdAt: string;
};
export type HostedAttestationClaimInput = {
    id: string;
    binding: ReceiptEvidenceBinding;
    preview: OffchainReputationPreview;
    hostedAttestationProof?: HostedAttestationProofRef;
    operatorApproval?: HostedAttestationOperatorApproval;
    publicationGate?: HostedAttestationPublicationGate;
    createdAt: string;
};
export type HostedAttestationClaimResult = {
    ok: true;
    claim: HostedAttestationClaim;
} | {
    ok: false;
    claim: HostedAttestationClaim;
};
export declare function deriveHostedAttestationClaim(input: HostedAttestationClaimInput): HostedAttestationClaimResult;
