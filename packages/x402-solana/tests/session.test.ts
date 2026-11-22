import { pinLaunchRateClock } from './support/launch-clock';
import { createHash } from 'node:crypto';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  DEFAULT_SESSION_IDLE_SECONDS,
  ESCROW_PROTOCOL_TREASURY,
  MemoryNonceReplayStore,
  MeteredSessionLedger,
  meteredEscrowReplayKey,
  providerMeteredTerms,
  readSessionHeaders,
  SELLER_MIN_CANCEL_WINDOW_SLOTS,
  sessionSettlement,
  tokenCostBaseUnits,
  tokenEscrowAddresses,
  treasuryTokenAccount,
  verifyMeteredLock,
  type SessionState,
  type SessionStore,
  type VerifiedLock,
} from '../src';

const PROGRAM = new PublicKey('DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu');
const USDC = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const payee = Keypair.generate().publicKey;
const payer = Keypair.generate().publicKey;
const NONCE = '00112233445566778899aabbccddeeff';
const KEY = Keypair.generate().publicKey.toBase58();
const CURRENT_SLOT = 1_000_000n;
// RAP-SESSION-S1: $2 in / $10 out per million, 0.15 USDC locked.
const terms = providerMeteredTerms({ currency: 'USDC', inputPerMillion: '2', outputPerMillion: '10', maxOutputTokens: 350, programId: PROGRAM, mint: USDC, payee });
const LOCKED = 150_000n;
const escrow = tokenEscrowAddresses({ programId: PROGRAM, payer, nonce: Buffer.from(NONCE, 'hex') }).escrow;
const header = { escrow, payer, nonce: Uint8Array.from(Buffer.from(NONCE, 'hex')) };
const ata = (owner: PublicKey) => treasuryTokenAccount({ mint: USDC, tokenProgram: TOKEN_PROGRAM }, owner);
const CALL = { inputTokens: 1_500, outputTokens: 350 };

function escrowBytes(f: { createdSlot?: bigint; cancel?: bigint; status?: number } = {}): Uint8Array {
  const data = Buffer.alloc(219);
  createHash('sha256').update('account:TokenEscrowAccount').digest().copy(data, 0, 0, 8);
  payer.toBuffer().copy(data, 8);
  payee.toBuffer().copy(data, 40);
  USDC.toBuffer().copy(data, 72);
  ata(payer).toBuffer().copy(data, 104);
  ata(payee).toBuffer().copy(data, 136);
  data.writeBigUInt64LE(LOCKED, 168);
  Buffer.from(NONCE, 'hex').copy(data, 176);
  data[192] = f.status ?? 0;
  data.writeBigUInt64LE(f.createdSlot ?? CURRENT_SLOT - 10n, 193);
  data[201] = 254;
  data[202] = 1;
  data.writeBigUInt64LE(1_500n, 203);
  data.writeBigUInt64LE(f.cancel ?? 9_000n, 211);
  return data;
}
function tokenAccount(owner: PublicKey): Uint8Array {
  const data = Buffer.alloc(165);
  USDC.toBuffer().copy(data, 0);
  owner.toBuffer().copy(data, 32);
  data[108] = 1;
  return data;
}
const accounts = new Map([payee, ESCROW_PROTOCOL_TREASURY, payer].map((o) => [ata(o).toBase58(), { owner: TOKEN_PROGRAM, data: tokenAccount(o) }]));

function verify(purpose: 'call' | 'session-call' | 'session-settle', f: Parameters<typeof escrowBytes>[0] = {}, slot = CURRENT_SLOT, replayStore = new MemoryNonceReplayStore()) {
  return verifyMeteredLock({
    header,
    terms,
    minimum: tokenCostBaseUnits(terms.price, CALL),
    readAccount: async (address) => (address.equals(escrow) ? { owner: PROGRAM, data: escrowBytes(f) } : accounts.get(address.toBase58()) ?? null),
    readSlot: async () => slot,
    replayStore,
    purpose,
  });
}
async function lock(): Promise<Extract<VerifiedLock, { ok: true }>> {
  const verified = await verify('session-call');
  if (!verified.ok) throw new Error(verified.message);
  return verified;
}
async function settleLock(): Promise<Extract<VerifiedLock, { ok: true }>> {
  const verified = await verify('session-settle');
  if (!verified.ok) throw new Error(verified.message);
  return verified;
}
class MemoryStore implements SessionStore {
  saved = new Map<string, SessionState>();
  failNext = false;
  load() { return [...this.saved.values()].map((s) => ({ ...s })); }
  save(state: SessionState) {
    if (this.failNext) { this.failNext = false; throw new Error('disk'); }
    this.saved.set(state.escrow, { ...state });
  }
}

describe('session headers', () => {
  test('reads a call number and close, and refuses anything else', () => {
    const h = (entries: Record<string, string>) => readSessionHeaders({ get: (name) => entries[name] ?? null });
    expect(h({})).toBeUndefined();
    expect(h({ 'x402-session-sequence': '3' })).toEqual({ sequence: 3, close: false });
    expect(h({ 'x402-session-sequence': '3', 'x402-session': 'close' })).toEqual({ sequence: 3, close: true });
    for (const bad of ['0', '-1', '1.5', '01', 'x', '10000000']) expect(h({ 'x402-session-sequence': bad })).toHaveProperty('error');
    expect(h({ 'x402-session': 'close' })).toHaveProperty('error');
    expect(h({ 'x402-session-sequence': '1', 'x402-session': 'open' })).toHaveProperty('error');
  });
});

describe('verifyMeteredLock purposes', () => {
  test('a session call does not claim the escrow, and a closing window has its own reason', async () => {
    const store = new MemoryNonceReplayStore();
    expect((await verify('session-call', {}, CURRENT_SLOT, store)).ok).toBe(true);
    expect((await verify('session-call', {}, CURRENT_SLOT, store)).ok).toBe(true);
    const late = CURRENT_SLOT - 10n + 9_000n - SELLER_MIN_CANCEL_WINDOW_SLOTS + 1n;
    expect(await verify('session-call', {}, late)).toMatchObject({ ok: false, reason: 'session_window_closing' });
    expect(await verify('call', {}, late)).toMatchObject({ ok: false, reason: 'invalid_receipt' });
  });
  test('a session settle skips the window and the replay store, but not the lock checks', async () => {
    const store = new MemoryNonceReplayStore();
    await store.checkAndStore(meteredEscrowReplayKey(escrow));
    expect((await verify('session-settle', {}, CURRENT_SLOT + 20_000n, store)).ok).toBe(true);
    expect(await verify('session-settle', { status: 1 })).toMatchObject({ ok: false, reason: 'duplicate_nonce' });
    const verified = await verify('session-settle');
    expect(verified.ok && verified.createdSlot).toBe(CURRENT_SLOT - 10n);
  });
});

describe('MeteredSessionLedger', () => {
  test('ten calls under one lock settle once for the cumulative cost (RAP-SESSION-S1)', async () => {
    const ledger = new MeteredSessionLedger(terms, new MemoryStore());
    const replayStore = new MemoryNonceReplayStore();
    const l = await lock();
    for (let sequence = 1; sequence <= 10; sequence += 1) {
      const begun = await ledger.begin({ lock: l, escrow, sequence, sessionKey: KEY, worstCase: CALL, replayStore, nowMs: sequence });
      if (!begun.ok) throw new Error(begun.message);
      const recorded = await ledger.record(begun.reservation, CALL, 'h'.repeat(64), sequence);
      expect(recorded.state.sequence).toBe(sequence);
      expect(recorded.state.costBaseUnits).toBe((6_500n * BigInt(sequence)).toString());
    }
    const state = (await ledger.close(escrow))!;
    expect(state.status).toBe('closing');
    const settle = sessionSettlement(terms, await settleLock(), state);
    expect(settle.settlement.chargedBaseUnits).toBe(65_000n);
    expect(settle.settlement.fee).toBe('0.001625');
    expect(settle.settlement.refund).toBe('0.085');
    expect(settle.instructions).toHaveLength(1);
  });

  test('refuses a call whose worst case would pass the lock, and charges nothing more (RAP-SESSION-S2)', async () => {
    const ledger = new MeteredSessionLedger(terms);
    const replayStore = new MemoryNonceReplayStore();
    const l = await lock();
    let sequence = 1;
    for (; sequence <= 23; sequence += 1) {
      const begun = await ledger.begin({ lock: l, escrow, sequence, sessionKey: KEY, worstCase: CALL, replayStore, nowMs: 0 });
      if (!begun.ok) throw new Error(`call ${sequence}: ${begun.message}`);
      await ledger.record(begun.reservation, CALL, undefined, 0);
    }
    // 23 calls cost 149,500; one more could take it to 156,000.
    const refused = await ledger.begin({ lock: l, escrow, sequence, sessionKey: KEY, worstCase: CALL, replayStore, nowMs: 0 });
    expect(refused).toMatchObject({ ok: false, reason: 'session_max_reached' });
    expect(ledger.get(escrow)!.costBaseUnits).toBe('149500');
    // A smaller call still fits.
    expect((await ledger.begin({ lock: l, escrow, sequence, sessionKey: KEY, worstCase: { inputTokens: 100, outputTokens: 10 }, replayStore, nowMs: 0 })).ok).toBe(true);
  });

  test('a call that uses more than its worst case is capped at the lock and fills the session', async () => {
    const ledger = new MeteredSessionLedger(terms);
    const l = await lock();
    const begun = await ledger.begin({ lock: l, escrow, sequence: 1, sessionKey: KEY, worstCase: CALL, replayStore: new MemoryNonceReplayStore(), nowMs: 0 });
    if (!begun.ok) throw new Error();
    const recorded = await ledger.record(begun.reservation, { inputTokens: 100_000, outputTokens: 0 }, undefined, 0);
    expect(recorded.full).toBe(true);
    expect(recorded.state).toMatchObject({ costBaseUnits: '150000', status: 'closing' });
    expect(sessionSettlement(terms, await settleLock(), recorded.state).settlement).toMatchObject({ chargedBaseUnits: 150_000n, capped: true });
  });

  test('refuses a replayed or skipped call number and leaves the ledger unchanged (RAP-SESSION-S3)', async () => {
    const ledger = new MeteredSessionLedger(terms);
    const replayStore = new MemoryNonceReplayStore();
    const l = await lock();
    expect(await ledger.begin({ lock: l, escrow, sequence: 2, sessionKey: KEY, worstCase: CALL, replayStore, nowMs: 0 })).toMatchObject({ ok: false, reason: 'session_sequence_invalid' });
    const first = await ledger.begin({ lock: l, escrow, sequence: 1, sessionKey: KEY, worstCase: CALL, replayStore, nowMs: 0 });
    if (!first.ok) throw new Error();
    expect(await ledger.begin({ lock: l, escrow, sequence: 2, sessionKey: KEY, worstCase: CALL, replayStore, nowMs: 0 })).toMatchObject({ ok: false, reason: 'session_call_in_progress' });
    await ledger.record(first.reservation, CALL, undefined, 0);
    const before = ledger.get(escrow);
    expect(await ledger.begin({ lock: l, escrow, sequence: 1, sessionKey: KEY, worstCase: CALL, replayStore, nowMs: 0 })).toMatchObject({ ok: false, reason: 'session_sequence_invalid' });
    expect(await ledger.begin({ lock: l, escrow, sequence: 3, sessionKey: KEY, worstCase: CALL, replayStore, nowMs: 0 })).toMatchObject({ ok: false, reason: 'session_sequence_invalid' });
    expect(ledger.get(escrow)).toEqual(before);
  });

  test('a session keeps the key it started with: another key cannot go on with it', async () => {
    const ledger = new MeteredSessionLedger(terms, new MemoryStore());
    const replayStore = new MemoryNonceReplayStore();
    const l = await lock();
    const first = await ledger.begin({ lock: l, escrow, sequence: 1, sessionKey: KEY, worstCase: CALL, replayStore, nowMs: 0 });
    if (!first.ok) throw new Error(first.message);
    await ledger.record(first.reservation, CALL, 'h'.repeat(64), 0);
    const other = await ledger.begin({ lock: l, escrow, sequence: 2, sessionKey: Keypair.generate().publicKey.toBase58(), worstCase: CALL, replayStore, nowMs: 0 });
    expect(other.ok).toBe(false);
    expect(!other.ok && other.reason).toBe('session_key_mismatch');
    expect(ledger.get(escrow)!.sequence).toBe(1);
  });

  test('a released call adds nothing and its number is reused', async () => {
    const ledger = new MeteredSessionLedger(terms);
    const replayStore = new MemoryNonceReplayStore();
    const l = await lock();
    const begun = await ledger.begin({ lock: l, escrow, sequence: 1, sessionKey: KEY, worstCase: CALL, replayStore, nowMs: 0 });
    if (!begun.ok) throw new Error();
    ledger.release(begun.reservation);
    expect(ledger.get(escrow)).toMatchObject({ sequence: 0, costBaseUnits: '0' });
    expect((await ledger.begin({ lock: l, escrow, sequence: 1, sessionKey: KEY, worstCase: CALL, replayStore, nowMs: 0 })).ok).toBe(true);
  });

  test('a lock that paid for a single call cannot start a session, nor a session lock pay for a single call', async () => {
    const replayStore = new MemoryNonceReplayStore();
    expect((await verify('call', {}, CURRENT_SLOT, replayStore)).ok).toBe(true);
    const ledger = new MeteredSessionLedger(terms);
    expect(await ledger.begin({ lock: await lock(), escrow, sequence: 1, sessionKey: KEY, worstCase: CALL, replayStore, nowMs: 0 })).toMatchObject({ ok: false, reason: 'duplicate_nonce' });
    const other = new MemoryNonceReplayStore();
    const begun = await new MeteredSessionLedger(terms).begin({ lock: await lock(), escrow, sequence: 1, sessionKey: KEY, worstCase: CALL, replayStore: other, nowMs: 0 });
    expect(begun.ok).toBe(true);
    expect(await verify('call', {}, CURRENT_SLOT, other)).toMatchObject({ ok: false, reason: 'duplicate_nonce' });
  });

  test('a closed or settled session takes no more calls (RAP-SESSION-S4)', async () => {
    const ledger = new MeteredSessionLedger(terms);
    const replayStore = new MemoryNonceReplayStore();
    const l = await lock();
    const begun = await ledger.begin({ lock: l, escrow, sequence: 1, sessionKey: KEY, worstCase: CALL, replayStore, nowMs: 0 });
    if (!begun.ok) throw new Error();
    await ledger.record(begun.reservation, CALL, undefined, 0);
    await ledger.close(escrow);
    expect(await ledger.begin({ lock: l, escrow, sequence: 2, sessionKey: KEY, worstCase: CALL, replayStore, nowMs: 0 })).toMatchObject({ ok: false, reason: 'session_closed' });
    await ledger.finish(escrow.toBase58(), { status: 'settled', signature: 'sig' });
    expect(await ledger.begin({ lock: l, escrow, sequence: 2, sessionKey: KEY, worstCase: CALL, replayStore, nowMs: 0 })).toMatchObject({ ok: false, reason: 'session_closed' });
    expect(ledger.due(10 ** 12, CURRENT_SLOT, 1)).toEqual([]);
  });

  test('is due after the idle timeout or before the refund window opens, never while a call runs (RAP-SESSION-S4)', async () => {
    const ledger = new MeteredSessionLedger(terms);
    const replayStore = new MemoryNonceReplayStore();
    const l = await lock();
    const idle = DEFAULT_SESSION_IDLE_SECONDS * 1_000;
    const begun = await ledger.begin({ lock: l, escrow, sequence: 1, sessionKey: KEY, worstCase: CALL, replayStore, nowMs: 1_000 });
    if (!begun.ok) throw new Error();
    expect(ledger.due(1_000 + idle, CURRENT_SLOT, idle)).toEqual([]);
    await ledger.record(begun.reservation, CALL, undefined, 1_000);
    expect(ledger.due(1_000 + idle - 1, CURRENT_SLOT, idle)).toEqual([]);
    expect(ledger.due(1_000 + idle, CURRENT_SLOT, idle)).toHaveLength(1);
    const refundOpens = CURRENT_SLOT - 10n + 9_000n;
    expect(ledger.due(1_000, refundOpens - SELLER_MIN_CANCEL_WINDOW_SLOTS - 1n, idle)).toEqual([]);
    expect(ledger.due(1_000, refundOpens - SELLER_MIN_CANCEL_WINDOW_SLOTS, idle)).toHaveLength(1);
  });

  test('restores saved sessions after a restart and goes on from the last recorded call (RAP-SESSION-S5)', async () => {
    const store = new MemoryStore();
    const replayStore = new MemoryNonceReplayStore();
    const l = await lock();
    const first = new MeteredSessionLedger(terms, store);
    for (const sequence of [1, 2]) {
      const begun = await first.begin({ lock: l, escrow, sequence, sessionKey: KEY, worstCase: CALL, replayStore, nowMs: 0 });
      if (!begun.ok) throw new Error();
      await first.record(begun.reservation, CALL, `${sequence}`.repeat(64), 0);
    }
    // A third call was running when the process stopped: never recorded.
    const third = await first.begin({ lock: l, escrow, sequence: 3, sessionKey: KEY, worstCase: CALL, replayStore, nowMs: 0 });
    expect(third.ok).toBe(true);
    const second = new MeteredSessionLedger(terms, store);
    expect(await second.restore()).toBe(1);
    expect(second.get(escrow)).toMatchObject({ sequence: 2, costBaseUnits: '13000', lastReceiptHash: '2'.repeat(64) });
    const next = await second.begin({ lock: l, escrow, sequence: 3, sessionKey: KEY, worstCase: CALL, replayStore, nowMs: 0 });
    expect(next.ok).toBe(true);
  });

  test('a call whose record cannot be saved is not recorded', async () => {
    const store = new MemoryStore();
    const ledger = new MeteredSessionLedger(terms, store);
    const replayStore = new MemoryNonceReplayStore();
    const l = await lock();
    const begun = await ledger.begin({ lock: l, escrow, sequence: 1, sessionKey: KEY, worstCase: CALL, replayStore, nowMs: 0 });
    if (!begun.ok) throw new Error();
    store.failNext = true;
    await expect(ledger.record(begun.reservation, CALL, undefined, 0)).rejects.toThrow('disk');
    expect(ledger.get(escrow)).toMatchObject({ sequence: 0, costBaseUnits: '0' });
    expect((await ledger.begin({ lock: l, escrow, sequence: 1, sessionKey: KEY, worstCase: CALL, replayStore, nowMs: 0 })).ok).toBe(true);
  });

  test('a later escrow locked at the session\'s address cannot go on with the session', async () => {
    const ledger = new MeteredSessionLedger(terms);
    const replayStore = new MemoryNonceReplayStore();
    const l = await lock();
    const begun = await ledger.begin({ lock: l, escrow, sequence: 1, sessionKey: KEY, worstCase: CALL, replayStore, nowMs: 0 });
    if (!begun.ok) throw new Error();
    await ledger.record(begun.reservation, CALL, undefined, 0);
    const next = { ...l, createdSlot: l.createdSlot + 5n };
    expect(await ledger.begin({ lock: next, escrow, sequence: 2, sessionKey: KEY, worstCase: CALL, replayStore, nowMs: 0 })).toMatchObject({ ok: false, reason: 'session_lock_mismatch' });
    expect(ledger.get(escrow)).toMatchObject({ sequence: 1 });
    expect((await ledger.begin({ lock: l, escrow, sequence: 2, sessionKey: KEY, worstCase: CALL, replayStore, nowMs: 0 })).ok).toBe(true);
  });

  test('the settle refuses a lock that is not the session’s', async () => {
    const ledger = new MeteredSessionLedger(terms);
    const l = await lock();
    const begun = await ledger.begin({ lock: l, escrow, sequence: 1, sessionKey: KEY, worstCase: CALL, replayStore: new MemoryNonceReplayStore(), nowMs: 0 });
    if (!begun.ok) throw new Error();
    const recorded = await ledger.record(begun.reservation, CALL, undefined, 0);
    expect(() => sessionSettlement(terms, { ...l, maxBaseUnits: 1n }, recorded.state)).toThrow('does not match');
    // A later escrow locked at the same address, with the same payer and maximum, is not this session's.
    expect(() => sessionSettlement(terms, { ...l, createdSlot: l.createdSlot + 5n }, recorded.state)).toThrow('does not match');
    expect(() => sessionSettlement(terms, l, { ...recorded.state, costBaseUnits: '1' })).toThrow('different amount');
  });
});

// Fee terms built from the current time stay at the launch rate after 1 April 2027.
pinLaunchRateClock();
