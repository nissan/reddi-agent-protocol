import { Keypair, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { confirmMeteredSettlement, recordedInstruction, transactionHasOnlyInstruction, type SettlementRecord } from '../src/provider';
import { lockMatchesSession, type SessionState } from '../src/session';

const program = Keypair.generate().publicKey;
const escrow = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const [destination, treasuryToken, refundTo] = [0, 1, 2].map(() => Keypair.generate().publicKey);
const settle = new TransactionInstruction({ programId: program, keys: [escrow, destination, treasuryToken, refundTo].map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })), data: Buffer.from([1, 2, 3, 4]) });
const expected = recordedInstruction(settle);
const record = (instructions = [expected]): SettlementRecord => ({
  failed: false,
  programIds: instructions.map((ix) => ix.programId),
  accounts: [escrow.toBase58(), destination.toBase58(), treasuryToken.toBase58(), refundTo.toBase58()],
  tokenBalances: [
    { account: destination.toBase58(), mint: mint.toBase58(), before: 0n, after: 975n },
    { account: treasuryToken.toBase58(), mint: mint.toBase58(), before: 0n, after: 25n },
    { account: refundTo.toBase58(), mint: mint.toBase58(), before: 0n, after: 1_000n },
  ],
  instructions,
});
const confirm = (r: SettlementRecord) => confirmMeteredSettlement(r, { programId: program, escrow, mint, destination, treasuryToken, refundTo, maxBaseUnits: 2_000n, instruction: expected });

describe('a settle counts only as the exact instruction the provider signed', () => {
  it('accepts the transaction carrying exactly that settle', () => {
    expect(transactionHasOnlyInstruction(record(), expected)).toBe(true);
    expect(confirm(record())).toMatchObject({ ok: true, paidBaseUnits: 1_000n });
  });

  it('refuses another instruction, a second call to the program, or a record without instructions', () => {
    expect(confirm(record([{ ...expected, data: Buffer.from([9]).toString('base64') }]))).toEqual({ ok: false, reason: 'wrong_transaction' });
    expect(confirm(record([{ ...expected, accounts: [...expected.accounts].reverse() }]))).toEqual({ ok: false, reason: 'wrong_transaction' });
    expect(confirm(record([expected, expected]))).toEqual({ ok: false, reason: 'wrong_transaction' });
    const { instructions: _omit, ...bare } = record();
    expect(confirm(bare)).toEqual({ ok: false, reason: 'wrong_transaction' });
  });
});

describe('a session is bound to the lock instance it was opened on', () => {
  const payer = Keypair.generate().publicKey;
  const source = Keypair.generate().publicKey;
  const state = { payer: payer.toBase58(), maxBaseUnits: '20000', createdSlot: '100', cancelWindowSlots: '4500', source: source.toBase58(), claimWindowSlots: '1500' } as SessionState;
  const lock = (over: { createdSlot?: bigint; source?: PublicKey; cancel?: bigint } = {}) => ({
    ok: true as const,
    payer,
    maxBaseUnits: 20_000n,
    createdSlot: over.createdSlot ?? 100n,
    rated: false,
    payout: {} as never,
    terms: { source: over.source ?? source, cancelWindowSlots: over.cancel ?? 4_500n, claimWindowSlots: 1_500n } as never,
  });

  it('matches the same lock and refuses one made again at the same address', () => {
    expect(lockMatchesSession(lock(), state)).toBe(true);
    expect(lockMatchesSession(lock({ createdSlot: 101n }), state)).toBe(false);
    expect(lockMatchesSession(lock({ source: Keypair.generate().publicKey }), state)).toBe(false);
    expect(lockMatchesSession(lock({ cancel: 4_501n }), state)).toBe(false);
  });
});
