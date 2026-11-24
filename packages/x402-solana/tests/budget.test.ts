import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import {
  BUDGET_ACCOUNT_LEN,
  BUDGET_DISCRIMINATORS,
  budgetAddress,
  budgetVaultAddress,
  budgetWindowsValid,
  closeBudgetInstruction,
  decodeBudget,
  decodeReservation,
  disputeEnds,
  disputeInstruction,
  judgeEnds,
  minReservation,
  MIN_REVIEW_SLOTS,
  openBudgetInstruction,
  payoutInstruction,
  postFinalInstruction,
  RESERVATION_ACCOUNT_LEN,
  reservationAddress,
  reserveInstruction,
  resolveInstruction,
  setPayoutAccountInstruction,
  waiveInstruction,
} from '../src/budget';

interface VectorMeta { name: string; address: string; signer: boolean; writable: boolean }
interface VectorInstruction { name: string; data_hex: string; accounts: VectorMeta[] }
interface VectorAccount { name: string; address: string; length: number; data_hex: string }
interface Vectors { program_id: string; instructions: VectorInstruction[]; accounts: VectorAccount[] }

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
  programId: vectors.program_id,
  data: vector.data_hex,
  accounts: vector.accounts.map(({ address, signer, writable }) => ({ address, signer, writable })),
});
const data = (vector: VectorInstruction) => Buffer.from(vector.data_hex, 'hex');
const u64At = (vector: VectorInstruction, offset: number) => data(vector).readBigUInt64LE(offset);
const key = (bytes: Buffer, offset: number) => new PublicKey(bytes.subarray(offset, offset + 32));

/** The open's terms, read back from its data. */
function terms(vector: VectorInstruction) {
  const bytes = data(vector);
  const allowlist = [0, 1, 2, 3].map((i) => key(bytes, 129 + 32 * i)).filter((entry) => !entry.equals(PublicKey.default));
  const judge = key(bytes, 56);
  return {
    nonce: bytes.subarray(8, 24),
    spender: key(bytes, 24),
    judge: judge.equals(PublicKey.default) ? null : judge,
    openSlots: bytes.readBigUInt64LE(88),
    disputeSlots: bytes.readBigUInt64LE(96),
    judgeSlots: bytes.readBigUInt64LE(104),
    total: bytes.readBigUInt64LE(112),
    perProviderCap: bytes.readBigUInt64LE(120),
    spenderMayWaive: bytes[128] === 1,
    allowlist,
  };
}

describe('pooled budget client', () => {
  it('fixes the discriminators the program uses', () => {
    for (const [name, bytes] of Object.entries(BUDGET_DISCRIMINATORS)) {
      expect([...createHash('sha256').update(name).digest().subarray(0, 8)]).toEqual(bytes);
    }
  });

  it('builds both opens byte for byte', () => {
    for (const name of ['open_budget', 'open_token_budget']) {
      const vector = instruction(name);
      const bytes = data(vector);
      // selector 8, nonce 16, spender 32, judge 32, five u64, flags 1, allowlist 4 x 32
      expect(bytes.length).toBe(8 + 16 + 32 + 32 + 40 + 1 + 128);
      const read = {
        nonce: bytes.subarray(8, 24),
        spender: key(bytes, 24),
        judge: key(bytes, 56),
        openSlots: bytes.readBigUInt64LE(88),
        disputeSlots: bytes.readBigUInt64LE(96),
        judgeSlots: bytes.readBigUInt64LE(104),
        total: bytes.readBigUInt64LE(112),
        perProviderCap: bytes.readBigUInt64LE(120),
        spenderMayWaive: bytes[128] === 1,
      };
      const payer = at(vector, 'payer');
      const ix = openBudgetInstruction({
        programId,
        payer,
        ...read,
        judge: read.judge.equals(PublicKey.default) ? null : read.judge,
        token: name === 'open_token_budget' ? { mint: at(vector, 'mint'), source: at(vector, 'source'), tokenProgram: at(vector, 'token_program') } : undefined,
      });
      expect(shape(ix)).toEqual(expected(vector));
      expect(budgetAddress(payer, read.nonce, programId)).toEqual(at(vector, 'budget'));
      if (name === 'open_token_budget') expect(budgetVaultAddress(at(vector, 'budget'), programId)).toEqual(at(vector, 'vault'));
    }
    expect(terms(instruction('open_budget')).judge).not.toBeNull();
  });

  it('builds reserve, set_payout_account, post, waive and dispute byte for byte', () => {
    const reserve = instruction('reserve');
    const budget = at(reserve, 'budget');
    expect(
      shape(
        reserveInstruction({
          programId,
          budget,
          createdSlot: u64At(reserve, 8),
          spender: at(reserve, 'spender'),
          payee: at(reserve, 'payee'),
          amount: u64At(reserve, 16),
        }),
      ),
    ).toEqual(expected(reserve));
    expect(reservationAddress(budget, at(reserve, 'payee'), programId)).toEqual(at(reserve, 'reservation'));

    const setPayout = instruction('set_payout_account');
    expect(
      shape(
        setPayoutAccountInstruction({
          programId,
          budget: at(setPayout, 'budget'),
          createdSlot: u64At(setPayout, 8),
          payee: at(setPayout, 'payee'),
          payoutAccount: at(setPayout, 'payout_account'),
        }),
      ),
    ).toEqual(expected(setPayout));

    const post = instruction('post_final');
    expect(
      shape(postFinalInstruction({ programId, budget: at(post, 'budget'), createdSlot: u64At(post, 8), payee: at(post, 'payee'), amount: u64At(post, 16) })),
    ).toEqual(expected(post));

    const reservationOf = (vector: VectorInstruction) => decodeReservation(account(vector.name === 'waive' ? 'reservation_posted' : 'reservation_disputed'));
    const waive = instruction('waive');
    expect(
      shape(
        waiveInstruction({
          programId,
          budget: at(waive, 'budget'),
          createdSlot: u64At(waive, 8),
          payee: reservationOf(waive).payee,
          signer: at(waive, 'signer'),
        }),
      ),
    ).toEqual(expected(waive));
    const dispute = instruction('dispute');
    expect(
      shape(
        disputeInstruction({
          programId,
          budget: at(dispute, 'budget'),
          createdSlot: u64At(dispute, 8),
          payee: reservationOf(dispute).payee,
          payer: at(dispute, 'signer'),
        }),
      ),
    ).toEqual(expected(dispute));
  });

  it('builds both closes byte for byte', () => {
    const sol = instruction('close_budget');
    expect(
      shape(closeBudgetInstruction({ programId, budget: at(sol, 'budget'), createdSlot: u64At(sol, 8), signer: at(sol, 'signer'), payer: at(sol, 'payer') })),
    ).toEqual(expected(sol));
    const token = instruction('close_token_budget');
    expect(
      shape(
        closeBudgetInstruction({
          programId,
          budget: at(token, 'budget'),
          createdSlot: u64At(token, 8),
          signer: at(token, 'signer'),
          payer: at(token, 'payer'),
          token: { mint: at(token, 'mint'), refund: at(token, 'refund'), tokenProgram: at(token, 'token_program') },
        }),
      ),
    ).toEqual(expected(token));
  });

  it('builds the payouts and resolves byte for byte', () => {
    const treasury = at(instruction('payout_budget'), 'treasury');
    for (const name of ['payout_budget', 'resolve_budget', 'payout_token_budget', 'resolve_token_budget']) {
      const vector = instruction(name);
      const isToken = name.includes('token');
      const input = {
        programId,
        budget: at(vector, 'budget'),
        createdSlot: u64At(vector, 8),
        payee: at(vector, 'payee'),
        payer: at(vector, 'payer'),
        treasury,
        token: isToken
          ? {
              mint: at(vector, 'mint'),
              payoutAccount: at(vector, 'payout_account'),
              treasuryToken: at(vector, 'treasury_token'),
              refund: at(vector, 'refund'),
              tokenProgram: at(vector, 'token_program'),
            }
          : undefined,
      };
      const ix = name.startsWith('resolve')
        ? resolveInstruction({ ...input, judge: at(vector, 'judge'), payout: u64At(vector, 16) })
        : payoutInstruction(input);
      expect(shape(ix)).toEqual(expected(vector));
    }
  });

  it('decodes budgets and reservations in each state', () => {
    const open = decodeBudget(account('budget_open'));
    const openTerms = terms(instruction('open_budget'));
    expect(open).toMatchObject({
      total: openTerms.total,
      unreserved: openTerms.total,
      perProviderCap: openTerms.perProviderCap,
      openSlots: openTerms.openSlots,
      disputeSlots: openTerms.disputeSlots,
      judgeSlots: openTerms.judgeSlots,
      mint: null,
      closed: false,
      closedSlot: 0n,
      reservations: 0,
      unsettled: 0,
      spenderMayWaive: false,
      allowlist: [],
    });
    expect(open.judge).toEqual(openTerms.judge);
    expect(open.spender).toEqual(openTerms.spender);
    expect(open.createdSlot).toBe(u64At(instruction('reserve'), 8));
    expect(open.openEnds).toBe(open.createdSlot + open.openSlots);
    expect(account('budget_open').length).toBe(BUDGET_ACCOUNT_LEN);

    const closed = decodeBudget(account('budget_closed'));
    expect(closed.closed).toBe(true);
    expect(closed.closedSlot).toBeGreaterThan(closed.createdSlot);
    expect(closed.unreserved).toBe(0n);
    expect(closed.unsettled).toBe(1);

    expect(decodeReservation(account('reservation_open'))).toMatchObject({ state: 'open', reserved: u64At(instruction('reserve'), 16), finalAmount: 0n, waived: false });
    const posted = decodeReservation(account('reservation_posted'));
    expect(posted).toMatchObject({ state: 'posted', finalAmount: u64At(instruction('post_final'), 16), waived: false });
    expect(posted.budgetCreatedSlot).toBe(open.createdSlot);
    expect(posted.payoutAccount).toEqual(posted.payee);
    expect(decodeReservation(account('reservation_paid'))).toMatchObject({ state: 'paid', waived: true });
    const disputed = decodeReservation(account('reservation_disputed'));
    expect(disputed.state).toBe('disputed');
    expect(account('reservation_open').length).toBe(RESERVATION_ACCOUNT_LEN);

    expect(judgeEnds(closed, disputed)).toBe(disputed.disputedSlot + closed.judgeSlots);
    expect(judgeEnds(closed, posted)).toBeNull();

    const wrong = account('budget_open');
    wrong[0] ^= 1;
    expect(() => decodeBudget(wrong)).toThrow('invalid budget account');
    expect(() => decodeReservation(account('budget_open'))).toThrow('invalid reservation account');
  });

  it('gives a late post its review time', () => {
    const closed = decodeBudget(account('budget_closed'));
    const posted = decodeReservation(account('reservation_posted'));
    expect(disputeEnds(decodeBudget(account('budget_open')), posted)).toBeNull();
    expect(disputeEnds(closed, { ...posted, lastPostSlot: 0n })).toBe(closed.closedSlot + closed.disputeSlots);
    const late = closed.closedSlot + closed.disputeSlots - 1n;
    expect(disputeEnds(closed, { ...posted, lastPostSlot: late })).toBe(late + MIN_REVIEW_SLOTS);
  });

  it('refuses terms the program would refuse', () => {
    const vector = instruction('open_budget');
    const base = { ...terms(vector), programId, payer: at(vector, 'payer') };
    expect(() => openBudgetInstruction(base)).not.toThrow();
    expect(() => openBudgetInstruction({ ...base, judge: null })).toThrow('a budget needs a judge or an allowlist');
    expect(() => openBudgetInstruction({ ...base, spenderMayWaive: true })).toThrow('the spender may waive only with an allowlist');
    expect(() => openBudgetInstruction({ ...base, openSlots: 8_999n })).toThrow('budget windows out of range');
    expect(() => openBudgetInstruction({ ...base, perProviderCap: base.total + 1n })).toThrow('perProviderCap above the total');
    expect(() => openBudgetInstruction({ ...base, total: 500_000_001n })).toThrow('total above the per-budget cap');
    expect(() => openBudgetInstruction({ ...base, judge: base.payer })).toThrow('the judge must not be the payer or the spender');
    expect(() => openBudgetInstruction({ ...base, allowlist: Array(5).fill(base.payer) })).toThrow('at most 4');
    expect(() => openBudgetInstruction({ ...base, nonce: new Uint8Array(15) })).toThrow('nonce must be 16 bytes');
    expect(budgetWindowsValid(9_000n, 1_512_000n, 1_500n)).toBe(true);
    expect(budgetWindowsValid(9_000n, 1_512_001n, 1_500n)).toBe(false);
    expect(minReservation(5_000_000n)).toBe(50_000n);
    expect(minReservation(50n)).toBe(1n);
  });
});
