import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ATTESTATION_REPUTATION_BRIDGE_SCHEMA_VERSION,
  deriveAttestationReputationBridge,
  deriveQuasarRegistryCompatibility,
  type AttestationReputationBridgeInput,
  type QuasarRegistryCompatibilityReport,
  type ReceiptEvidenceBinding,
} from '../dist/index.js';

const createdAt = '2026-07-16T09:00:00.000Z';
const listingId = 'listing:reputation-bridge-fixture';

function binding(overrides: Partial<ReceiptEvidenceBinding> = {}): ReceiptEvidenceBinding {
  return {
    schemaVersion: 'reddi.receipt-evidence-binding.v1',
    id: 'binding:reputation-bridge:happy',
    source: {
      kind: 'hosted-rap-registry',
      sourceId: 'source:reputation-bridge:happy',
      catalogRef: '/.well-known/ai-catalog.json',
      listingId,
      rawSnapshotRef: 'sha256:reputation-bridge-source-snapshot',
    },
    receipt: {
      id: 'job:reputation-bridge:happy',
      sourceId: 'source:reputation-bridge:happy',
      policyDecision: {
        schemaVersion: 'reddi.policy-decision.v1',
        allowed: true,
        reasonCodes: ['allowed'],
        quotedAmount: {
          amount: '2500000',
          asset: 'AUDD',
          network: 'solana-devnet',
          source: 'source:reputation-bridge:happy',
          specialist: listingId,
        },
        approvalState: 'approved',
        asset: 'AUDD',
        network: 'solana-devnet',
        auditNotes: ['Allowed by reputation bridge fixture.'],
      },
      paymentProofRef: 'dry-run:audd-proof:reputation-bridge-happy',
      requestHash: 'sha256:request-reputation-bridge-happy',
      responseHash: 'sha256:response-reputation-bridge-happy',
      evidenceRef: 'file://fixtures/evidence/reputation-bridge-happy.json',
      attestationStatus: 'attested',
    },
    evidence: {
      id: 'evidence:reputation-bridge:happy',
      receiptId: 'job:reputation-bridge:happy',
      evidenceRef: 'file://fixtures/evidence/reputation-bridge-happy.json',
      evidenceHash: 'sha256:evidence-reputation-bridge-happy',
    },
    payment: {
      preflightAllowed: true,
      reasonCodes: ['audd_payment_plan_allowed'],
      paymentProofRef: 'dry-run:audd-proof:reputation-bridge-happy',
      planRef: {
        asset: 'AUDD',
        network: 'solana-devnet',
        amount: '2500000',
        paymentMode: 'dry-run',
        evidenceRequired: true,
      },
    },
    attestation: {
      id: 'attestation:reputation-bridge:happy',
      status: 'attested',
      verdict: 'passed',
      trustBoundary: 'reddi_attested',
    },
    reputationEventDraft: {
      schemaVersion: 'reddi.reputation-event.v1',
      id: 'reputation:reputation-bridge:happy',
      subjectId: listingId,
      receiptId: 'job:reputation-bridge:happy',
      evidenceId: 'evidence:reputation-bridge:happy',
      attestationId: 'attestation:reputation-bridge:happy',
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

function compatibility(
  overrides: Partial<Parameters<typeof deriveQuasarRegistryCompatibility>[0]> = {},
): QuasarRegistryCompatibilityReport {
  return deriveQuasarRegistryCompatibility({
    listingId,
    displayName: 'Reputation Bridge Fixture Listing',
    registrationIntent: 'metadata_only',
    offchain: {
      catalogRefs: ['/.well-known/ai-catalog.json'],
      evidenceRefs: ['file://fixtures/evidence/reputation-bridge-happy.json'],
    },
    ...overrides,
  });
}

function hostedInputs() {
  return {
    proof: {
      sourceProofRef: 'hosted-proof:source:reputation-bridge-happy',
      attestationProofRef: 'hosted-proof:attestation:reputation-bridge-happy',
      hostedBy: 'reddi' as const,
    },
    operatorApproval: {
      approved: true,
      evidenceRef: 'evidence:operator-approval:reputation-bridge-happy',
    },
    publicationGate: {
      issue: 395 as const,
      state: 'claim_contract_ready' as const,
      evidenceRef: 'evidence:publication-gate:reputation-bridge-happy',
    },
  };
}

function bridgeInput(overrides: Partial<AttestationReputationBridgeInput> = {}): AttestationReputationBridgeInput {
  return {
    id: 'reputation-bridge:happy',
    binding: binding(),
    compatibility: compatibility(),
    createdAt,
    ...overrides,
  };
}

function externalBinding(): ReceiptEvidenceBinding {
  const base = binding({ id: 'binding:reputation-bridge:external' });
  return {
    ...base,
    source: {
      kind: 'ai-catalog',
      sourceId: 'source:reputation-bridge:happy',
      catalogRef: 'https://catalog.example.invalid/.well-known/ai-catalog.json',
      profileId: 'profile:reputation-bridge-external',
    },
  };
}

describe('deriveAttestationReputationBridge — backing classification', () => {
  it('classifies a fully-gated hosted record set as hosted_attestation_backed', () => {
    const result = deriveAttestationReputationBridge(bridgeInput({ hosted: hostedInputs() }));
    assert.equal(result.ok, true);
    assert.equal(result.bridge.schemaVersion, ATTESTATION_REPUTATION_BRIDGE_SCHEMA_VERSION);
    assert.equal(result.bridge.status, 'hosted_attestation_backed');
    assert.equal(result.bridge.display.label, 'Hosted attestation-backed');
    assert.equal(result.bridge.lanes.hostedAttestation.status, 'ready');
    assert.equal(result.bridge.lanes.offchainPreview.status, 'available');
    assert.equal(result.bridge.lanes.quasar.status, 'intent_fixtures_ready');
    assert.equal(result.bridge.marking.source, 'hosted_registry');
    assert.ok(result.bridge.reasonCodes.includes('hosted_attestation_ready'));
  });

  it('classifies preview + eligible intent plan without hosted gates as quasar_intent_fixtures', () => {
    const result = deriveAttestationReputationBridge(bridgeInput());
    assert.equal(result.ok, true);
    assert.equal(result.bridge.status, 'quasar_intent_fixtures');
    assert.equal(result.bridge.display.label, 'Quasar intent fixtures ready');
    // The hosted-registry binding without gate metadata leaves the hosted lane pending.
    assert.equal(result.bridge.lanes.hostedAttestation.status, 'pending');
    assert.ok(result.bridge.reasonCodes.includes('hosted_claim_pending'));
    assert.ok(result.bridge.reasonCodes.includes('quasar_intent_fixtures_ready'));
  });

  it('classifies a valid binding without a #390 compatibility report as offchain_preview', () => {
    const result = deriveAttestationReputationBridge(bridgeInput({
      binding: externalBinding(),
      compatibility: undefined,
    }));
    assert.equal(result.ok, true);
    assert.equal(result.bridge.status, 'offchain_preview');
    assert.equal(result.bridge.lanes.quasar.status, 'compatibility_missing');
    assert.equal(result.bridge.lanes.hostedAttestation.status, 'not_available');
    assert.ok(result.bridge.reasonCodes.includes('missing_quasar_compatibility'));
    assert.ok(result.bridge.reasonCodes.includes('offchain_preview_available'));
  });

  it('classifies a binding missing attestation and reputation draft as insufficient_evidence', () => {
    const base = binding({ id: 'binding:reputation-bridge:insufficient' });
    const insufficient: ReceiptEvidenceBinding = {
      ...base,
      receipt: { ...base.receipt, attestationStatus: 'pending' },
      attestation: undefined,
      reputationEventDraft: undefined,
    };
    const result = deriveAttestationReputationBridge(bridgeInput({ binding: insufficient }));
    assert.equal(result.ok, true);
    assert.equal(result.bridge.status, 'insufficient_evidence');
    assert.equal(result.bridge.display.label, 'Insufficient evidence');
    assert.equal(result.bridge.lanes.offchainPreview.status, 'insufficient_evidence');
    assert.equal(result.bridge.listingProjection.offchainPreview, 'pending');
    // Quasar lane fails closed too: the intent gate requires attestation evidence.
    assert.equal(result.bridge.lanes.quasar.status, 'blocked');
    assert.equal(result.bridge.records.preview?.previewEvent, undefined);
  });

  it('marks a binding-less external listing as unverified_external instead of deriving anything', () => {
    const result = deriveAttestationReputationBridge({
      id: 'reputation-bridge:external-listing',
      source: {
        kind: 'ai-catalog',
        sourceId: 'source:external-catalog',
        catalogRef: 'https://catalog.example.invalid/.well-known/ai-catalog.json',
        listingId: 'listing:external-unverified',
      },
      createdAt,
    });
    assert.equal(result.ok, true);
    assert.equal(result.bridge.status, 'unverified_external');
    assert.equal(result.bridge.display.label, 'Unverified external listing');
    assert.equal(result.bridge.marking.source, 'external_source');
    assert.equal(result.bridge.subject.id, 'listing:external-unverified');
    assert.equal(result.bridge.lanes.offchainPreview.status, 'not_available');
    assert.equal(result.bridge.lanes.quasar.status, 'not_available');
    assert.equal(result.bridge.lanes.hostedAttestation.status, 'not_available');
    assert.deepEqual(result.bridge.records, { preview: undefined, quasarIntentPlan: undefined, hostedClaim: undefined });
    assert.equal(result.bridge.evidenceSummary, undefined);
    assert.ok(result.bridge.reasonCodes.includes('missing_binding'));
    assert.ok(result.bridge.reasonCodes.includes('external_source_marked'));
  });

  it('marks external sources on evidence-backed previews without hiding the preview', () => {
    const result = deriveAttestationReputationBridge(bridgeInput({
      binding: externalBinding(),
      compatibility: undefined,
    }));
    assert.equal(result.bridge.marking.source, 'external_source');
    assert.ok(result.bridge.reasonCodes.includes('external_source_marked'));
    assert.equal(result.bridge.status, 'offchain_preview');
  });
});

describe('deriveAttestationReputationBridge — fail-closed gates', () => {
  it('blocks on denied policy with no reputation surface of any kind', () => {
    const base = binding({ id: 'binding:reputation-bridge:policy-denied' });
    const denied: ReceiptEvidenceBinding = {
      ...base,
      receipt: {
        ...base.receipt,
        policyDecision: { ...base.receipt.policyDecision, allowed: false, approvalState: 'denied' },
      },
    };
    const result = deriveAttestationReputationBridge(bridgeInput({ binding: denied }));
    assert.equal(result.ok, false);
    assert.equal(result.bridge.status, 'blocked');
    assert.equal(result.bridge.lanes.offchainPreview.status, 'blocked');
    assert.equal(result.bridge.lanes.quasar.status, 'blocked');
    assert.equal(result.bridge.records.preview?.status, 'blocked');
    assert.equal(result.bridge.records.quasarIntentPlan?.intents.length, 0);
    assert.ok(result.bridge.reasonCodes.includes('preview_blocked'));
  });

  it('blocks on unverified payment proof', () => {
    const base = binding({ id: 'binding:reputation-bridge:payment-proof' });
    const mismatched: ReceiptEvidenceBinding = {
      ...base,
      payment: { ...base.payment, paymentProofRef: 'dry-run:audd-proof:other' },
    };
    const result = deriveAttestationReputationBridge(bridgeInput({ binding: mismatched }));
    assert.equal(result.ok, false);
    assert.equal(result.bridge.status, 'blocked');
  });

  it('blocks on failed attestation', () => {
    const base = binding({ id: 'binding:reputation-bridge:failed-attestation' });
    const failed: ReceiptEvidenceBinding = {
      ...base,
      receipt: { ...base.receipt, attestationStatus: 'failed' },
      attestation: { ...base.attestation!, status: 'failed', verdict: 'failed' },
    };
    const result = deriveAttestationReputationBridge(bridgeInput({ binding: failed }));
    assert.equal(result.ok, false);
    assert.equal(result.bridge.status, 'blocked');
  });

  it('blocks on unsafe live guardrails in the binding', () => {
    const base = binding({ id: 'binding:reputation-bridge:unsafe' });
    const unsafe = {
      ...base,
      guardrails: { ...base.guardrails, livePaymentExecuted: true },
    } as unknown as ReceiptEvidenceBinding;
    const result = deriveAttestationReputationBridge(bridgeInput({ binding: unsafe }));
    assert.equal(result.ok, false);
    assert.equal(result.bridge.status, 'blocked');
  });

  it('blocks on missing bridge id and malformed createdAt', () => {
    const missingId = deriveAttestationReputationBridge(bridgeInput({ id: '' }));
    assert.equal(missingId.ok, false);
    assert.ok(missingId.bridge.reasonCodes.includes('missing_bridge_id'));

    const badTimestamp = deriveAttestationReputationBridge(bridgeInput({ createdAt: 'not-a-date' }));
    assert.equal(badTimestamp.ok, false);
    assert.ok(badTimestamp.bridge.reasonCodes.includes('malformed_bridge'));
  });

  it('blocks on a wrong-schema binding instead of trusting it', () => {
    const wrongSchema = { ...binding(), schemaVersion: 'reddi.receipt-evidence-binding.v0' } as unknown as ReceiptEvidenceBinding;
    const result = deriveAttestationReputationBridge(bridgeInput({ binding: wrongSchema }));
    assert.equal(result.ok, false);
    assert.equal(result.bridge.status, 'blocked');
    assert.ok(result.bridge.reasonCodes.includes('malformed_bridge'));
  });

  it('keeps the quasar lane blocked when the #390 report is blocked, without hiding the preview', () => {
    const blockedCompatibility = compatibility({
      listingId: '',
    });
    const result = deriveAttestationReputationBridge(bridgeInput({ compatibility: blockedCompatibility }));
    assert.equal(result.bridge.lanes.quasar.status, 'blocked');
    assert.ok(result.bridge.reasonCodes.includes('quasar_intent_blocked'));
    assert.equal(result.bridge.lanes.offchainPreview.status, 'available');
    assert.notEqual(result.bridge.status, 'quasar_intent_fixtures');
  });

  it('blocks the hosted lane when hosted gate inputs are supplied for a non-hosted source', () => {
    const result = deriveAttestationReputationBridge(bridgeInput({
      binding: externalBinding(),
      compatibility: undefined,
      hosted: hostedInputs(),
    }));
    assert.equal(result.bridge.lanes.hostedAttestation.status, 'blocked');
    assert.ok(result.bridge.reasonCodes.includes('hosted_claim_blocked'));
    assert.equal(result.bridge.status, 'offchain_preview');
    assert.notEqual(result.bridge.status, 'hosted_attestation_backed');
  });

  it('keeps hosted backing pending when the #395 publication gate is not claim_contract_ready', () => {
    const hosted = hostedInputs();
    const result = deriveAttestationReputationBridge(bridgeInput({
      hosted: { ...hosted, publicationGate: { ...hosted.publicationGate, state: 'pending' } },
    }));
    assert.equal(result.bridge.lanes.hostedAttestation.status, 'pending');
    assert.equal(result.bridge.lanes.hostedAttestation.claimStatus, 'publication_gate_pending');
    assert.notEqual(result.bridge.status, 'hosted_attestation_backed');
  });
});

describe('deriveAttestationReputationBridge — composed record consistency', () => {
  it('embeds composed records whose ids and evidence summaries agree', () => {
    const result = deriveAttestationReputationBridge(bridgeInput({ hosted: hostedInputs() }));
    const { preview, quasarIntentPlan, hostedClaim } = result.bridge.records;
    assert.ok(preview && quasarIntentPlan && hostedClaim);
    assert.equal(preview.id, 'reputation-bridge:happy:offchain-preview');
    assert.equal(quasarIntentPlan.id, 'reputation-bridge:happy:quasar-intent');
    assert.equal(hostedClaim.id, 'reputation-bridge:happy:hosted-claim');
    assert.equal(result.bridge.evidenceSummary?.previewId, preview.id);
    assert.equal(result.bridge.evidenceSummary?.intentPlanId, quasarIntentPlan.id);
    assert.equal(result.bridge.evidenceSummary?.hostedClaimId, hostedClaim.id);
    // The intent plan cross-checked the same preview the bridge derived.
    assert.equal(quasarIntentPlan.evidenceSummary.previewId, preview.id);
    assert.equal(preview.evidenceSummary.bindingId, result.bridge.evidenceSummary?.bindingId);
    assert.equal(hostedClaim.evidenceSummary.previewId, preview.id);
  });

  it('projects listing-surface states in the marketplace evidence vocabulary', () => {
    const hostedResult = deriveAttestationReputationBridge(bridgeInput({ hosted: hostedInputs() }));
    assert.deepEqual(
      {
        offchainPreview: hostedResult.bridge.listingProjection.offchainPreview,
        hostedAttestation: hostedResult.bridge.listingProjection.hostedAttestation,
        quasar: hostedResult.bridge.listingProjection.quasar,
        buyerFacingClaimsAllowed: hostedResult.bridge.listingProjection.buyerFacingClaimsAllowed,
      },
      {
        offchainPreview: 'available',
        hostedAttestation: 'ready',
        quasar: 'intent_fixtures_ready',
        buyerFacingClaimsAllowed: false,
      },
    );
    assert.ok(hostedResult.bridge.listingProjection.evidenceRefs.some((ref) => ref.startsWith('quasar-intent:')));
    assert.ok(hostedResult.bridge.listingProjection.evidenceRefs.some((ref) => ref.startsWith('hosted-claim:')));
    assert.equal(hostedResult.bridge.listingProjection.blockedReasons.length, 0);

    const externalResult = deriveAttestationReputationBridge({
      id: 'reputation-bridge:external-projection',
      createdAt,
    });
    assert.equal(externalResult.bridge.listingProjection.offchainPreview, 'not_available');
    assert.equal(externalResult.bridge.listingProjection.quasar, 'not_backed');
    assert.equal(externalResult.bridge.listingProjection.hostedAttestation, 'not_available');
    assert.ok(externalResult.bridge.listingProjection.blockedReasons.length > 0);
  });

  it('lists eligible Quasar lanes from the intent plan without fabricating instructions', () => {
    const result = deriveAttestationReputationBridge(bridgeInput());
    assert.deepEqual(result.bridge.lanes.quasar.eligibleLanes, ['commit', 'reveal', 'confirm']);
    assert.equal(result.bridge.lanes.quasar.intentCount, 3);
    assert.equal(result.bridge.lanes.quasar.instructionFlow, 'not_built');
    assert.equal(result.bridge.lanes.quasar.quasarBackedReputation, false);
    for (const intent of result.bridge.records.quasarIntentPlan?.intents ?? []) {
      assert.equal(intent.instructionBuilt, false);
      assert.equal(intent.signable, false);
    }
  });

  it('is deterministic and does not mutate its inputs', () => {
    const inputA = bridgeInput({ hosted: hostedInputs() });
    const inputB = bridgeInput({ hosted: hostedInputs() });
    Object.freeze(inputA.binding);
    Object.freeze(inputA.compatibility);
    const first = deriveAttestationReputationBridge(inputA);
    const second = deriveAttestationReputationBridge(inputB);
    assert.deepEqual(first, second);
    assert.deepEqual(inputA.binding, inputB.binding);
  });
});

describe('deriveAttestationReputationBridge — no-live boundary proofs', () => {
  it('carries all-false guardrails and disabled buyer-facing claims in every state', () => {
    const cases = [
      deriveAttestationReputationBridge(bridgeInput({ hosted: hostedInputs() })),
      deriveAttestationReputationBridge(bridgeInput()),
      deriveAttestationReputationBridge(bridgeInput({ binding: externalBinding(), compatibility: undefined })),
      deriveAttestationReputationBridge({ id: 'reputation-bridge:external', createdAt }),
      deriveAttestationReputationBridge(bridgeInput({ id: '' })),
    ];
    for (const result of cases) {
      assert.deepEqual(result.bridge.guardrails, {
        reputationMutated: false,
        quasarInstructionBuilt: false,
        walletSigning: false,
        rpcCall: false,
        programDeploy: false,
        hostedRegistryWrite: false,
        marketplacePublished: false,
        livePaymentExecuted: false,
        providerCall: false,
      });
      assert.equal(result.bridge.display.buyerFacingClaimAllowed, false);
      assert.equal(result.bridge.listingProjection.buyerFacingClaimsAllowed, false);
      assert.ok(result.bridge.reasonCodes.includes('buyer_facing_claim_disabled'));
      assert.ok(result.bridge.reasonCodes.includes('instruction_not_built'));
      assert.ok(result.bridge.reasonCodes.includes('reputation_not_mutated'));
    }
  });

  it('never leaks raw payloads or credential-shaped keys through the bridge', () => {
    const result = deriveAttestationReputationBridge(bridgeInput({ hosted: hostedInputs() }));
    const serialized = JSON.stringify(result.bridge);
    for (const forbiddenKey of ['privateKey', 'secretKey', 'mnemonic', 'rawPrompt', 'rawOutput', 'transcript', 'completion']) {
      assert.ok(!serialized.includes(forbiddenKey), `bridge must not contain ${forbiddenKey}`);
    }
  });

  it('imports nothing from wallet / RPC / chain-client stacks and stays fully synchronous (source guard)', () => {
    const sourcePath = fileURLToPath(new URL('../src/attestation-reputation-bridge.ts', import.meta.url));
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
      'signTransaction',
      'requestAirdrop',
      'simulateTransaction',
      'getLatestBlockhash',
      'findProgramAddress',
      'TransactionInstruction',
      'SystemProgram',
      'process.env',
      'api.devnet.solana.com',
    ];
    for (const banned of forbiddenTerms) {
      assert.ok(!source.includes(banned), `module must not reference ${banned}`);
    }
    assert.ok(!/\basync\b/.test(source), 'module must not contain async code');
    assert.ok(!/\bawait\b/.test(source), 'module must not contain await');
    // Guardrail/live flags must never be declared true in the module source.
    for (const guardrailKey of [
      'reputationMutated',
      'quasarInstructionBuilt',
      'walletSigning',
      'rpcCall',
      'programDeploy',
      'hostedRegistryWrite',
      'marketplacePublished',
      'livePaymentExecuted',
      'providerCall',
      'quasarBackedReputation',
    ]) {
      assert.ok(
        !new RegExp(`${guardrailKey}\\s*:\\s*true`).test(source),
        `module must never set ${guardrailKey} to true`,
      );
    }
  });
});
