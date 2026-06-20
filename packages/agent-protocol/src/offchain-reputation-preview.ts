import type {
  ReputationEvent,
} from './attestation-reputation.js';
import {
  RECEIPT_EVIDENCE_BINDING_SCHEMA_VERSION,
  type ReceiptEvidenceBinding,
} from './receipt-evidence-binding.js';

export const OFFCHAIN_REPUTATION_PREVIEW_SCHEMA_VERSION = 'reddi.offchain-reputation-preview.v1' as const;

export type OffchainReputationPreviewStatus =
  | 'preview_ready'
  | 'blocked'
  | 'insufficient_evidence'
  | 'quasar_compatibility_pending';

export type OffchainReputationPreviewReasonCode =
  | 'binding_valid'
  | 'offchain_preview_only'
  | 'quasar_compatibility_pending'
  | 'buyer_facing_claim_disabled'
  | 'missing_binding_id'
  | 'malformed_binding'
  | 'unsafe_live_guardrail'
  | 'missing_source_ref'
  | 'policy_denied'
  | 'payment_preflight_denied'
  | 'missing_payment_proof'
  | 'missing_evidence_summary'
  | 'missing_attestation'
  | 'attestation_not_passed'
  | 'missing_reputation_draft'
  | 'reputation_event_mismatch';

export type OffchainReputationPreview = {
  schemaVersion: typeof OFFCHAIN_REPUTATION_PREVIEW_SCHEMA_VERSION;
  id: string;
  subject: { id: string; type: 'specialist' | 'provider' | 'listing' };
  source: ReceiptEvidenceBinding['source'];
  status: OffchainReputationPreviewStatus;
  backing: {
    reputationKind: 'offchain_preview';
    attestationKind:
      | 'none'
      | 'self_attested'
      | 'external_attested'
      | 'reddi_attested'
      | 'verified';
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
    label:
      | 'Off-chain preview'
      | 'Insufficient evidence'
      | 'Blocked'
      | 'Quasar compatibility pending';
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

export type OffchainReputationPreviewResult =
  | { ok: true; preview: OffchainReputationPreview }
  | { ok: false; preview: OffchainReputationPreview };

const GUARDRAILS: OffchainReputationPreview['guardrails'] = {
  reputationMutated: false,
  quasarInstructionBuilt: false,
  walletSigning: false,
  rpcCall: false,
  hostedRegistryWrite: false,
  marketplacePublished: false,
  livePaymentExecuted: false,
};

export function deriveOffchainReputationPreview(input: OffchainReputationPreviewInput): OffchainReputationPreviewResult {
  const binding = input.binding;
  const reasonCodes: OffchainReputationPreviewReasonCode[] = [];
  const evidenceSummary = createEvidenceSummary(input.id, binding);

  if (!isNonEmptyString(input.id)) reasonCodes.push('missing_binding_id');
  if (!isNonEmptyString(input.createdAt) || Number.isNaN(Date.parse(input.createdAt))) reasonCodes.push('malformed_binding');
  if (!binding || binding.schemaVersion !== RECEIPT_EVIDENCE_BINDING_SCHEMA_VERSION) reasonCodes.push('malformed_binding');
  if (!bindingHasCoreShape(binding)) reasonCodes.push('malformed_binding');
  if (!hasSourceRef(binding)) reasonCodes.push('missing_source_ref');
  if (!bindingGuardrailsAreSafe(binding)) reasonCodes.push('unsafe_live_guardrail');
  if (binding?.receipt?.policyDecision?.allowed !== true) reasonCodes.push('policy_denied');
  if (binding?.payment?.preflightAllowed !== true) reasonCodes.push('payment_preflight_denied');
  if (!isNonEmptyString(binding?.payment?.paymentProofRef) || binding?.payment?.paymentProofRef !== binding?.receipt?.paymentProofRef) {
    reasonCodes.push('missing_payment_proof');
  }
  if (!evidenceSummary) reasonCodes.push('missing_evidence_summary');

  const hasAttestation = Boolean(binding?.attestation);
  if (!hasAttestation) reasonCodes.push('missing_attestation');
  if (binding?.attestation && (binding.attestation.verdict !== 'passed' || binding?.receipt?.attestationStatus !== 'attested')) {
    reasonCodes.push('attestation_not_passed');
  }

  const hasReputationDraft = Boolean(binding?.reputationEventDraft);
  if (!hasReputationDraft) reasonCodes.push('missing_reputation_draft');
  if (hasAttestation && hasReputationDraft && !reputationDraftMatchesBinding(binding)) reasonCodes.push('reputation_event_mismatch');

  const blockingReason = reasonCodes.find((code) => [
    'missing_binding_id',
    'malformed_binding',
    'unsafe_live_guardrail',
    'missing_source_ref',
    'policy_denied',
    'payment_preflight_denied',
    'missing_payment_proof',
    'missing_evidence_summary',
    'attestation_not_passed',
    'reputation_event_mismatch',
  ].includes(code));

  const status: OffchainReputationPreviewStatus = blockingReason
    ? 'blocked'
    : !hasAttestation || !hasReputationDraft
      ? 'insufficient_evidence'
      : 'preview_ready';

  const normalizedReasonCodes = unique([
    ...(status === 'preview_ready' ? ['binding_valid' as const] : []),
    ...reasonCodes,
    'offchain_preview_only' as const,
    'quasar_compatibility_pending' as const,
    'buyer_facing_claim_disabled' as const,
  ]);

  const preview: OffchainReputationPreview = {
    schemaVersion: OFFCHAIN_REPUTATION_PREVIEW_SCHEMA_VERSION,
    id: input.id,
    subject: input.subject ?? inferSubject(binding),
    source: binding?.source ?? { kind: 'static-fixture', sourceId: 'unknown', fixtureRef: 'unknown' },
    status,
    backing: {
      reputationKind: 'offchain_preview',
      attestationKind: binding?.attestation?.trustBoundary ?? 'none',
      quasarBacking: {
        status: status === 'preview_ready' ? 'compatibility_pending' : 'not_quasar_backed',
        compatibilityIssue: 390,
        instructionFlow: 'not_built',
      },
      hostedAttestationBacking: 'not_published',
    },
    evidenceSummary: evidenceSummary ?? {
      bindingId: input.id,
      receiptId: '',
      evidenceId: '',
      evidenceHash: '',
      evidenceRef: '',
      paymentProofRef: '',
    },
    previewEvent: status === 'preview_ready' ? binding.reputationEventDraft : undefined,
    display: {
      label: displayLabel(status),
      explanation: displayExplanation(status),
      buyerFacingClaimAllowed: false,
    },
    reasonCodes: normalizedReasonCodes,
    guardrails: GUARDRAILS,
    createdAt: input.createdAt,
  };

  return status === 'blocked' ? { ok: false, preview } : { ok: true, preview };
}

function createEvidenceSummary(id: string, binding: ReceiptEvidenceBinding | undefined): OffchainReputationPreview['evidenceSummary'] | undefined {
  if (!binding) return undefined;
  if (!isNonEmptyString(id)
    || !isNonEmptyString(binding.receipt?.id)
    || !isNonEmptyString(binding.evidence?.id)
    || !isNonEmptyString(binding.evidence?.evidenceHash)
    || !isNonEmptyString(binding.receipt?.evidenceRef)
    || !isNonEmptyString(binding.receipt?.paymentProofRef)) {
    return undefined;
  }

  return {
    bindingId: binding.id,
    receiptId: binding.receipt.id,
    evidenceId: binding.evidence.id,
    evidenceHash: binding.evidence.evidenceHash,
    evidenceRef: binding.receipt.evidenceRef,
    paymentProofRef: binding.receipt.paymentProofRef,
    attestationId: binding.attestation?.id,
    reputationEventDraftId: binding.reputationEventDraft?.id,
  };
}

function bindingGuardrailsAreSafe(binding: ReceiptEvidenceBinding | undefined): boolean {
  if (!binding?.guardrails) return false;
  return binding.guardrails.rawPromptStored === false
    && binding.guardrails.rawOutputStored === false
    && binding.guardrails.livePaymentExecuted === false
    && binding.guardrails.walletSigning === false
    && binding.guardrails.rpcCall === false
    && binding.guardrails.hostedRegistryRequired === false
    && binding.guardrails.reputationMutated === false;
}

function bindingHasCoreShape(binding: ReceiptEvidenceBinding | undefined): boolean {
  return Boolean(
    binding?.receipt
    && binding.evidence
    && binding.payment
    && binding.guardrails
    && typeof binding.receipt === 'object'
    && typeof binding.evidence === 'object'
    && typeof binding.payment === 'object'
    && typeof binding.guardrails === 'object',
  );
}

function hasSourceRef(binding: ReceiptEvidenceBinding | undefined): boolean {
  if (!binding?.source?.sourceId) return false;
  return [binding.source.catalogRef, binding.source.fixtureRef, binding.source.listingId, binding.source.profileId, binding.source.rawSnapshotRef]
    .some(isNonEmptyString);
}

function reputationDraftMatchesBinding(binding: ReceiptEvidenceBinding | undefined): boolean {
  if (!binding?.reputationEventDraft || !binding.attestation) return false;
  return binding.reputationEventDraft.receiptId === binding.receipt?.id
    && binding.reputationEventDraft.evidenceId === binding.evidence?.id
    && binding.reputationEventDraft.attestationId === binding.attestation.id
    && binding.reputationEventDraft.verdict === binding.attestation.verdict
    && binding.reputationEventDraft.trustBoundary === binding.attestation.trustBoundary;
}

function inferSubject(binding: ReceiptEvidenceBinding | undefined): OffchainReputationPreview['subject'] {
  const draft = binding?.reputationEventDraft;
  if (draft?.subjectId) {
    return {
      id: draft.subjectId,
      type: binding?.source?.listingId ? 'listing' : 'specialist',
    };
  }
  if (binding?.source?.listingId) return { id: binding.source.listingId, type: 'listing' };
  if (binding?.source?.profileId) return { id: binding.source.profileId, type: 'specialist' };
  return { id: 'unknown', type: 'specialist' };
}

function displayLabel(status: OffchainReputationPreviewStatus): OffchainReputationPreview['display']['label'] {
  if (status === 'blocked') return 'Blocked';
  if (status === 'insufficient_evidence') return 'Insufficient evidence';
  if (status === 'quasar_compatibility_pending') return 'Quasar compatibility pending';
  return 'Off-chain preview';
}

function displayExplanation(status: OffchainReputationPreviewStatus): string {
  if (status === 'blocked') return 'The binding cannot produce a reputation preview until the failed gate is corrected.';
  if (status === 'insufficient_evidence') return 'Evidence exists, but the binding is missing attestation or reputation draft data required for a score preview.';
  if (status === 'quasar_compatibility_pending') return 'Quasar compatibility is tracked by #390 and no instruction flow is built in this preview.';
  return 'This is an off-chain reputation preview only; it does not mutate reputation or create a buyer-facing trust claim.';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
