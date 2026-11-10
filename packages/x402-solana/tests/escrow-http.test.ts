import { Keypair, PublicKey, Transaction, Connection, SystemProgram } from '@solana/web3.js';
import { AccountLayout, MintLayout, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { createHash } from 'node:crypto';
import { createEscrowChallenge, escrowTerms, escrowRequestHash, verifyEscrowLock, EscrowSeller, buyWithEscrow } from '../src/escrow-http';
import { buildLockTokenEscrowInstruction, buildSettleTokenEscrowInstruction, tokenEscrowAddresses, decodeTokenEscrowAccount } from '../src/token-escrow';
const pk = () => Keypair.generate().publicKey;
function fixture() {
  const payer = Keypair.generate();
  const c = createEscrowChallenge({ network: 'solana-local-validator', genesisHash: 'local-genesis', endpoint: 'http://127.0.0.1/analyze',
    requestHash: escrowRequestHash('{}'), programId: pk().toBase58(), payer: payer.publicKey.toBase58(), payee: pk().toBase58(),
    mint: pk().toBase58(), source: pk().toBase58(), recipient: pk().toBase58(), amount: '400000', tokenProgram: TOKEN_PROGRAM_ID.toBase58(), decimals: 6, expiresAt: Date.now() + 60000 });
  const t = escrowTerms(c), addresses = tokenEscrowAddresses(t);
  const state = Buffer.alloc(202);
  createHash('sha256').update('account:TokenEscrowAccount').digest().copy(state, 0, 0, 8);
  [t.payer, t.payee, t.mint, t.source, t.recipient].forEach((p, n) => p.toBuffer().copy(state, 8 + n * 32));
  state.writeBigUInt64LE(t.amount, 168); Buffer.from(t.nonce).copy(state, 176); state.writeBigUInt64LE(100n, 193); state[201] = addresses.bump;
  const vault = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode({ mint: t.mint, owner: addresses.escrow, amount: t.amount, delegateOption: 0, delegate: PublicKey.default,
    state: 1, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default }, vault);
  const mint = Buffer.alloc(MintLayout.span);
  MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: PublicKey.default, supply: t.amount, decimals: 6, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, mint);
  const message = new Transaction({ feePayer: payer.publicKey, recentBlockhash: pk().toBase58() }).add(buildLockTokenEscrowInstruction(t)).compileMessage();
  const tx = { slot: 100, meta: { err: null }, transaction: { message } };
  const rpc = { getGenesisHash: jest.fn(async () => c.genesisHash), getTransaction: jest.fn(async () => tx),
    getAccountInfo: jest.fn(async (key: PublicKey) => ({ data: key.equals(addresses.escrow) ? state : key.equals(t.mint) ? mint : vault,
      owner: key.equals(addresses.escrow) ? t.programId : TOKEN_PROGRAM_ID, executable: false, lamports: 2000000, rentEpoch: 0 })) };
  const proof = { nonce: c.nonce, lockSignature: '2'.repeat(88) };
  return { c, t, state, rpc, proof, tx, addresses };
}
test('finalized exact lock yields a locked receipt, never a correctness or settlement claim', async () => {
  const f = fixture(); const receipt = await verifyEscrowLock(f.rpc as unknown as Connection, f.c, f.proof);
  expect(receipt.status).toBe('locked'); expect(receipt.escrow).toBe(f.addresses.escrow.toBase58());
  expect(f.rpc.getTransaction).toHaveBeenCalledWith(f.proof.lockSignature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
});
test.each([8, 40, 72, 104, 136, 168, 176, 192, 201])('reject changed escrow field at %i', async offset => {
  const f = fixture(); f.state[offset] ^= 1;
  await expect(verifyEscrowLock(f.rpc as unknown as Connection, f.c, f.proof)).rejects.toThrow();
});
test('reject failed or unrelated transaction and wrong genesis', async () => {
  const f = fixture(); f.rpc.getGenesisHash.mockResolvedValueOnce('other');
  await expect(verifyEscrowLock(f.rpc as unknown as Connection, f.c, f.proof)).rejects.toThrow('wrong cluster');
  f.tx.transaction.message = new Transaction({ feePayer: f.t.payer, recentBlockhash: pk().toBase58() }).add(SystemProgram.transfer({ fromPubkey: f.t.payer, toPubkey: f.t.payee, lamports: 1 })).compileMessage();
  await expect(verifyEscrowLock(f.rpc as unknown as Connection, f.c, f.proof)).rejects.toThrow('does not prove');
});
test('reject closed record, wrong owner, insufficient vault and wrong decimals', async () => {
  for (const kind of ['closed', 'owner', 'amount', 'decimals']) {
    const f = fixture(), original = f.rpc.getAccountInfo.getMockImplementation()!;
    f.rpc.getAccountInfo.mockImplementation(async key => {
      const info = await original(key);
      if (key.equals(f.addresses.escrow) && kind === 'closed') return null as any;
      if (key.equals(f.addresses.escrow) && kind === 'owner') info.owner = pk();
      if (key.equals(f.addresses.vault) && kind === 'amount') info.data.writeBigUInt64LE(1n, 64);
      if (key.equals(f.t.mint) && kind === 'decimals') info.data[44] = 9;
      return info;
    });
    await expect(verifyEscrowLock(f.rpc as unknown as Connection, f.c, f.proof)).rejects.toThrow();
  }
});
test('server stores authoritative terms, binds request and rejects concurrent/repeated redemption', async () => {
  const f = fixture(), seller = new EscrowSeller(f.rpc as unknown as Connection);
  const c = seller.issue(f.c);
  // Encode newly issued random nonce in on-chain fixture and transaction.
  const t = escrowTerms(c); Buffer.from(t.nonce).copy(f.state, 176); f.state[201] = tokenEscrowAddresses(t).bump;
  f.tx.transaction.message = new Transaction({ feePayer: t.payer, recentBlockhash: pk().toBase58() }).add(buildLockTokenEscrowInstruction(t)).compileMessage();
  const original = f.rpc.getAccountInfo.getMockImplementation()!;
  f.rpc.getAccountInfo.mockImplementation(async key => original(key.equals(tokenEscrowAddresses(t).escrow) ? f.addresses.escrow : key));
  // Vault authority also must match this new escrow.
  const original2 = f.rpc.getAccountInfo.getMockImplementation()!;
  f.rpc.getAccountInfo.mockImplementation(async key => { const info = await original2(key); if (key.equals(tokenEscrowAddresses(t).vault)) tokenEscrowAddresses(t).escrow.toBuffer().copy(info.data, 32); return info; });
  const proof = { ...f.proof, nonce: c.nonce };
  await expect(seller.accept(c.endpoint, 'changed', proof)).rejects.toThrow('mismatched');
  const first = seller.accept(c.endpoint, '{}', proof);
  await expect(seller.accept(c.endpoint, '{}', proof)).rejects.toThrow('replayed');
  await expect(first).resolves.toMatchObject({ status: 'locked' });
  await expect(seller.accept(c.endpoint, '{}', proof)).rejects.toThrow('replayed');
});
test('strict raw u64, classic program and nonce boundaries; settlement selects recorded destination', () => {
  const f = fixture();
  expect(() => escrowTerms({ ...f.c, amount: '18446744073709551616' })).toThrow();
  expect(() => escrowTerms({ ...f.c, tokenProgram: pk().toBase58() })).toThrow('classic');
  expect(() => escrowTerms({ ...f.c, nonce: 'z'.repeat(32) })).toThrow();
  expect(buildSettleTokenEscrowInstruction(f.t).keys[4].pubkey.equals(f.t.recipient)).toBe(true);
  expect(buildSettleTokenEscrowInstruction(f.t, true).keys[4].pubkey.equals(f.t.source)).toBe(true);
  expect(decodeTokenEscrowAccount(f.state).createdSlot).toBe(100n);
});
test('buyer requires approval before lock; rejects challenge substitution without spending', async () => {
  const f = fixture(), lock = jest.fn(), approve = jest.fn(async () => { throw new Error('cap exceeded'); });
  const request = jest.fn(async () => ({ status: 402, headers: { get: () => JSON.stringify(f.c) }, json: async () => ({}) }));
  await expect(buyWithEscrow({ endpoint: f.c.endpoint, body: '{}', request, lock, approve })).rejects.toThrow('cap exceeded');
  expect(lock).not.toHaveBeenCalled();
  await expect(buyWithEscrow({ endpoint: f.c.endpoint, body: 'other', request, lock, approve })).rejects.toThrow('mismatch');
});
test('expired proof and failed transaction fail closed', async () => {
  const f = fixture();
  await expect(verifyEscrowLock(f.rpc as unknown as Connection, { ...f.c, expiresAt: 1 }, f.proof)).rejects.toThrow('expired');
  f.tx.meta.err = { InstructionError: [0, 'failed'] } as any;
  await expect(verifyEscrowLock(f.rpc as unknown as Connection, f.c, f.proof)).rejects.toThrow('failed');
});
test('paid retry transport failure preserves proof and never locks twice', async () => {
  const f = fixture(), lock = jest.fn(async () => f.proof.lockSignature);
  const request = jest.fn().mockResolvedValueOnce({ status: 402, headers: { get: () => JSON.stringify(f.c) } }).mockRejectedValueOnce(new Error('transport lost'));
  await expect(buyWithEscrow({ endpoint: f.c.endpoint, body: '{}', request, approve: async () => {}, lock })).rejects.toMatchObject({ name: 'EscrowPurchaseError', challenge: f.c, proof: f.proof });
  expect(lock).toHaveBeenCalledTimes(1); expect(request).toHaveBeenCalledTimes(2);
});
