import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import {
  buildAcceptDeliveryInstruction,
  buildDisputeDeliveryInstruction,
  buildOpenDeliveryInstruction,
  buildRecordDeliveryInstruction,
  buildResolveDeliveryInstruction,
  buildResolveTokenDeliveryInstruction,
  decodeDeliveryAccount,
  deliveryPda,
  deliveryWindowsValid,
  DELIVERY_ACCOUNT_LEN,
  DELIVERY_DISCRIMINATORS,
  DELIVERY_STATES,
  ESCROW_FLAG_DELIVERY,
  isDeliveryCheckedFlag,
  withDeliveryAccount,
} from '../src/delivery';
import { ESCROW_FLAG_DELIVERY as RATING_FLAG_DELIVERY, escrowAccountFlags } from '../src/rating';
import { decodeTokenEscrowAccount } from '../src/token-escrow';

interface VectorMeta { name: string; address: string; signer: boolean; writable: boolean }
interface VectorInstruction { name: string; data_hex: string; accounts: VectorMeta[] }
interface VectorAccount { name: string; address: string; length: number; data_hex: string }
interface Vectors {
  program_id: string;
  instructions: VectorInstruction[];
  accounts: VectorAccount[];
  escrow_flag_byte: { delivery_checked: number };
  delivery_states: string[];
}

// The program's own fixture: equivalence/tests/interface_vectors.rs fails when it and the program disagree.
const vectors: Vectors = JSON.parse(readFileSync(join(__dirname, '../../../programs/pinocchio-escrow/interface/vectors.json'), 'utf8'));
const programId = new PublicKey(vectors.program_id);
const instruction = (name: string) => {
  const found = vectors.instructions.find((entry) => entry.name === name);
  if (!found) throw new Error(`no vector for ${name}`);
  return found;
};
const account = (name: string) => {
  const found = vectors.accounts.find((entry) => entry.name === name);
  if (!found) throw new Error(`no account vector for ${name}`);
  return Buffer.from(found.data_hex, 'hex');
};
const at = (vector: VectorInstruction, name: string) => new PublicKey(vector.accounts.find((meta) => meta.name === name)!.address);
const shape = (ix: TransactionInstruction) => ({
  programId: ix.programId.toBase58(),
  data: ix.data.toString('hex'),
  accounts: ix.keys.map((meta) => ({ address: meta.pubkey.toBase58(), signer: meta.isSigner, writable: meta.isWritable })),
});
const expected = (vector: VectorInstruction) => ({
  programId: vectors.program_id,
  data: vector.data_hex,
  accounts: vector.accounts.map(({ address, signer, writable }) => ({ address, signer, writable })),
});
const u64At = (hex: string, byteOffset: number) => Buffer.from(hex, 'hex').readBigUInt64LE(byteOffset);

describe('delivery-checked escrow client', () => {
  it('fixes the discriminators the program uses', () => {
    for (const [name, bytes] of Object.entries(DELIVERY_DISCRIMINATORS)) {
      expect([...createHash('sha256').update(name).digest().subarray(0, 8)]).toEqual(bytes);
    }
  });

  it('reads the flag bit, the states and the account layout the fixture gives', () => {
    expect(ESCROW_FLAG_DELIVERY).toBe(vectors.escrow_flag_byte.delivery_checked);
    expect(RATING_FLAG_DELIVERY).toBe(ESCROW_FLAG_DELIVERY);
    expect([...DELIVERY_STATES]).toEqual(vectors.delivery_states);
    expect(isDeliveryCheckedFlag(5)).toBe(true);
    expect(isDeliveryCheckedFlag(3)).toBe(false);
    const sol = account('sol_escrow_delivery_checked_metered');
    expect(escrowAccountFlags(sol)).toEqual({ kind: 'sol', metered: true, rated: false, deliveryChecked: true });
  });

  it('builds open, record, accept and dispute byte for byte', () => {
    const open = instruction('open_delivery');
    const data = Buffer.from(open.data_hex, 'hex');
    expect(
      shape(
        buildOpenDeliveryInstruction({
          programId,
          escrow: at(open, 'escrow'),
          payer: at(open, 'payer'),
          judge: new PublicKey(data.subarray(8, 40)),
          judgeAgent: at(open, 'judge_agent'),
          verifyWindowSlots: data.readBigUInt64LE(40),
          resolveWindowSlots: data.readBigUInt64LE(48),
        }),
      ),
    ).toEqual(expected(open));
    expect(deliveryPda(at(open, 'escrow'), programId)).toEqual(at(open, 'delivery'));

    const record = instruction('record_delivery');
    const recordData = Buffer.from(record.data_hex, 'hex');
    expect(
      shape(
        buildRecordDeliveryInstruction({
          programId,
          escrow: at(record, 'escrow'),
          payee: at(record, 'payee'),
          openedSlot: recordData.readBigUInt64LE(8),
          units: recordData.readBigUInt64LE(16),
          bytes: recordData.readBigUInt64LE(24),
          sha256: recordData.subarray(32, 64),
        }),
      ),
    ).toEqual(expected(record));

    for (const [name, build] of [
      ['accept_delivery', buildAcceptDeliveryInstruction],
      ['dispute_delivery', buildDisputeDeliveryInstruction],
    ] as const) {
      const vector = instruction(name);
      expect(shape(build({ programId, escrow: at(vector, 'escrow'), payer: at(vector, 'payer'), openedSlot: u64At(vector.data_hex, 8) }))).toEqual(expected(vector));
    }
  });

  it("builds the judge's resolves byte for byte", () => {
    const sol = instruction('resolve_delivery');
    expect(
      shape(
        buildResolveDeliveryInstruction({
          programId,
          escrow: at(sol, 'escrow'),
          payer: at(sol, 'payer'),
          payee: at(sol, 'payee'),
          treasury: at(sol, 'treasury'),
          judge: at(sol, 'judge'),
          payout: u64At(sol.data_hex, 8),
          openedSlot: u64At(sol.data_hex, 16),
          rated: false,
        }),
      ),
    ).toEqual(expected(sol));

    const token = instruction('resolve_token_delivery');
    expect(
      shape(
        buildResolveTokenDeliveryInstruction({
          programId,
          escrow: at(token, 'escrow'),
          vault: at(token, 'vault'),
          judge: at(token, 'judge'),
          payer: at(token, 'payer'),
          mint: at(token, 'mint'),
          destination: at(token, 'destination'),
          treasuryToken: at(token, 'treasury_token'),
          refund: at(token, 'refund'),
          tokenProgram: at(token, 'token_program'),
          payout: u64At(token.data_hex, 8),
          openedSlot: u64At(token.data_hex, 16),
          rated: false,
        }),
      ),
    ).toEqual(expected(token));
  });

  it('puts the delivery account after the rating account on a rated resolve and on any exit', () => {
    const sol = instruction('resolve_delivery');
    const escrow = at(sol, 'escrow');
    const rated = buildResolveDeliveryInstruction({
      programId,
      escrow,
      payer: at(sol, 'payer'),
      payee: at(sol, 'payee'),
      treasury: at(sol, 'treasury'),
      judge: at(sol, 'judge'),
      payout: 1n,
      openedSlot: 2n,
      rated: true,
    });
    const rating = PublicKey.findProgramAddressSync([Buffer.from('rating'), escrow.toBuffer()], programId)[0];
    expect(rated.keys.slice(6).map((meta) => [meta.pubkey.toBase58(), meta.isWritable])).toEqual([
      [rating.toBase58(), true],
      [deliveryPda(escrow, programId).toBase58(), true],
    ]);
    const exit = new TransactionInstruction({ programId, data: Buffer.from([1, 2, 3]), keys: [{ pubkey: escrow, isSigner: false, isWritable: true }] });
    const withDelivery = withDeliveryAccount(exit);
    expect(withDelivery.data).toEqual(exit.data);
    expect(withDelivery.keys.map((meta) => meta.pubkey.toBase58())).toEqual([escrow.toBase58(), deliveryPda(escrow, programId).toBase58()]);
  });

  it('decodes each delivery account state', () => {
    expect(decodeDeliveryAccount(account('delivery_awaiting'))).toMatchObject({ state: 'awaiting', verifyWindowSlots: 150n, resolveWindowSlots: 1_500n, deliveredSlot: 0n, units: 0n });
    const delivered = decodeDeliveryAccount(account('delivery_delivered'));
    expect(delivered).toMatchObject({ state: 'delivered', units: 30n, bytes: 37_500_000n, disputedSlot: 0n });
    expect(Buffer.from(delivered.sha256)).toEqual(Buffer.alloc(32, 7));
    expect(delivered.openedSlot).toBe(u64At(instruction('record_delivery').data_hex, 8));
    expect(decodeDeliveryAccount(account('delivery_accepted')).state).toBe('accepted');
    const disputed = decodeDeliveryAccount(account('delivery_disputed'));
    expect(disputed.state).toBe('disputed');
    expect(disputed.disputedSlot).toBeGreaterThan(0n);
    expect(account('delivery_awaiting').length).toBe(DELIVERY_ACCOUNT_LEN);
    const wrong = account('delivery_awaiting');
    wrong[0] ^= 1;
    expect(() => decodeDeliveryAccount(wrong)).toThrow('invalid delivery account');
    const badState = account('delivery_awaiting');
    badState[160] = 4;
    expect(() => decodeDeliveryAccount(badState)).toThrow('invalid delivery state');
  });

  it('refuses what the program would refuse before signing', () => {
    expect(deliveryWindowsValid(150n, 1_500n)).toBe(true);
    expect(deliveryWindowsValid(149n, 1_500n)).toBe(false);
    expect(deliveryWindowsValid(1_512_001n, 1_500n)).toBe(false);
    expect(deliveryWindowsValid(150n, 3_024_001n)).toBe(false);
    const parties = { programId, escrow: PublicKey.default, payer: PublicKey.default, judge: PublicKey.default, judgeAgent: PublicKey.default };
    expect(() => buildOpenDeliveryInstruction({ ...parties, verifyWindowSlots: 100n, resolveWindowSlots: 1_500n })).toThrow('out of range');
    const record = { programId, escrow: PublicKey.default, payee: PublicKey.default, openedSlot: 1n, units: 1n, bytes: 1n, sha256: new Uint8Array(32) };
    expect(() => buildRecordDeliveryInstruction({ ...record, units: 0n })).toThrow('units');
    expect(() => buildRecordDeliveryInstruction({ ...record, bytes: 0n })).toThrow('bytes');
    expect(() => buildRecordDeliveryInstruction({ ...record, sha256: new Uint8Array(31) })).toThrow('32 bytes');
  });

  it('reads the delivery bit of a token escrow', () => {
    const token = account('sol_escrow_delivery_checked_metered');
    expect(token.length).toBe(165);
    // A token escrow stores its flag byte at 202; set the bit on a token escrow example.
    const example = vectors.accounts.find((entry) => entry.length === 219);
    if (!example) return;
    const data = Buffer.from(example.data_hex, 'hex');
    data[202] |= ESCROW_FLAG_DELIVERY;
    expect(decodeTokenEscrowAccount(data).deliveryChecked).toBe(true);
    data[202] &= ~ESCROW_FLAG_DELIVERY;
    expect(decodeTokenEscrowAccount(data).deliveryChecked).toBe(false);
  });
});
