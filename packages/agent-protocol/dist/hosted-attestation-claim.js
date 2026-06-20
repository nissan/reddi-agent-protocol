import { OFFCHAIN_REPUTATION_PREVIEW_SCHEMA_VERSION, } from './offchain-reputation-preview.js';
import { RECEIPT_EVIDENCE_BINDING_SCHEMA_VERSION, } from './receipt-evidence-binding.js';
export const HOSTED_ATTESTATION_CLAIM_SCHEMA_VERSION = 'reddi.hosted-attestation-claim.v1';
const GUARDRAILS = {
    reputationMutated: false,
    quasarInstructionBuilt: false,
    walletSigning: false,
    rpcCall: false,
    hostedRegistryWrite: false,
    marketplacePublished: false,
    livePaymentExecuted: false,
    providerCall: false,
};
export function deriveHostedAttestationClaim(input) {
    const reasonCodes = [];
    const binding = input.binding;
    const preview = input.preview;
    if (!isNonEmptyString(input.id))
        reasonCodes.push('missing_claim_id');
    if (!isNonEmptyString(input.createdAt) || Number.isNaN(Date.parse(input.createdAt)))
        reasonCodes.push('malformed_claim');
    if (!binding || binding.schemaVersion !== RECEIPT_EVIDENCE_BINDING_SCHEMA_VERSION)
        reasonCodes.push('malformed_binding');
    if (!preview || preview.schemaVersion !== OFFCHAIN_REPUTATION_PREVIEW_SCHEMA_VERSION)
        reasonCodes.push('malformed_preview');
    if (!bindingHasCoreShape(binding))
        reasonCodes.push('malformed_binding');
    if (!previewHasCoreShape(preview))
        reasonCodes.push('malformed_preview');
    if (!bindingGuardrailsAreSafe(binding) || !previewGuardrailsAreSafe(preview))
        reasonCodes.push('unsafe_live_guardrail');
    if (binding?.source?.kind !== 'hosted-rap-registry')
        reasonCodes.push('source_not_hosted');
    if (!binding?.attestation)
        reasonCodes.push('missing_attestation');
    if (binding?.attestation && (binding.attestation.verdict !== 'passed' || binding.receipt?.attestationStatus !== 'attested')) {
        reasonCodes.push('attestation_not_passed');
    }
    if (binding?.attestation && !hostedAttestationBoundaryIsSupported(binding.attestation.trustBoundary)) {
        reasonCodes.push('attestation_not_hosted_backed');
    }
    if (preview?.status !== 'preview_ready') {
        reasonCodes.push(preview?.status === 'insufficient_evidence' ? 'insufficient_evidence' : 'preview_not_ready');
    }
    if (preview?.status === 'preview_ready' && !previewSourceAndSubjectMatchBinding(preview, binding)) {
        reasonCodes.push('source_mismatch');
    }
    if (!previewEvidenceMatchesBinding(preview, binding))
        reasonCodes.push('evidence_mismatch');
    if (!isNonEmptyString(input.hostedAttestationProof?.sourceProofRef))
        reasonCodes.push('missing_source_proof');
    if (!hostedAttestationProofIsPresent(input.hostedAttestationProof)) {
        reasonCodes.push('missing_hosted_attestation_proof');
    }
    if (!operatorApprovalIsPresent(input.operatorApproval))
        reasonCodes.push('missing_operator_approval');
    if (!input.publicationGate || input.publicationGate.issue !== 395 || !isNonEmptyString(input.publicationGate.evidenceRef)) {
        reasonCodes.push('publication_gate_missing');
    }
    else if (input.publicationGate.state === 'blocked') {
        reasonCodes.push('publication_gate_blocked');
    }
    else if (input.publicationGate.state !== 'claim_contract_ready') {
        reasonCodes.push('publication_gate_missing');
    }
    const blockingReason = reasonCodes.find((code) => [
        'missing_claim_id',
        'malformed_claim',
        'malformed_binding',
        'malformed_preview',
        'preview_not_ready',
        'unsafe_live_guardrail',
        'source_not_hosted',
        'attestation_not_hosted_backed',
        'attestation_not_passed',
        'source_mismatch',
        'evidence_mismatch',
        'publication_gate_blocked',
    ].includes(code));
    const status = blockingReason
        ? 'blocked'
        : reasonCodes.includes('insufficient_evidence') || reasonCodes.includes('missing_attestation')
            ? 'insufficient_evidence'
            : reasonCodes.includes('missing_source_proof')
                || reasonCodes.includes('missing_hosted_attestation_proof')
                || reasonCodes.includes('missing_operator_approval')
                || reasonCodes.includes('publication_gate_missing')
                ? 'publication_gate_pending'
                : 'hosted_attestation_ready';
    const normalizedReasonCodes = unique([
        ...(status === 'hosted_attestation_ready'
            ? [
                'binding_valid',
                'preview_ready',
                'hosted_attestation_evidence_present',
                'operator_approval_present',
                'publication_gate_present',
            ]
            : []),
        ...reasonCodes,
        'buyer_facing_claim_disabled',
        'not_quasar_backed',
    ]);
    const claim = {
        schemaVersion: HOSTED_ATTESTATION_CLAIM_SCHEMA_VERSION,
        id: input.id,
        status,
        subject: preview?.subject ?? { id: 'unknown', type: 'listing' },
        source: binding?.source ?? { kind: 'static-fixture', sourceId: 'unknown', fixtureRef: 'unknown' },
        backing: {
            claimKind: 'hosted_attestation_backed',
            attestationKind: binding?.attestation?.trustBoundary ?? 'none',
            reputationKind: 'offchain_preview',
            quasarBacking: {
                status: 'not_quasar_backed',
                instructionFlow: 'not_built',
                promotionChecklistIssue: 441,
            },
            hostedAttestationBacking: {
                status: status === 'hosted_attestation_ready' ? 'ready' : status === 'blocked' ? 'blocked' : 'pending',
                sourceProofRef: input.hostedAttestationProof?.sourceProofRef,
                attestationProofRef: input.hostedAttestationProof?.attestationProofRef,
                hostedBy: input.hostedAttestationProof?.hostedBy,
                operatorApprovalEvidenceRef: input.operatorApproval?.evidenceRef,
                publicationGateEvidenceRef: input.publicationGate?.evidenceRef,
                publicationGateIssue: 395,
            },
        },
        evidenceSummary: {
            ...(preview?.evidenceSummary ?? {
                bindingId: input.id,
                receiptId: '',
                evidenceId: '',
                evidenceHash: '',
                evidenceRef: '',
                paymentProofRef: '',
            }),
            previewId: preview?.id ?? '',
            sourceProofRef: input.hostedAttestationProof?.sourceProofRef,
            attestationProofRef: input.hostedAttestationProof?.attestationProofRef,
            operatorApprovalEvidenceRef: input.operatorApproval?.evidenceRef,
            publicationGateEvidenceRef: input.publicationGate?.evidenceRef,
        },
        previewEvent: status === 'hosted_attestation_ready' ? preview.previewEvent : undefined,
        display: {
            label: displayLabel(status),
            explanation: displayExplanation(status),
            buyerFacingClaimAllowed: false,
        },
        reasonCodes: normalizedReasonCodes,
        guardrails: GUARDRAILS,
        createdAt: input.createdAt,
    };
    return status === 'hosted_attestation_ready' ? { ok: true, claim } : { ok: false, claim };
}
function bindingHasCoreShape(binding) {
    return Boolean(binding?.receipt
        && binding.evidence
        && binding.payment
        && binding.guardrails
        && typeof binding.receipt === 'object'
        && typeof binding.evidence === 'object'
        && typeof binding.payment === 'object'
        && typeof binding.guardrails === 'object');
}
function previewHasCoreShape(preview) {
    return Boolean(preview?.evidenceSummary
        && preview.display
        && preview.guardrails
        && preview.backing
        && typeof preview.evidenceSummary === 'object'
        && typeof preview.display === 'object'
        && typeof preview.guardrails === 'object'
        && typeof preview.backing === 'object');
}
function bindingGuardrailsAreSafe(binding) {
    if (!binding?.guardrails)
        return false;
    return binding.guardrails.rawPromptStored === false
        && binding.guardrails.rawOutputStored === false
        && binding.guardrails.livePaymentExecuted === false
        && binding.guardrails.walletSigning === false
        && binding.guardrails.rpcCall === false
        && binding.guardrails.hostedRegistryRequired === false
        && binding.guardrails.reputationMutated === false;
}
function previewGuardrailsAreSafe(preview) {
    if (!preview?.guardrails || preview.display?.buyerFacingClaimAllowed !== false)
        return false;
    return preview.guardrails.reputationMutated === false
        && preview.guardrails.quasarInstructionBuilt === false
        && preview.guardrails.walletSigning === false
        && preview.guardrails.rpcCall === false
        && preview.guardrails.hostedRegistryWrite === false
        && preview.guardrails.marketplacePublished === false
        && preview.guardrails.livePaymentExecuted === false;
}
function previewEvidenceMatchesBinding(preview, binding) {
    if (!preview?.evidenceSummary || !bindingHasCoreShape(binding))
        return false;
    return preview.evidenceSummary.bindingId === binding?.id
        && preview.evidenceSummary.receiptId === binding.receipt.id
        && preview.evidenceSummary.evidenceId === binding.evidence.id
        && preview.evidenceSummary.evidenceHash === binding.evidence.evidenceHash
        && preview.evidenceSummary.evidenceRef === binding.receipt.evidenceRef
        && preview.evidenceSummary.paymentProofRef === binding.receipt.paymentProofRef
        && preview.evidenceSummary.attestationId === binding.attestation?.id
        && preview.evidenceSummary.reputationEventDraftId === binding.reputationEventDraft?.id;
}
function previewSourceAndSubjectMatchBinding(preview, binding) {
    if (!preview || !bindingHasCoreShape(binding))
        return false;
    if (JSON.stringify(preview.source) !== JSON.stringify(binding?.source))
        return false;
    if (binding?.source.kind === 'hosted-rap-registry') {
        return preview.subject.id === binding.source.listingId
            && preview.previewEvent?.subjectId === binding.source.listingId;
    }
    return false;
}
function operatorApprovalIsPresent(approval) {
    return approval?.approved === true && isNonEmptyString(approval.evidenceRef);
}
function hostedAttestationBoundaryIsSupported(trustBoundary) {
    return trustBoundary === 'reddi_attested' || trustBoundary === 'verified';
}
function hostedAttestationProofIsPresent(proof) {
    return proof?.hostedBy === 'reddi'
        && isNonEmptyString(proof.sourceProofRef)
        && isNonEmptyString(proof.attestationProofRef);
}
function displayLabel(status) {
    if (status === 'hosted_attestation_ready')
        return 'Hosted attestation ready';
    if (status === 'publication_gate_pending')
        return 'Publication gate pending';
    if (status === 'insufficient_evidence')
        return 'Insufficient evidence';
    return 'Blocked';
}
function displayExplanation(status) {
    if (status === 'hosted_attestation_ready') {
        return 'Hosted attestation evidence is ready for downstream publication gates, but buyer-facing claims remain disabled until #395 permits them.';
    }
    if (status === 'publication_gate_pending') {
        return 'The preview has evidence, but hosted publication/operator gate metadata is not complete.';
    }
    if (status === 'insufficient_evidence') {
        return 'The binding or preview is missing attestation or reputation evidence required for a hosted-backed claim.';
    }
    return 'The binding or preview failed a safety gate and cannot produce a hosted-backed claim.';
}
function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function unique(items) {
    return [...new Set(items)];
}
