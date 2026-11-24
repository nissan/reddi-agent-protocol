import { sign as edSign, createPrivateKey } from 'node:crypto';
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { reserveInstruction, type BudgetAccount } from '../src/budget';
import {
  BUDGET_PAYMENT_HEADER,
  BUDGET_SIGNATURE_HEADER,
  budgetRequestHeaders,
  checkPooledBudgetForProvider,
  checkReserveTransaction,
  readBudgetPaymentHeader,
  spenderSignedReserve,
  verifyPooledBudgetRequest,
  type PooledBudgetOffer,
} from '../src/budget-provider';

const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const signer = (k: Keypair) => (message: Uint8Array) => new Uint8Array(edSign(null, Buffer.from(message), createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(k.secretKey.subarray(0, 32))]), format: 'der', type: 'pkcs8' })));

const programId = Keypair.generate().publicKey;
const budgetKey = Keypair.generate().publicKey;
const spender = Keypair.generate();
const payee = Keypair.generate();
const judge = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const payout = Keypair.generate().publicKey;
const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const CREATED = 1_000n;
const BLOCKHASH = Keypair.generate().publicKey.toBase58();

const budget = (over: Partial<BudgetAccount> = {}): BudgetAccount => ({
  payer: Keypair.generate().publicKey, spender: spender.publicKey, judge, mint, nonce: new Uint8Array(16), createdSlot: CREATED,
  openSlots: 648_000n, disputeSlots: 216_000n, judgeSlots: 648_000n, total: 50_000_000n, unreserved: 40_000_000n, perProviderCap: 0n,
  allowlist: [], closedSlot: 0n, reservations: 1, unsettled: 1, spenderMayWaive: false, closed: false, openEnds: CREATED + 648_000n, ...over,
});

const check = (over: Partial<BudgetAccount> = {}, extra: Partial<Parameters<typeof checkPooledBudgetForProvider>[0]> = {}) => checkPooledBudgetForProvider({
  budget: budget(over), createdSlot: CREATED, payee: payee.publicKey, mint, acceptedJudges: [judge], slice: 5_000_000n, currentSlot: CREATED + 100n, minOpenSlotsLeft: 9_000n, ...extra,
});

describe('checkPooledBudgetForProvider', () => {
  it('accepts a budget in its own token, with an accepted judge, room and time left', () => {
    expect(check()).toEqual({ ok: true });
    expect(check({ judge: null }, { acceptedJudges: [] })).toEqual({ ok: true });
    expect(check({ mint: null }, { mint: null })).toEqual({ ok: true });
  });

  it.each([
    ['a budget in another token', { mint: Keypair.generate().publicKey }, {}, 'budget_currency_not_accepted'],
    ['a SOL budget for a token provider', { mint: null }, {}, 'budget_currency_not_accepted'],
    ['a token budget for a SOL provider', {}, { mint: null }, 'budget_currency_not_accepted'],
    ['another instance at the address', { createdSlot: CREATED + 1n, openEnds: CREATED + 648_001n }, {}, 'budget_instance_mismatch'],
    ['a closed budget', { closed: true }, {}, 'budget_closed'],
    ['one closing soon', {}, { currentSlot: CREATED + 648_000n - 9_000n }, 'budget_closing'],
    ['a judge it does not accept', { judge: Keypair.generate().publicKey }, {}, 'budget_judge_not_accepted'],
    ['a judge when it accepts none', {}, { acceptedJudges: [] }, 'budget_judge_not_accepted'],
    ['an allowlist without it', { allowlist: [Keypair.generate().publicKey] }, {}, 'budget_not_allowlisted'],
    ['a cap below the slice', { perProviderCap: 4_999_999n }, {}, 'budget_cap_too_small'],
    ['a slice below the on-chain floor', {}, { slice: 499_999n }, 'budget_cap_too_small'],
    ['too little unreserved', { unreserved: 4_999_999n }, {}, 'budget_funds_too_low'],
    ['eight slices taken', { reservations: 8 }, {}, 'budget_full'],
  ] as const)('refuses %s', (_what, over, extra, reason) => {
    expect(check(over as Partial<BudgetAccount>, extra as never)).toMatchObject({ ok: false, reason });
  });

  it('counts only the raise against what is unreserved, and a raise takes no new slot', () => {
    expect(check({ unreserved: 1_000_000n, reservations: 8 }, { reservedNow: 4_000_000n, hasReservation: true })).toEqual({ ok: true });
    expect(check({ unreserved: 999_999n }, { reservedNow: 4_000_000n, hasReservation: true })).toMatchObject({ ok: false, reason: 'budget_funds_too_low' });
  });

  it('allows an allowlist that names it', () => {
    expect(check({ allowlist: [Keypair.generate().publicKey, payee.publicKey] })).toEqual({ ok: true });
  });
});

const offer: PooledBudgetOffer = {
  scheme: 'budget', network: GENESIS, programId: programId.toBase58(), payee: payee.publicKey.toBase58(), payoutAccount: payout.toBase58(),
  mint: mint.toBase58(), reservation: '5000000', minReservation: '1000000', acceptedJudges: [judge.toBase58()], minOpenSlotsLeft: '9000',
};
const expected = { programId, budget: budgetKey, createdSlot: CREATED, spender: spender.publicKey, payee: payee.publicKey, payoutAccount: payout, minAmount: 1_000_000n, maxAmount: 5_000_000n };

describe('checkReserveTransaction', () => {
  const signed = (amount = 5_000_000n) => spenderSignedReserve({ offer, budget: budgetKey, createdSlot: CREATED, spender: spender.publicKey, amount, recentBlockhash: BLOCKHASH, signWithSpender: signer(spender) });

  it('accepts the reserve the spender signed for this offer, and the provider can sign and complete it', async () => {
    const result = checkReserveTransaction({ ...expected, transactionBase64: await signed() });
    expect(result).toMatchObject({ ok: true, amount: 5_000_000n });
    if (!result.ok) throw new Error('unreachable');
    result.transaction.partialSign(payee);
    expect(result.transaction.verifySignatures()).toBe(true);
  });

  it('accepts compute-budget instructions beside the reserve', async () => {
    const tx = new Transaction({ feePayer: payee.publicKey, recentBlockhash: BLOCKHASH });
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }));
    tx.add(reserveInstruction({ programId, budget: budgetKey, createdSlot: CREATED, spender: spender.publicKey, payee: payee.publicKey, amount: 2_000_000n, payoutAccount: payout }));
    tx.addSignature(spender.publicKey, Buffer.from(signer(spender)(tx.serializeMessage())));
    expect(checkReserveTransaction({ ...expected, transactionBase64: tx.serialize({ requireAllSignatures: false }).toString('base64') })).toMatchObject({ ok: true, amount: 2_000_000n });
  });

  it.each([
    ['more than offered', 5_000_001n],
    ['less than the least', 999_999n],
  ])('refuses an amount %s', async (_what, amount) => {
    expect(checkReserveTransaction({ ...expected, transactionBase64: await signed(amount) })).toMatchObject({ ok: false, reason: 'invalid_reserve' });
  });

  const build = (mutate: (tx: Transaction) => void, signers: Keypair[] = [spender], feePayer = payee.publicKey, ixOver: Partial<Parameters<typeof reserveInstruction>[0]> = {}) => {
    const tx = new Transaction({ feePayer, recentBlockhash: BLOCKHASH });
    tx.add(reserveInstruction({ programId, budget: budgetKey, createdSlot: CREATED, spender: spender.publicKey, payee: payee.publicKey, amount: 3_000_000n, payoutAccount: payout, ...ixOver }));
    mutate(tx);
    for (const s of signers) tx.addSignature(s.publicKey, Buffer.from(signer(s)(tx.serializeMessage())));
    return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
  };

  it.each([
    ['another fee payer', () => build(() => {}, [spender], spender.publicKey)],
    ['an extra transfer from the provider', () => build((tx) => tx.add(SystemProgram.transfer({ fromPubkey: payee.publicKey, toPubkey: spender.publicKey, lamports: 1 })))],
    ['another payout account', () => build(() => {}, [spender], payee.publicKey, { payoutAccount: Keypair.generate().publicKey })],
    ['another budget', () => build(() => {}, [spender], payee.publicKey, { budget: Keypair.generate().publicKey })],
    ['another budget instance', () => build(() => {}, [spender], payee.publicKey, { createdSlot: CREATED + 1n })],
    ['another spender', () => { const other = Keypair.generate(); return build(() => {}, [other], payee.publicKey, { spender: other.publicKey }); }],
    ['another program', () => build(() => {}, [spender], payee.publicKey, { programId: Keypair.generate().publicKey })],
    ['no spender signature', () => build(() => {}, [])],
    ['garbage', () => 'not-a-transaction'],
  ])('refuses %s', (_what, make) => {
    expect(checkReserveTransaction({ ...expected, transactionBase64: make() })).toMatchObject({ ok: false, reason: 'invalid_reserve' });
  });

  it('refuses a spender signature over other bytes', async () => {
    const tx = Transaction.from(Buffer.from(await signed(), 'base64'));
    tx.recentBlockhash = Keypair.generate().publicKey.toBase58();
    const forged = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
    expect(checkReserveTransaction({ ...expected, transactionBase64: forged })).toMatchObject({ ok: false, reason: 'invalid_reserve', message: expect.stringContaining('spender') });
  });
});

describe('budget call signatures', () => {
  const call = { genesisHash: GENESIS, action: 'call' as const, budget: budgetKey, createdSlot: CREATED, provider: payee.publicKey, sequence: 3, body: '{"messages":[]}' };

  it('round-trips: the headers the spender makes verify against the budget spender', async () => {
    const headers = await budgetRequestHeaders(call, signer(spender));
    const read = readBudgetPaymentHeader(headers[BUDGET_PAYMENT_HEADER]);
    expect(read).toEqual({ budget: budgetKey, createdSlot: CREATED, sequence: 3 });
    expect(verifyPooledBudgetRequest({ ...call, spender: spender.publicKey, signatureHeader: headers[BUDGET_SIGNATURE_HEADER] })).toEqual({ ok: true });
  });

  it.each([
    ['another body', { body: '{"messages":[1]}' }],
    ['another call number', { sequence: 4 }],
    ['another provider', { provider: Keypair.generate().publicKey }],
    ['another budget instance', { createdSlot: CREATED + 1n }],
    ['another network', { genesisHash: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' }],
    ['another action', { action: 'close' as const }],
    ['another spender', { spender: Keypair.generate().publicKey }],
  ])('refuses a signature checked against %s', async (_what, over) => {
    const headers = await budgetRequestHeaders(call, signer(spender));
    expect(verifyPooledBudgetRequest({ ...call, spender: spender.publicKey, signatureHeader: headers[BUDGET_SIGNATURE_HEADER], ...over })).toMatchObject({ ok: false, reason: 'budget_signature_invalid' });
  });

  it('refuses a missing or short signature, and reads malformed headers as errors', () => {
    expect(verifyPooledBudgetRequest({ ...call, spender: spender.publicKey, signatureHeader: undefined })).toMatchObject({ ok: false });
    expect(verifyPooledBudgetRequest({ ...call, spender: spender.publicKey, signatureHeader: 'AAAA' })).toMatchObject({ ok: false });
    expect(readBudgetPaymentHeader(undefined)).toBeUndefined();
    expect(readBudgetPaymentHeader('nope')).toMatchObject({ error: expect.any(String) });
    expect(readBudgetPaymentHeader(Buffer.from(JSON.stringify({ budget: budgetKey.toBase58(), createdSlot: '1', sequence: -1 })).toString('base64'))).toMatchObject({ error: expect.any(String) });
    expect(readBudgetPaymentHeader(Buffer.from(JSON.stringify({ budget: budgetKey.toBase58(), createdSlot: 1, sequence: 0 })).toString('base64'))).toMatchObject({ error: expect.any(String) });
  });
});
