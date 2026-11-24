import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as edSign } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  REDDI_RECEIPT_V2_VERSION,
  hashReddiReceiptV2,
  signReddiReceiptV2,
  validateReddiReceiptV2,
  verifyReddiReceiptV2,
  verifyReddiReceiptV2Session,
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
// Throwaway test keys and addresses, never a real wallet.
function testProvider(): { address: string; signer: ReddiReceiptV2Signer } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { address: base58(publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)), signer: (message) => edSign(null, message, privateKey) };
}
const PAYER = base58(Buffer.alloc(32, 2));
const BUDGET = base58(Buffer.alloc(32, 6));
const RESERVATION = base58(Buffer.alloc(32, 7));
const HASH = 'a'.repeat(64);

function budgetCall(address: string, sequence: number, previous?: ReddiReceiptV2): ReddiReceiptV2 {
  return {
    schemaVersion: REDDI_RECEIPT_V2_VERSION, providerId: address, declaredModel: 'mid-tier', requestHash: HASH, responseHash: HASH,
    session: {
      escrow: RESERVATION, payer: PAYER, network: 'solana-devnet', currency: 'SOL', maxAmount: '5000000',
      sequence: String(sequence), inputTokens: '100', outputTokens: '50',
      cumulativeInputTokens: String(100 * sequence), cumulativeOutputTokens: String(50 * sequence), cumulativeCost: String(1000 * sequence),
      ...(previous ? { previousReceiptHash: hashReddiReceiptV2(previous) } : {}),
      closed: false,
    },
    budget: { address: BUDGET, createdSlot: '123456', reservation: RESERVATION },
    issuedAt: '2026-11-24T12:00:00.000Z',
  };
}

describe('reddi.receipt.v2 budget block', () => {
  it('a call paid from a Budget slice names the Budget, its opening and the slice, and is signed over them', async () => {
    const provider = testProvider();
    const first = budgetCall(provider.address, 1);
    const second = budgetCall(provider.address, 2, first);
    assert.equal(validateReddiReceiptV2(first).ok, true);
    const signed = await Promise.all([first, second].map((r) => signReddiReceiptV2(r, provider.signer)));
    const chain = verifyReddiReceiptV2Session(signed, { providerId: provider.address, budget: { address: BUDGET, createdSlot: '123456' } });
    assert.equal(chain.ok, true);
    // Another opening of the same Budget address is a different job.
    const other = verifyReddiReceiptV2(signed[0], { budget: { createdSlot: '999' } });
    assert.equal(other.ok, false);
    if (!other.ok) assert.equal(other.errors[0]!.code, 'budget_mismatch');
    // The block is under the signature: changing it breaks the proof.
    const altered = structuredClone(signed[0]);
    altered.receipt.budget!.createdSlot = '999';
    const tampered = verifyReddiReceiptV2(altered);
    assert.equal(tampered.ok, false);
    if (!tampered.ok) assert.equal(tampered.errors[0]!.code, 'signature_invalid');
  });

  it('refuses a budget block without its session, or naming another slice than the session escrow', () => {
    const provider = testProvider();
    const call = budgetCall(provider.address, 1);
    const { session: _s, ...noSession } = call;
    void _s;
    assert.equal(validateReddiReceiptV2({ ...noSession }).ok, false);
    const mismatched = { ...call, budget: { ...call.budget!, reservation: base58(Buffer.alloc(32, 8)) } };
    const result = validateReddiReceiptV2(mismatched);
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.some((e) => e.path === '$.budget.reservation'));
    assert.equal(validateReddiReceiptV2({ ...call, budget: { ...call.budget!, createdSlot: '0' } }).ok, false);
    assert.equal(validateReddiReceiptV2({ ...call, budget: { ...call.budget!, extra: 1 } }).ok, false);
  });

  it('a receipt without a budget block fails an expectation of one', async () => {
    const provider = testProvider();
    const { budget: _b, ...plain } = budgetCall(provider.address, 1);
    void _b;
    const signed = await signReddiReceiptV2(plain as ReddiReceiptV2, provider.signer);
    const result = verifyReddiReceiptV2(signed, { budget: { address: BUDGET } });
    assert.equal(result.ok, false);
  });
});
