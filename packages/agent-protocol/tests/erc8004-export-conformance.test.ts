import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  ERC8004_CONFORMANCE_SCHEMA_VERSION,
  ERC8004_DOCUMENTED_CHAINS,
  ERC8004_EXPORT_FIELD_PROVENANCE,
  ERC8004_UNSUPPORTED_FIELDS,
  applyAttestationToReputation,
  createAttestationRecord,
  createEvidenceArchiveRecord,
  createReceiptEvidenceBinding,
  createReddiReceipt,
  deriveOffchainReputationPreview,
  evaluateErc8004SourceEligibility,
  exportReceiptToErc8004,
  exportReputationCredential,
  generateEphemeralEd25519Signer,
  listErc8004ConformanceFixtures,
  policyDecisionFromBudgetPolicyDecision,
  runErc8004ConformanceSuite,
  verifyErc8004ExportAgainstSource,
  type AttestationRecord,
  type AuddPaymentPlanPreflightDecision,
  type Erc8004ExportBundle,
  type RailNeutralPaymentReceipt,
  type ReceiptEvidenceBindingInput,
  type ReddiReceipt,
  type ReputationCredential,
} from '../dist/index.js';

// ---------------------------------------------------------------------------
// Portable reputation credential fixture chain (mirrors the #565 export test):
// receipt -> evidence -> attestation -> reputation event -> binding -> preview
// -> signed credential. Everything offline; the signer is ephemeral ed25519.
// ---------------------------------------------------------------------------

const createdAt = '2026-07-06T01:00:00.000Z';
const issuedAt = '2026-07-06T01:30:00.000Z';
const requestHash = 'sha256:4f2d0ef8455d0f0f41a37ea5e6a47f52c0d73d97f426097f159a98f8c8fb6b15';
const responseHash = 'sha256:5c9d1f1e3d0f02b5afcbb31dfbb3ab3de70ce1b84ff3ca856d272b2f4f7f4501';
const sourceId = 'source:hosted-rap:erc8004-conformance';
const jobId = 'job:erc8004-conformance:562';
const evidenceId = 'evidence:erc8004-conformance:562';
const paymentProofRef = 'evidence:payment:erc8004-conformance-562';
const subjectId = 'listing:erc8004-conformance';

function credentialChain(): { receipt: ReddiReceipt; attestation: AttestationRecord; credential: ReputationCredential } {
  const policyDecision = policyDecisionFromBudgetPolicyDecision({
    allowed: true,
    reasonCodes: ['allowed'],
    quotedAmount: {
      amount: '2500000',
      asset: 'AUDD',
      network: 'solana-devnet',
      source: sourceId,
      specialist: subjectId,
    },
    remainingBudget: { perRequest: '3000000' },
    auditNotes: ['Allowed by local AUDD dry-run policy.'],
  });

  const receipt = createReddiReceipt({
    schemaVersion: 'reddi.receipt.v1',
    job: { id: jobId, type: 'erc8004-conformance' },
    source: { id: sourceId, type: 'hosted-rap-registry', uri: 'urn:reddi:marketplace-listing:erc8004Conformance' },
    payer: { id: 'buyer:fixture' },
    specialist: { id: subjectId, endpoint: 'https://agents.example/erc8004-conformance' },
    protocol: { name: 'Reddi Agent Protocol', version: '0.1.0' },
    payment: { network: 'solana-devnet', asset: 'AUDD', amount: '2500000', paymentProofRef },
    requestHash,
    responseHash,
    evidenceRef: 'file://fixtures/evidence/erc8004-conformance-562.json',
    policyDecision,
    attestationStatus: 'attested',
    createdAt,
  });

  const evidence = createEvidenceArchiveRecord({
    id: evidenceId,
    receiptId: jobId,
    sourceId,
    requestHash,
    responseHash,
    evidenceRef: receipt.evidenceRef,
    createdAt,
    evidencePayload: { request: { hash: requestHash }, response: { hash: responseHash } },
  });

  const attestation = createAttestationRecord({
    schemaVersion: 'reddi.attestation.v1',
    id: 'attestation:erc8004-conformance:562',
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
        { id: 'delivery_quality', score: 90, weight: 1, summary: 'Fixture output met expectations.', reasonCodes: ['fixture_passed'] },
      ],
    },
    createdAt,
  });

  const reputation = applyAttestationToReputation(attestation, undefined, {
    subject: { id: subjectId, type: 'listing' },
    now: createdAt,
  });
  assert.ok(reputation.ok, 'expected reputation fixture to apply');

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
      quoteExpiresAt: '2026-07-06T02:00:00.000Z',
      failurePolicy: { mode: 'no_charge_on_failure', description: 'Dry-run failure does not charge.' },
      refundPolicy: { mode: 'manual_review', description: 'Refunds require manual review.' },
      evidenceRequired: true,
      paymentMode: 'dry-run',
    },
    auditNotes: ['Allowed by local AUDD dry-run policy.'],
  };

  const bindingInput: ReceiptEvidenceBindingInput = {
    id: 'binding:erc8004-conformance:562',
    source: {
      kind: 'hosted-rap-registry',
      sourceId,
      catalogRef: '/.well-known/ai-catalog.json',
      listingId: 'erc8004Conformance',
      rawSnapshotRef: 'sha256:hosted-rap-ai-catalog-erc8004-fixture',
    },
    receipt,
    evidence,
    evidencePayload: { request: { hash: requestHash }, response: { hash: responseHash } },
    paymentPreflight,
    attestation,
    reputationEventDraft: reputation.event,
    createdAt,
  };

  const binding = createReceiptEvidenceBinding(bindingInput);
  const previewResult = deriveOffchainReputationPreview({
    id: 'preview:erc8004-conformance:562',
    binding,
    createdAt,
  });
  assert.ok(previewResult.ok && previewResult.preview.status === 'preview_ready', 'expected a preview_ready fixture');

  const exported = exportReputationCredential(
    {
      id: 'credential:erc8004-conformance:562',
      preview: previewResult.preview,
      attestations: [attestation],
      issuedAt,
    },
    generateEphemeralEd25519Signer(),
  );
  assert.ok(exported.ok, 'expected the portable credential to export');

  return { receipt, attestation, credential: exported.credential };
}

describe('ERC-8004 conformance suite (#562, reddi.erc8004-export-conformance.v1)', () => {
  it('runs every conformance fixture green — exclusions and round-trips', () => {
    const suite = runErc8004ConformanceSuite();
    assert.equal(suite.schemaVersion, ERC8004_CONFORMANCE_SCHEMA_VERSION);
    for (const entry of suite.cases) {
      assert.ok(entry.pass, `case ${entry.case} failed: ${entry.failures.join(' | ')}`);
    }
    assert.equal(suite.ok, true);

    const caseNames = suite.cases.map((entry) => entry.case);
    for (const expected of [
      'full_export_round_trip',
      'metadata_only_no_attestation',
      'dry_run_missing_payment_proof_excluded',
      'failure_final_receipt_excluded',
      'pending_receipt_attestation_excluded',
      'disputed_attestation_excluded',
      'mismatched_attestation_excluded',
      'unsupported_chain_hint_blocked',
      'probe_only_rail_neutral_excluded',
      'rail_neutral_binding_candidate_requires_bridge',
    ]) {
      assert.ok(caseNames.includes(expected), `missing conformance case ${expected}`);
    }
  });

  it('exposes deterministic fixtures with chain refs as unverified placeholders only', () => {
    const fixtures = listErc8004ConformanceFixtures();
    assert.deepEqual(fixtures, listErc8004ConformanceFixtures(), 'fixture list must be deterministic');

    for (const chain of ERC8004_DOCUMENTED_CHAINS) {
      assert.equal(chain.verified, false, `${chain.name} must be marked unverified`);
      assert.equal(chain.deploymentClaim, false, `${chain.name} must carry no deployment claim`);
      if (chain.caip2 !== null) assert.match(chain.caip2, /^eip155:\d+$/);
    }
    // The chains the issue names are documented — without any deployment claim.
    const names = ERC8004_DOCUMENTED_CHAINS.map((chain) => chain.name);
    for (const name of ['Ethereum', 'Base', 'Polygon', 'Monad', 'BNB Chain']) {
      assert.ok(names.includes(name), `chain ${name} from the issue text must be documented`);
    }
  });

  it('documents per-field provenance for all three registries and fail-closed unsupported fields', () => {
    const registries = new Set(ERC8004_EXPORT_FIELD_PROVENANCE.map((entry) => entry.registry));
    for (const registry of ['identity', 'reputation', 'validation', 'crossReference']) {
      assert.ok(registries.has(registry as never), `provenance table must cover ${registry}`);
    }
    for (const entry of ERC8004_EXPORT_FIELD_PROVENANCE) {
      assert.ok(entry.source.length > 0, `${entry.registry}.${entry.field} must name its source`);
      assert.ok(['rap-native', 'erc8004-draft-interface'].includes(entry.confidence));
    }
    // One-way boundary is a documented, fail-closed non-feature.
    assert.ok(
      ERC8004_UNSUPPORTED_FIELDS.some((entry) => entry.behavior === 'blocked' && /trust import/i.test(entry.surface)),
      'ERC-8004 trust import into RAP must be documented as blocked',
    );
    for (const entry of ERC8004_UNSUPPORTED_FIELDS) {
      assert.ok(['null', 'omitted', 'blocked', 'excluded'].includes(entry.behavior));
      assert.ok(entry.reason.length > 0);
    }
  });

  it('round-trip verifier passes a faithful export and fails any tampering', () => {
    const fixtures = listErc8004ConformanceFixtures();
    const full = fixtures.find((fixture) => fixture.case === 'full_export_round_trip');
    assert.ok(full && full.kind === 'export');

    const bundle = exportReceiptToErc8004(full.receipt, full.attestation, full.options);
    const clean = verifyErc8004ExportAgainstSource(bundle, { receipt: full.receipt, attestation: full.attestation });
    assert.equal(clean.ok, true, clean.checks.filter((c) => !c.ok).map((c) => c.id).join(','));

    // Tamper with the reputation score.
    const tamperedScore: Erc8004ExportBundle = JSON.parse(JSON.stringify(bundle));
    tamperedScore.reputation!.value = '10000';
    const scoreResult = verifyErc8004ExportAgainstSource(tamperedScore, { receipt: full.receipt, attestation: full.attestation });
    assert.equal(scoreResult.ok, false);
    assert.ok(scoreResult.checks.some((c) => c.id === 'reputation_value_reconstructs' && !c.ok));

    // Tamper with the identity name.
    const tamperedIdentity: Erc8004ExportBundle = JSON.parse(JSON.stringify(bundle));
    tamperedIdentity.identity!.registrationFile.name = 'specialist:attacker:someone-else';
    const identityResult = verifyErc8004ExportAgainstSource(tamperedIdentity, { receipt: full.receipt, attestation: full.attestation });
    assert.equal(identityResult.ok, false);
    assert.ok(identityResult.checks.some((c) => c.id === 'identity_name_matches_specialist' && !c.ok));

    // Tamper with a guardrail.
    const tamperedGuardrails = JSON.parse(JSON.stringify(bundle)) as Record<string, { trustImported: boolean }> & Erc8004ExportBundle;
    (tamperedGuardrails.guardrails as { trustImported: boolean }).trustImported = true;
    const guardrailResult = verifyErc8004ExportAgainstSource(tamperedGuardrails, { receipt: full.receipt, attestation: full.attestation });
    assert.equal(guardrailResult.ok, false);
    assert.ok(guardrailResult.checks.some((c) => c.id === 'guardrails_all_false' && !c.ok));

    // Invented extra field.
    const invented = JSON.parse(JSON.stringify(bundle)) as Erc8004ExportBundle & { settlementTx?: string };
    invented.settlementTx = '0xdeadbeef';
    const inventedResult = verifyErc8004ExportAgainstSource(invented, { receipt: full.receipt, attestation: full.attestation });
    assert.equal(inventedResult.ok, false);
    assert.ok(inventedResult.checks.some((c) => c.id === 'no_unknown_top_level_keys' && !c.ok));
  });

  it('a blocked bundle never round-trips', () => {
    const fixtures = listErc8004ConformanceFixtures();
    const blockedFixture = fixtures.find((fixture) => fixture.case === 'failure_final_receipt_excluded');
    assert.ok(blockedFixture && blockedFixture.kind === 'export');
    const bundle = exportReceiptToErc8004(blockedFixture.receipt, blockedFixture.attestation);
    assert.equal(bundle.exportIntent, 'blocked');
    const result = verifyErc8004ExportAgainstSource(bundle, { receipt: blockedFixture.receipt, attestation: blockedFixture.attestation });
    assert.equal(result.ok, false);
    assert.ok(result.checks.some((c) => c.id === 'export_not_blocked' && !c.ok));
  });

  it('excludes probe-only rail-neutral receipts even when passed to the exporter directly', () => {
    const fixtures = listErc8004ConformanceFixtures();
    const probeOnly = fixtures.find((fixture) => fixture.case === 'probe_only_rail_neutral_excluded');
    assert.ok(probeOnly && probeOnly.kind === 'eligibility' && probeOnly.source.kind === 'rail-neutral');

    const eligibility = evaluateErc8004SourceEligibility(probeOnly.source);
    assert.equal(eligibility.eligible, false);
    assert.deepEqual(eligibility.reasonCodes, ['probe_only_receipt_excluded']);

    // Belt-and-suspenders: shoving the rail-neutral receipt straight into the
    // exporter is also fail-closed with the same exclusion reason.
    const direct = exportReceiptToErc8004(probeOnly.source.receipt as unknown as ReddiReceipt);
    assert.equal(direct.exportIntent, 'blocked');
    assert.ok(direct.reasonCodes.includes('probe_only_receipt_excluded'));
    assert.equal(direct.identity, null);
  });

  it('excludes a not_requested receipt + attestation combination fail-closed', () => {
    const fixtures = listErc8004ConformanceFixtures();
    const full = fixtures.find((fixture) => fixture.case === 'full_export_round_trip');
    assert.ok(full && full.kind === 'export');

    const receipt: ReddiReceipt = { ...full.receipt, attestationStatus: 'not_requested' };
    const bundle = exportReceiptToErc8004(receipt, full.attestation);
    assert.equal(bundle.exportIntent, 'metadata_only');
    assert.equal(bundle.reputation, null);
    assert.ok(bundle.reasonCodes.includes('attestation_state_excluded'));

    const roundTrip = verifyErc8004ExportAgainstSource(bundle, { receipt, attestation: full.attestation });
    assert.equal(roundTrip.ok, true, 'exclusion must itself round-trip: the bundle records why nothing exported');
  });

  it('composes with a verified portable reputation credential (reference, not duplication)', () => {
    const { receipt, attestation, credential } = credentialChain();

    const bundle = exportReceiptToErc8004(receipt, attestation, { reputationCredential: credential });
    assert.equal(bundle.exportIntent, 'exportable');
    assert.ok(bundle.reputation);
    assert.ok(bundle.reputation.credentialRef);
    assert.equal(bundle.reputation.credentialRef.credentialId, 'credential:erc8004-conformance:562');
    assert.equal(bundle.reputation.credentialRef.subjectId, subjectId);
    assert.ok(bundle.reputation.credentialRef.evidenceHashes.includes(attestation.evidenceHash));
    assert.equal(bundle.reputation.credentialRef.proof.publicKey, credential.proof.publicKey);
    // Reference, not duplication: the credential signature never enters the bundle.
    assert.ok(!JSON.stringify(bundle).includes(credential.proof.signature));

    const roundTrip = verifyErc8004ExportAgainstSource(bundle, { receipt, attestation, reputationCredential: credential });
    assert.equal(roundTrip.ok, true, roundTrip.checks.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`).join(' | '));
    assert.ok(roundTrip.checks.some((c) => c.id === 'credential_ref_matches_source' && c.ok));

    // Determinism: same inputs (same credential object) => identical bundle.
    const again = exportReceiptToErc8004(receipt, attestation, { reputationCredential: credential });
    assert.deepEqual(again, bundle);
  });

  it('fails closed on tampered, mismatched-subject, and mismatched-evidence credentials', () => {
    const { receipt, attestation, credential } = credentialChain();

    // Tampered credential body -> offline verification fails -> blocked.
    const tampered: ReputationCredential = JSON.parse(JSON.stringify(credential));
    tampered.credential.reputation.score = 100;
    const tamperedBundle = exportReceiptToErc8004(receipt, attestation, { reputationCredential: tampered });
    assert.equal(tamperedBundle.exportIntent, 'blocked');
    assert.ok(tamperedBundle.reasonCodes.includes('reputation_credential_invalid'));
    assert.equal(tamperedBundle.reputation, null);

    // Valid credential, but for a different subject than the receipt specialist -> blocked.
    const fixtures = listErc8004ConformanceFixtures();
    const other = fixtures.find((fixture) => fixture.case === 'full_export_round_trip');
    assert.ok(other && other.kind === 'export' && other.attestation);
    const subjectMismatch = exportReceiptToErc8004(other.receipt, other.attestation, { reputationCredential: credential });
    assert.equal(subjectMismatch.exportIntent, 'blocked');
    assert.ok(subjectMismatch.reasonCodes.includes('reputation_credential_subject_mismatch'));

    // Same subject, but the attestation evidence hash is not bound by the credential -> blocked.
    const strayAttestation: AttestationRecord = {
      ...attestation,
      evidenceHash: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    };
    const evidenceMismatch = exportReceiptToErc8004(receipt, strayAttestation, { reputationCredential: credential });
    assert.equal(evidenceMismatch.exportIntent, 'blocked');
    assert.ok(evidenceMismatch.reasonCodes.includes('reputation_credential_evidence_mismatch'));
  });

  it('a credential without an exportable attestation attaches nothing and says so', () => {
    const { receipt, credential } = credentialChain();
    const bundle = exportReceiptToErc8004(receipt, undefined, { reputationCredential: credential });
    assert.equal(bundle.exportIntent, 'metadata_only');
    assert.equal(bundle.reputation, null);
    assert.ok(bundle.reasonCodes.includes('attestation_missing'));
    assert.ok(bundle.notes.some((note) => note.includes('credentialRef requires an exportable attestation')));
  });

  it('imports nothing from the network / web3 / ethers stacks (offline-only guard)', () => {
    for (const module of ['../src/erc8004-export.ts', '../src/erc8004-export-conformance.ts']) {
      const sourcePath = fileURLToPath(new URL(module, import.meta.url));
      const source = readFileSync(sourcePath, 'utf8');
      for (const banned of ['ethers', 'web3', 'viem', 'node:net', 'node:http', 'node:https', 'fetch(', 'XMLHttpRequest']) {
        assert.ok(!source.includes(banned), `${module} must not reference ${banned}`);
      }
      assert.ok(!/\basync\b/.test(source), `${module} must not contain async code`);
    }
  });

  it('keeps rail-neutral typing honest in fixtures', () => {
    const fixtures = listErc8004ConformanceFixtures();
    const railNeutral = fixtures.filter(
      (fixture): fixture is Extract<typeof fixture, { kind: 'eligibility' }> => fixture.kind === 'eligibility',
    );
    assert.equal(railNeutral.length, 2);
    for (const fixture of railNeutral) {
      assert.equal(fixture.source.kind, 'rail-neutral');
      const receipt = fixture.source.receipt as RailNeutralPaymentReceipt;
      assert.equal(receipt.schemaVersion, 'reddi.rail-neutral-payment-receipt.v1');
      assert.equal(receipt.guardrails.livePaymentExecuted, false);
      assert.equal(receipt.guardrails.rpcCall, false);
    }
  });
});
