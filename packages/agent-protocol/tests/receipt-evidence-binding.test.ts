import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyAttestationToReputation,
  createAttestationRecord,
  SPL_TOKEN_PROGRAM_ID,
  createEvidenceArchiveRecord,
  createPaymentObservationRecord,
  createReceiptEvidenceBinding,
  createReddiReceipt,
  deriveReceiptEvidenceBinding,
  formatPaymentObservationProofRef,
  policyDecisionFromBudgetPolicyDecision,
  type AuddPaymentPlanPreflightDecision,
  type ReceiptEvidenceBindingInput,
} from '../dist/index.js';

const createdAt = '2026-06-20T01:00:00.000Z';
const requestHash = 'sha256:7b2d0ef8455d0f0f41a37ea5e6a47f52c0d73d97f426097f159a98f8c8fb6b15';
const responseHash = 'sha256:8c9d1f1e3d0f02b5afcbb31dfbb3ab3de70ce1b84ff3ca856d272b2f4f7f4501';
const sourceId = 'source:hosted-rap:approve-ready-draft';
const jobId = 'job:ard-onboarded:approve-ready-draft';
const evidenceId = 'evidence:ard-onboarded:approve-ready-draft';
const paymentProofRef = 'dry-run:audd-proof:approve-ready-draft';

function validInput(): ReceiptEvidenceBindingInput {
  const policyDecision = policyDecisionFromBudgetPolicyDecision({
    allowed: true,
    reasonCodes: ['allowed'],
    quotedAmount: {
      amount: '2500000',
      asset: 'AUDD',
      network: 'solana-devnet',
      source: sourceId,
      specialist: 'listing:approve-ready-draft',
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
      uri: 'urn:reddi:marketplace-listing:approveReadyDraft',
    },
    payer: { id: 'buyer:fixture' },
    specialist: { id: 'listing:approve-ready-draft' },
    protocol: { name: 'Reddi Agent Protocol', version: '0.1.0' },
    payment: {
      network: 'solana-devnet',
      asset: 'AUDD',
      amount: '2500000',
      paymentProofRef,
    },
    requestHash,
    responseHash,
    evidenceRef: 'file://fixtures/evidence/ard-onboarded-approve-ready.json',
    policyDecision,
    attestationStatus: 'attested',
    createdAt,
    metadata: {
      sourceCatalogRef: '/.well-known/ai-catalog.json',
      listingId: 'approveReadyDraft',
    },
  });

  const evidencePayload = {
    request: { hash: requestHash },
    response: { hash: responseHash },
    resultSummary: 'Dry-run workflow completed with redacted request and response hashes only.',
    source: { catalogRef: '/.well-known/ai-catalog.json', listingId: 'approveReadyDraft' },
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
    id: 'attestation:ard-onboarded:approve-ready-draft',
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
    subject: { id: 'listing:approve-ready-draft', type: 'listing' },
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
      quoteExpiresAt: '2026-06-20T02:00:00.000Z',
      failurePolicy: { mode: 'no_charge_on_failure', description: 'Dry-run failure does not charge.' },
      refundPolicy: { mode: 'manual_review', description: 'Refunds require manual review.' },
      evidenceRequired: true,
      paymentMode: 'dry-run',
    },
    auditNotes: ['Allowed by local AUDD dry-run policy.'],
  };

  return {
    id: 'binding:ard-onboarded:approve-ready-draft',
    source: {
      kind: 'hosted-rap-registry',
      sourceId,
      catalogRef: '/.well-known/ai-catalog.json',
      listingId: 'approveReadyDraft',
      rawSnapshotRef: 'sha256:hosted-rap-ai-catalog-fixture',
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

describe('receipt/evidence binding for ARD-onboarded agents', () => {
  it('binds receipt, evidence, payment proof, attestation, and reputation draft without live side effects', () => {
    const binding = createReceiptEvidenceBinding(validInput());

    assert.equal(binding.schemaVersion, 'reddi.receipt-evidence-binding.v1');
    assert.equal(binding.source.kind, 'hosted-rap-registry');
    assert.equal(binding.receipt.paymentProofRef, paymentProofRef);
    assert.equal(binding.evidence.id, evidenceId);
    assert.equal(binding.payment.preflightAllowed, true);
    assert.equal(binding.attestation?.verdict, 'passed');
    assert.equal(binding.reputationEventDraft?.schemaVersion, 'reddi.reputation-event.v1');
    assert.deepEqual(binding.guardrails, {
      rawPromptStored: false,
      rawOutputStored: false,
      livePaymentExecuted: false,
      walletSigning: false,
      rpcCall: false,
      hostedRegistryRequired: false,
      reputationMutated: false,
    });
  });

  it('fails closed when evidence payload or external pointer is missing', () => {
    const input = validInput();
    const result = deriveReceiptEvidenceBinding({ ...input, evidencePayload: undefined });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((item) => item.code === 'evidence_invalid' && item.path === '$.evidence.evidencePayload'));
    }
  });

  it('fails closed when payment preflight proof is missing or denied', () => {
    const input = validInput();
    const result = deriveReceiptEvidenceBinding({
      ...input,
      paymentPreflight: {
        ...input.paymentPreflight,
        allowed: false,
        paymentProofRef: undefined,
        reasonCodes: ['buyer_policy_missing'],
      },
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((item) => item.code === 'payment_preflight_denied'));
      assert.ok(result.errors.some((item) => item.code === 'missing_payment_preflight'));
    }
  });

  it('fails closed when the source reference is missing', () => {
    const input = validInput();
    const result = deriveReceiptEvidenceBinding({
      ...input,
      source: { kind: 'static-fixture', sourceId },
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((item) => item.code === 'missing_source_ref' && item.path === '$.source'));
    }
  });

  it('fails closed for unsupported receipt payment network and asset', () => {
    const input = validInput();
    const result = deriveReceiptEvidenceBinding({
      ...input,
      receipt: {
        ...input.receipt,
        payment: {
          ...input.receipt.payment,
          network: 'base-mainnet',
          asset: 'USDG',
        },
      },
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((item) => item.code === 'unsupported_network_asset'));
    }
  });

  it('fails closed for credential-bearing source or evidence metadata', () => {
    const input = validInput();
    const result = deriveReceiptEvidenceBinding({
      ...input,
      source: {
        ...input.source,
        catalogRef: 'https://registry.example/.well-known/ai-catalog.json?api_key=secret',
      },
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((item) => item.code === 'credential_leakage_rejected'));
    }
  });

  it('rejects raw prompt or output payload leakage by default', () => {
    const input = validInput();
    const result = deriveReceiptEvidenceBinding({
      ...input,
      evidencePayload: {
        ...(input.evidencePayload as Record<string, unknown>),
        rawPrompt: 'Write a private customer report.',
      },
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((item) => item.code === 'raw_payload_leakage_rejected'));
    }
  });

  it('binds a non-live AUDD TransferChecked observation without making it grant eligible', () => {
    const input = validInput();
    const plan = input.paymentPreflight.paymentPlan;
    if (!plan) throw new Error('test fixture must carry an AUDD payment plan');
    const proofRef = formatPaymentObservationProofRef({
      network: { caip2: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', rapAlias: 'solana-devnet' },
      asset: 'AUDD',
      signature: 'fixtureSignatureAuddTransferChecked111111111111111111',
      instructionIndex: '0',
      mint: plan.mint,
      amountBaseUnits: plan.amount,
    });
    input.receipt.payment.paymentProofRef = proofRef;
    input.paymentPreflight.paymentProofRef = proofRef;

    const observation = createPaymentObservationRecord({
      labels: {
        environment: 'deterministic-fixture',
        eligibility: 'non_eligible',
        exclusionReason: 'offline parsed transaction fixture',
      },
      observedAt: createdAt,
      verifier: { name: 'fixture-spl-transfer-checked', version: 'v1' },
      payment: {
        rail: 'svm-spl-token-transfer-checked',
        network: { caip2: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', rapAlias: 'solana-devnet' },
        asset: 'AUDD',
        mint: plan.mint,
        tokenProgram: SPL_TOKEN_PROGRAM_ID,
        amountBaseUnits: plan.amount,
        payTo: plan.payee,
        sourceTokenAccount: 'payer-audd-token-account-fixture',
        destinationTokenAccount: plan.settlementAccount,
        authority: 'payer-owner-fixture',
        signature: 'fixtureSignatureAuddTransferChecked111111111111111111',
        instructionIndex: '0',
        memo: 'reddi:pay:binding-fixture',
        paymentProofRef: proofRef,
      },
      confirmation: { slot: 443284058, blockTime: 1785523200, commitment: 'confirmed' },
      status: 'observed_confirmed',
    });

    const result = deriveReceiptEvidenceBinding({ ...input, paymentObservation: observation });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.binding.payment.observationRef?.id, observation.id);
      assert.equal(result.binding.payment.observationRef?.eligibility, 'non_eligible');
      assert.equal(result.binding.guardrails.livePaymentExecuted, false);
      assert.equal(result.binding.guardrails.rpcCall, false);
    }
  });

  it('rejects payment observations that are grant-eligible fixtures or mismatch the plan', () => {
    const input = validInput();
    const plan = input.paymentPreflight.paymentPlan;
    if (!plan) throw new Error('test fixture must carry an AUDD payment plan');
    const observation = createPaymentObservationRecord({
      labels: { environment: 'deterministic-fixture', eligibility: 'non_eligible' },
      observedAt: createdAt,
      verifier: { name: 'fixture-spl-transfer-checked', version: 'v1' },
      payment: {
        rail: 'svm-spl-token-transfer-checked',
        network: { caip2: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', rapAlias: 'solana-devnet' },
        asset: 'AUDD',
        mint: plan.mint,
        tokenProgram: SPL_TOKEN_PROGRAM_ID,
        amountBaseUnits: plan.amount,
        payTo: plan.payee,
        destinationTokenAccount: plan.settlementAccount,
        signature: 'fixtureSignatureAuddTransferChecked222222222222222222',
        instructionIndex: '0',
        paymentProofRef,
      },
      confirmation: { slot: 443284058, blockTime: 1785523200, commitment: 'confirmed' },
      status: 'observed_confirmed',
    });

    const eligibleFixture = deriveReceiptEvidenceBinding({
      ...input,
      paymentObservation: {
        ...observation,
        labels: { environment: 'deterministic-fixture', eligibility: 'eligible' },
      },
    });
    assert.equal(eligibleFixture.ok, false);
    if (!eligibleFixture.ok) assert.ok(eligibleFixture.errors.some((item) => item.code === 'payment_observation_ineligible'));

    const overstatedRail = deriveReceiptEvidenceBinding({
      ...input,
      paymentObservation: {
        ...observation,
        labels: { environment: 'controlled-live', eligibility: 'eligible', partnerAcceptanceRef: 'audd:not-real' },
      },
    });
    assert.equal(overstatedRail.ok, false);
    if (!overstatedRail.ok) assert.ok(overstatedRail.errors.some((item) => item.code === 'payment_observation_ineligible' && item.path === '$.paymentObservation.labels.environment'));

    const wrongAmount = deriveReceiptEvidenceBinding({
      ...input,
      paymentObservation: {
        ...observation,
        payment: { ...observation.payment, amountBaseUnits: '1' },
      },
    });
    assert.equal(wrongAmount.ok, false);
    if (!wrongAmount.ok) assert.ok(wrongAmount.errors.some((item) => item.code === 'payment_observation_mismatch'));

    const missingMint = deriveReceiptEvidenceBinding({
      ...input,
      paymentObservation: {
        ...observation,
        payment: { ...observation.payment, mint: undefined },
      },
    });
    assert.equal(missingMint.ok, false);
    if (!missingMint.ok) assert.ok(missingMint.errors.some((item) => item.code === 'payment_observation_mismatch'));

    const wrongDestination = deriveReceiptEvidenceBinding({
      ...input,
      paymentObservation: {
        ...observation,
        payment: { ...observation.payment, destinationTokenAccount: 'attacker-token-account' },
      },
    });
    assert.equal(wrongDestination.ok, false);
    if (!wrongDestination.ok) assert.ok(wrongDestination.errors.some((item) => item.code === 'payment_observation_mismatch'));

    const inconclusive = deriveReceiptEvidenceBinding({
      ...input,
      paymentObservation: { ...observation, status: 'observation_inconclusive' },
    });
    assert.equal(inconclusive.ok, false);
    if (!inconclusive.ok) assert.ok(inconclusive.errors.some((item) => item.code === 'payment_observation_mismatch' && item.path === '$.paymentObservation.status'));
  });
});
