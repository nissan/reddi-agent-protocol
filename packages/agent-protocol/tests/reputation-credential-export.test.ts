import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  applyAttestationToReputation,
  buildReputationCredentialBody,
  canonicalizeReputationCredentialBody,
  createAttestationRecord,
  createEvidenceArchiveRecord,
  createReceiptEvidenceBinding,
  createReddiReceipt,
  deriveOffchainReputationPreview,
  encodeEd25519PublicKey,
  exportReputationCredential,
  policyDecisionFromBudgetPolicyDecision,
  signReputationCredentialBody,
  verifyReputationCredential,
  type AttestationRecord,
  type AuddPaymentPlanPreflightDecision,
  type OffchainReputationPreview,
  type ReceiptEvidenceBindingInput,
  type ReputationCredentialInput,
} from '../dist/index.js';

const createdAt = '2026-06-20T02:10:00.000Z';
const issuedAt = '2026-06-20T02:30:00.000Z';
const requestHash = 'sha256:4f2d0ef8455d0f0f41a37ea5e6a47f52c0d73d97f426097f159a98f8c8fb6b15';
const responseHash = 'sha256:5c9d1f1e3d0f02b5afcbb31dfbb3ab3de70ce1b84ff3ca856d272b2f4f7f4501';
const sourceId = 'source:hosted-rap:credential-export';
const jobId = 'job:ard-onboarded:credential-export';
const evidenceId = 'evidence:ard-onboarded:credential-export';
const paymentProofRef = 'dry-run:audd-proof:credential-export';
const RAW_RESULT_SUMMARY = 'SECRET RAW PROMPT AND COMPLETION TRANSCRIPT that must never leak into a credential.';

function validBindingInput(): ReceiptEvidenceBindingInput {
  const policyDecision = policyDecisionFromBudgetPolicyDecision({
    allowed: true,
    reasonCodes: ['allowed'],
    quotedAmount: {
      amount: '2500000',
      asset: 'AUDD',
      network: 'solana-devnet',
      source: sourceId,
      specialist: 'listing:credential-export',
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
      uri: 'urn:reddi:marketplace-listing:credentialExport',
    },
    payer: { id: 'buyer:fixture' },
    specialist: { id: 'listing:credential-export' },
    protocol: { name: 'Reddi Agent Protocol', version: '0.1.0' },
    payment: {
      network: 'solana-devnet',
      asset: 'AUDD',
      amount: '2500000',
      paymentProofRef,
    },
    requestHash,
    responseHash,
    evidenceRef: 'file://fixtures/evidence/ard-onboarded-credential-export.json',
    policyDecision,
    attestationStatus: 'attested',
    createdAt,
  });

  const evidencePayload = {
    request: { hash: requestHash },
    response: { hash: responseHash },
    resultSummary: RAW_RESULT_SUMMARY,
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
    id: 'attestation:ard-onboarded:credential-export',
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
    subject: { id: 'listing:credential-export', type: 'listing' },
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
    id: 'binding:ard-onboarded:credential-export',
    source: {
      kind: 'hosted-rap-registry',
      sourceId,
      catalogRef: '/.well-known/ai-catalog.json',
      listingId: 'credentialExport',
      rawSnapshotRef: 'sha256:hosted-rap-ai-catalog-credential-fixture',
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

function readyPreview(): OffchainReputationPreview {
  const binding = createReceiptEvidenceBinding(validBindingInput());
  const result = deriveOffchainReputationPreview({
    id: 'preview:listing:credential-export',
    binding,
    createdAt,
  });
  if (!result.ok || result.preview.status !== 'preview_ready') {
    throw new Error('expected a preview_ready fixture');
  }
  return result.preview;
}

function fixtureAttestation(): AttestationRecord {
  const input = validBindingInput();
  return input.attestation as AttestationRecord;
}

function credentialInput(overrides: Partial<ReputationCredentialInput> = {}): ReputationCredentialInput {
  return {
    id: 'credential:listing:credential-export',
    preview: readyPreview(),
    attestations: [fixtureAttestation()],
    issuedAt,
    ...overrides,
  };
}

describe('reputation credential export', () => {
  it('builds, signs, and verifies a credential round-trip', () => {
    const exported = exportReputationCredential(credentialInput());
    assert.equal(exported.ok, true);
    if (!exported.ok) return;

    const credential = exported.credential;
    assert.equal(credential.schemaVersion, 'reddi.reputation-credential.v1');
    assert.equal(credential.credential.subject.id, 'listing:credential-export');
    assert.equal(credential.credential.reputation.buyerFacingClaimAllowed, false);
    assert.equal(credential.credential.guardrails.chainAgnostic, true);
    assert.equal(credential.credential.guardrails.onchainSettlement, false);
    assert.ok(credential.credential.evidence.length >= 1);
    assert.match(credential.credential.evidence[0].evidenceHash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(credential.proof.type, 'ed25519');
    assert.ok(credential.proof.publicKey.length > 0);
    assert.ok(credential.proof.signature.length > 0);

    const verified = verifyReputationCredential(credential);
    assert.equal(verified.ok, true);
  });

  it('does not leak any raw evidence payload into the serialized credential', () => {
    const exported = exportReputationCredential(credentialInput());
    assert.equal(exported.ok, true);
    if (!exported.ok) return;

    const serialized = JSON.stringify(exported.credential);
    assert.ok(!serialized.includes(RAW_RESULT_SUMMARY), 'raw result summary must not appear');
    assert.ok(!/resultSummary/i.test(serialized), 'no resultSummary key may appear');
    assert.ok(!/transcript/i.test(serialized), 'no transcript may appear');
    // The evidence hash (the only permitted binding) IS present.
    assert.ok(serialized.includes(exported.credential.credential.evidence[0].evidenceHash));

    // The canonical body that gets signed is likewise payload-free.
    const canonical = canonicalizeReputationCredentialBody(exported.credential.credential);
    assert.ok(!canonical.includes(RAW_RESULT_SUMMARY));
  });

  it('fails verification when a signed field is tampered with', () => {
    const exported = exportReputationCredential(credentialInput());
    assert.equal(exported.ok, true);
    if (!exported.ok) return;

    const tampered = {
      ...exported.credential,
      credential: {
        ...exported.credential.credential,
        reputation: { ...exported.credential.credential.reputation, score: 999 },
      },
    };

    const verified = verifyReputationCredential(tampered);
    assert.equal(verified.ok, false);
    if (verified.ok) return;
    assert.ok(verified.errors.some((e) => e.code === 'signature_invalid'));
  });

  it('fails build and verify when an evidence-hash binding is missing', () => {
    const attestation = fixtureAttestation();
    const build = buildReputationCredentialBody(
      credentialInput({ attestations: [{ ...attestation, evidenceHash: '' }] as AttestationRecord[] }),
    );
    assert.equal(build.ok, false);
    if (build.ok) return;
    assert.ok(build.errors.some((e) => e.code === 'missing_evidence_hash'));

    // A hand-assembled credential body with an empty evidence array must fail verify too.
    const exported = exportReputationCredential(credentialInput());
    assert.equal(exported.ok, true);
    if (!exported.ok) return;
    const stripped = {
      ...exported.credential,
      credential: { ...exported.credential.credential, evidence: [] },
    };
    const verified = verifyReputationCredential(stripped);
    assert.equal(verified.ok, false);
    if (verified.ok) return;
    assert.ok(verified.errors.some((e) => e.code === 'missing_evidence_hash'));
  });

  it('fails verification when signed by the wrong key', () => {
    const built = buildReputationCredentialBody(credentialInput());
    assert.equal(built.ok, true);
    if (!built.ok) return;

    const signerA = generateKeyPairSync('ed25519');
    const credential = signReputationCredentialBody(built.body, {
      privateKey: signerA.privateKey,
      publicKey: signerA.publicKey,
    });

    // Swap in a different public key: signature was made by A, but the credential now claims B.
    const signerB = generateKeyPairSync('ed25519');
    const wrongKeyed = {
      ...credential,
      proof: { ...credential.proof, publicKey: encodeEd25519PublicKey(signerB.publicKey) },
    };

    const verified = verifyReputationCredential(wrongKeyed);
    assert.equal(verified.ok, false);
    if (verified.ok) return;
    assert.ok(verified.errors.some((e) => e.code === 'signature_invalid'));
  });

  it('fails closed on an unknown schema version', () => {
    const exported = exportReputationCredential(credentialInput());
    assert.equal(exported.ok, true);
    if (!exported.ok) return;

    const unknownVersion = { ...exported.credential, schemaVersion: 'reddi.reputation-credential.v2' };
    const verified = verifyReputationCredential(unknownVersion);
    assert.equal(verified.ok, false);
    if (verified.ok) return;
    assert.ok(verified.errors.some((e) => e.code === 'unknown_version'));
  });

  it('refuses to export a preview that is not preview_ready', () => {
    const preview = readyPreview();
    const notReady = { ...preview, status: 'insufficient_evidence', previewEvent: undefined } as OffchainReputationPreview;
    const build = buildReputationCredentialBody(credentialInput({ preview: notReady }));
    assert.equal(build.ok, false);
    if (build.ok) return;
    assert.ok(build.errors.some((e) => e.code === 'preview_not_ready'));
  });

  it('rejects a missing proof block', () => {
    const exported = exportReputationCredential(credentialInput());
    assert.equal(exported.ok, true);
    if (!exported.ok) return;
    const noProof = { schemaVersion: exported.credential.schemaVersion, credential: exported.credential.credential };
    const verified = verifyReputationCredential(noProof);
    assert.equal(verified.ok, false);
    if (verified.ok) return;
    assert.ok(verified.errors.some((e) => e.code === 'missing_proof'));
  });
});
