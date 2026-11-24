import { Keypair, PublicKey, Transaction, Connection, SystemProgram, type AccountInfo, type TransactionError } from '@solana/web3.js';
import { AccountLayout, MintLayout, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { createHash } from 'node:crypto';
import { createEscrowChallenge, escrowTerms, escrowRequestHash, verifyEscrowLock, EscrowSeller, buyWithEscrow, buildEscrowSellerExit } from '../src/escrow-http';
import { ratingPda } from '../src/rating';
import { buildLockTokenEscrowInstruction, buildSettleTokenEscrowInstruction, tokenEscrowAddresses, decodeTokenEscrowAccount, treasuryTokenAccount,
  DEFAULT_CANCEL_WINDOW_SLOTS, DEFAULT_CLAIM_WINDOW_SLOTS, MAX_ESCROW_WINDOW_SLOTS, escrowWindowSlots, escrowWindows } from '../src/token-escrow';
const pk = () => Keypair.generate().publicKey;
function fixture() {
  const payer = Keypair.generate();
  const c = createEscrowChallenge({ network: 'solana-local-validator', genesisHash: 'local-genesis', endpoint: 'http://127.0.0.1/analyze',
    requestHash: escrowRequestHash('{}'), programId: pk().toBase58(), payer: payer.publicKey.toBase58(), payee: pk().toBase58(),
    mint: pk().toBase58(), source: pk().toBase58(), recipient: pk().toBase58(), amount: '400000', tokenProgram: TOKEN_PROGRAM_ID.toBase58(), decimals: 6, expiresAt: Date.now() + 60000 });
  const t = escrowTerms(c), addresses = tokenEscrowAddresses(t);
  const state = Buffer.alloc(219);
  createHash('sha256').update('account:TokenEscrowAccount').digest().copy(state, 0, 0, 8);
  [t.payer, t.payee, t.mint, t.source, t.recipient].forEach((p, n) => p.toBuffer().copy(state, 8 + n * 32));
  state.writeBigUInt64LE(t.amount, 168); Buffer.from(t.nonce).copy(state, 176); state.writeBigUInt64LE(100n, 193); state[201] = addresses.bump;
  state.writeBigUInt64LE(DEFAULT_CLAIM_WINDOW_SLOTS, 203); state.writeBigUInt64LE(DEFAULT_CANCEL_WINDOW_SLOTS, 211);
  const vault = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode({ mint: t.mint, owner: addresses.escrow, amount: t.amount, delegateOption: 0, delegate: PublicKey.default,
    state: 1, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default }, vault);
  const mint = Buffer.alloc(MintLayout.span);
  MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: PublicKey.default, supply: t.amount, decimals: 6, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, mint);
  const message = new Transaction({ feePayer: payer.publicKey, recentBlockhash: pk().toBase58() }).add(buildLockTokenEscrowInstruction(t)).compileMessage();
  const tx = { slot: 100, meta: { err: null as TransactionError | null }, transaction: { message } };
  // The escrow's rating account, awaiting settlement, opened in the lock's slot (read only for a rated escrow).
  const ratingAddress = ratingPda(addresses.escrow, t.programId);
  const rating = Buffer.alloc(270);
  createHash('sha256').update('account:RatingAccount').digest().copy(rating, 0, 0, 8);
  addresses.escrow.toBuffer().copy(rating, 8); t.payer.toBuffer().copy(rating, 40); t.payee.toBuffer().copy(rating, 72);
  rating.writeBigUInt64LE(100n, 240);
  const rpc = { getGenesisHash: jest.fn(async () => c.genesisHash), getTransaction: jest.fn(async () => tx),
    getAccountInfo: jest.fn(async (key: PublicKey): Promise<AccountInfo<Buffer> | null> => ({ data: key.equals(addresses.escrow) ? state : key.equals(ratingAddress) ? rating : key.equals(t.mint) ? mint : vault,
      owner: key.equals(addresses.escrow) || key.equals(ratingAddress) ? t.programId : TOKEN_PROGRAM_ID, executable: false, lamports: 2000000, rentEpoch: 0 })) };
  const proof = { nonce: c.nonce, lockSignature: '2'.repeat(88) };
  return { c, t, state, rating, rpc, proof, tx, addresses };
}
test('finalized exact lock yields a locked receipt, never a correctness or settlement claim', async () => {
  const f = fixture(); const receipt = await verifyEscrowLock(f.rpc as unknown as Connection, f.c, f.proof);
  expect(receipt.status).toBe('locked'); expect(receipt.escrow).toBe(f.addresses.escrow.toBase58());
  expect(f.rpc.getTransaction).toHaveBeenCalledWith(f.proof.lockSignature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
});
test.each([[8, 'wrong escrow payer'], [40, 'wrong escrow payee'], [72, 'wrong escrow mint'], [104, 'wrong escrow source'], [136, 'wrong escrow recipient'],
  [168, 'escrow terms mismatch'], [176, 'escrow terms mismatch'], [192, 'escrow terms mismatch'], [201, 'escrow terms mismatch'],
  [203, 'escrow windows mismatch'], [211, 'escrow windows mismatch']] as const)(
  'reject changed escrow field at %i with %s', async (offset, message) => {
    const f = fixture(); f.state[offset] ^= 1;
    await expect(verifyEscrowLock(f.rpc as unknown as Connection, f.c, f.proof)).rejects.toThrow(message);
  });
test('reject failed or unrelated transaction and wrong genesis', async () => {
  const f = fixture(); f.rpc.getGenesisHash.mockResolvedValueOnce('other');
  await expect(verifyEscrowLock(f.rpc as unknown as Connection, f.c, f.proof)).rejects.toThrow('wrong cluster');
  f.tx.transaction.message = new Transaction({ feePayer: f.t.payer, recentBlockhash: pk().toBase58() }).add(SystemProgram.transfer({ fromPubkey: f.t.payer, toPubkey: f.t.payee, lamports: 1 })).compileMessage();
  await expect(verifyEscrowLock(f.rpc as unknown as Connection, f.c, f.proof)).rejects.toThrow('does not prove');
});
test('reject closed record, wrong owner, insufficient vault and wrong decimals', async () => {
  for (const [kind, message] of [['closed', 'escrow missing or wrong owner'], ['owner', 'escrow missing or wrong owner'], ['amount', 'vault mismatch'], ['decimals', 'mint decimals mismatch']]) {
    const f = fixture(), original = f.rpc.getAccountInfo.getMockImplementation()!;
    f.rpc.getAccountInfo.mockImplementation(async key => {
      const info = (await original(key))!;
      if (key.equals(f.addresses.escrow) && kind === 'closed') return null;
      if (key.equals(f.addresses.escrow) && kind === 'owner') info.owner = pk();
      if (key.equals(f.addresses.vault) && kind === 'amount') info.data.writeBigUInt64LE(1n, 64);
      if (key.equals(f.t.mint) && kind === 'decimals') info.data[44] = 9;
      return info;
    });
    await expect(verifyEscrowLock(f.rpc as unknown as Connection, f.c, f.proof)).rejects.toThrow(message);
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
  f.rpc.getAccountInfo.mockImplementation(async key => { const info = (await original2(key))!; if (key.equals(tokenEscrowAddresses(t).vault)) tokenEscrowAddresses(t).escrow.toBuffer().copy(info.data, 32); return info; });
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
  const release = buildSettleTokenEscrowInstruction(f.t);
  expect(release.keys).toHaveLength(9);
  // Fee to the treasury's token account, anything unused back to the recorded source.
  expect(release.keys[6].pubkey.equals(treasuryTokenAccount(f.t))).toBe(true);
  expect(release.keys[7].pubkey.equals(f.t.source)).toBe(true);
  const settle = buildSettleTokenEscrowInstruction(f.t, false, f.t.payee, { actual: 123n });
  expect(settle.data.subarray(8).readBigUInt64LE()).toBe(123n);
  expect(settle.data.subarray(0, 8).equals(createHash('sha256').update('global:settle_token_escrow').digest().subarray(0, 8))).toBe(true);
  expect(() => buildSettleTokenEscrowInstruction(f.t, false, f.t.payee, { actual: 0n })).toThrow('at most the locked amount');
  expect(() => buildSettleTokenEscrowInstruction(f.t, false, f.t.payee, { actual: f.t.amount + 1n })).toThrow('at most the locked amount');
  expect(() => buildSettleTokenEscrowInstruction(f.t, true, f.t.payee, { actual: 1n })).toThrow('no settled amount');
  // Only the payee settles; the payer is the default authority, so it must be named.
  expect(() => buildSettleTokenEscrowInstruction(f.t, false, undefined, { actual: 123n })).toThrow('only the payee settles');
  expect(() => buildSettleTokenEscrowInstruction(f.t, false, f.t.payer, { actual: f.t.amount })).toThrow('only the payee settles');
  const meteredLock = buildLockTokenEscrowInstruction({ ...f.t, metered: true });
  expect(meteredLock.data.subarray(0, 8).equals(createHash('sha256').update('global:lock_metered_token_escrow').digest().subarray(0, 8))).toBe(true);
  expect(release.keys[2]).toMatchObject({ isSigner: true, isWritable: false });
  expect(release.keys[2].pubkey.equals(f.t.payer)).toBe(true);
  expect(release.keys[5].pubkey.equals(f.t.recipient)).toBe(true);
  const claim = buildSettleTokenEscrowInstruction(f.t, false, f.t.payee);
  expect(claim.keys[2].pubkey.equals(f.t.payee)).toBe(true);
  expect(claim.keys[5].pubkey.equals(f.t.recipient)).toBe(true);
  // The payee may be paid at another of its own token accounts; the payer cannot choose one for it.
  const other = pk();
  expect(buildSettleTokenEscrowInstruction(f.t, false, f.t.payee, { payTo: other }).keys[5].pubkey.equals(other)).toBe(true);
  expect(buildSettleTokenEscrowInstruction(f.t, false, f.t.payee, { actual: 5n, payTo: other }).keys[5].pubkey.equals(other)).toBe(true);
  expect(() => buildSettleTokenEscrowInstruction(f.t, false, f.t.payer, { payTo: other })).toThrow('only the payee chooses');
  expect(() => buildSettleTokenEscrowInstruction(f.t, true, f.t.payee, { payTo: other })).toThrow('goes to the payer');
  // The mint is read-only unless withheld fees are to be harvested, on a payout or a refund.
  expect(release.keys[4]).toMatchObject({ isWritable: false, isSigner: false });
  expect(buildSettleTokenEscrowInstruction(f.t, false, f.t.payer, { harvestWithheldFees: true }).keys[4]).toMatchObject({ pubkey: f.t.mint, isWritable: true });
  expect(buildSettleTokenEscrowInstruction(f.t, true, f.t.payee, { harvestWithheldFees: true }).keys[4]).toMatchObject({ pubkey: f.t.mint, isWritable: true });
  expect(buildSettleTokenEscrowInstruction(f.t, true, f.t.payee).keys[4].isWritable).toBe(false);
  const refund = buildSettleTokenEscrowInstruction(f.t, true);
  expect(refund.keys).toHaveLength(7);
  expect(refund.keys[2]).toMatchObject({ isSigner: true, isWritable: false });
  expect(refund.keys[2].pubkey.equals(f.t.payer)).toBe(true);
  expect(refund.keys[3]).toMatchObject({ isSigner: false, isWritable: true });
  expect(refund.keys[3].pubkey.equals(f.t.payer)).toBe(true);
  expect(refund.keys[5].pubkey.equals(f.t.source)).toBe(true);
  const declined = buildSettleTokenEscrowInstruction(f.t, true, f.t.payee);
  expect(declined.keys[2].pubkey.equals(f.t.payee)).toBe(true);
  expect(declined.keys[3].pubkey.equals(f.t.payer)).toBe(true);
  expect(decodeTokenEscrowAccount(f.state).createdSlot).toBe(100n);
  expect(decodeTokenEscrowAccount(f.state).metered).toBe(false);
});
test('a lock names both windows in slots, with defaults, and refuses windows outside the program rule', () => {
  const f = fixture();
  const lock = buildLockTokenEscrowInstruction(f.t);
  expect(lock.data).toHaveLength(48);
  expect([lock.data.readBigUInt64LE(32), lock.data.readBigUInt64LE(40)]).toEqual([DEFAULT_CLAIM_WINDOW_SLOTS, DEFAULT_CANCEL_WINDOW_SLOTS]);
  expect([DEFAULT_CLAIM_WINDOW_SLOTS, DEFAULT_CANCEL_WINDOW_SLOTS, MAX_ESCROW_WINDOW_SLOTS]).toEqual([1_500n, 4_500n, 6_480_000n]);
  const quick = buildLockTokenEscrowInstruction({ ...f.t, claimWindowSlots: escrowWindowSlots(10), cancelWindowSlots: escrowWindowSlots(60) });
  expect([quick.data.readBigUInt64LE(32), quick.data.readBigUInt64LE(40)]).toEqual([25n, 150n]);
  expect(escrowWindowSlots(0.5)).toBe(2n);
  expect(() => escrowWindowSlots(0)).toThrow('positive');
  // One named window is checked against the other's default.
  expect(escrowWindows({ claimWindowSlots: 4_500n })).toEqual({ claimWindowSlots: 4_500n, cancelWindowSlots: 4_500n });
  for (const windows of [{ claimWindowSlots: 0n }, { claimWindowSlots: 4_501n }, { claimWindowSlots: 11n, cancelWindowSlots: 10n },
    { cancelWindowSlots: MAX_ESCROW_WINDOW_SLOTS + 1n }, { cancelWindowSlots: 1_499n }]) {
    expect(() => buildLockTokenEscrowInstruction({ ...f.t, ...windows })).toThrow('refund window');
  }
  expect(decodeTokenEscrowAccount(f.state)).toMatchObject({ claimWindowSlots: DEFAULT_CLAIM_WINDOW_SLOTS, cancelWindowSlots: DEFAULT_CANCEL_WINDOW_SLOTS });
  // An account the earlier program wrote has no windows and still decodes.
  const legacy = decodeTokenEscrowAccount(f.state.subarray(0, 203));
  expect(legacy.createdSlot).toBe(100n);
  expect(legacy.cancelWindowSlots).toBeUndefined();
  expect(() => decodeTokenEscrowAccount(f.state.subarray(0, 210))).toThrow('invalid token escrow layout');
});
test('a challenge can name its windows, and the lock must carry them', async () => {
  const f = fixture();
  const c = { ...f.c, claimWindowSlots: 25, cancelWindowSlots: 250 };
  const t = escrowTerms(c);
  expect([t.claimWindowSlots, t.cancelWindowSlots]).toEqual([25n, 250n]);
  expect(() => escrowTerms({ ...f.c, claimWindowSlots: 0 })).toThrow('invalid escrow window');
  expect(() => escrowTerms({ ...f.c, claimWindowSlots: 1.5 })).toThrow('invalid escrow window');
  expect(() => escrowTerms({ ...f.c, claimWindowSlots: 300, cancelWindowSlots: 250 })).toThrow('refund window');
  // The fixture's lock used the default windows, so it does not prove a lock with these.
  await expect(verifyEscrowLock(f.rpc as unknown as Connection, c, f.proof)).rejects.toThrow('signature does not prove this lock');
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
  f.tx.meta.err = { InstructionError: [0, 'failed'] };
  await expect(verifyEscrowLock(f.rpc as unknown as Connection, f.c, f.proof)).rejects.toThrow('failed');
});
test('paid retry transport failure preserves proof and never locks twice', async () => {
  const f = fixture(), lock = jest.fn(async () => f.proof.lockSignature);
  const request = jest.fn().mockResolvedValueOnce({ status: 402, headers: { get: () => JSON.stringify(f.c) } }).mockRejectedValueOnce(new Error('transport lost'));
  await expect(buyWithEscrow({ endpoint: f.c.endpoint, body: '{}', request, approve: async () => {}, lock })).rejects.toMatchObject({ name: 'EscrowPurchaseError', challenge: f.c, proof: f.proof });
  expect(lock).toHaveBeenCalledTimes(1); expect(request).toHaveBeenCalledTimes(2);
});

test('token escrow instructions carry the token program from the terms, for classic and Token-2022 only', () => {
  const { TOKEN_2022_PROGRAM_ID } = require('@solana/spl-token');
  const base = { programId: pk(), payer: pk(), payee: pk(), mint: pk(), source: pk(), recipient: pk(), amount: 400000n, nonce: new Uint8Array(16).fill(3) };
  for (const tokenProgram of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const t = { ...base, tokenProgram };
    expect(buildLockTokenEscrowInstruction(t).keys[7].pubkey.equals(tokenProgram)).toBe(true);
    expect(buildSettleTokenEscrowInstruction(t).keys[8].pubkey.equals(tokenProgram)).toBe(true);
    expect(buildSettleTokenEscrowInstruction(t, true).keys[6].pubkey.equals(tokenProgram)).toBe(true);
  }
  expect(() => buildLockTokenEscrowInstruction({ ...base, tokenProgram: pk() })).toThrow('classic SPL Token or Token-2022');
});

describe('rated escrows (flag byte bit 0x02)', () => {
  const shape = (ix: { data: Buffer; keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] }) => ({ data: ix.data.toString('hex'), keys: ix.keys.map(k => [k.pubkey.toBase58(), k.isSigner, k.isWritable]) });

  test.each([[2, 'rated'], [3, 'metered and rated']] as const)('flag byte %i (%s): declined before serving by default', async (flag, _what) => {
    const f = fixture(); f.state[202] = flag;
    expect(decodeTokenEscrowAccount(f.state)).toMatchObject({ rated: true, metered: flag === 3 });
    await expect(verifyEscrowLock(f.rpc as unknown as Connection, f.c, f.proof)).rejects.toThrow('rated escrow declined');
    await expect(verifyEscrowLock(f.rpc as unknown as Connection, f.c, f.proof, { acceptRatedEscrows: false })).rejects.toThrow('rated escrow declined');
  });

  test.each([[4], [5], [7]] as const)('flag byte %i (delivery-checked): declined before serving, even by a seller that takes rated escrows', async (flag) => {
    const f = fixture(); f.state[202] = flag;
    expect(decodeTokenEscrowAccount(f.state)).toMatchObject({ deliveryChecked: true });
    await expect(verifyEscrowLock(f.rpc as unknown as Connection, f.c, f.proof)).rejects.toThrow('delivery-checked escrow declined');
    await expect(verifyEscrowLock(f.rpc as unknown as Connection, f.c, f.proof, { acceptRatedEscrows: true })).rejects.toThrow('delivery-checked escrow declined');
  });

  test.each([[8], [9], [0x81], [0xff]] as const)('flag byte %i (bits this version does not know): declined before serving', async (flag) => {
    const f = fixture(); f.state[202] = flag;
    expect(decodeTokenEscrowAccount(f.state).unknownFlagBits).toBe(flag & 0xf8);
    await expect(verifyEscrowLock(f.rpc as unknown as Connection, f.c, f.proof, { acceptRatedEscrows: true })).rejects.toThrow('options this seller does not know');
  });

  test.each([[2], [3]] as const)('flag byte %i: accepted when the seller takes rated escrows, and the receipt says so', async (flag) => {
    const f = fixture(); f.state[202] = flag;
    const receipt = await verifyEscrowLock(f.rpc as unknown as Connection, f.c, f.proof, { acceptRatedEscrows: true });
    expect(receipt).toMatchObject({ status: 'locked', rated: true, openedSlot: '100' });
    const rating = ratingPda(f.addresses.escrow, f.t.programId);
    // Claim and decline both carry the rating account, writable, after the usual accounts, and name the job after their data.
    const slot = Buffer.alloc(8); slot.writeBigUInt64LE(100n);
    const claim = buildEscrowSellerExit(f.c, receipt, 'claim');
    const plainClaim = buildSettleTokenEscrowInstruction(f.t, false, f.t.payee);
    expect(shape(claim)).toEqual({ data: shape(plainClaim).data + slot.toString('hex'), keys: [...shape(plainClaim).keys, [rating.toBase58(), false, true]] });
    expect(claim.keys).toHaveLength(10);
    const decline = buildEscrowSellerExit(f.c, receipt, 'decline');
    const plainDecline = buildSettleTokenEscrowInstruction(f.t, true, f.t.payee);
    expect(shape(decline)).toEqual({ data: shape(plainDecline).data + slot.toString('hex'), keys: [...shape(plainDecline).keys, [rating.toBase58(), false, true]] });
    expect(decline.keys).toHaveLength(8);
    // The receipt round-trips through JSON (the slot is a decimal string), and a rated receipt without it builds nothing.
    expect(shape(buildEscrowSellerExit(f.c, JSON.parse(JSON.stringify(receipt)), 'claim'))).toEqual(shape(claim));
    expect(() => buildEscrowSellerExit(f.c, { rated: true, slot: 100 }, 'claim')).toThrow('opened slot');
    expect(() => buildEscrowSellerExit(f.c, { rated: true, openedSlot: '-1', slot: 100 }, 'claim')).toThrow('opened slot');
    expect(() => buildEscrowSellerExit(f.c, { rated: true, openedSlot: '99', slot: 100 }, 'claim')).toThrow('opened slot');
    // Every exit names its escrow by the lock slot: an unrated receipt too, and one without a slot builds nothing.
    const unratedClaim = buildEscrowSellerExit(f.c, { slot: 100 }, 'claim');
    expect(shape(unratedClaim)).toEqual({ data: shape(plainClaim).data + slot.toString('hex'), keys: shape(plainClaim).keys });
    expect(() => buildEscrowSellerExit(f.c, { slot: undefined as unknown as number }, 'claim')).toThrow('slot of the lock');
  });

  test('a rated escrow whose rating account is missing, not the program\'s, another escrow\'s or past settlement is refused', async () => {
    const ratingAddress = (f: ReturnType<typeof fixture>) => ratingPda(f.addresses.escrow, f.t.programId);
    for (const kind of ['missing', 'owner', 'escrow', 'state'] as const) {
      const f = fixture(); f.state[202] = 2;
      const original = f.rpc.getAccountInfo.getMockImplementation()!;
      f.rpc.getAccountInfo.mockImplementation(async key => {
        const info = await original(key);
        if (!key.equals(ratingAddress(f))) return info;
        if (kind === 'missing') return null;
        if (kind === 'owner') info!.owner = pk();
        if (kind === 'escrow') pk().toBuffer().copy(info!.data, 8);
        if (kind === 'state') info!.data[264] = 1;
        return info;
      });
      await expect(verifyEscrowLock(f.rpc as unknown as Connection, f.c, f.proof, { acceptRatedEscrows: true })).rejects.toThrow(/rating account/);
    }
  });

  test.each([[0], [1]] as const)('flag byte %i (not rated): the receipt is as before and the exits carry no rating account, whatever the setting', async (flag) => {
    for (const options of [undefined, { acceptRatedEscrows: true }]) {
      const f = fixture(); f.state[202] = flag;
      const receipt = await verifyEscrowLock(f.rpc as unknown as Connection, f.c, f.proof, options);
      expect(receipt).toEqual({ ...f.proof, scheme: 'rap-spl-escrow-v1', status: 'locked', escrow: f.addresses.escrow.toBase58(), amount: f.c.amount, mint: f.c.mint, requestHash: f.c.requestHash, slot: 100 });
      expect('rated' in receipt).toBe(false);
      // Named by the lock slot (100, little-endian) after their own data.
      const named = (ix: ReturnType<typeof shape>) => ({ ...ix, data: ix.data + '6400000000000000' });
      expect(shape(buildEscrowSellerExit(f.c, receipt, 'claim'))).toEqual(named(shape(buildSettleTokenEscrowInstruction(f.t, false, f.t.payee))));
      expect(shape(buildEscrowSellerExit(f.c, receipt, 'decline'))).toEqual(named(shape(buildSettleTokenEscrowInstruction(f.t, true, f.t.payee))));
    }
  });

  test('EscrowSeller declines a rated escrow by default and keeps the challenge; a seller set to accept takes it', async () => {
    for (const accept of [false, true]) {
      const f = fixture(), seller = new EscrowSeller(f.rpc as unknown as Connection, accept ? { acceptRatedEscrows: true } : undefined);
      const c = seller.issue(f.c);
      const t = escrowTerms(c), addresses = tokenEscrowAddresses(t);
      Buffer.from(t.nonce).copy(f.state, 176); f.state[201] = addresses.bump; f.state[202] = 2;
      f.tx.transaction.message = new Transaction({ feePayer: t.payer, recentBlockhash: pk().toBase58() }).add(buildLockTokenEscrowInstruction(t)).compileMessage();
      const original = f.rpc.getAccountInfo.getMockImplementation()!;
      const rating = ratingPda(addresses.escrow, t.programId);
      addresses.escrow.toBuffer().copy(f.rating, 8);
      f.rpc.getAccountInfo.mockImplementation(async key => {
        const info = (await original(key.equals(addresses.escrow) ? f.addresses.escrow : key.equals(rating) ? ratingPda(f.addresses.escrow, f.t.programId) : key))!;
        if (key.equals(addresses.vault)) addresses.escrow.toBuffer().copy(info.data, 32);
        return info;
      });
      const proof = { ...f.proof, nonce: c.nonce };
      if (accept) {
        await expect(seller.accept(c.endpoint, '{}', proof)).resolves.toMatchObject({ status: 'locked', rated: true, openedSlot: '100' });
      } else {
        await expect(seller.accept(c.endpoint, '{}', proof)).rejects.toThrow('rated escrow declined');
        // Nothing was consumed: the same proof is refused for the same reason, not as a replay.
        await expect(seller.accept(c.endpoint, '{}', proof)).rejects.toThrow('rated escrow declined');
      }
    }
  });
});
