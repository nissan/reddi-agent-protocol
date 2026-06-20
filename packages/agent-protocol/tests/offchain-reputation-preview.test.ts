import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyAttestationToReputation,
  createAttestationRecord,
  createEvidenceArchiveRecord,
  createReceiptEvidenceBinding,
  createReddiReceipt,
  deriveOffchainReputationPreview,
  policyDecisionFromBudgetPolicyDecision,
  type AuddPaymentPlanPreflightDecision,
  type ReceiptEvidenceBinding,
  type ReceiptEvidenceBindingInput,
} from '../dist/index.js';

const createdAt = '2026-06-20T02:10:00.000Z';
const requestHash = 'sha256:4f2d0ef8455d0f0f41a37ea5e6a47f52c0d73d97f426097f159a98f8c8fb6b15';
const responseHash = 'sha256:5c9d1f1e3d0f02b5afcbb31dfbb3ab3de70ce1b84ff3ca856d272b2f4f7f4501';
const sourceId = 'source:hosted-rap:preview-ready';
const jobId = 'job:ard-onboarded:preview-ready';
const evidenceId = 'evidence:ard-onboarded:preview-ready';
const paymentProofRef = 'dry-run:audd-proof:preview-ready';

function validInput(): ReceiptEvidenceBindingInput {
  const policyDecision = policyDecisionFromBudgetPolicyDecision({
    allowed: true,
    reasonCodes: ['allowed'],
    quotedAmount: {
      amount: '2500000',
      asset: 'AUDD',
      network: 'solana-devnet',
      source: sourceId,
      specialist: 'listing:preview-ready',
    },
    remainingBudget: { perRequest: '3000000' },
    auditNotes: ['Allowed by local AUDD dry-run policy.'],
  });

  const receipt = createReddiReceipt({
    schemaVersion: 'reddi.receipt.v1',
    job: { id: jobId, type: 'ard-onboarded-agent-dry-run' },
    source: {
      id: sourceId,
      type: 'hosted-rap-registry',
      uri: 'urn:reddi:marketplace-listing:previewReady',
    },
    payer: { id: 'buyer:fixture' },
    specialist: { id: 'listing:preview-ready' },
    protocol: { name: 'Reddi Agent Protocol', version: '0.1.0' },
    payment: {
      network: 'solana-devnet',
      asset: 'AUDD',
      amount: '2500000',
      paymentProofRef,
    },
    requestHash,
    responseHash,
    evidenceRef: 'file://fixtures/evidence/ard-onboarded-preview-ready.json',
    policyDecision,
    attestationStatus: 'attested',
    createdAt,
  });

  const evidencePayload = {
    request: { hash: requestHash },
    response: { hash: responseHash },
    resultSummary: 'Dry-run workflow completed with redacted request and response hashes only.',
  };

  const evidence = createEvidenceArchiveRecord({
    id: evidenceId,
    receiptId: jobId,
    sourceId,
    requestHash,
    responseHash,
    evidenceRef: receipt.evidenceRef,
    createdAt,
    evidencePayload,
  });

  const attestation = createAttestationRecord({
    schemaVersion: 'reddi.attestation.v1',
    id: 'attestation:ard-onboarded:preview-ready',
    receiptId: jobId,
    evidenceId,
    evidenceRef: evidence.evidenceRef,
    evidenceHash: evidence.evidenceHash,
    attestor: { id: 'attestor:local-fixture', type: 'local-fixture' },
    trustBoundary: 'self_attested',
    verdict: 'passed',
    workStatus: 'completed',
    confidence: 92,
    rubric: {
      dimensions: [
        { id: 'evidence_integrity', score: 95, weight: 1, summary: 'Evidence hashes match.', reasonCodes: ['hashes_match'] },
        { id: 'policy_compliance', score: 90, weight: 1, summary: 'Policy decision and payment proof are present.', reasonCodes: ['policy_bound'] },
        { id: 'delivery_quality', score: 90, weight: 1, summary: 'Dry-run output met fixture expectations.', reasonCodes: ['fixture_passed'] },
      ],
    },
    createdAt,
  });

  const reputation = applyAttestationToReputation(attestation, undefined, {
    subject: { id: 'listing:preview-ready', type: 'listing' },
    now: createdAt,
  });
  if (!reputation.ok) throw new Error('unexpected reputation fixture failure');

  const paymentPreflight: AuddPaymentPlanPreflightDecision = {
    allowed: true,
    reasonCodes: ['audd_payment_plan_allowed'],
    paymentProofRef,
    policyDecision,
    paymentPlan: {
      schemaVersion: 'reddi.audd-payment-plan.v1',
      asset: 'AUDD',
      network: 'solana-devnet',
      mint: 'AUDDdev111111111111111111111111111111111111',
      payee: 'solana:payeeFixture111111111111111111111111111111',
      settlementAccount: 'solana:settlementFixture1111111111111111111111',
      amount: '2500000',
      quoteExpiresAt: '2026-06-20T03:00:00.000Z',
      failurePolicy: { mode: 'no_charge_on_failure', description: 'Dry-run failure does not charge.' },
      refundPolicy: { mode: 'manual_review', description: 'Refunds require manual review.' },
      evidenceRequired: true,
      paymentMode: 'dry-run',
    },
    auditNotes: ['Allowed by local AUDD dry-run policy.'],
  };

  return {
    id: 'binding:ard-onboarded:preview-ready',
    source: {
      kind: 'hosted-rap-registry',
      sourceId,
      catalogRef: '/.well-known/ai-catalog.json',
      listingId: 'previewReady',
      rawSnapshotRef: 'sha256:hosted-rap-ai-catalog-preview-fixture',
    },
    receipt,
    evidence,
    evidencePayload,
    paymentPreflight,
    attestation,
    reputationEventDraft: reputation.event,
    createdAt,
  };
}

function validBinding(): ReceiptEvidenceBinding {
  return createReceiptEvidenceBinding(validInput());
}

describe('off-chain reputation preview', () => {
  it('derives a non-mutating preview from a receipt/evidence binding', () => {
    const result = deriveOffchainReputationPreview({
      id: 'preview:listing:preview-ready',
      binding: validBinding(),
      createdAt,
    });

    assert.equal(result.ok, true);
    assert.equal(result.preview.schemaVersion, 'reddi.offchain-reputation-preview.v1');
    assert.equal(result.preview.status, 'preview_ready');
    assert.equal(result.preview.subject.id, 'listing:preview-ready');
    assert.equal(result.preview.backing.reputationKind, 'offchain_preview');
    assert.equal(result.preview.backing.attestationKind, 'self_attested');
    assert.equal(result.preview.backing.quasarBacking.status, 'compatibility_pending');
    assert.equal(result.preview.backing.quasarBacking.compatibilityIssue, 390);
    assert.equal(result.preview.backing.quasarBacking.instructionFlow, 'not_built');
    assert.equal(result.preview.previewEvent?.id, 'reputation:attestation:ard-onboarded:preview-ready');
    assert.equal(result.preview.display.buyerFacingClaimAllowed, false);
    assert.deepEqual(result.preview.guardrails, {
      reputationMutated: false,
      quasarInstructionBuilt: false,
      walletSigning: false,
      rpcCall: false,
      hostedRegistryWrite: false,
      marketplacePublished: false,
      livePaymentExecuted: false,
    });
  });

  it('keeps missing attestation or reputation draft as insufficient evidence', () => {
    const missingAttestation = deriveOffchainReputationPreview({
      id: 'preview:missing-attestation',
      binding: { ...validBinding(), attestation: undefined },
      createdAt,
    });
    assert.equal(missingAttestation.ok, true);
    assert.equal(missingAttestation.preview.status, 'insufficient_evidence');
    assert.ok(missingAttestation.preview.reasonCodes.includes('missing_attestation'));
    assert.equal(missingAttestation.preview.previewEvent, undefined);

    const missingDraft = deriveOffchainReputationPreview({
      id: 'preview:missing-draft',
      binding: { ...validBinding(), reputationEventDraft: undefined },
      createdAt,
    });
    assert.equal(missingDraft.ok, true);
    assert.equal(missingDraft.preview.status, 'insufficient_evidence');
    assert.ok(missingDraft.preview.reasonCodes.includes('missing_reputation_draft'));
    assert.equal(missingDraft.preview.display.buyerFacingClaimAllowed, false);
  });

  it('blocks denied policy and payment preflight evidence', () => {
    const binding = validBinding();
    const result = deriveOffchainReputationPreview({
      id: 'preview:denied-payment',
      binding: {
        ...binding,
        receipt: {
          ...binding.receipt,
          policyDecision: { ...binding.receipt.policyDecision, allowed: false },
        },
        payment: {
          ...binding.payment,
          preflightAllowed: false,
          reasonCodes: ['buyer_policy_missing'],
        },
      },
      createdAt,
    });

    assert.equal(result.ok, false);
    assert.equal(result.preview.status, 'blocked');
    assert.ok(result.preview.reasonCodes.includes('policy_denied'));
    assert.ok(result.preview.reasonCodes.includes('payment_preflight_denied'));
  });

  it('blocks malformed evidence summaries and unsafe live guardrails', () => {
    const binding = validBinding();
    const result = deriveOffchainReputationPreview({
      id: 'preview:unsafe-guardrail',
      binding: {
        ...binding,
        evidence: { ...binding.evidence, evidenceHash: '' },
        guardrails: { ...binding.guardrails, rpcCall: true },
      } as unknown as ReceiptEvidenceBinding,
      createdAt,
    });

    assert.equal(result.ok, false);
    assert.equal(result.preview.status, 'blocked');
    assert.ok(result.preview.reasonCodes.includes('missing_evidence_summary'));
    assert.ok(result.preview.reasonCodes.includes('unsafe_live_guardrail'));
  });

  it('fails closed instead of throwing for schema-compatible malformed bindings', () => {
    const binding = validBinding();
    const result = deriveOffchainReputationPreview({
      id: 'preview:malformed-binding',
      binding: {
        schemaVersion: binding.schemaVersion,
        id: binding.id,
        source: binding.source,
        attestation: binding.attestation,
        reputationEventDraft: binding.reputationEventDraft,
        createdAt: binding.createdAt,
      } as unknown as ReceiptEvidenceBinding,
      createdAt,
    });

    assert.equal(result.ok, false);
    assert.equal(result.preview.status, 'blocked');
    assert.ok(result.preview.reasonCodes.includes('malformed_binding'));
    assert.equal(result.preview.display.buyerFacingClaimAllowed, false);
  });

  it('blocks failed, disputed, or refunded attestations instead of producing a positive claim', () => {
    for (const verdict of ['failed', 'disputed', 'refunded'] as const) {
      const binding = validBinding();
      const result = deriveOffchainReputationPreview({
        id: `preview:${verdict}`,
        binding: {
          ...binding,
          receipt: { ...binding.receipt, attestationStatus: 'failed' },
          attestation: { ...binding.attestation!, verdict },
        },
        createdAt,
      });

      assert.equal(result.ok, false);
      assert.equal(result.preview.status, 'blocked');
      assert.equal(result.preview.previewEvent, undefined);
      assert.ok(result.preview.reasonCodes.includes('attestation_not_passed'));
      assert.equal(result.preview.display.buyerFacingClaimAllowed, false);
    }
  });

  it('fails closed on mismatched reputation event ids', () => {
    const binding = validBinding();
    const result = deriveOffchainReputationPreview({
      id: 'preview:mismatched-event',
      binding: {
        ...binding,
        reputationEventDraft: {
          ...binding.reputationEventDraft!,
          evidenceId: 'evidence:other',
        },
      },
      createdAt,
    });

    assert.equal(result.ok, false);
    assert.equal(result.preview.status, 'blocked');
    assert.ok(result.preview.reasonCodes.includes('reputation_event_mismatch'));
    assert.equal(result.preview.display.buyerFacingClaimAllowed, false);
  });
});
