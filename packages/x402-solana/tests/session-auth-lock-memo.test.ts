import { sign as edSign, createPrivateKey } from 'node:crypto';
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import {
  lockBoundDelegationHeaderValue,
  MEMO_PROGRAM_ID,
  SESSION_DELEGATION_HEADER,
  SESSION_SIGNATURE_HEADER,
  sessionDelegationHeaderValue,
  sessionDelegationMemo,
  sessionDelegationMemoInstruction,
  sessionSignatureHeaderValue,
  transactionFactsReader,
  verifyPaidCallRequestWithTransactions,
  verifySessionRequest,
  verifySessionRequestWithTransactions,
  type ConfirmedTransactionFacts,
  type SessionDelegation,
} from '../src';

const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const signer = (k: Keypair) => (message: Uint8Array) => new Uint8Array(edSign(null, Buffer.from(message), createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(k.secretKey.subarray(0, 32))]), format: 'der', type: 'pkcs8' })));

const payer = Keypair.generate();
const relayKey = Keypair.generate();
const provider = Keypair.generate().publicKey;
const escrow = Keypair.generate().publicKey;
const NOW = 1_800_000_000_000;
const BODY = JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] });
const LOCK_SIG = '5'.repeat(88);
const d = (over: Partial<SessionDelegation> = {}): SessionDelegation => ({ escrow: escrow.toBase58(), provider: provider.toBase58(), sessionKey: relayKey.publicKey.toBase58(), expiresAt: NOW / 1000 + 600, ...over });

const goodFacts = (over: Partial<ConfirmedTransactionFacts> = {}, delegation = d()): ConfirmedTransactionFacts => ({
  failed: false,
  signers: [payer.publicKey.toBase58()],
  accounts: [payer.publicKey.toBase58(), escrow.toBase58(), MEMO_PROGRAM_ID.toBase58()],
  memos: [{ text: sessionDelegationMemo(delegation), accounts: [payer.publicKey.toBase58()] }],
  ...over,
});

async function headers(delegation = d(), key = relayKey, body = BODY) {
  const map = new Map<string, string>([
    [SESSION_DELEGATION_HEADER, lockBoundDelegationHeaderValue(delegation, LOCK_SIG)],
    [SESSION_SIGNATURE_HEADER, await sessionSignatureHeaderValue({ action: 'single', escrow: escrow.toBase58(), sequence: 0, body }, signer(key))],
  ]);
  return { get: (name: string) => map.get(name) ?? null };
}

const check = (h: { get(n: string): string | null }, facts: ConfirmedTransactionFacts | null | 'throw' | undefined, over: { body?: string; payerKey?: PublicKey } = {}) =>
  verifyPaidCallRequestWithTransactions({
    headers: h,
    escrow,
    payer: over.payerKey ?? payer.publicKey,
    provider,
    body: over.body ?? BODY,
    nowMs: NOW,
    ...(facts === undefined ? {} : { readTransaction: async () => { if (facts === 'throw') throw new Error('rpc'); return facts; } }),
  });

describe('lock-bound session delegation (Solana Pay transaction requests)', () => {
  test('accepts a call whose delegation memo the payer signed in the lock transaction', async () => {
    expect(await check(await headers(), goodFacts())).toEqual({ ok: true, sessionKey: relayKey.publicKey.toBase58(), expiresAt: NOW / 1000 + 600 });
  });

  test('the memo binds escrow, provider, key and expiry', () => {
    const memos = [d(), d({ escrow: provider.toBase58() }), d({ provider: escrow.toBase58() }), d({ sessionKey: payer.publicKey.toBase58() }), d({ expiresAt: NOW / 1000 + 601 })].map(sessionDelegationMemo);
    expect(new Set(memos).size).toBe(5);
    expect(memos[0]).toMatch(/^reddi-session\/1 delegate [0-9a-f]{64}$/);
  });

  test('the memo instruction makes the payer a required signer of the Memo program', () => {
    const ix = sessionDelegationMemoInstruction(d(), payer.publicKey);
    expect(ix.programId.equals(MEMO_PROGRAM_ID)).toBe(true);
    expect(ix.keys).toEqual([{ pubkey: payer.publicKey, isSigner: true, isWritable: false }]);
    expect(ix.data.toString('utf8')).toBe(sessionDelegationMemo(d()));
  });

  test('the synchronous check refuses a lock-bound delegation instead of trusting it', async () => {
    const result = verifySessionRequest({ headers: await headers(), action: 'single', escrow, payer: payer.publicKey, provider, sequence: 0, body: BODY, nowMs: NOW });
    expect(!result.ok && result.reason).toBe('session_auth_invalid');
  });

  test('refuses when the provider has no transaction reader', async () => {
    const result = await check(await headers(), undefined);
    expect(!result.ok && result.reason).toBe('session_auth_invalid');
  });

  test.each([
    ['not confirmed', null],
    ['failed', goodFacts({ failed: true })],
    ['not signed by the payer', goodFacts({ signers: [Keypair.generate().publicKey.toBase58()] })],
    ['another escrow', goodFacts({ accounts: [payer.publicKey.toBase58()] })],
    ['no memo', goodFacts({ memos: [] })],
    ['memo for another delegation', goodFacts({}, d({ sessionKey: Keypair.generate().publicKey.toBase58() }))],
    ['memo not naming the payer', goodFacts({ memos: [{ text: sessionDelegationMemo(d()), accounts: [] }] })],
  ])('refuses a lock transaction that is %s', async (_label, facts) => {
    const result = await check(await headers(), facts as ConfirmedTransactionFacts | null);
    expect(!result.ok && result.reason).toBe('session_auth_invalid');
  });

  test('refuses another payer, a changed body or another signing key', async () => {
    for (const result of [
      await check(await headers(), goodFacts(), { payerKey: Keypair.generate().publicKey }),
      await check(await headers(), goodFacts(), { body: BODY + ' ' }),
      await check(await headers(d(), Keypair.generate()), goodFacts()),
    ]) expect(!result.ok && result.reason).toBe('session_auth_invalid');
  });

  test('an unreadable chain is not a refusal of the buyer', async () => {
    const result = await check(await headers(), 'throw');
    expect(!result.ok && result.reason).toBe('payment_check_unavailable');
  });

  test('a delegation may not carry both proofs', async () => {
    const both = Buffer.from(JSON.stringify({ ...d(), lockSignature: LOCK_SIG, signature: Buffer.alloc(64).toString('base64') })).toString('base64');
    const h = await headers();
    const result = await check({ get: (n: string) => (n === SESSION_DELEGATION_HEADER ? both : h.get(n)) }, goodFacts());
    expect(!result.ok && result.reason).toBe('session_auth_invalid');
  });

  test('wallet-signed delegations still pass through the async check', async () => {
    const map = new Map<string, string>([
      [SESSION_DELEGATION_HEADER, await sessionDelegationHeaderValue(d(), signer(payer))],
      [SESSION_SIGNATURE_HEADER, await sessionSignatureHeaderValue({ action: 'call', escrow: escrow.toBase58(), sequence: 3, body: BODY }, signer(relayKey))],
    ]);
    const result = await verifySessionRequestWithTransactions({ headers: { get: (n) => map.get(n) ?? null }, action: 'call', sequence: 3, escrow, payer: payer.publicKey, provider, body: BODY, nowMs: NOW });
    expect(result.ok).toBe(true);
  });

  test('transactionFactsReader reads signers, accounts and memos from a v0 and a legacy transaction', async () => {
    const ixs = [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: escrow, lamports: 1 }), sessionDelegationMemoInstruction(d(), payer.publicKey)];
    const blockhash = PublicKey.default.toBase58();
    const v0 = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
    const legacy = new Transaction({ feePayer: payer.publicKey, recentBlockhash: blockhash }).add(...ixs);
    const legacyMessage = legacy.compileMessage();
    for (const message of [v0.message, legacyMessage]) {
      const read = transactionFactsReader({ getTransaction: async () => ({ meta: { err: null }, transaction: { message } }) });
      const facts = await read(LOCK_SIG);
      expect(facts).not.toBeNull();
      expect(facts!.signers).toEqual([payer.publicKey.toBase58()]);
      expect(facts!.accounts).toContain(escrow.toBase58());
      expect(facts!.memos).toEqual([{ text: sessionDelegationMemo(d()), accounts: [payer.publicKey.toBase58()] }]);
      expect(await check(await headers(), facts)).toMatchObject({ ok: true });
    }
    const failed = await transactionFactsReader({ getTransaction: async () => ({ meta: { err: { InstructionError: [0, 'x'] } }, transaction: { message: v0.message } }) })(LOCK_SIG);
    expect(failed!.failed).toBe(true);
    expect(await transactionFactsReader({ getTransaction: async () => null })(LOCK_SIG)).toBeNull();
  });
});
