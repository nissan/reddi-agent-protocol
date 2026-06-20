import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  deriveHostedAttestationClaim,
  type HostedAttestationClaimInput,
  type OffchainReputationPreview,
  type ReceiptEvidenceBinding,
} from '../dist/index.js';

const createdAt = '2026-06-20T03:40:00.000Z';

function binding(overrides: Partial<ReceiptEvidenceBinding> = {}): ReceiptEvidenceBinding {
  return {
    schemaVersion: 'reddi.receipt-evidence-binding.v1',
    id: 'binding:hosted-attestation:ready',
    source: {
      kind: 'hosted-rap-registry',
      sourceId: 'source:hosted-attestation:ready',
      catalogRef: '/.well-known/ai-catalog.json',
      listingId: 'listing:hosted-attestation-ready',
      rawSnapshotRef: 'sha256:hosted-attestation-source-snapshot',
    },
    receipt: {
      id: 'job:hosted-attestation:ready',
      sourceId: 'source:hosted-attestation:ready',
      policyDecision: {
        schemaVersion: 'reddi.policy-decision.v1',
        allowed: true,
        reasonCodes: ['allowed'],
        quotedAmount: {
          amount: '2500000',
          asset: 'AUDD',
          network: 'solana-devnet',
          source: 'source:hosted-attestation:ready',
          specialist: 'listing:hosted-attestation-ready',
        },
        approvalState: 'approved',
        asset: 'AUDD',
        network: 'solana-devnet',
        auditNotes: ['Allowed by hosted attestation fixture.'],
      },
      paymentProofRef: 'dry-run:audd-proof:hosted-attestation-ready',
      requestHash: 'sha256:request-hosted-attestation-ready',
      responseHash: 'sha256:response-hosted-attestation-ready',
      evidenceRef: 'file://fixtures/evidence/hosted-attestation-ready.json',
      attestationStatus: 'attested',
    },
    evidence: {
      id: 'evidence:hosted-attestation:ready',
      receiptId: 'job:hosted-attestation:ready',
      evidenceRef: 'file://fixtures/evidence/hosted-attestation-ready.json',
      evidenceHash: 'sha256:evidence-hosted-attestation-ready',
    },
    payment: {
      preflightAllowed: true,
      reasonCodes: ['audd_payment_plan_allowed'],
      paymentProofRef: 'dry-run:audd-proof:hosted-attestation-ready',
      planRef: {
        asset: 'AUDD',
        network: 'solana-devnet',
        amount: '2500000',
        paymentMode: 'dry-run',
        evidenceRequired: true,
      },
    },
    attestation: {
      id: 'attestation:hosted-attestation:ready',
      status: 'attested',
      verdict: 'passed',
      trustBoundary: 'reddi_attested',
    },
    reputationEventDraft: {
      schemaVersion: 'reddi.reputation-event.v1',
      id: 'reputation:hosted-attestation:ready',
      subjectId: 'listing:hosted-attestation-ready',
      receiptId: 'job:hosted-attestation:ready',
      evidenceId: 'evidence:hosted-attestation:ready',
      attestationId: 'attestation:hosted-attestation:ready',
      verdict: 'passed',
      workStatus: 'completed',
      trustBoundary: 'reddi_attested',
      confidence: 92,
      rubricScore: 92,
      delta: 7,
      previousScore: 50,
      nextScore: 57,
      routingImpact: 'eligible',
      reasonCodes: ['attestation_passed'],
      createdAt,
    },
    guardrails: {
      rawPromptStored: false,
      rawOutputStored: false,
      livePaymentExecuted: false,
      walletSigning: false,
      rpcCall: false,
      hostedRegistryRequired: false,
      reputationMutated: false,
    },
    createdAt,
    ...overrides,
  };
}

function preview(bindingValue = binding(), overrides: Partial<OffchainReputationPreview> = {}): OffchainReputationPreview {
  return {
    schemaVersion: 'reddi.offchain-reputation-preview.v1',
    id: 'preview:hosted-attestation:ready',
    subject: { id: 'listing:hosted-attestation-ready', type: 'listing' },
    source: bindingValue.source,
    status: 'preview_ready',
    backing: {
      reputationKind: 'offchain_preview',
      attestationKind: 'reddi_attested',
      quasarBacking: {
        status: 'compatibility_pending',
        compatibilityIssue: 390,
        instructionFlow: 'not_built',
      },
      hostedAttestationBacking: 'not_published',
    },
    evidenceSummary: {
      bindingId: bindingValue.id,
      receiptId: bindingValue.receipt.id,
      evidenceId: bindingValue.evidence.id,
      evidenceHash: bindingValue.evidence.evidenceHash,
      evidenceRef: bindingValue.receipt.evidenceRef,
      paymentProofRef: bindingValue.receipt.paymentProofRef,
      attestationId: bindingValue.attestation?.id,
      reputationEventDraftId: bindingValue.reputationEventDraft?.id,
    },
    previewEvent: bindingValue.reputationEventDraft,
    display: {
      label: 'Off-chain preview',
      explanation: 'Preview only.',
      buyerFacingClaimAllowed: false,
    },
    reasonCodes: [
      'binding_valid',
      'offchain_preview_only',
      'quasar_compatibility_pending',
      'buyer_facing_claim_disabled',
    ],
    guardrails: {
      reputationMutated: false,
      quasarInstructionBuilt: false,
      walletSigning: false,
      rpcCall: false,
      hostedRegistryWrite: false,
      marketplacePublished: false,
      livePaymentExecuted: false,
    },
    createdAt,
    ...overrides,
  };
}

function validInput(overrides: Partial<HostedAttestationClaimInput> = {}): HostedAttestationClaimInput {
  const bindingValue = binding();
  return {
    id: 'hosted-claim:hosted-attestation:ready',
    binding: bindingValue,
    preview: preview(bindingValue),
    hostedAttestationProof: {
      sourceProofRef: 'source-proof:hosted-attestation-ready',
      attestationProofRef: 'hosted-attestation-proof:hosted-attestation-ready',
      hostedBy: 'reddi',
      reviewedAt: createdAt,
    },
    operatorApproval: {
      approved: true,
      evidenceRef: 'operator-approval:hosted-attestation-ready',
      approvedAt: createdAt,
    },
    publicationGate: {
      issue: 395,
      state: 'claim_contract_ready',
      evidenceRef: 'publication-gate:hosted-attestation-ready',
      reviewedAt: createdAt,
    },
    createdAt,
    ...overrides,
  };
}

describe('hosted attestation-backed reputation claim', () => {
  it('derives a hosted-backed claim from binding and preview without enabling buyer-facing claims', () => {
    const result = deriveHostedAttestationClaim(validInput());

    assert.equal(result.ok, true);
    assert.equal(result.claim.schemaVersion, 'reddi.hosted-attestation-claim.v1');
    assert.equal(result.claim.status, 'hosted_attestation_ready');
    assert.equal(result.claim.backing.claimKind, 'hosted_attestation_backed');
    assert.equal(result.claim.backing.attestationKind, 'reddi_attested');
    assert.equal(result.claim.backing.hostedAttestationBacking.status, 'ready');
    assert.equal(result.claim.backing.hostedAttestationBacking.sourceProofRef, 'source-proof:hosted-attestation-ready');
    assert.equal(result.claim.backing.hostedAttestationBacking.attestationProofRef, 'hosted-attestation-proof:hosted-attestation-ready');
    assert.equal(result.claim.backing.hostedAttestationBacking.hostedBy, 'reddi');
    assert.equal(result.claim.backing.hostedAttestationBacking.publicationGateIssue, 395);
    assert.equal(result.claim.evidenceSummary.sourceProofRef, 'source-proof:hosted-attestation-ready');
    assert.equal(result.claim.evidenceSummary.attestationProofRef, 'hosted-attestation-proof:hosted-attestation-ready');
    assert.equal(result.claim.backing.quasarBacking.status, 'not_quasar_backed');
    assert.equal(result.claim.backing.quasarBacking.instructionFlow, 'not_built');
    assert.equal(result.claim.backing.quasarBacking.promotionChecklistIssue, 441);
    assert.equal(result.claim.display.buyerFacingClaimAllowed, false);
    assert.equal(result.claim.previewEvent?.id, 'reputation:hosted-attestation:ready');
    assert.ok(result.claim.reasonCodes.includes('operator_approval_present'));
    assert.ok(result.claim.reasonCodes.includes('publication_gate_present'));
    assert.deepEqual(result.claim.guardrails, {
      reputationMutated: false,
      quasarInstructionBuilt: false,
      walletSigning: false,
      rpcCall: false,
      hostedRegistryWrite: false,
      marketplacePublished: false,
      livePaymentExecuted: false,
      providerCall: false,
    });
  });

  it('keeps otherwise valid evidence pending without operator approval or publication-gate metadata', () => {
    const result = deriveHostedAttestationClaim(validInput({
      operatorApproval: undefined,
      publicationGate: undefined,
    }));

    assert.equal(result.ok, false);
    assert.equal(result.claim.status, 'publication_gate_pending');
    assert.ok(result.claim.reasonCodes.includes('missing_operator_approval'));
    assert.ok(result.claim.reasonCodes.includes('publication_gate_missing'));
    assert.equal(result.claim.display.buyerFacingClaimAllowed, false);
    assert.equal(result.claim.previewEvent, undefined);
  });

  it('requires operator approval independently from publication metadata', () => {
    const result = deriveHostedAttestationClaim(validInput({
      operatorApproval: undefined,
    }));

    assert.equal(result.ok, false);
    assert.equal(result.claim.status, 'publication_gate_pending');
    assert.ok(result.claim.reasonCodes.includes('missing_operator_approval'));
    assert.ok(!result.claim.reasonCodes.includes('publication_gate_missing'));
    assert.equal(result.claim.display.buyerFacingClaimAllowed, false);
  });

  it('requires #395 publication metadata independently from operator approval', () => {
    const result = deriveHostedAttestationClaim(validInput({
      publicationGate: undefined,
    }));

    assert.equal(result.ok, false);
    assert.equal(result.claim.status, 'publication_gate_pending');
    assert.ok(result.claim.reasonCodes.includes('publication_gate_missing'));
    assert.ok(!result.claim.reasonCodes.includes('missing_operator_approval'));
    assert.equal(result.claim.display.buyerFacingClaimAllowed, false);
  });

  it('keeps malformed publication metadata pending or blocked', () => {
    const wrongIssue = deriveHostedAttestationClaim(validInput({
      publicationGate: {
        issue: 394 as 395,
        state: 'claim_contract_ready',
        evidenceRef: 'publication-gate:wrong-issue',
      },
    }));
    const missingEvidence = deriveHostedAttestationClaim(validInput({
      publicationGate: {
        issue: 395,
        state: 'claim_contract_ready',
        evidenceRef: ' ',
      },
    }));
    const pendingGate = deriveHostedAttestationClaim(validInput({
      publicationGate: {
        issue: 395,
        state: 'pending',
        evidenceRef: 'publication-gate:pending',
      },
    }));
    const blockedGate = deriveHostedAttestationClaim(validInput({
      publicationGate: {
        issue: 395,
        state: 'blocked',
        evidenceRef: 'publication-gate:blocked',
      },
    }));

    assert.equal(wrongIssue.ok, false);
    assert.equal(wrongIssue.claim.status, 'publication_gate_pending');
    assert.ok(wrongIssue.claim.reasonCodes.includes('publication_gate_missing'));
    assert.equal(missingEvidence.ok, false);
    assert.equal(missingEvidence.claim.status, 'publication_gate_pending');
    assert.ok(missingEvidence.claim.reasonCodes.includes('publication_gate_missing'));
    assert.equal(pendingGate.ok, false);
    assert.equal(pendingGate.claim.status, 'publication_gate_pending');
    assert.ok(pendingGate.claim.reasonCodes.includes('publication_gate_missing'));
    assert.equal(blockedGate.ok, false);
    assert.equal(blockedGate.claim.status, 'blocked');
    assert.ok(blockedGate.claim.reasonCodes.includes('publication_gate_blocked'));
  });

  it('keeps imported metadata pending when hosted source proof is missing', () => {
    const result = deriveHostedAttestationClaim(validInput({
      hostedAttestationProof: undefined,
    }));

    assert.equal(result.ok, false);
    assert.equal(result.claim.status, 'publication_gate_pending');
    assert.ok(result.claim.reasonCodes.includes('missing_source_proof'));
    assert.ok(result.claim.reasonCodes.includes('missing_hosted_attestation_proof'));
    assert.equal(result.claim.display.buyerFacingClaimAllowed, false);
    assert.equal(result.claim.previewEvent, undefined);
  });

  it('keeps partial hosted proof metadata pending', () => {
    const missingSource = deriveHostedAttestationClaim(validInput({
      hostedAttestationProof: {
        sourceProofRef: ' ',
        attestationProofRef: 'hosted-attestation-proof:present',
        hostedBy: 'reddi',
      },
    }));
    const missingAttestationProof = deriveHostedAttestationClaim(validInput({
      hostedAttestationProof: {
        sourceProofRef: 'source-proof:present',
        attestationProofRef: ' ',
        hostedBy: 'reddi',
      },
    }));
    const wrongHost = deriveHostedAttestationClaim(validInput({
      hostedAttestationProof: {
        sourceProofRef: 'source-proof:present',
        attestationProofRef: 'hosted-attestation-proof:present',
        hostedBy: 'external' as 'reddi',
      },
    }));

    assert.equal(missingSource.ok, false);
    assert.equal(missingSource.claim.status, 'publication_gate_pending');
    assert.ok(missingSource.claim.reasonCodes.includes('missing_source_proof'));
    assert.ok(missingSource.claim.reasonCodes.includes('missing_hosted_attestation_proof'));
    assert.equal(missingAttestationProof.ok, false);
    assert.equal(missingAttestationProof.claim.status, 'publication_gate_pending');
    assert.ok(missingAttestationProof.claim.reasonCodes.includes('missing_hosted_attestation_proof'));
    assert.equal(wrongHost.ok, false);
    assert.equal(wrongHost.claim.status, 'publication_gate_pending');
    assert.ok(wrongHost.claim.reasonCodes.includes('missing_hosted_attestation_proof'));
  });

  it('keeps insufficient preview evidence from becoming a hosted-backed claim', () => {
    const bindingValue = binding({ attestation: undefined, reputationEventDraft: undefined });
    const result = deriveHostedAttestationClaim(validInput({
      binding: bindingValue,
      preview: preview(bindingValue, {
        status: 'insufficient_evidence',
        evidenceSummary: {
          ...preview(bindingValue).evidenceSummary,
          attestationId: undefined,
          reputationEventDraftId: undefined,
        },
        previewEvent: undefined,
      }),
    }));

    assert.equal(result.ok, false);
    assert.equal(result.claim.status, 'insufficient_evidence');
    assert.ok(result.claim.reasonCodes.includes('insufficient_evidence'));
    assert.ok(result.claim.reasonCodes.includes('missing_attestation'));
    assert.equal(result.claim.backing.hostedAttestationBacking.status, 'pending');
    assert.equal(result.claim.backing.attestationKind, 'none');
  });

  it('blocks static or self-attested imported data from becoming hosted-ready', () => {
    const importedBinding = binding({
      source: {
        kind: 'static-fixture',
        sourceId: 'source:imported-static',
        fixtureRef: 'fixtures/imported-static.json',
      },
      attestation: {
        ...binding().attestation!,
        trustBoundary: 'self_attested',
      },
      reputationEventDraft: {
        ...binding().reputationEventDraft!,
        trustBoundary: 'self_attested',
      },
    });
    const result = deriveHostedAttestationClaim(validInput({
      binding: importedBinding,
      preview: preview(importedBinding, {
        source: importedBinding.source,
        previewEvent: importedBinding.reputationEventDraft,
      }),
    }));

    assert.equal(result.ok, false);
    assert.equal(result.claim.status, 'blocked');
    assert.ok(result.claim.reasonCodes.includes('source_not_hosted'));
    assert.ok(result.claim.reasonCodes.includes('attestation_not_hosted_backed'));
    assert.equal(result.claim.display.buyerFacingClaimAllowed, false);
    assert.equal(result.claim.previewEvent, undefined);
  });

  it('blocks preview source or subject mismatches from becoming hosted-ready', () => {
    const bindingValue = binding();
    const wrongSubject = deriveHostedAttestationClaim(validInput({
      binding: bindingValue,
      preview: preview(bindingValue, {
        subject: { id: 'listing:other', type: 'listing' },
      }),
    }));
    const wrongPreviewEventSubject = deriveHostedAttestationClaim(validInput({
      binding: bindingValue,
      preview: preview(bindingValue, {
        previewEvent: {
          ...bindingValue.reputationEventDraft!,
          subjectId: 'listing:other',
        },
      }),
    }));
    const wrongSource = deriveHostedAttestationClaim(validInput({
      binding: bindingValue,
      preview: preview(bindingValue, {
        source: {
          ...bindingValue.source,
          sourceId: 'source:other',
        },
      }),
    }));

    assert.equal(wrongSubject.ok, false);
    assert.equal(wrongSubject.claim.status, 'blocked');
    assert.ok(wrongSubject.claim.reasonCodes.includes('source_mismatch'));
    assert.equal(wrongPreviewEventSubject.ok, false);
    assert.equal(wrongPreviewEventSubject.claim.status, 'blocked');
    assert.ok(wrongPreviewEventSubject.claim.reasonCodes.includes('source_mismatch'));
    assert.equal(wrongSource.ok, false);
    assert.equal(wrongSource.claim.status, 'blocked');
    assert.ok(wrongSource.claim.reasonCodes.includes('source_mismatch'));
  });

  it('blocks failed attestations and blocked publication gates', () => {
    const bindingValue = binding({
      receipt: { ...binding().receipt, attestationStatus: 'failed' },
      attestation: { ...binding().attestation!, verdict: 'failed', status: 'failed' },
    });
    const result = deriveHostedAttestationClaim(validInput({
      binding: bindingValue,
      preview: preview(bindingValue, { status: 'blocked' }),
      publicationGate: {
        issue: 395,
        state: 'blocked',
        evidenceRef: 'publication-gate:blocked',
      },
    }));

    assert.equal(result.ok, false);
    assert.equal(result.claim.status, 'blocked');
    assert.ok(result.claim.reasonCodes.includes('attestation_not_passed'));
    assert.ok(result.claim.reasonCodes.includes('preview_not_ready'));
    assert.ok(result.claim.reasonCodes.includes('publication_gate_blocked'));
  });

  it('blocks mismatched evidence summaries and unsafe live guardrails', () => {
    const result = deriveHostedAttestationClaim(validInput({
      preview: preview(binding(), {
        evidenceSummary: {
          ...preview(binding()).evidenceSummary,
          evidenceHash: 'sha256:tampered',
        },
      }),
      binding: {
        ...binding(),
        guardrails: { ...binding().guardrails, rpcCall: true },
      } as unknown as ReceiptEvidenceBinding,
    }));

    assert.equal(result.ok, false);
    assert.equal(result.claim.status, 'blocked');
    assert.ok(result.claim.reasonCodes.includes('evidence_mismatch'));
    assert.ok(result.claim.reasonCodes.includes('unsafe_live_guardrail'));
    assert.equal(result.claim.guardrails.rpcCall, false);
  });

  it('blocks buyer-facing or hosted-backed claims spoofed through imported preview metadata', () => {
    const bindingValue = binding();
    const result = deriveHostedAttestationClaim(validInput({
      binding: bindingValue,
      preview: {
        ...preview(bindingValue),
        backing: {
          ...preview(bindingValue).backing,
          hostedAttestationBacking: 'published' as 'not_published',
        },
        display: {
          ...preview(bindingValue).display,
          buyerFacingClaimAllowed: true as false,
        },
      },
    }));

    assert.equal(result.ok, false);
    assert.equal(result.claim.status, 'blocked');
    assert.ok(result.claim.reasonCodes.includes('unsafe_live_guardrail'));
    assert.equal(result.claim.display.buyerFacingClaimAllowed, false);
    assert.equal(result.claim.previewEvent, undefined);
  });

  it('fails closed for malformed schema-compatible input without throwing', () => {
    const result = deriveHostedAttestationClaim(validInput({
      binding: {
        schemaVersion: 'reddi.receipt-evidence-binding.v1',
        id: 'binding:malformed',
        source: binding().source,
      } as unknown as ReceiptEvidenceBinding,
    }));

    assert.equal(result.ok, false);
    assert.equal(result.claim.status, 'blocked');
    assert.ok(result.claim.reasonCodes.includes('malformed_binding'));
  });
});
