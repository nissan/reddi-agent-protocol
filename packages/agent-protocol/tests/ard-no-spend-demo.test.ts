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
    assert.equal(output.payment.asset, 'AUDD');
    assert.equal(output.payment.mode, 'dry-run');
    assert.equal(output.payment.allowed, true);
    assert.equal(output.payment.paymentProofRef, 'dry-run:ard-no-spend-001');
    assert.equal(output.execution.status, 200);
    assert.equal(output.execution.receiptId, 'job:ard-no-spend-001');
    assert.equal(output.execution.evidenceId, 'evidence:ard-no-spend-001');
    assert.equal(output.execution.archiveHasEvidence, true);
    assert.equal(output.attestation.verdict, 'passed');
    assert.equal(output.failures.policyDenial.allowed, false);
    assert.ok(output.failures.policyDenial.reasonCodes.includes('over_budget'));
    assert.equal(output.failures.malformedChallenge.allowed, false);
    assert.ok(output.failures.malformedChallenge.reasonCodes.includes('challenge_malformed'));
    assert.equal(output.failures.missingEvidence.ok, false);
    assert.ok(output.failures.missingEvidence.errorCodes.includes('evidence_missing'));
    assert.equal(output.failures.unsupportedRailNetwork.allowed, false);
    assert.ok(output.failures.unsupportedRailNetwork.reasonCodes.includes('wrong_network'));
  });
});
