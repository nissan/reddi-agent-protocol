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
  type ReddiReceiptV2Session,
  type ReddiReceiptV2Signer,
  type SignedReddiReceiptV2,
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
const MINT = base58(Buffer.alloc(32, 4));
const TREASURY = base58(Buffer.alloc(32, 3));
const PAYER = base58(Buffer.alloc(32, 2));
const ESCROW = base58(Buffer.alloc(32, 5));
const TX = '5'.repeat(88);
const HASH = 'a'.repeat(64);

/** Calls of 1,500 in / 350 out at $2 / $10 per million: 0.0065 USDC (6,500 base units) each, under a 0.15 USDC lock. */
function sessionReceipts(address: string, calls: number, close: boolean): ReddiReceiptV2[] {
  const receipts: ReddiReceiptV2[] = [];
  for (let i = 1; i <= calls; i += 1) {
    const last = i === calls && close;
    const session: ReddiReceiptV2Session = {
      escrow: ESCROW, payer: PAYER, network: 'solana-devnet', currency: 'USDC', mint: MINT, maxAmount: '150000',
      sequence: String(i), inputTokens: '1500', outputTokens: '350',
      cumulativeInputTokens: String(1500 * i), cumulativeOutputTokens: String(350 * i), cumulativeCost: String(6500 * i),
      ...(i > 1 ? { previousReceiptHash: hashReddiReceiptV2(receipts[i - 2]!) } : {}),
      closed: last,
    };
    receipts.push({
      schemaVersion: REDDI_RECEIPT_V2_VERSION, providerId: address, declaredModel: 'mid-tier', requestHash: HASH, responseHash: HASH,
      ...(last
        ? { payment: { network: 'solana-devnet', txSignature: TX, currency: 'USDC', mint: MINT, amount: String(6500 * i), fee: { amount: String(Math.floor(6500 * i * 0.025)), treasury: TREASURY }, payer: PAYER, settlement: 'metered-escrow', metered: { inputTokens: String(1500 * i), outputTokens: String(350 * i), maxAmount: '150000', refunded: String(150000 - 6500 * i) } } }
        : {}),
      session,
      issuedAt: '2026-11-21T12:00:00.000Z',
    } as ReddiReceiptV2);
  }
  return receipts;
}
const signAll = (receipts: ReddiReceiptV2[], signer: ReddiReceiptV2Signer) => Promise.all(receipts.map((r) => signReddiReceiptV2(r, signer)));

describe('reddi.receipt.v2 session receipts', () => {
  it('ten calls under one lock chain together and the last settles the cumulative cost (RAP-SESSION-S1)', async () => {
    const provider = testProvider();
    const chain = await signAll(sessionReceipts(provider.address, 10, true), provider.signer);
    const result = verifyReddiReceiptV2Session(chain, { providerId: provider.address, session: { escrow: ESCROW } });
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.closed, true);
    const last = chain[9]!.receipt;
    assert.equal(last.payment!.amount, last.session!.cumulativeCost);
    assert.equal(last.payment!.amount, '65000');
  });

  it('an open receipt has no payment, and a payment expectation on it fails', async () => {
    const provider = testProvider();
    const [first] = await signAll(sessionReceipts(provider.address, 1, false), provider.signer);
    assert.equal(verifyReddiReceiptV2(first).ok, true);
    assert.equal(first!.receipt.payment, undefined);
    const check = verifyReddiReceiptV2(first, { payment: { network: 'solana-devnet', txSignature: TX } });
    assert.equal(check.ok, false);
    assert.equal(!check.ok && check.errors[0]!.code, 'payment_mismatch');
    const wrong = verifyReddiReceiptV2(first, { session: { escrow: PAYER } });
    assert.equal(!wrong.ok && wrong.errors[0]!.code, 'session_mismatch');
  });

  it('refuses a closed receipt without the settle, or with a settle that differs from the totals', () => {
    const provider = testProvider();
    const [open] = sessionReceipts(provider.address, 1, false);
    assert.equal(validateReddiReceiptV2({ ...open, session: { ...open!.session, closed: true } }).ok, false);
    const [closed] = sessionReceipts(provider.address, 1, true);
    assert.equal(validateReddiReceiptV2(closed).ok, true);
    assert.equal(validateReddiReceiptV2({ ...closed, payment: { ...closed!.payment, amount: '6501', metered: { ...closed!.payment!.metered, refunded: '143499' } } }).ok, false);
    assert.equal(validateReddiReceiptV2({ ...closed, session: { ...closed!.session, closed: false } }).ok, false);
    assert.equal(validateReddiReceiptV2({ ...closed, payment: undefined, session: undefined }).ok, false);
  });

  it('refuses malformed session blocks', () => {
    const provider = testProvider();
    const [first, second] = sessionReceipts(provider.address, 2, false);
    const bad = (session: Record<string, unknown>) => validateReddiReceiptV2({ ...first, session: { ...first!.session, ...session } }).ok;
    assert.equal(bad({ cumulativeCost: '150001' }), false);
    assert.equal(bad({ sequence: '0' }), false);
    assert.equal(bad({ previousReceiptHash: HASH }), false);
    assert.equal(bad({ cumulativeInputTokens: '1499' }), false);
    assert.equal(bad({ cumulativeCost: '6.5' }), false);
    assert.equal(bad({ extra: true }), false);
    assert.equal(validateReddiReceiptV2({ ...second, session: { ...second!.session, previousReceiptHash: undefined } }).ok, false);
  });

  it('breaks the chain on a gap, a replayed sequence, an altered link or a total that does not add up (RAP-SESSION-S3)', async () => {
    const provider = testProvider();
    const receipts = sessionReceipts(provider.address, 3, false);
    const chain = await signAll(receipts, provider.signer);
    const broken = (items: SignedReddiReceiptV2[]) => {
      const result = verifyReddiReceiptV2Session(items);
      return result.ok ? 'ok' : result.errors[0]!.code;
    };
    assert.equal(broken(chain), 'ok');
    assert.equal(broken([chain[0]!, chain[2]!]), 'session_chain_broken');
    assert.equal(broken([chain[0]!, chain[1]!, chain[1]!]), 'session_chain_broken');
    const relinked = { ...receipts[2]!, session: { ...receipts[2]!.session!, previousReceiptHash: hashReddiReceiptV2(receipts[0]!) } };
    assert.equal(broken([chain[0]!, chain[1]!, await signReddiReceiptV2(relinked, provider.signer)]), 'session_chain_broken');
    const inflated = { ...receipts[2]!, session: { ...receipts[2]!.session!, cumulativeInputTokens: '9000' } };
    assert.equal(broken([chain[0]!, chain[1]!, await signReddiReceiptV2(inflated, provider.signer)]), 'session_chain_broken');
    const cheaper = { ...receipts[2]!, session: { ...receipts[2]!.session!, cumulativeCost: '100' } };
    assert.equal(broken([chain[0]!, chain[1]!, await signReddiReceiptV2(cheaper, provider.signer)]), 'session_chain_broken');
    const other = testProvider();
    assert.equal(broken([chain[0]!, (await signAll(sessionReceipts(other.address, 2, false), other.signer))[1]!]), 'session_chain_broken');
    assert.equal(broken([]), 'session_chain_broken');
  });

  it('a tampered receipt in the chain fails its signature', async () => {
    const provider = testProvider();
    const chain = await signAll(sessionReceipts(provider.address, 2, false), provider.signer);
    const tampered = { ...chain[1]!, receipt: { ...chain[1]!.receipt, session: { ...chain[1]!.receipt.session!, cumulativeCost: '13001' } } };
    const result = verifyReddiReceiptV2Session([chain[0]!, tampered]);
    assert.equal(!result.ok && result.errors[0]!.code, 'signature_invalid');
  });
});
