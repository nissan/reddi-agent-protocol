import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  QUASAR_REPUTATION_INTENT_COMPATIBILITY,
  QUASAR_REPUTATION_INTENT_SCHEMA_VERSION,
  deriveOffchainReputationPreview,
  deriveQuasarRegistryCompatibility,
  deriveQuasarReputationIntentPlan,
  evaluateQuasarReputationIntentSourceEligibility,
  type QuasarRegistryCompatibilityReport,
  type QuasarReputationIntentInput,
  type RailNeutralPaymentReceipt,
  type ReceiptEvidenceBinding,
} from '../dist/index.js';

const createdAt = '2026-07-06T09:00:00.000Z';
const listingId = 'listing:quasar-intent-fixture';

function binding(overrides: Partial<ReceiptEvidenceBinding> = {}): ReceiptEvidenceBinding {
  return {
    schemaVersion: 'reddi.receipt-evidence-binding.v1',
    id: 'binding:quasar-intent:happy',
    source: {
      kind: 'hosted-rap-registry',
      sourceId: 'source:quasar-intent:happy',
      catalogRef: '/.well-known/ai-catalog.json',
      listingId,
      rawSnapshotRef: 'sha256:quasar-intent-source-snapshot',
    },
    receipt: {
      id: 'job:quasar-intent:happy',
      sourceId: 'source:quasar-intent:happy',
      policyDecision: {
        schemaVersion: 'reddi.policy-decision.v1',
        allowed: true,
        reasonCodes: ['allowed'],
        quotedAmount: {
          amount: '2500000',
          asset: 'AUDD',
          network: 'solana-devnet',
          source: 'source:quasar-intent:happy',
          specialist: listingId,
        },
        approvalState: 'approved',
        asset: 'AUDD',
        network: 'solana-devnet',
        auditNotes: ['Allowed by quasar intent fixture.'],
      },
      paymentProofRef: 'dry-run:audd-proof:quasar-intent-happy',
      requestHash: 'sha256:request-quasar-intent-happy',
      responseHash: 'sha256:response-quasar-intent-happy',
      evidenceRef: 'file://fixtures/evidence/quasar-intent-happy.json',
      attestationStatus: 'attested',
    },
    evidence: {
      id: 'evidence:quasar-intent:happy',
      receiptId: 'job:quasar-intent:happy',
      evidenceRef: 'file://fixtures/evidence/quasar-intent-happy.json',
      evidenceHash: 'sha256:evidence-quasar-intent-happy',
    },
    payment: {
      preflightAllowed: true,
      reasonCodes: ['audd_payment_plan_allowed'],
      paymentProofRef: 'dry-run:audd-proof:quasar-intent-happy',
      planRef: {
        asset: 'AUDD',
        network: 'solana-devnet',
        amount: '2500000',
        paymentMode: 'dry-run',
        evidenceRequired: true,
      },
    },
    attestation: {
      id: 'attestation:quasar-intent:happy',
      status: 'attested',
      verdict: 'passed',
      trustBoundary: 'reddi_attested',
    },
    reputationEventDraft: {
      schemaVersion: 'reddi.reputation-event.v1',
      id: 'reputation:quasar-intent:happy',
      subjectId: listingId,
      receiptId: 'job:quasar-intent:happy',
      evidenceId: 'evidence:quasar-intent:happy',
      attestationId: 'attestation:quasar-intent:happy',
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

function compatibility(overrides: Partial<Parameters<typeof deriveQuasarRegistryCompatibility>[0]> = {}): QuasarRegistryCompatibilityReport {
  return deriveQuasarRegistryCompatibility({
    listingId,
    displayName: 'Quasar Intent Fixture Listing',
    registrationIntent: 'metadata_only',
    offchain: {
      catalogRefs: ['/.well-known/ai-catalog.json'],
      evidenceRefs: ['file://fixtures/evidence/quasar-intent-happy.json'],
    },
    ...overrides,
  });
}

function intentInput(overrides: Partial<QuasarReputationIntentInput> = {}): QuasarReputationIntentInput {
  return {
    id: 'quasar-intent:happy',
    binding: binding(),
    compatibility: compatibility(),
    createdAt,
    ...overrides,
  };
}

function disputedBinding(): ReceiptEvidenceBinding {
  const base = binding({ id: 'binding:quasar-intent:disputed' });
  return {
    ...base,
    receipt: { ...base.receipt, attestationStatus: 'rejected' },
    attestation: { ...base.attestation!, status: 'rejected', verdict: 'disputed' },
    reputationEventDraft: {
      ...base.reputationEventDraft!,
      verdict: 'disputed',
      workStatus: 'disputed',
      rubricScore: 25,
      confidence: 25,
      delta: -50,
      nextScore: 0,
      routingImpact: 'deprioritized',
      reasonCodes: ['work_disputed'],
    },
  };
}

function railNeutralReceipt(supportState: RailNeutralPaymentReceipt['supportState']): RailNeutralPaymentReceipt {
  return {
    schemaVersion: 'reddi.rail-neutral-payment-receipt.v1',
    rail: 'pay-sh-sandbox',
    case: 'quasar_intent_gate_case',
    supportState,
    source: { kind: 'static-fixture', sourceId: 'source:quasar-intent:rail-neutral', fixtureRef: 'fixture:rail-neutral' },
    payment: {
      network: 'solana-devnet',
      asset: 'USDC',
      amount: '2500000',
      unit: 'microusd',
      paymentProofRef: 'fixture:sandbox-payment:quasar-intent',
    },
    bindingRefs: {
      evidenceRef: 'fixture:evidence:quasar-intent',
      requestHash: 'sha256:request-rail-neutral',
      responseHash: 'sha256:response-rail-neutral',
      recipientRef: 'fixture:recipient:quasar-intent',
      nonceRef: 'fixture:nonce:quasar-intent',
      operatorApprovalRef: 'fixture:operator-approval:quasar-intent',
    },
    policy: { allowed: true, reasonCodes: ['allowed'], auditNotes: ['rail-neutral fixture'] },
    bindingIntegration: {
      schemaVersion: 'reddi.receipt-evidence-binding.v1',
      compatible: supportState === 'receipt_binding_candidate',
      requiredReceiptSchemaVersion: 'reddi.receipt.v1',
      ...(supportState === 'receipt_binding_candidate' ? {} : { incompatibilityReasons: ['fixture cap'] }),
    },
    claimBoundary: ['fixture only; no custody, settlement finality, or live payment claim'],
    guardrails: {
      fixtureOnly: true,
      livePaymentExecuted: false,
      walletSigning: false,
      rpcCall: false,
      providerCall: false,
      hostedRegistryWrite: false,
      marketplacePublication: false,
      trustUpgrade: false,
      reputationMutation: false,
      settlementProof: false,
      custodyClaim: false,
    },
  } as RailNeutralPaymentReceipt;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

describe('deriveQuasarReputationIntentPlan — happy paths', () => {
  it('maps an attested/passed record set to commit + reveal + confirm intent fixtures', () => {
    const result = deriveQuasarReputationIntentPlan(intentInput());
    assert.equal(result.ok, true);
    assert.equal(result.plan.status, 'intent_ready');
    assert.equal(result.plan.schemaVersion, QUASAR_REPUTATION_INTENT_SCHEMA_VERSION);
    assert.deepEqual(
      result.plan.intents.map((intent) => intent.kind),
      ['commit', 'reveal', 'confirm'],
    );
    const laneByKind = Object.fromEntries(result.plan.lanes.map((lane) => [lane.kind, lane]));
    assert.equal(laneByKind.commit.eligible, true);
    assert.equal(laneByKind.reveal.eligible, true);
    assert.equal(laneByKind.confirm.eligible, true);
    assert.equal(laneByKind.dispute.eligible, false);
    assert.ok(laneByKind.dispute.reasonCodes.includes('attestation_state_excluded'));
    assert.ok(result.plan.reasonCodes.includes('intent_ready'));
    assert.ok(result.plan.reasonCodes.includes('fixture_intent_only'));
    assert.ok(result.plan.reasonCodes.includes('instruction_not_built'));
    assert.ok(result.plan.reasonCodes.includes('buyer_facing_claim_disabled'));
    assert.equal(result.plan.display.buyerFacingClaimAllowed, false);
  });

  it('emits the commit intent with the documented lane, discriminator, and an uncomputed commitment', () => {
    const result = deriveQuasarReputationIntentPlan(intentInput());
    const commitIntent = result.plan.intents.find((intent) => intent.kind === 'commit');
    assert.ok(commitIntent);
    assert.equal(commitIntent.program.lane, 'quasar-reputation');
    assert.equal(commitIntent.program.instructionName, 'commit');
    assert.equal(commitIntent.program.discriminator, 1);
    assert.equal(commitIntent.program.deploymentsRef, 'config/quasar/deployments.json');
    assert.equal(commitIntent.compactFields.jobIdRef, 'job:quasar-intent:happy');
    assert.equal(commitIntent.compactFields.role, 'consumer');
    assert.equal(commitIntent.compactFields.commitment?.state, 'not_computed');
    assert.deepEqual(commitIntent.compactFields.commitment?.preimageFields, ['score', 'salt', 'job_id', 'program_id']);
    assert.ok(commitIntent.deferredToInstructionBuilder.includes('salt_generation'));
    assert.ok(commitIntent.deferredToInstructionBuilder.includes('commitment_hash'));
    assert.ok(commitIntent.deferredToInstructionBuilder.includes('consumer_pk'));
    assert.ok(commitIntent.deferredToInstructionBuilder.includes('specialist_pk'));
  });

  it('scales the reveal score from the 0-100 rubric score onto the program 1-10 range', () => {
    const result = deriveQuasarReputationIntentPlan(intentInput());
    const revealIntent = result.plan.intents.find((intent) => intent.kind === 'reveal');
    assert.ok(revealIntent);
    assert.equal(revealIntent.program.discriminator, 2);
    assert.equal(revealIntent.compactFields.score, 9); // rubricScore 92 -> 9
    assert.ok(revealIntent.compactFields.score! >= QUASAR_REPUTATION_INTENT_COMPATIBILITY.scoreRange.min);
    assert.ok(revealIntent.compactFields.score! <= QUASAR_REPUTATION_INTENT_COMPATIBILITY.scoreRange.max);
    assert.ok(revealIntent.deferredToInstructionBuilder.includes('salt'));
  });

  it('routes confirm intents to the attestation program lane', () => {
    const result = deriveQuasarReputationIntentPlan(intentInput());
    const confirmIntent = result.plan.intents.find((intent) => intent.kind === 'confirm');
    assert.ok(confirmIntent);
    assert.equal(confirmIntent.program.lane, 'quasar-attestation');
    assert.equal(confirmIntent.program.discriminator, 2);
    assert.deepEqual(Object.keys(confirmIntent.compactFields), ['jobIdRef']);
  });

  it('maps a rejected receipt with a disputed attestation onto the dispute lane', () => {
    const result = deriveQuasarReputationIntentPlan(intentInput({ binding: disputedBinding() }));
    assert.equal(result.ok, true);
    assert.deepEqual(
      result.plan.intents.map((intent) => intent.kind),
      ['commit', 'reveal', 'dispute'],
    );
    const disputeIntent = result.plan.intents.find((intent) => intent.kind === 'dispute');
    assert.ok(disputeIntent);
    assert.equal(disputeIntent.program.lane, 'quasar-attestation');
    assert.equal(disputeIntent.program.discriminator, 3);
    const revealIntent = result.plan.intents.find((intent) => intent.kind === 'reveal');
    assert.equal(revealIntent?.compactFields.score, 3); // rubricScore 25 -> 3
    const laneByKind = Object.fromEntries(result.plan.lanes.map((lane) => [lane.kind, lane]));
    assert.equal(laneByKind.confirm.eligible, false);
  });

  it('accepts a matching preview_ready read-model and records its id by reference', () => {
    const happyBinding = binding();
    const preview = deriveOffchainReputationPreview({ id: happyBinding.id, binding: happyBinding, createdAt });
    assert.equal(preview.ok, true);
    const result = deriveQuasarReputationIntentPlan(intentInput({ binding: happyBinding, preview: preview.preview }));
    assert.equal(result.ok, true);
    assert.equal(result.plan.evidenceSummary.previewId, happyBinding.id);
    for (const intent of result.plan.intents) {
      assert.equal(intent.offchainRefs.previewId, happyBinding.id);
    }
  });

  it('keeps confirm eligible but rating lanes ineligible when the reputation draft is missing', () => {
    const result = deriveQuasarReputationIntentPlan(intentInput({
      binding: binding({ reputationEventDraft: undefined }),
    }));
    assert.equal(result.ok, true);
    assert.deepEqual(result.plan.intents.map((intent) => intent.kind), ['confirm']);
    const laneByKind = Object.fromEntries(result.plan.lanes.map((lane) => [lane.kind, lane]));
    assert.ok(laneByKind.commit.reasonCodes.includes('missing_reputation_draft'));
    assert.ok(laneByKind.reveal.reasonCodes.includes('missing_reputation_draft'));
  });

  it('is deterministic and does not mutate its (frozen) inputs', () => {
    const first = deriveQuasarReputationIntentPlan(deepFreeze(intentInput()));
    const second = deriveQuasarReputationIntentPlan(deepFreeze(intentInput()));
    assert.deepEqual(first, second);
  });
});

describe('deriveQuasarReputationIntentPlan — fail-closed gates', () => {
  function assertBlocked(input: QuasarReputationIntentInput, code: string) {
    const result = deriveQuasarReputationIntentPlan(input);
    assert.equal(result.ok, false, `expected blocked for ${code}`);
    assert.equal(result.plan.status, 'blocked');
    assert.ok(result.plan.reasonCodes.includes(code as never), `expected reason code ${code}, got ${result.plan.reasonCodes.join(',')}`);
    assert.deepEqual(result.plan.intents, [], 'a blocked plan must carry no intent records');
    assert.ok(result.plan.lanes.every((lane) => lane.eligible === false), 'a blocked plan must have no eligible lanes');
  }

  it('blocks when the #390 compatibility mapping is missing', () => {
    assertBlocked(intentInput({ compatibility: undefined }), 'missing_quasar_compatibility');
  });

  it('blocks when the compatibility report carries the wrong schema version', () => {
    const report = { ...compatibility(), schemaVersion: 'reddi.other.v1' } as unknown as QuasarRegistryCompatibilityReport;
    assertBlocked(intentInput({ compatibility: report }), 'missing_quasar_compatibility');
  });

  it('blocks when the compatibility report itself is blocked', () => {
    const report = compatibility({ listingId: '', displayName: '' });
    assert.equal(report.registrationStatus, 'blocked');
    assertBlocked(intentInput({ compatibility: { ...report, listingId } }), 'quasar_compatibility_blocked');
  });

  it('blocks when the compatibility report is for a different listing', () => {
    assertBlocked(
      intentInput({ compatibility: compatibility({ listingId: 'listing:someone-else' }) }),
      'compatibility_subject_mismatch',
    );
  });

  it('blocks on unsafe binding guardrails', () => {
    const unsafe = binding();
    (unsafe.guardrails as { walletSigning: boolean }).walletSigning = true;
    assertBlocked(intentInput({ binding: unsafe }), 'unsafe_live_guardrail');
  });

  it('blocks on unsafe compatibility guardrails', () => {
    const report = compatibility();
    const doctored = {
      ...report,
      guardrails: { ...report.guardrails, instructionBuilt: true },
    } as unknown as QuasarRegistryCompatibilityReport;
    assertBlocked(intentInput({ compatibility: doctored }), 'unsafe_live_guardrail');
  });

  it('blocks on a denied policy decision', () => {
    const denied = binding();
    (denied.receipt.policyDecision as { allowed: boolean }).allowed = false;
    assertBlocked(intentInput({ binding: denied }), 'policy_denied');
  });

  it('blocks on a failed payment preflight', () => {
    const failed = binding();
    (failed.payment as { preflightAllowed: boolean }).preflightAllowed = false;
    assertBlocked(intentInput({ binding: failed }), 'payment_preflight_denied');
  });

  it('blocks on a missing payment proof', () => {
    const missing = binding();
    (missing.payment as { paymentProofRef: string }).paymentProofRef = '';
    assertBlocked(intentInput({ binding: missing }), 'missing_payment_proof');
  });

  it('blocks on a payment proof mismatch between preflight and receipt', () => {
    const mismatch = binding();
    (mismatch.payment as { paymentProofRef: string }).paymentProofRef = 'dry-run:audd-proof:other';
    assertBlocked(intentInput({ binding: mismatch }), 'missing_payment_proof');
  });

  it('blocks on missing evidence', () => {
    const missing = binding();
    (missing.evidence as { evidenceHash: string }).evidenceHash = '';
    assertBlocked(intentInput({ binding: missing }), 'missing_evidence');
  });

  it('blocks on a missing attestation', () => {
    assertBlocked(intentInput({ binding: binding({ attestation: undefined }) }), 'missing_attestation');
  });

  it('blocks non-final receipt states (pending / not_requested)', () => {
    for (const attestationStatus of ['pending', 'not_requested'] as const) {
      const nonFinal = binding();
      (nonFinal.receipt as { attestationStatus: string }).attestationStatus = attestationStatus;
      assertBlocked(intentInput({ binding: nonFinal }), 'non_final_state_excluded');
    }
  });

  it('blocks failure-final receipts', () => {
    const failureFinal = binding();
    (failureFinal.receipt as { attestationStatus: string }).attestationStatus = 'failed';
    assertBlocked(intentInput({ binding: failureFinal }), 'failure_final_excluded');
  });

  it('excludes rejected receipts whose attestation verdict is not a consumer dispute', () => {
    const rejected = binding();
    (rejected.receipt as { attestationStatus: string }).attestationStatus = 'rejected';
    (rejected.attestation as { verdict: string }).verdict = 'refunded';
    assertBlocked(intentInput({ binding: rejected }), 'attestation_state_excluded');
  });

  it('blocks a malformed binding (wrong schema version)', () => {
    const malformed = { ...binding(), schemaVersion: 'reddi.other.v1' } as unknown as ReceiptEvidenceBinding;
    assertBlocked(intentInput({ binding: malformed }), 'malformed_binding');
  });

  it('blocks malformed source metadata (no source refs)', () => {
    const noRefs = binding();
    (noRefs.source as Record<string, unknown>).catalogRef = undefined;
    (noRefs.source as Record<string, unknown>).listingId = undefined;
    (noRefs.source as Record<string, unknown>).rawSnapshotRef = undefined;
    const result = deriveQuasarReputationIntentPlan(intentInput({ binding: noRefs }));
    assert.equal(result.ok, false);
    assert.ok(result.plan.reasonCodes.includes('missing_source_ref'));
  });

  it('blocks a missing intent id and a malformed createdAt', () => {
    assertBlocked(intentInput({ id: '' }), 'missing_intent_id');
    assertBlocked(intentInput({ createdAt: 'not-a-timestamp' }), 'malformed_intent');
  });

  it('blocks when a supplied preview is not preview_ready', () => {
    const insufficient = binding({ reputationEventDraft: undefined });
    const preview = deriveOffchainReputationPreview({ id: insufficient.id, binding: insufficient, createdAt });
    assert.equal(preview.preview.status, 'insufficient_evidence');
    assertBlocked(intentInput({ preview: preview.preview }), 'preview_not_ready');
  });

  it('blocks when a supplied preview does not match the binding evidence', () => {
    const otherBinding = binding({ id: 'binding:quasar-intent:other' });
    const preview = deriveOffchainReputationPreview({ id: otherBinding.id, binding: otherBinding, createdAt });
    assert.equal(preview.ok, true);
    assertBlocked(intentInput({ preview: preview.preview }), 'preview_mismatch');
  });
});

describe('evaluateQuasarReputationIntentSourceEligibility', () => {
  it('accepts an eligible receipt-evidence binding', () => {
    const eligibility = evaluateQuasarReputationIntentSourceEligibility({
      kind: 'receipt-evidence-binding',
      binding: binding(),
    });
    assert.equal(eligibility.eligible, true);
    assert.deepEqual(eligibility.reasonCodes, []);
  });

  it('rejects a binding without an attestation', () => {
    const eligibility = evaluateQuasarReputationIntentSourceEligibility({
      kind: 'receipt-evidence-binding',
      binding: binding({ attestation: undefined }),
    });
    assert.equal(eligibility.eligible, false);
    assert.ok(eligibility.reasonCodes.includes('missing_attestation'));
  });

  it('excludes probe-only rail-neutral receipts outright', () => {
    const eligibility = evaluateQuasarReputationIntentSourceEligibility({
      kind: 'rail-neutral',
      receipt: railNeutralReceipt('probe_only'),
    });
    assert.equal(eligibility.eligible, false);
    assert.deepEqual(eligibility.reasonCodes, ['probe_only_receipt_excluded']);
  });

  it('requires rail-neutral binding candidates to bridge into reddi.receipt.v1 first', () => {
    const eligibility = evaluateQuasarReputationIntentSourceEligibility({
      kind: 'rail-neutral',
      receipt: railNeutralReceipt('receipt_binding_candidate'),
    });
    assert.equal(eligibility.eligible, false);
    assert.deepEqual(eligibility.reasonCodes, ['rail_neutral_bridge_required']);
  });

  it('rejects unsupported rail-neutral networks', () => {
    const eligibility = evaluateQuasarReputationIntentSourceEligibility({
      kind: 'rail-neutral',
      receipt: railNeutralReceipt('unsupported_receipt_v1_network'),
    });
    assert.equal(eligibility.eligible, false);
    assert.ok(eligibility.reasonCodes.includes('unsupported_network_asset'));
  });

  it('rejects malformed sources', () => {
    const eligibility = evaluateQuasarReputationIntentSourceEligibility(
      { kind: 'unknown' } as never,
    );
    assert.equal(eligibility.eligible, false);
    assert.deepEqual(eligibility.reasonCodes, ['malformed_source_metadata']);
  });
});

describe('no-live boundary proofs', () => {
  it('marks every intent record explicitly unbuilt and unsignable with all-false plan guardrails', () => {
    for (const input of [intentInput(), intentInput({ binding: disputedBinding() })]) {
      const result = deriveQuasarReputationIntentPlan(input);
      assert.ok(result.plan.intents.length > 0);
      for (const intent of result.plan.intents) {
        assert.equal(intent.instructionBuilt, false);
        assert.equal(intent.signable, false);
      }
      assert.deepEqual(result.plan.guardrails, {
        quasarInstructionBuilt: false,
        walletSigning: false,
        rpcCall: false,
        programDeploy: false,
        livePaymentExecuted: false,
        reputationMutated: false,
        hostedRegistryWrite: false,
        marketplacePublished: false,
      });
    }
  });

  it('keeps intent records compact: rich RAP/ARD metadata never appears inline', () => {
    const result = deriveQuasarReputationIntentPlan(intentInput());
    const serialized = JSON.stringify(result.plan.intents);
    for (const richField of [
      'displayName',
      'description',
      'buyerPreview',
      'endpoint',
      'ardUrl',
      'auddTerms',
      'trustBadges',
      'capabilities',
      'riskDiagnostics',
      'rubric',
      'auditNotes',
    ]) {
      assert.ok(!serialized.includes(richField), `intent records must not inline ${richField}`);
    }
    // Evidence and attestations travel by reference only.
    for (const intent of result.plan.intents) {
      assert.ok(intent.offchainRefs.evidenceHash.startsWith('sha256:'));
      assert.ok(intent.offchainRefs.evidenceRef.startsWith('file://'));
    }
  });

  it('never leaks credential-shaped or raw-payload material into the plan', () => {
    const serialized = JSON.stringify(deriveQuasarReputationIntentPlan(intentInput()).plan);
    for (const forbiddenKey of ['privateKey', 'secretKey', 'mnemonic', 'rawPrompt', 'rawOutput', 'transcript', 'completion']) {
      assert.ok(!serialized.includes(forbiddenKey), `plan must not contain ${forbiddenKey}`);
    }
  });

  it('imports nothing from wallet / RPC / chain-client stacks and stays fully synchronous (source guard)', () => {
    const sourcePath = fileURLToPath(new URL('../src/quasar-reputation-intent.ts', import.meta.url));
    const source = readFileSync(sourcePath, 'utf8');
    const forbiddenImports = [
      '@solana/web3.js',
      '@solana/spl-token',
      '@coral-xyz/anchor',
      '@magicblock-labs',
      'ethers',
      'viem',
      'node:net',
      'node:http',
      'node:https',
      'node:child_process',
      'child_process',
      'node:fs',
      'node:crypto',
    ];
    for (const banned of forbiddenImports) {
      assert.ok(!source.includes(banned), `module must not import ${banned}`);
    }
    const forbiddenTerms = [
      'fetch(',
      'XMLHttpRequest',
      'WebSocket',
      'Keypair',
      'new Connection',
      'clusterApiUrl',
      'sendTransaction',
      'sendAndConfirmTransaction',
      'sendRawTransaction',
      'signTransaction',
      'signAllTransactions',
      'partialSign',
      'requestAirdrop',
      'simulateTransaction',
      'getLatestBlockhash',
      'findProgramAddress',
      'TransactionInstruction',
      'AccountMeta',
      'SystemProgram',
      'process.env',
      'api.devnet.solana.com',
    ];
    for (const banned of forbiddenTerms) {
      assert.ok(!source.includes(banned), `module must not reference ${banned}`);
    }
    // No wallet, RPC, deploy, payment, or mutation surface can hide behind
    // an async boundary: the module is pure synchronous data mapping.
    assert.ok(!/\basync\b/.test(source), 'module must not contain async code');
    assert.ok(!/\bawait\b/.test(source), 'module must not contain await');
    // Guardrails may only ever be declared false in source.
    assert.ok(!/quasarInstructionBuilt\s*:\s*true/.test(source));
    assert.ok(!/reputationMutated\s*:\s*true/.test(source));
    assert.ok(!/walletSigning\s*:\s*true/.test(source));
    assert.ok(!/rpcCall\s*:\s*true/.test(source));
    assert.ok(!/programDeploy\s*:\s*true/.test(source));
    assert.ok(!/livePaymentExecuted\s*:\s*true/.test(source));
    assert.ok(!/instructionBuilt\s*:\s*true/.test(source));
    assert.ok(!/signable\s*:\s*true/.test(source));
  });
});
