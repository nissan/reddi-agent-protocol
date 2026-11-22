import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ADL_MAX_DOCUMENT_BYTES,
  ADL_V03_LAUNCH_RATE,
  ADL_V03_MAINNET_MINTS,
  ADL_V03_SCHEMA_SHA256,
  adlNameSlug,
  adlProblems,
  buildProviderAdl,
  checkAdlConformance,
  formatAdlDocument,
  parseAdlDocument,
  providerTermsFromAdl,
  type ProviderAdlInput,
} from '../dist/adl.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'adl-v03');
const expected = JSON.parse(readFileSync(join(fixtures, 'expected.json'), 'utf8')) as {
  reports: Record<string, { status: string; requestedLevel: number; achievedLevel: number; schemaValid: boolean; missingFieldsByLevel: Record<string, string[]>; forbiddenCapabilitiesByLevel: Record<string, string[]> }>;
};

function load(name: string) {
  const parsed = parseAdlDocument(readFileSync(join(fixtures, name), 'utf8'));
  assert.ok(parsed.ok, `${name} parses`);
  return parsed.document;
}

describe('ADL v0.3: the same verdict as the lab checker', () => {
  const names = Object.keys(expected.reports);
  it('covers the lab examples and negative fixtures', () => {
    assert.ok(names.filter((n) => n.startsWith('valid/')).length >= 18);
    assert.ok(names.filter((n) => n.startsWith('invalid/')).length >= 20);
  });
  for (const name of names) {
    it(name, () => {
      const want = expected.reports[name];
      const report = checkAdlConformance(load(name));
      assert.equal(report.status, want.status);
      assert.equal(report.requestedLevel, want.requestedLevel);
      assert.equal(report.achievedLevel, want.achievedLevel);
      assert.equal(report.schemaDiagnostics.length === 0, want.schemaValid, JSON.stringify(report.schemaDiagnostics));
      assert.deepEqual(report.missingFieldsByLevel, want.missingFieldsByLevel);
      assert.deepEqual(report.forbiddenCapabilitiesByLevel, want.forbiddenCapabilitiesByLevel);
      assert.equal(report.payment.paymentMade, false);
    });
  }
});

describe('schema copy', () => {
  it('is the schema the verdicts were made with', () => {
    assert.equal(ADL_V03_SCHEMA_SHA256, (expected as unknown as { schemaSha256: string }).schemaSha256);
  });
});

describe('parseAdlDocument', () => {
  it('reads JSON as well as YAML', () => {
    const doc = load('valid/simple-agent.yaml');
    const again = parseAdlDocument(JSON.stringify(doc));
    assert.ok(again.ok);
    assert.deepEqual(again.document, doc);
  });
  it('refuses empty, non-mapping, oversized, duplicate-key and alias-bomb input', () => {
    assert.equal(parseAdlDocument('').ok, false);
    assert.equal(parseAdlDocument('- a\n- b\n').ok, false);
    assert.equal(parseAdlDocument('a: 1\na: 2\n').ok, false);
    assert.equal(parseAdlDocument(`a: "${'x'.repeat(ADL_MAX_DOCUMENT_BYTES)}"`).ok, false);
    const bomb = ['a: &a [x, x, x, x, x, x, x, x, x]', ...Array.from({ length: 12 }, (_, i) => `${String.fromCharCode(98 + i)}: &${String.fromCharCode(98 + i)} [${Array(9).fill(`*${String.fromCharCode(97 + i)}`).join(', ')}]`)].join('\n');
    assert.equal(parseAdlDocument(bomb).ok, false);
  });
  it('reads an unquoted timestamp as a date, as PyYAML does, so the schema refuses it', () => {
    const doc = load('valid/live-solana-per-token-provider-agent.yaml');
    const text = formatAdlDocument(doc).replace("expiresAt: 2026-12-31T23:59:59Z", "expiresAt: 2026-12-31T23:59:59Z");
    const parsed = parseAdlDocument(text.replace(/expiresAt: "?'?2026-12-31T23:59:59Z'?"?/, 'expiresAt: 2026-12-31T23:59:59Z'));
    assert.ok(parsed.ok);
    assert.equal(checkAdlConformance(parsed.document).status, 'fail');
  });
});

const provider: ProviderAdlInput = {
  name: 'Scene Writer Pro',
  description: 'Writes video scenes.',
  model: 'anthropic/claude-sonnet-5-5',
  network: 'solana-mainnet-beta',
  currency: 'USDC',
  mint: ADL_V03_MAINNET_MINTS.USDC,
  payTo: 'hbr2Fee3ewDbm33wTDrdEF3e7byNCzNgQ57CwJWaPtt',
  price: { per: 'token', inputPerMillion: '3', outputPerMillion: '15', maxPerCall: '0.75' },
  endpointUrl: 'https://scenes.example.com',
};

describe('buildProviderAdl', () => {
  it('passes Level 3 and survives a YAML round trip', () => {
    const doc = buildProviderAdl(provider);
    const report = checkAdlConformance(doc);
    assert.deepEqual(adlProblems(report), []);
    assert.equal(report.status, 'pass');
    assert.equal(report.achievedLevel, 3);
    const reparsed = parseAdlDocument(formatAdlDocument(doc));
    assert.ok(reparsed.ok);
    assert.deepEqual(reparsed.document, doc);
  });
  it('declares the 5% fee with the launch rate, metered escrow and receipt v2', () => {
    const doc = buildProviderAdl(provider) as any;
    assert.equal(doc.extensions.x402.protocolFee.bps, 500);
    assert.deepEqual(doc.extensions.x402.protocolFee.launchRate, { ...ADL_V03_LAUNCH_RATE });
    assert.equal(doc.extensions.x402.intents[0].settlement, 'metered-escrow');
    assert.equal(doc.extensions.receipts.refs[0].format, 'reddi.receipt.v2');
  });
  it('gives a failing document, not a different one, for bad input', () => {
    assert.equal(checkAdlConformance(buildProviderAdl({ ...provider, mint: ADL_V03_MAINNET_MINTS.AUDD })).status, 'fail');
    assert.equal(checkAdlConformance(buildProviderAdl({ ...provider, currency: 'EUR' })).status, 'fail');
    assert.equal(checkAdlConformance(buildProviderAdl({ ...provider, price: { per: 'token', inputPerMillion: 'three', outputPerMillion: '15', maxPerCall: '1' } })).status, 'fail');
  });
  it('makes a schema-safe name', () => {
    assert.equal(adlNameSlug('Scene Writer Pro!'), 'scene-writer-pro');
    assert.equal(adlNameSlug('***'), 'provider');
    assert.equal(adlNameSlug('X'), 'x-provider');
  });
});

describe('providerTermsFromAdl', () => {
  it('reads back what was built', () => {
    const read = providerTermsFromAdl(buildProviderAdl(provider));
    assert.ok(read.ok);
    assert.deepEqual(read.terms, {
      name: 'scene-writer-pro',
      description: 'Writes video scenes.',
      declaredModel: provider.model,
      endpointUrl: 'https://scenes.example.com',
      mode: 'live',
      network: 'solana-mainnet-beta',
      currency: 'USDC',
      mint: ADL_V03_MAINNET_MINTS.USDC,
      payTo: provider.payTo,
      price: { per: 'token', inputPerMillion: '3', outputPerMillion: '15', maxPerCall: '0.75' },
    });
  });
  it('reads back a fixed-price listing with no model', () => {
    const { model: _model, ...noModel } = provider;
    const doc = buildProviderAdl({ ...noModel, price: { per: 'call', amount: '2.5' } });
    assert.deepEqual(adlProblems(checkAdlConformance(doc)), []);
    const read = providerTermsFromAdl(doc);
    assert.ok(read.ok);
    assert.deepEqual(read.terms.price, { per: 'call', amount: '2.5' });
    assert.equal(read.terms.declaredModel, undefined);
  });
  it('reads the lab per-token provider example', () => {
    const read = providerTermsFromAdl(load('valid/live-solana-per-token-provider-agent.yaml'));
    assert.ok(read.ok);
    assert.equal(read.terms.currency, 'AUDD');
    assert.deepEqual(read.terms.price, { per: 'token', inputPerMillion: '0.90', outputPerMillion: '3.60', maxPerCall: '0.05' });
  });
  it('refuses a document that fails Level 3, or settles directly', () => {
    const bad = providerTermsFromAdl(load('invalid/adl-v0.3-wrong-protocol-fee.yaml'));
    assert.equal(bad.ok, false);
    assert.ok(!bad.ok && bad.problems.includes('extensions.x402.protocolFee.bps must be 500'));
    // The per-call example settles directly, which a listing cannot take.
    assert.equal(providerTermsFromAdl(load('valid/live-solana-provider-agent.yaml')).ok, false);
  });
});
