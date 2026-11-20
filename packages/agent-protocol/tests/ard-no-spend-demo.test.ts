import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  createAiCatalogSnapshot,
  validateAiCatalog,
} from '../dist/index.js';

describe('ARD no-spend demo', () => {
  it('validates the public AI Catalog fixture', () => {
    const catalog = JSON.parse(readFileSync('examples/ard-no-spend-ai-catalog.json', 'utf8'));
    const validation = validateAiCatalog(catalog, {
      rawSnapshotRef: 'file://examples/ard-no-spend-ai-catalog.json',
    });

    assert.equal(validation.ok, true);
    const snapshot = createAiCatalogSnapshot(catalog, {
      rawSnapshotRef: 'file://examples/ard-no-spend-ai-catalog.json',
    });
    assert.equal(snapshot.publisher.id, 'reddi.local');
    assert.equal(snapshot.resources.length, 1);
    assert.equal(snapshot.resources[0].id, 'urn:ai:reddi.local:specialists:listing-writer');
    assert.deepEqual(snapshot.resources[0].payment, {
      protocol: 'rap',
      quoteMode: 'preflight',
      asset: 'AUDD',
      network: 'solana-devnet',
      amount: '2500000',
    });
  });

  it('runs discover decide prove without spend or hosted services', () => {
    const stdout = execFileSync(process.execPath, ['examples/ard-no-spend-demo.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    const output = JSON.parse(stdout);

    assert.equal(output.ok, true);
    assert.equal(output.mode, 'no-spend');
    assert.equal(output.catalog.valid, true);
    assert.equal(output.discovery.candidate.identifier, 'urn:ai:reddi.local:specialists:listing-writer');
    assert.equal(output.discovery.candidate.trustStatus, 'verified');
    assert.equal(output.discovery.policyDecision.allowed, true);
    assert.equal(output.receipt.schemaVersion, 'reddi.receipt.v2');
    assert.equal(output.receipt.verified, true);
    assert.equal(output.receipt.jobId, 'job:ard-no-spend-001');
    assert.equal(output.receipt.declaredModel, 'fixture/listing-writer-v1');
    assert.match(output.receipt.requestHash, /^[0-9a-f]{64}$/);
    assert.match(output.receipt.responseHash, /^[0-9a-f]{64}$/);
    assert.equal(output.receipt.payment.currency, 'AUDD');
    assert.equal(output.receipt.payment.network, 'solana-devnet');
    assert.equal(output.receipt.payment.fixtureTransaction, true);
    assert.match(output.receipt.reading, /not proof of which model ran/);
    assert.equal(output.evidence.evidenceId, 'evidence:ard-no-spend-001');
    assert.equal(output.evidence.receiptId, output.receipt.jobId);
    assert.equal(output.evidence.archiveHasEvidence, true);
    assert.equal(output.attestation.verdict, 'passed');
    assert.equal(output.failures.policyDenial.allowed, false);
    assert.ok(output.failures.policyDenial.reasonCodes.includes('over_budget'));
    assert.equal(output.failures.unsupportedNetwork.allowed, false);
    assert.ok(output.failures.unsupportedNetwork.reasonCodes.includes('unsupported_network'));
    const receiptRefusals: Record<string, string> = {
      tamperedResponse: 'response_hash_mismatch',
      wrongProvider: 'provider_mismatch',
      editedAfterSigning: 'signature_invalid',
      differentPayment: 'payment_mismatch',
      removedReceiptVersion: 'unsupported_version',
      missingEvidence: 'evidence_missing',
      unsafeMetadata: 'credential_leakage_rejected',
    };
    for (const [name, code] of Object.entries(receiptRefusals)) {
      assert.equal(output.failures[name].ok, false, name);
      assert.deepEqual(output.failures[name].errorCodes, [code], name);
    }
    assert.deepEqual(output.boundaries, {
      hostedService: false,
      paidProvider: false,
      walletAccess: false,
      rpcCall: false,
      splTransfer: false,
      quasarCustody: false,
      settlementFinalityProof: false,
      modelExecutionProof: false,
      trustUpgrade: false,
      reputationMutation: false,
      livePayment: false,
    });
  });

  it('prints the same output on every run', () => {
    const run = () => execFileSync(process.execPath, ['examples/ard-no-spend-demo.mjs'], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(run(), run());
  });
});
