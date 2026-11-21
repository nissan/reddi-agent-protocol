import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as edSign, type KeyObject } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  REDDI_RECEIPT_V2_VERSION,
  canonicalizeReddiReceiptV2,
  hashReddiReceiptV2Body,
  signReddiReceiptV2,
  validateReddiReceiptV2,
  verifyReddiReceiptV2,
  type ReddiReceiptV2,
  type ReddiReceiptV2Signer,
} from '../dist/index.js';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes: Uint8Array): string {
  let value = BigInt('0x' + (Buffer.from(bytes).toString('hex') || '0'));
  let out = '';
  while (value > 0n) {
    out = ALPHABET[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = '1' + out;
  }
  return out;
}

// Throwaway test keys, generated per run. Never a real wallet.
function testProvider(): { address: string; signer: ReddiReceiptV2Signer; privateKey: KeyObject } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return { address: base58(raw), privateKey, signer: (message) => edSign(null, message, privateKey) };
}

const TX = '5'.repeat(88);
// Throwaway addresses for the test only.
const MINT = base58(Buffer.alloc(32, 4));
const TREASURY = base58(Buffer.alloc(32, 3));
const PAYER = base58(Buffer.alloc(32, 2));
/** A 1.000000 USDC call with a 0.05% fee, paid directly. The fee value is arbitrary to this module. */
const PAYMENT = {
  network: 'solana-devnet',
  txSignature: TX,
  currency: 'USDC',
  mint: MINT,
  amount: '1000000',
  fee: { amount: '500', treasury: TREASURY },
  payer: PAYER,
  settlement: 'direct',
} as const;
const REQUEST = '{"model":"llama3.1:8b","messages":[{"role":"user","content":"hi"}]}';
const RESPONSE = '{"choices":[{"message":{"role":"assistant","content":"hello"}}]}';

function receiptFor(address: string, overrides: Partial<ReddiReceiptV2> = {}): ReddiReceiptV2 {
  return {
    schemaVersion: REDDI_RECEIPT_V2_VERSION,
    providerId: address,
    declaredModel: 'llama3.1:8b',
    requestHash: hashReddiReceiptV2Body(REQUEST),
    responseHash: hashReddiReceiptV2Body(RESPONSE),
    payment: PAYMENT,
    issuedAt: '2026-11-20T09:00:00Z',
    ...overrides,
  };
}

function codes(result: ReturnType<typeof verifyReddiReceiptV2>): string[] {
  return result.ok ? [] : result.errors.map((e) => e.code);
}

describe('reddi.receipt.v2', () => {
  it('hashes a body as SHA-256 hex, the same for a string and its bytes', () => {
    assert.equal(hashReddiReceiptV2Body(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    assert.equal(hashReddiReceiptV2Body('héllo'), hashReddiReceiptV2Body(Buffer.from('héllo', 'utf8')));
  });

  it('signs and verifies offline against what the buyer knows (RAP-739-S2)', async () => {
    const provider = testProvider();
    const signed = await signReddiReceiptV2(receiptFor(provider.address), provider.signer);
    const result = verifyReddiReceiptV2(JSON.parse(JSON.stringify(signed)), {
      providerId: provider.address,
      declaredModel: 'llama3.1:8b',
      requestHash: hashReddiReceiptV2Body(REQUEST),
      responseHash: hashReddiReceiptV2Body(RESPONSE),
      payment: { network: 'solana-devnet', txSignature: TX },
    });
    assert.equal(result.ok, true);
  });

  it('the signature covers the declared model, both hashes and the payment', async () => {
    const provider = testProvider();
    const signed = await signReddiReceiptV2(receiptFor(provider.address), provider.signer);
    const tampered: Array<Partial<ReddiReceiptV2>> = [
      { declaredModel: 'gpt-large' },
      { requestHash: 'a'.repeat(64) },
      { responseHash: 'b'.repeat(64) },
      { payment: { ...PAYMENT, txSignature: '4'.repeat(88) } },
      { payment: { ...PAYMENT, network: 'solana-mainnet-beta' } },
      { payment: { ...PAYMENT, amount: '999999' } },
      { payment: { ...PAYMENT, currency: 'AUDD' } },
      { payment: { ...PAYMENT, fee: { amount: '0', treasury: TREASURY } } },
      { payment: { ...PAYMENT, payer: TREASURY } },
      { payment: { ...PAYMENT, settlement: 'escrow' } },
      { jobId: 'job-2' },
      { issuedAt: '2026-11-21T09:00:00Z' },
    ];
    for (const change of tampered) {
      const result = verifyReddiReceiptV2({ ...signed, receipt: { ...signed.receipt, ...change } });
      assert.deepEqual(codes(result), ['signature_invalid'], JSON.stringify(change));
    }
  });

  it('fails when the response the buyer received was altered (RAP-739-S3)', async () => {
    const provider = testProvider();
    const signed = await signReddiReceiptV2(receiptFor(provider.address), provider.signer);
    const result = verifyReddiReceiptV2(signed, { responseHash: hashReddiReceiptV2Body(RESPONSE.replace('hello', 'goodbye')) });
    assert.deepEqual(codes(result), ['response_hash_mismatch']);
  });

  it('reports each mismatch against the expectation', async () => {
    const provider = testProvider();
    const other = testProvider();
    const signed = await signReddiReceiptV2(receiptFor(provider.address), provider.signer);
    const result = verifyReddiReceiptV2(signed, {
      providerId: other.address,
      declaredModel: 'other-model',
      requestHash: 'c'.repeat(64),
      payment: { network: 'solana-mainnet-beta', txSignature: TX },
    });
    assert.deepEqual(codes(result), ['provider_mismatch', 'declared_model_mismatch', 'request_hash_mismatch', 'payment_mismatch']);
  });

  it('rejects a receipt signed by a key other than providerId', async () => {
    const provider = testProvider();
    const impostor = testProvider();
    await assert.rejects(signReddiReceiptV2(receiptFor(provider.address), impostor.signer), /provider_receipt_signer_mismatch/);
    const receipt = receiptFor(provider.address);
    const forged = {
      receipt,
      proof: { type: 'ed25519', signature: edSign(null, Buffer.from(canonicalizeReddiReceiptV2(receipt), 'utf8'), impostor.privateKey).toString('base64') },
    };
    assert.deepEqual(codes(verifyReddiReceiptV2(forged)), ['signature_invalid']);
  });

  it('rejects swapping in another provider id with the original signature', async () => {
    const provider = testProvider();
    const other = testProvider();
    const signed = await signReddiReceiptV2(receiptFor(provider.address), provider.signer);
    assert.deepEqual(codes(verifyReddiReceiptV2({ ...signed, receipt: { ...signed.receipt, providerId: other.address } })), ['signature_invalid']);
  });

  it('rejects malformed proofs', async () => {
    const provider = testProvider();
    const signed = await signReddiReceiptV2(receiptFor(provider.address), provider.signer);
    const bad = [
      { ...signed, proof: { type: 'rsa', signature: signed.proof.signature } },
      { ...signed, proof: { type: 'ed25519', signature: 'AAAA' } },
      { ...signed, proof: { type: 'ed25519', signature: signed.proof.signature, extra: 1 } },
      { ...signed, proof: undefined },
      { ...signed, extra: true },
      null,
      'text',
    ];
    for (const input of bad) assert.deepEqual(codes(verifyReddiReceiptV2(input)), ['malformed_proof']);
    const zeroSignature = { ...signed, proof: { type: 'ed25519', signature: Buffer.alloc(64).toString('base64') } };
    assert.deepEqual(codes(verifyReddiReceiptV2(zeroSignature)), ['signature_invalid']);
  });

  it('rejects malformed receipts and unknown versions', () => {
    const provider = testProvider();
    const good = receiptFor(provider.address);
    assert.equal(validateReddiReceiptV2(good).ok, true);
    assert.deepEqual(codes(validateReddiReceiptV2({ ...good, schemaVersion: 'reddi.receipt.v1' })), ['unsupported_version']);
    const bad: Array<Record<string, unknown>> = [
      { ...good, providerId: 'not-base58-0OIl' },
      { ...good, providerId: '1111' },
      { ...good, declaredModel: '' },
      { ...good, declaredModel: 'x'.repeat(121) },
      { ...good, declaredModel: 'line\nbreak' },
      { ...good, requestHash: 'A'.repeat(64) },
      { ...good, responseHash: 'abc' },
      { ...good, payment: { ...PAYMENT, network: 'solana-testnet' } },
      { ...good, payment: { ...PAYMENT, txSignature: 'short' } },
      { ...good, payment: { ...PAYMENT, memo: 'x' } },
      { ...good, payment: { network: 'solana-devnet', txSignature: TX } },
      { ...good, payment: { ...PAYMENT, currency: 'EUR' } },
      { ...good, payment: { ...PAYMENT, mint: undefined } },
      { ...good, payment: { ...PAYMENT, currency: 'SOL' } },
      { ...good, payment: { ...PAYMENT, amount: '0' } },
      { ...good, payment: { ...PAYMENT, amount: '1.5' } },
      { ...good, payment: { ...PAYMENT, amount: 1000000 } },
      { ...good, payment: { ...PAYMENT, amount: '01' } },
      { ...good, payment: { ...PAYMENT, fee: { amount: '500' } } },
      { ...good, payment: { ...PAYMENT, fee: { amount: '1000000', treasury: TREASURY } } },
      { ...good, payment: { ...PAYMENT, fee: { amount: '500', treasury: TREASURY, bps: 5 } } },
      { ...good, payment: { ...PAYMENT, payer: 'nope' } },
      { ...good, payment: { ...PAYMENT, settlement: 'card' } },
      { ...good, jobId: 'has space' },
      { ...good, issuedAt: '20 Nov 2026' },
      { ...good, issuedAt: '2026-13-40T99:00:00Z' },
      { ...good, verifiedExecution: true },
    ];
    for (const input of bad) assert.deepEqual([...new Set(codes(validateReddiReceiptV2(input)))], ['malformed_receipt'], JSON.stringify(input));
    assert.deepEqual(codes(validateReddiReceiptV2([])), ['malformed_receipt']);
  });

  it('canonical bytes do not depend on the order the fields were written in', () => {
    const provider = testProvider();
    const good = receiptFor(provider.address);
    const reordered = { issuedAt: good.issuedAt, payment: { settlement: 'direct' as const, payer: PAYER, fee: { treasury: TREASURY, amount: '500' }, amount: '1000000', mint: MINT, currency: 'USDC' as const, txSignature: TX, network: 'solana-devnet' as const }, responseHash: good.responseHash, requestHash: good.requestHash, declaredModel: good.declaredModel, providerId: good.providerId, schemaVersion: good.schemaVersion };
    assert.equal(canonicalizeReddiReceiptV2(reordered), canonicalizeReddiReceiptV2(good));
    assert.ok(canonicalizeReddiReceiptV2(good).startsWith(`{"schemaVersion":"${REDDI_RECEIPT_V2_VERSION}"`));
  });

  it('accepts SOL without a mint, a zero fee without a treasury, no payer and a job id (RAP-V2-S1)', async () => {
    const provider = testProvider();
    const receipt = receiptFor(provider.address, {
      payment: { network: 'solana-mainnet-beta', txSignature: TX, currency: 'SOL', amount: '1000', fee: { amount: '0' }, settlement: 'escrow' },
      jobId: 'job_01:abc-1.2',
    });
    const signed = await signReddiReceiptV2(receipt, provider.signer);
    assert.equal(verifyReddiReceiptV2(JSON.parse(JSON.stringify(signed))).ok, true);
    for (const currency of ['USDC', 'PYUSD', 'USDG', 'AUDD'] as const) {
      assert.equal(validateReddiReceiptV2(receiptFor(provider.address, { payment: { ...PAYMENT, currency } })).ok, true, currency);
    }
  });

  it('compares each payment field the verifier supplies (RAP-V2-S2)', async () => {
    const provider = testProvider();
    const signed = await signReddiReceiptV2(receiptFor(provider.address), provider.signer);
    const base = { network: 'solana-devnet', txSignature: TX } as const;
    assert.equal(verifyReddiReceiptV2(signed, { payment: { ...base, currency: 'USDC', mint: MINT, amount: '1000000', payer: PAYER, settlement: 'direct', fee: { amount: '500', treasury: TREASURY } } }).ok, true);
    const wrong = [
      { ...base, currency: 'AUDD' as const },
      { ...base, mint: TREASURY },
      { ...base, amount: '999999' },
      { ...base, payer: TREASURY },
      { ...base, settlement: 'escrow' as const },
      { ...base, fee: { amount: '499' } },
      { ...base, fee: { amount: '500', treasury: PAYER } },
    ];
    for (const payment of wrong) assert.deepEqual(codes(verifyReddiReceiptV2(signed, { payment })), ['payment_mismatch'], JSON.stringify(payment));
  });

  it('states token counts and the refund of a metered call (RAP-794-S3)', async () => {
    const provider = testProvider();
    // 123,457 actual of a 300,000 maximum, 2.5% fee, 176,543 returned.
    const metered = {
      ...PAYMENT,
      amount: '123457',
      fee: { amount: '3086', treasury: TREASURY },
      settlement: 'metered-escrow',
      metered: { inputTokens: '1200', outputTokens: '800', maxAmount: '300000', refunded: '176543' },
    } as const;
    const signed = await signReddiReceiptV2(receiptFor(provider.address, { payment: metered }), provider.signer);
    assert.match(canonicalizeReddiReceiptV2(signed.receipt), /"settlement":"metered-escrow","metered":\{"inputTokens":"1200","outputTokens":"800","maxAmount":"300000","refunded":"176543"\}\}/);
    const base = { network: metered.network, txSignature: TX };
    assert.equal(verifyReddiReceiptV2(signed, { payment: { ...base, metered: metered.metered } }).ok, true);
    assert.deepEqual(codes(verifyReddiReceiptV2(signed, { payment: { ...base, metered: { ...metered.metered, outputTokens: '801' } } })), ['payment_mismatch']);
    // The token counts are signed.
    const edited = { ...signed, receipt: { ...signed.receipt, payment: { ...metered, metered: { ...metered.metered, outputTokens: '80' } } } };
    assert.deepEqual(codes(verifyReddiReceiptV2(edited)), ['signature_invalid']);

    const bad = (payment: unknown) => validateReddiReceiptV2(receiptFor(provider.address, { payment: payment as ReddiReceiptV2['payment'] }));
    assert.equal(bad({ ...metered, metered: undefined }).ok, false);
    assert.equal(bad({ ...metered, metered: { ...metered.metered, refunded: '176542' } }).ok, false);
    assert.equal(bad({ ...metered, amount: '300001', metered: { ...metered.metered, refunded: '0' } }).ok, false);
    assert.equal(bad({ ...metered, metered: { ...metered.metered, inputTokens: '-1' } }).ok, false);
    assert.equal(bad({ ...metered, metered: { ...metered.metered, extra: '1' } }).ok, false);
    assert.equal(bad({ ...PAYMENT, metered: metered.metered }).ok, false);
    assert.equal(bad({ ...metered, amount: '300000', metered: { ...metered.metered, refunded: '0' } }).ok, true);
  });

  it('refuses to sign an invalid receipt', async () => {
    const provider = testProvider();
    await assert.rejects(signReddiReceiptV2(receiptFor(provider.address, { declaredModel: '' }), provider.signer), /invalid_reddi_receipt_v2/);
  });

  it('rejects the removed receipt versions', () => {
    const v2 = receiptFor(testProvider().address);
    const asV1 = validateReddiReceiptV2({ ...v2, schemaVersion: 'reddi.receipt.v1' });
    assert.equal(asV1.ok, false);
    if (!asV1.ok) assert.equal(asV1.errors[0]?.code, 'unsupported_version');
    const retired = validateReddiReceiptV2({ ...v2, schemaVersion: 'reddi.receipt.provider-extension.v1' });
    assert.equal(retired.ok, false);
    if (!retired.ok) assert.equal(retired.errors[0]?.code, 'unsupported_version');
  });
});
