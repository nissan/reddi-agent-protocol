import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as edSign, type KeyObject } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  REDDI_RECEIPT_V2_VERSION,
  canonicalizeReddiReceiptV2,
  hashReddiReceiptV2Body,
  signReddiReceiptV2,
  reddiReceiptFixtures,
  validateReddiReceipt,
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
const REQUEST = '{"model":"llama3.1:8b","messages":[{"role":"user","content":"hi"}]}';
const RESPONSE = '{"choices":[{"message":{"role":"assistant","content":"hello"}}]}';

function receiptFor(address: string, overrides: Partial<ReddiReceiptV2> = {}): ReddiReceiptV2 {
  return {
    schemaVersion: REDDI_RECEIPT_V2_VERSION,
    providerId: address,
    declaredModel: 'llama3.1:8b',
    requestHash: hashReddiReceiptV2Body(REQUEST),
    responseHash: hashReddiReceiptV2Body(RESPONSE),
    payment: { network: 'solana-devnet', txSignature: TX },
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
      { payment: { network: 'solana-devnet', txSignature: '4'.repeat(88) } },
      { payment: { network: 'solana-mainnet-beta', txSignature: TX } },
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
      { ...good, payment: { network: 'solana-testnet', txSignature: TX } },
      { ...good, payment: { network: 'solana-devnet', txSignature: 'short' } },
      { ...good, payment: { network: 'solana-devnet', txSignature: TX, memo: 'x' } },
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
    const reordered = { issuedAt: good.issuedAt, payment: { txSignature: TX, network: 'solana-devnet' as const }, responseHash: good.responseHash, requestHash: good.requestHash, declaredModel: good.declaredModel, providerId: good.providerId, schemaVersion: good.schemaVersion };
    assert.equal(canonicalizeReddiReceiptV2(reordered), canonicalizeReddiReceiptV2(good));
    assert.ok(canonicalizeReddiReceiptV2(good).startsWith(`{"schemaVersion":"${REDDI_RECEIPT_V2_VERSION}"`));
  });

  it('refuses to sign an invalid receipt', async () => {
    const provider = testProvider();
    await assert.rejects(signReddiReceiptV2(receiptFor(provider.address, { declaredModel: '' }), provider.signer), /invalid_reddi_receipt_v2/);
  });

  it('is a separate version: each validator rejects the other version', () => {
    const v2 = receiptFor(testProvider().address);
    assert.equal(validateReddiReceipt(v2).ok, false);
    const asV2 = validateReddiReceiptV2(reddiReceiptFixtures.happyPath);
    assert.equal(asV2.ok, false);
    if (!asV2.ok) assert.equal(asV2.errors[0]?.code, 'unsupported_version');
    const retired = validateReddiReceiptV2({ ...v2, schemaVersion: 'reddi.receipt.provider-extension.v1' });
    assert.equal(retired.ok, false);
    if (!retired.ok) assert.equal(retired.errors[0]?.code, 'unsupported_version');
  });
});
