import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  deriveQuasarRegistryCompatibility,
  QUASAR_AGENT_ACCOUNT_COMPATIBILITY,
  type QuasarRegistryCompatibilityInput,
} from '../dist/index.js';

function importedProfile(overrides: Partial<QuasarRegistryCompatibilityInput> = {}): QuasarRegistryCompatibilityInput {
  return {
    profileId: 'profile:static:research-agent',
    listingId: 'listing:hosted-rap:research-agent',
    displayName: 'Research Agent',
    summary: 'Imported research specialist metadata.',
    description: 'Rich buyer-facing listing copy belongs off-chain.',
    role: { callable: true },
    model: 'qwen3:8b',
    registrationIntent: 'metadata_only',
    minReputation: 0,
    offchain: {
      buyerPreview: 'Detailed buyer copy and operator caveats.',
      endpoint: { url: 'https://agents.example/research', bindingRef: 'endpoint-binding:research', healthStatus: 'not_probed' },
      ardUrl: 'https://agents.example/.well-known/ai-catalog.json',
      catalogRefs: ['/.well-known/ai-catalog.json'],
      sourceRefs: ['https://github.com/example/research-agent#abc123'],
      authRequirements: ['operator-approved-token'],
      auddTerms: {
        asset: 'AUDD',
        network: 'solana-devnet',
        amount: '2500000',
        paymentPlanRef: 'payment-plan:research-agent',
        quoteRef: 'quote:research-agent',
        settlementAccount: 'solana:settlementFixture1111111111111111111111',
        refundPolicy: 'manual_review',
        failurePolicy: 'no_charge_on_failure',
      },
      evidenceRefs: ['evidence:dry-run:research-agent'],
      receiptRefs: ['receipt:dry-run:research-agent'],
      trustBadges: ['offchain-preview-only'],
      providerTrustStatus: 'unverified',
      capabilities: ['research', 'summarization'],
      tags: ['hosted-rap', 'external'],
      groups: ['tools', 'skills'],
      riskDiagnostics: ['static_only_untrusted_import'],
      reviewStates: ['operator_review_required'],
      operatorApprovalEvidenceRef: 'operator-approval:research-agent',
    },
    ...overrides,
  };
}

describe('Quasar registry compatibility projection', () => {
  it('keeps imported rich profile metadata off-chain and metadata-only', () => {
    const report = deriveQuasarRegistryCompatibility(importedProfile());

    assert.equal(report.schemaVersion, 'reddi.quasar-registry-compatibility.v1');
    assert.equal(report.registrationStatus, 'metadata_only');
    assert.equal(report.onchain.agentType, 'Primary');
    assert.equal(report.onchain.active, false);
    assert.equal(report.onchain.rateLamports, undefined);
    assert.equal(report.offchain.auddTerms?.asset, 'AUDD');
    assert.equal(report.offchain.endpoint?.healthStatus, 'not_probed');
    assert.deepEqual(report.account.discriminator, [20]);
    assert.equal(report.account.dataSize, 153);
    assert.equal(report.account.modelMaxBytes, 64);
    assert.ok(!report.account.onchainFieldNames.includes('endpoint' as never));
    assert.ok(!report.account.onchainFieldNames.includes('auddTerms' as never));
    assert.ok(report.account.offchainFieldNames.includes('evidenceRefs'));
    assert.deepEqual(report.guardrails, {
      richMetadataOnchain: false,
      auddCustodyOnchain: false,
      endpointOnchain: false,
      evidencePayloadOnchain: false,
      trustBadgeOnchain: false,
      instructionBuilt: false,
      walletSigning: false,
      rpcCall: false,
      programDeploy: false,
      livePaymentExecuted: false,
    });
  });

  it('marks explicit native-SOL registry profiles as registerable without building instructions', () => {
    const report = deriveQuasarRegistryCompatibility(importedProfile({
      owner: '11111111111111111111111111111112',
      nativeSolRateLamports: 1_250_000n,
      minReputation: 7,
      active: true,
      registrationIntent: 'register',
      role: { callable: true, attestation: true },
    }));

    assert.equal(report.registrationStatus, 'registerable');
    assert.deepEqual(report.blockedReasons, []);
    assert.equal(report.onchain.agentType, 'Both');
    assert.equal(report.onchain.rateLamports, '1250000');
    assert.equal(report.onchain.minReputation, 7);
    assert.equal(report.onchain.active, true);
    assert.equal(report.guardrails.instructionBuilt, false);
    assert.equal(report.guardrails.walletSigning, false);
    assert.equal(report.guardrails.rpcCall, false);
  });

  it('derives compact agent type from explicit capability intent', () => {
    assert.equal(deriveQuasarRegistryCompatibility(importedProfile({ role: { callable: true } })).onchain.agentType, 'Primary');
    assert.equal(deriveQuasarRegistryCompatibility(importedProfile({ role: { attestation: true } })).onchain.agentType, 'Attestation');
    assert.equal(deriveQuasarRegistryCompatibility(importedProfile({ role: { callable: true, attestation: true } })).onchain.agentType, 'Both');
  });

  it('fails closed for overlong models and invalid compact u8 thresholds', () => {
    const report = deriveQuasarRegistryCompatibility(importedProfile({
      model: 'x'.repeat(65),
      minReputation: 300,
      registrationIntent: 'register',
      owner: '11111111111111111111111111111112',
      nativeSolRateLamports: '1000',
    }));

    assert.equal(report.registrationStatus, 'blocked');
    assert.deepEqual(report.blockedReasons, [
      'model_too_long_for_quasar_account',
      'invalid_min_reputation',
    ]);
    assert.equal(report.guardrails.programDeploy, false);
    assert.equal(report.offchain.description, 'Rich buyer-facing listing copy belongs off-chain.');
  });

  it('fails closed for owners that match base58 shape but are not Solana public keys', () => {
    const report = deriveQuasarRegistryCompatibility(importedProfile({
      owner: 'z'.repeat(44),
      nativeSolRateLamports: '1000',
      registrationIntent: 'register',
    }));

    assert.equal(report.registrationStatus, 'blocked');
    assert.deepEqual(report.blockedReasons, ['missing_or_invalid_owner']);
    assert.equal(report.guardrails.instructionBuilt, false);
    assert.equal(report.guardrails.rpcCall, false);
  });

  it('fails closed for native SOL lamport rates outside Quasar u64 storage', () => {
    const report = deriveQuasarRegistryCompatibility(importedProfile({
      owner: '11111111111111111111111111111112',
      nativeSolRateLamports: '18446744073709551616',
      registrationIntent: 'register',
    }));

    assert.equal(report.registrationStatus, 'blocked');
    assert.deepEqual(report.blockedReasons, ['missing_native_sol_rate_lamports']);
    assert.equal(report.onchain.rateLamports, '18446744073709551616');
    assert.equal(report.guardrails.walletSigning, false);
  });

  it('keeps Quasar aggregates read-only and sourced only from decoded accounts', () => {
    const report = deriveQuasarRegistryCompatibility(importedProfile({
      decodedAggregates: {
        reputationScore: 8800,
        jobsCompleted: 42n,
        jobsFailed: '3',
        createdAt: 1_720_000_000,
        attestationAccuracy: 9300,
      },
    }));

    assert.equal(report.onchain.aggregates.source, 'decoded_quasar_account');
    assert.equal(report.onchain.aggregates.reputationScore, 8800);
    assert.equal(report.onchain.aggregates.jobsCompleted, '42');
    assert.equal(report.onchain.aggregates.jobsFailed, '3');
    assert.equal(report.onchain.aggregates.createdAt, '1720000000');
    assert.equal(report.onchain.aggregates.attestationAccuracy, 9300);
    assert.equal(QUASAR_AGENT_ACCOUNT_COMPATIBILITY.pdaSeed, 'agent');
  });

  it('does not convert AUDD terms into lamports for metadata-only listings', () => {
    const report = deriveQuasarRegistryCompatibility(importedProfile({
      offchain: {
        ...importedProfile().offchain,
        auddTerms: {
          asset: 'AUDD',
          network: 'solana-devnet',
          amount: '999999999',
        },
      },
    }));

    assert.equal(report.registrationStatus, 'metadata_only');
    assert.equal(report.onchain.rateLamports, undefined);
    assert.equal(report.offchain.auddTerms?.amount, '999999999');
    assert.ok(report.reasonCodes.includes('audd_terms_offchain'));
    assert.ok(report.reasonCodes.includes('native_lamports_rate_missing'));
  });
});
