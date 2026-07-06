import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  exportReceiptToErc8004,
  ERC8004_EXPORT_SCHEMA_VERSION,
  ERC8004_EXPORT_IS_DRAFT,
  type ReddiReceipt,
  type AttestationRecord,
} from '../dist/index.js';

function policyDecision(): ReddiReceipt['policyDecision'] {
  return {
    schemaVersion: 'reddi.policy-decision.v1',
    allowed: true,
    reasonCodes: ['allowed'],
    quotedAmount: { amount: '2500000', asset: 'AUDD', network: 'solana-devnet' },
    asset: 'AUDD',
    network: 'solana-devnet',
    approvalState: 'approved',
    auditNotes: ['fixture policy decision'],
  };
}

function receiptFixture(overrides: Partial<ReddiReceipt> = {}): ReddiReceipt {
  return {
    schemaVersion: 'reddi.receipt.v1',
    job: { id: 'job:fixture:562', type: 'summarize' },
    source: { id: 'source:fixture:ai-catalog' },
    payer: { id: 'payer:fixture:orchestrator' },
    specialist: { id: 'specialist:fixture:research-agent', endpoint: 'https://agents.example/research' },
    protocol: { name: 'Reddi Agent Protocol', version: '0.1.0' },
    payment: {
      network: 'solana-devnet',
      asset: 'AUDD',
      amount: '2500000',
      paymentProofRef: 'evidence:payment:fixture-562',
    },
    requestHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    responseHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    evidenceRef: 'https://evidence.example/receipts/562.json',
    policyDecision: policyDecision(),
    attestationStatus: 'attested',
    createdAt: '2026-07-05T00:00:00.000Z',
    ...overrides,
  };
}

function attestationFixture(overrides: Partial<AttestationRecord> = {}): AttestationRecord {
  return {
    schemaVersion: 'reddi.attestation.v1',
    id: 'attestation:fixture:562',
    receiptId: 'job:fixture:562',
    evidenceId: 'evidence:fixture:562',
    evidenceRef: 'https://evidence.example/attestations/562.json',
    evidenceHash: 'sha256:3333333333333333333333333333333333333333333333333333333333333333',
    attestor: { id: 'attestor:fixture:reddi', type: 'reddi' },
    trustBoundary: 'reddi_attested',
    verdict: 'passed',
    workStatus: 'completed',
    confidence: 95,
    rubric: {
      dimensions: [
        { id: 'evidence_integrity', score: 96, weight: 3, summary: 'evidence intact', reasonCodes: ['evidence_attached'] },
        { id: 'policy_compliance', score: 94, weight: 2, summary: 'policy respected', reasonCodes: ['policy_ok'] },
        { id: 'delivery_quality', score: 95, weight: 2, summary: 'delivered well', reasonCodes: ['delivery_ok'] },
      ],
    },
    createdAt: '2026-07-05T00:00:00.000Z',
    ...overrides,
  };
}

describe('ERC-8004 export (reddi.erc8004-export.v1, promoted by #562)', () => {
  it('builds a shape-valid export from a receipt + passed attestation', () => {
    const bundle = exportReceiptToErc8004(receiptFixture(), attestationFixture(), { targetChainHint: 'eip155:8453' });

    assert.equal(bundle.schemaVersion, ERC8004_EXPORT_SCHEMA_VERSION);
    assert.equal(bundle.schemaVersion, 'reddi.erc8004-export.v1');
    // Promotion (#562): the RAP-side mapping spec is no longer draft, while the
    // external ERC-8004 standard stays honestly marked unverified.
    assert.equal(bundle.draft, false);
    assert.equal(ERC8004_EXPORT_IS_DRAFT, false);
    assert.equal(bundle.externalStandard.fieldShapesVerified, false);
    assert.equal(bundle.externalStandard.deploymentClaim, false);
    assert.equal(bundle.exportIntent, 'exportable');
    assert.deepEqual(bundle.reasonCodes, ['erc8004_export_ok']);

    // Identity payload
    assert.ok(bundle.identity);
    assert.equal(bundle.identity.registrationFile.name, 'specialist:fixture:research-agent');
    assert.equal(bundle.identity.registrationFile.endpoint, 'https://agents.example/research');
    assert.equal(bundle.identity.registrationFile.solanaAgentRef, 'solana-devnet/specialist:fixture:research-agent');
    assert.equal(bundle.identity.registrationFile.protocol.version, '0.1.0');
    assert.ok(bundle.identity.metadata.some((m) => m.key === 'reddi.solanaAgentRef'));

    // Reputation payload (giveFeedback-style args)
    assert.ok(bundle.reputation);
    assert.equal(bundle.reputation.value, '9500');
    assert.equal(bundle.reputation.valueDecimals, 2);
    assert.equal(bundle.reputation.tag1, 'passed');
    assert.equal(bundle.reputation.tag2, 'evidence_integrity');
    assert.equal(bundle.reputation.payloadURI, 'https://evidence.example/attestations/562.json');
    assert.equal(bundle.reputation.payloadHash, 'sha256:3333333333333333333333333333333333333333333333333333333333333333');

    // Cross-reference
    assert.equal(bundle.crossReference.solanaNetworkAsset, 'solana-devnet:AUDD');
    assert.equal(bundle.crossReference.evmChainHint, 'eip155:8453');
    assert.equal(bundle.crossReference.solanaAgentRef, 'solana-devnet/specialist:fixture:research-agent');
  });

  it('round-trips the attestation score and hashes through the reputation payload', () => {
    const attestation = attestationFixture({ confidence: 88 });
    const bundle = exportReceiptToErc8004(receiptFixture(), attestation);

    assert.ok(bundle.reputation);
    // score reconstructs from value / 10^valueDecimals
    const reconstructed = Number(bundle.reputation.value) / 10 ** bundle.reputation.valueDecimals;
    assert.equal(reconstructed, attestation.confidence);
    assert.equal(bundle.reputation.tag1, attestation.verdict);
    assert.equal(bundle.reputation.payloadHash, attestation.evidenceHash);
    assert.equal(bundle.reputation.payloadURI, attestation.evidenceRef);

    // deterministic: identical inputs produce identical output
    const again = exportReceiptToErc8004(receiptFixture(), attestationFixture({ confidence: 88 }));
    assert.deepEqual(again, bundle);
  });

  it('includes the experimental Validation payload only when requested', () => {
    const withoutValidation = exportReceiptToErc8004(receiptFixture(), attestationFixture());
    assert.equal(withoutValidation.validation, null);

    const withValidation = exportReceiptToErc8004(receiptFixture(), attestationFixture(), { includeValidation: true });
    assert.ok(withValidation.validation);
    assert.equal(withValidation.validation.experimental, true);
    assert.equal(withValidation.validation.requestHash, receiptFixture().requestHash);
    assert.equal(withValidation.validation.hash, receiptFixture().responseHash);
    assert.equal(withValidation.validation.responseURI, receiptFixture().evidenceRef);
    assert.ok(withValidation.reasonCodes.includes('validation_registry_experimental'));
  });

  it('exports identity metadata only when no attestation is supplied', () => {
    const bundle = exportReceiptToErc8004(receiptFixture());

    assert.equal(bundle.exportIntent, 'metadata_only');
    assert.equal(bundle.reputation, null);
    assert.equal(bundle.validation, null);
    assert.ok(bundle.identity);
    assert.ok(bundle.reasonCodes.includes('attestation_missing'));
  });

  it('keeps caipAgentRef null for an unregistered agent but still emits identity', () => {
    const bundle = exportReceiptToErc8004(receiptFixture(), attestationFixture());
    assert.ok(bundle.identity);
    assert.equal(bundle.identity.caipAgentRef, null);
    assert.ok(bundle.reputation);
    assert.equal(bundle.reputation.agentRef, null);
  });

  it('fails closed when the receipt metadata leaks credentials', () => {
    const leaky = receiptFixture({
      metadata: { note: 'authorization: bearer sk-live-abcdef0123456789abcdef' },
    });
    const bundle = exportReceiptToErc8004(leaky, attestationFixture());

    assert.equal(bundle.exportIntent, 'blocked');
    assert.equal(bundle.identity, null);
    assert.equal(bundle.reputation, null);
    assert.deepEqual(bundle.reasonCodes, ['credential_leakage_rejected']);
    // no emitted string anywhere reveals the secret
    assert.ok(!JSON.stringify(bundle).includes('sk-live-abcdef'));
  });

  it('fails closed for an unsupported network/asset', () => {
    const unsupported = exportReceiptToErc8004(
      receiptFixture({
        payment: { network: 'ethereum-mainnet', asset: 'DAI', amount: '2500000', paymentProofRef: 'evidence:payment:x' },
      }),
      attestationFixture(),
    );

    assert.equal(unsupported.exportIntent, 'blocked');
    assert.equal(unsupported.identity, null);
    assert.ok(unsupported.reasonCodes.includes('unsupported_network_asset'));
  });

  it('fails closed when asked to submit / broadcast / sign on-chain', () => {
    for (const opts of [{ submit: true }, { broadcast: true }, { sign: true }]) {
      const bundle = exportReceiptToErc8004(receiptFixture(), attestationFixture(), opts);
      assert.equal(bundle.exportIntent, 'blocked');
      assert.equal(bundle.identity, null);
      assert.deepEqual(bundle.reasonCodes, ['onchain_write_not_permitted']);
    }
  });

  it('never implies an on-chain write and never inlines raw evidence payloads', () => {
    const bundle = exportReceiptToErc8004(receiptFixture(), attestationFixture(), { includeValidation: true });

    assert.deepEqual(bundle.guardrails, {
      minted: false,
      onchainWrite: false,
      signerInvoked: false,
      rpcCall: false,
      evidencePayloadInlined: false,
      liveSignatureVerified: false,
      trustImported: false,
    });

    // Only URIs + hashes are emitted for evidence — never a raw payload field.
    const serialized = JSON.stringify(bundle);
    for (const forbiddenKey of ['rawPrompt', 'rawOutput', 'transcript', 'completion', 'privateKey', 'signature']) {
      assert.ok(!serialized.includes(forbiddenKey), `bundle must not contain ${forbiddenKey}`);
    }
    // Evidence is referenced, not embedded: the reputation payloadURI is a URL, not a document body.
    assert.ok(bundle.reputation);
    assert.match(bundle.reputation.payloadURI, /^https?:\/\//);
  });

  it('imports nothing from the network / web3 / ethers stacks (offline-only guard)', () => {
    const sourcePath = fileURLToPath(new URL('../src/erc8004-export.ts', import.meta.url));
    const source = readFileSync(sourcePath, 'utf8');
    for (const banned of ['ethers', 'web3', 'viem', 'node:net', 'node:http', 'node:https', 'fetch(', 'XMLHttpRequest']) {
      assert.ok(!source.includes(banned), `module must not reference ${banned}`);
    }
    // No async surface — the export is a pure synchronous function.
    assert.ok(!/\basync\b/.test(source), 'module must not contain async code');
  });
});
