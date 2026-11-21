import { sign as edSign, createPrivateKey } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import {
  DEFAULT_DELEGATION_SECONDS,
  delegationExpiresAt,
  MAX_SESSION_DELEGATION_SECONDS,
  paidCallAuthHeaders,
  verifyPaidCallRequest,
  SESSION_DELEGATION_HEADER,
  SESSION_SIGNATURE_HEADER,
  sessionDelegationHeaderValue,
  sessionDelegationMessage,
  sessionSignatureHeaderValue,
  verifySessionRequest,
  type SessionDelegation,
} from '../src';

const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const signer = (k: Keypair) => (message: Uint8Array) => new Uint8Array(edSign(null, Buffer.from(message), createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(k.secretKey.subarray(0, 32))]), format: 'der', type: 'pkcs8' })));

const payer = Keypair.generate();
const sessionKey = Keypair.generate();
const provider = Keypair.generate().publicKey;
const escrow = Keypair.generate().publicKey;
const NOW = 1_800_000_000_000;
const BODY = JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] });

const delegation = (over: Partial<SessionDelegation> = {}): SessionDelegation => ({ escrow: escrow.toBase58(), provider: provider.toBase58(), sessionKey: sessionKey.publicKey.toBase58(), expiresAt: NOW / 1000 + 3600, ...over });

async function headers(input: { d?: SessionDelegation; payerKey?: Keypair; key?: Keypair; action?: 'call' | 'close' | 'read'; sequence?: number; body?: string } = {}) {
  const map = new Map<string, string>([
    [SESSION_DELEGATION_HEADER, await sessionDelegationHeaderValue(input.d ?? delegation(), signer(input.payerKey ?? payer))],
    [SESSION_SIGNATURE_HEADER, await sessionSignatureHeaderValue({ action: input.action ?? 'call', escrow: escrow.toBase58(), sequence: input.sequence ?? 1, body: input.body ?? BODY }, signer(input.key ?? sessionKey))],
  ]);
  return { get: (name: string) => map.get(name) ?? null, map };
}

const check = (h: { get(name: string): string | null }, over: { action?: 'call' | 'close' | 'read'; sequence?: number; body?: string; nowMs?: number } = {}) =>
  verifySessionRequest({ headers: h, action: over.action ?? 'call', escrow, payer: payer.publicKey, provider, sequence: over.sequence ?? 1, body: over.body ?? BODY, nowMs: over.nowMs ?? NOW });

describe('session request signatures (security review S-1)', () => {
  test('accepts a call signed by a session key the payer delegated to', async () => {
    const result = check(await headers());
    expect(result).toEqual({ ok: true, sessionKey: sessionKey.publicKey.toBase58(), expiresAt: NOW / 1000 + 3600 });
  });

  test('the delegation is plain text a wallet can show', () => {
    expect(sessionDelegationMessage(delegation())).toContain(`escrow: ${escrow.toBase58()}`);
  });

  test('refuses a request without the headers', () => {
    const result = check({ get: () => null });
    expect(!result.ok && result.reason).toBe('session_auth_required');
  });

  test('refuses someone who knows the public lock but is not the payer', async () => {
    const result = check(await headers({ payerKey: Keypair.generate() }));
    expect(!result.ok && result.reason).toBe('session_auth_invalid');
  });

  test('refuses a request signed by another key, a changed body, another call number or another action', async () => {
    for (const result of [
      check(await headers({ key: Keypair.generate() })),
      check(await headers(), { body: BODY + ' ' }),
      check(await headers(), { sequence: 2 }),
      check(await headers({ action: 'read', sequence: 0 }), { action: 'close', sequence: 0 }),
    ]) expect(!result.ok && result.reason).toBe('session_auth_invalid');
  });

  test('refuses a delegation for another escrow or provider', async () => {
    for (const d of [delegation({ escrow: Keypair.generate().publicKey.toBase58() }), delegation({ provider: Keypair.generate().publicKey.toBase58() })]) {
      const result = check(await headers({ d }));
      expect(!result.ok && result.reason).toBe('session_auth_invalid');
    }
  });

  test('refuses an expired delegation and one that runs too long', async () => {
    const expired = check(await headers(), { nowMs: NOW + 3600_000 });
    expect(!expired.ok && expired.reason).toBe('session_auth_expired');
    const long = check(await headers({ d: delegation({ expiresAt: NOW / 1000 + MAX_SESSION_DELEGATION_SECONDS + 1 }) }));
    expect(!long.ok && long.reason).toBe('session_auth_invalid');
  });

  test('refuses malformed headers without throwing', () => {
    for (const [d, s] of [['%%%', 'AA=='], [Buffer.from('[1]').toString('base64'), 'AA=='], [Buffer.from('{"escrow":1}').toString('base64'), 'AA==']]) {
      const result = check({ get: (name: string) => (name === SESSION_DELEGATION_HEADER ? d : s) });
      expect(!result.ok && result.reason).toBe('session_auth_invalid');
    }
  });
});

describe('single metered call signatures (#866)', () => {
  const singleCheck = (h: { get(name: string): string | null }, body = BODY) =>
    verifyPaidCallRequest({ headers: h, escrow, payer: payer.publicKey, provider, body, nowMs: NOW });
  const asHeaders = (r: Record<string, string>) => ({ get: (name: string) => r[name] ?? null });

  test('accepts a call the payer signed directly, or through a fresh key', async () => {
    const direct = await paidCallAuthHeaders({ escrow: escrow.toBase58(), provider: provider.toBase58(), body: BODY, payer: payer.publicKey.toBase58(), signWithPayer: signer(payer), nowMs: NOW });
    expect(singleCheck(asHeaders(direct)).ok).toBe(true);
    const viaKey = await paidCallAuthHeaders({ escrow: escrow.toBase58(), provider: provider.toBase58(), body: BODY, payer: payer.publicKey.toBase58(), signWithPayer: signer(payer), sessionKey: { publicKey: sessionKey.publicKey.toBase58(), sign: signer(sessionKey) }, nowMs: NOW });
    expect(singleCheck(asHeaders(viaKey)).ok).toBe(true);
  });

  test('refuses a stranger, a changed body, and a session call presented as a single call', async () => {
    const stranger = Keypair.generate();
    const theirs = await paidCallAuthHeaders({ escrow: escrow.toBase58(), provider: provider.toBase58(), body: BODY, payer: stranger.publicKey.toBase58(), signWithPayer: signer(stranger), nowMs: NOW });
    expect(singleCheck(asHeaders(theirs)).ok).toBe(false);
    const mine = await paidCallAuthHeaders({ escrow: escrow.toBase58(), provider: provider.toBase58(), body: BODY, payer: payer.publicKey.toBase58(), signWithPayer: signer(payer), nowMs: NOW });
    expect(singleCheck(asHeaders(mine), BODY + ' ').ok).toBe(false);
    const sessionCall = await headers({ action: 'call', sequence: 0 });
    expect(singleCheck(sessionCall).ok).toBe(false);
  });
});

describe('delegation expiry default', () => {
  it('defaults to a day and refuses anything past the maximum', () => {
    expect(DEFAULT_DELEGATION_SECONDS).toBe(86_400);
    expect(delegationExpiresAt(1_000_000_500)).toBe(1_000_000 + 86_400);
    expect(delegationExpiresAt(0, 3600)).toBe(3600);
    for (const bad of [0, -1, 1.5, MAX_SESSION_DELEGATION_SECONDS + 1]) expect(() => delegationExpiresAt(0, bad)).toThrow();
  });
});
