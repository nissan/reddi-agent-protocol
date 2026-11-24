import { createSign, createVerify, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY, Transaction, TransactionInstruction } from '@solana/web3.js';
import {
  BUDGET_FLAG_P256_SPENDER,
  budgetApprovalMessage,
  closeBudgetInstruction,
  compactLowSP256Signature,
  compressP256PublicKey,
  openBudgetInstruction,
  p256SpenderAddress,
  reserveInstruction,
  SECP256R1_PROGRAM_ID,
  secp256r1ApprovalInstruction,
  waiveInstruction,
} from '../src/budget';
import { BUDGET_SIGNATURE_HEADER, budgetRequestHeadersP256, checkReserveTransaction, verifyPooledBudgetRequest } from '../src/budget-provider';

interface VectorMeta { name: string; address: string; signer: boolean; writable: boolean }
interface VectorInstruction { name: string; data_hex: string; accounts: VectorMeta[] }
interface Example { action: string; message_hex: string; precompile_data_hex: string; call: VectorInstruction }
interface P256Vectors {
  public_key_hex: string;
  spender: string;
  budget: string;
  created_slot: number;
  expires_slot: number;
  examples: Example[];
}

// The program's own fixture: equivalence/tests/interface_vectors.rs signs these and runs them against the program.
const all = JSON.parse(readFileSync(join(__dirname, '../../../programs/pinocchio-escrow/interface/vectors.json'), 'utf8'));
const programId = new PublicKey(all.program_id);
const p256: P256Vectors = all.budget_p256_spender;
const publicKey = Buffer.from(p256.public_key_hex, 'hex');
const budget = new PublicKey(p256.budget);
const createdSlot = BigInt(p256.created_slot);
const expiresSlot = BigInt(p256.expires_slot);
const example = (action: string) => {
  const found = p256.examples.find((entry) => entry.action === action);
  if (!found) throw new Error(`no example for ${action}`);
  return found;
};
const at = (vector: VectorInstruction, name: string) => {
  const found = vector.accounts.find((meta) => meta.name === name);
  if (!found) throw new Error(`${vector.name} has no account ${name}`);
  return new PublicKey(found.address);
};
const shape = (ix: TransactionInstruction) => ({
  programId: ix.programId.toBase58(),
  data: ix.data.toString('hex'),
  accounts: ix.keys.map((meta) => ({ address: meta.pubkey.toBase58(), signer: meta.isSigner, writable: meta.isWritable })),
});
const expected = (vector: VectorInstruction) => ({
  programId: all.program_id,
  data: vector.data_hex,
  accounts: vector.accounts.map(({ address, signer, writable }) => ({ address, signer, writable })),
});
const signatureOf = (precompileHex: string) => Buffer.from(precompileHex, 'hex').subarray(49, 113);

describe('P-256 spender approvals (flag 0x08)', () => {
  it('derives the spender from the key', async () => {
    expect((await p256SpenderAddress(publicKey)).toBase58()).toBe(p256.spender);
  });

  it('builds each approval, its precompile instruction and its call byte for byte', () => {
    const reserve = example('reserve');
    const payee = at(reserve.call, 'payee');
    const common = { programId, budget, createdSlot, expiresSlot, cluster: 'mainnet' as const };
    const cases: Array<[Example, Buffer, TransactionInstruction]> = [
      [
        reserve,
        budgetApprovalMessage({ ...common, action: 'reserve', payee, amount: 40_000_000n }),
        reserveInstruction({ programId, budget, createdSlot, spender: { p256ExpiresSlot: expiresSlot }, payee, amount: 40_000_000n }),
      ],
      [
        example('waive'),
        budgetApprovalMessage({ ...common, action: 'waive', payee }),
        waiveInstruction({ programId, budget, createdSlot, payee, signer: { p256ExpiresSlot: expiresSlot } }),
      ],
      [
        example('close_budget'),
        budgetApprovalMessage({ ...common, action: 'close' }),
        closeBudgetInstruction({
          programId,
          budget,
          createdSlot,
          signer: { p256ExpiresSlot: expiresSlot },
          payer: at(example('close_budget').call, 'payer'),
        }),
      ],
    ];
    for (const [vector, message, call] of cases) {
      expect(message.toString('hex')).toBe(vector.message_hex);
      const pre = secp256r1ApprovalInstruction({ publicKey, signature: signatureOf(vector.precompile_data_hex), message });
      expect(pre.programId.equals(SECP256R1_PROGRAM_ID)).toBe(true);
      expect(pre.keys).toEqual([]);
      expect(pre.data.toString('hex')).toBe(vector.precompile_data_hex);
      expect(shape(call)).toEqual(expected(vector.call));
      expect(call.keys.some((meta) => meta.pubkey.equals(SYSVAR_INSTRUCTIONS_PUBKEY) && !meta.isSigner)).toBe(true);
    }
  });

  it('binds the cluster', () => {
    const message = budgetApprovalMessage({ programId, budget, createdSlot, expiresSlot, cluster: 'devnet', action: 'close' });
    expect(message.toString('hex')).not.toBe(example('close_budget').message_hex);
    expect(message[21]).toBe(1);
  });

  it('sets flag 0x08 at open', () => {
    const ix = openBudgetInstruction({
      programId,
      payer: at(example('close_budget').call, 'payer'),
      nonce: new Uint8Array(16).fill(11),
      spender: new PublicKey(p256.spender),
      judge: null,
      openSlots: 9_000n,
      disputeSlots: 9_000n,
      judgeSlots: 1_500n,
      total: 100_000_000n,
      perProviderCap: 0n,
      allowlist: [at(example('reserve').call, 'payee')],
      spenderMayWaive: true,
      p256Spender: true,
    });
    expect(ix.data[128]).toBe(BUDGET_FLAG_P256_SPENDER | 0x01);
  });

  it('turns a KMS signature (DER or raw, any S) into the low-S compact form the precompile takes', () => {
    const { privateKey, publicKey: pub } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const message = budgetApprovalMessage({ programId, budget, createdSlot, expiresSlot, cluster: 'mainnet', action: 'close' });
    const order = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
    const half = order / 2n;
    const s = (sig: Uint8Array) => BigInt('0x' + Buffer.from(sig.subarray(32)).toString('hex'));
    for (let i = 0; i < 16; i++) {
      const der = createSign('SHA256').update(message).sign(privateKey);
      const compact = compactLowSP256Signature(der);
      expect(s(compact) <= half).toBe(true);
      expect(createVerify('SHA256').update(message).verify({ key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(compact))).toBe(true);
      // The same signature as raw r || s with a high S comes out the same.
      const high = Buffer.from(compact);
      const flipped = order - s(compact);
      high.set(Buffer.from(flipped.toString(16).padStart(64, '0'), 'hex'), 32);
      expect(Buffer.from(compactLowSP256Signature(high)).equals(Buffer.from(compact))).toBe(true);
    }
    expect(() => compactLowSP256Signature(new Uint8Array(10))).toThrow();
  });

  it('compresses an uncompressed key', async () => {
    const { publicKey: pub } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = pub.export({ format: 'jwk' });
    const x = Buffer.from(jwk.x!, 'base64url');
    const y = Buffer.from(jwk.y!, 'base64url');
    const compressed = compressP256PublicKey(Buffer.concat([Buffer.from([4]), x, y]));
    expect(compressed[0]).toBe((y[31] & 1) === 0 ? 2 : 3);
    expect(Buffer.from(compressed.subarray(1)).equals(x)).toBe(true);
    expect(() => compressP256PublicKey(new Uint8Array(32))).toThrow();
  });
});

describe('provider side with a P-256 spender', () => {
  const { privateKey, publicKey: pub } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = pub.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')]);
  const key = compressP256PublicKey(raw);
  const sign = (message: Uint8Array) => new Uint8Array(createSign('SHA256').update(Buffer.from(message)).sign(privateKey));
  const pid = Keypair.generate().publicKey;
  const budgetKey = Keypair.generate().publicKey;
  const payee = Keypair.generate();
  const payout = Keypair.generate().publicKey;
  const CREATED = 1_000n;
  const EXPIRES = 1_150n;

  async function reserveTx(over: { amount?: bigint; messageAmount?: bigint; signKey?: (m: Uint8Array) => Uint8Array; publicKey?: Uint8Array; extra?: TransactionInstruction; cluster?: 'mainnet' | 'devnet' } = {}) {
    const amount = over.amount ?? 2_000_000n;
    const message = budgetApprovalMessage({
      programId: pid, budget: budgetKey, createdSlot: CREATED, action: 'reserve', payee: payee.publicKey, payoutAccount: payout,
      amount: over.messageAmount ?? amount, expiresSlot: EXPIRES, cluster: over.cluster ?? 'mainnet',
    });
    const tx = new Transaction({ feePayer: payee.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58() });
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 40_000 }));
    tx.add(secp256r1ApprovalInstruction({ publicKey: over.publicKey ?? key, signature: (over.signKey ?? sign)(message), message }));
    if (over.extra) tx.add(over.extra);
    tx.add(reserveInstruction({ programId: pid, budget: budgetKey, createdSlot: CREATED, spender: { p256ExpiresSlot: EXPIRES }, payee: payee.publicKey, amount, payoutAccount: payout }));
    return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
  }

  const check = async (transactionBase64: string) => checkReserveTransaction({
    transactionBase64, programId: pid, budget: budgetKey, createdSlot: CREATED, spender: await p256SpenderAddress(key),
    payee: payee.publicKey, payoutAccount: payout, minAmount: 1_000_000n, maxAmount: 5_000_000n, p256: { cluster: 'mainnet' },
  });

  it('accepts the reserve its spender approved, with the provider as the only signer', async () => {
    const result = await check(await reserveTx());
    expect(result).toMatchObject({ ok: true, amount: 2_000_000n, maxFeeLamports: 10_000n });
  });

  it('refuses a reserve its approval does not match, or that is not the spender\'s', async () => {
    const other = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const otherJwk = other.publicKey.export({ format: 'jwk' });
    const otherKey = compressP256PublicKey(Buffer.concat([Buffer.from([4]), Buffer.from(otherJwk.x!, 'base64url'), Buffer.from(otherJwk.y!, 'base64url')]));
    const otherSign = (m: Uint8Array) => new Uint8Array(createSign('SHA256').update(Buffer.from(m)).sign(other.privateKey));
    const refusals = [
      await reserveTx({ messageAmount: 2_000_001n }),
      await reserveTx({ cluster: 'devnet' }),
      await reserveTx({ publicKey: otherKey, signKey: otherSign }),
      await reserveTx({ signKey: otherSign }),
      await reserveTx({ amount: 9_000_000n }),
      await reserveTx({ extra: SystemProgram.transfer({ fromPubkey: payee.publicKey, toPubkey: payout, lamports: 1 }) }),
    ];
    for (const tx of refusals) expect((await check(tx)).ok).toBe(false);
  });

  it('signs and verifies a budget call with the key in the header', async () => {
    const spender = await p256SpenderAddress(key);
    const base = { genesisHash: 'G', action: 'call' as const, budget: budgetKey, createdSlot: CREATED, provider: payee.publicKey, sequence: 3, body: '{"q":1}' };
    const headers = await budgetRequestHeadersP256(base, raw, sign);
    const signatureHeader = headers[BUDGET_SIGNATURE_HEADER];
    expect(Buffer.from(signatureHeader, 'base64')).toHaveLength(97);
    expect(verifyPooledBudgetRequest({ ...base, spender, p256Spender: true, signatureHeader })).toEqual({ ok: true });
    expect(verifyPooledBudgetRequest({ ...base, sequence: 4, spender, p256Spender: true, signatureHeader }).ok).toBe(false);
    expect(verifyPooledBudgetRequest({ ...base, spender: Keypair.generate().publicKey, p256Spender: true, signatureHeader }).ok).toBe(false);
    expect(verifyPooledBudgetRequest({ ...base, spender, signatureHeader }).ok).toBe(false);
  });
});
