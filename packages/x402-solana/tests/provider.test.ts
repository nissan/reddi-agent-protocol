import { createHash } from 'node:crypto';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  buildSettleTokenEscrowInstruction,
  checkMeteredPayout,
  checkProviderCluster,
  confirmMeteredSettlement,
  ESCROW_PROTOCOL_TREASURY,
  MemoryNonceReplayStore,
  meteredDecline,
  meteredOffer,
  meteredPaymentHeaderValue,
  meteredRatingAccount,
  meteredSettlement,
  prepareTokenPayout,
  providerMeteredTerms,
  ratingPda,
  readMeteredPaymentHeader,
  SOLANA_GENESIS_HASHES,
  tokenEscrowAddresses,
  treasuryTokenAccount,
  usageFrom,
  verifyMeteredLock,
  type MeteredPaymentHeader,
  type SettlementRecord,
  type VerifiedLock,
} from '../src';

const PROGRAM = new PublicKey('DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu');
const USDC = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const payee = Keypair.generate().publicKey;
const payer = Keypair.generate().publicKey;
const NONCE = '00112233445566778899aabbccddeeff';
const CURRENT_SLOT = BigInt(1_000_000);

const terms = providerMeteredTerms({ currency: 'USDC', inputPerMillion: '3', outputPerMillion: '15', maxOutputTokens: 500, programId: PROGRAM, mint: USDC, payee });
const messages = [{ content: 'x'.repeat(400) }]; // 100 input tokens
// 100 input at 3 per million + 500 output at 15 per million = 0.0003 + 0.0075 = 0.0078 USDC = 7800 base units
const MINIMUM = BigInt(7800);

const disc = createHash('sha256').update('account:TokenEscrowAccount').digest().subarray(0, 8);
const ata = (owner: PublicKey, mint = USDC) => treasuryTokenAccount({ mint, tokenProgram: TOKEN_PROGRAM }, owner);

interface Fields { amount?: bigint; payee?: PublicKey; mint?: PublicKey; recipient?: PublicKey; status?: number; metered?: boolean; rated?: boolean; payer?: PublicKey; windows?: { claim: bigint; cancel: bigint } | null; createdSlot?: bigint }
function escrowBytes(f: Fields = {}): Uint8Array {
  const mint = f.mint ?? USDC;
  const owner = f.payee ?? payee;
  const data = Buffer.alloc(f.windows === null ? 203 : 219);
  disc.copy(data, 0);
  (f.payer ?? payer).toBuffer().copy(data, 8);
  owner.toBuffer().copy(data, 40);
  mint.toBuffer().copy(data, 72);
  ata(f.payer ?? payer, mint).toBuffer().copy(data, 104);
  (f.recipient ?? ata(owner, mint)).toBuffer().copy(data, 136);
  data.writeBigUInt64LE(f.amount ?? MINIMUM * BigInt(2), 168);
  Buffer.from(NONCE, 'hex').copy(data, 176);
  data[192] = f.status ?? 0;
  data.writeBigUInt64LE(f.createdSlot ?? CURRENT_SLOT - BigInt(10), 193);
  data[201] = 254;
  data[202] = (f.metered === false ? 0 : 1) | (f.rated ? 2 : 0);
  if (f.windows !== null) {
    data.writeBigUInt64LE(f.windows?.claim ?? BigInt(1_500), 203);
    data.writeBigUInt64LE(f.windows?.cancel ?? BigInt(4_500), 211);
  }
  return data;
}

const header: MeteredPaymentHeader = {
  escrow: tokenEscrowAddresses({ programId: PROGRAM, payer, nonce: Buffer.from(NONCE, 'hex') }).escrow,
  payer,
  nonce: Uint8Array.from(Buffer.from(NONCE, 'hex')),
};

function tokenAccount(mint: PublicKey, owner: PublicKey, state = 1): Uint8Array {
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data, 0);
  owner.toBuffer().copy(data, 32);
  data[108] = state; // 0 uninitialised, 1 initialised, 2 frozen
  return data;
}
type Accounts = Map<string, { owner: PublicKey; data: Uint8Array } | null>;
/** The slot the escrow's rating was opened in: the lock's. */
const OPENED_SLOT = CURRENT_SLOT - BigInt(10);
/** The escrow's rating account, awaiting settlement (read only for a rated escrow). */
function ratingBytes(f: { escrow?: PublicKey; state?: number; openedSlot?: bigint } = {}): Uint8Array {
  const data = Buffer.alloc(270);
  createHash('sha256').update('account:RatingAccount').digest().copy(data, 0, 0, 8);
  (f.escrow ?? header.escrow).toBuffer().copy(data, 8);
  payer.toBuffer().copy(data, 40);
  payee.toBuffer().copy(data, 72);
  data.writeBigUInt64LE(f.openedSlot ?? OPENED_SLOT, 240);
  data[264] = f.state ?? 0;
  return data;
}
/** The provider's, the treasury's and the buyer's USDC accounts, all able to receive, and the escrow's rating account. */
function payoutAccounts(): Accounts {
  return new Map<string, { owner: PublicKey; data: Uint8Array } | null>([
    [ratingPda(header.escrow, PROGRAM).toBase58(), { owner: PROGRAM, data: ratingBytes() }],
    [ata(payee).toBase58(), { owner: TOKEN_PROGRAM, data: tokenAccount(USDC, payee) }],
    [ata(ESCROW_PROTOCOL_TREASURY).toBase58(), { owner: TOKEN_PROGRAM, data: tokenAccount(USDC, ESCROW_PROTOCOL_TREASURY) }],
    [ata(payer).toBase58(), { owner: TOKEN_PROGRAM, data: tokenAccount(USDC, payer) }],
  ]);
}

function verify(fields: Fields | 'missing' | 'rpc-down' = {}, extra: { owner?: PublicKey; slot?: () => Promise<bigint>; replayStore?: MemoryNonceReplayStore; header?: MeteredPaymentHeader; accounts?: Accounts; terms?: typeof terms; acceptRatedEscrows?: boolean } = {}) {
  const accounts = extra.accounts ?? payoutAccounts();
  const escrowKey = (extra.header ?? header).escrow;
  return verifyMeteredLock({
    header: extra.header ?? header,
    terms: extra.terms ?? terms,
    minimum: MINIMUM,
    readAccount: async (address) => {
      if (fields === 'rpc-down') throw new Error('rpc');
      if (!address.equals(escrowKey)) return accounts.get(address.toBase58()) ?? null;
      if (fields === 'missing') return null;
      return { owner: extra.owner ?? PROGRAM, data: escrowBytes(fields) };
    },
    readSlot: extra.slot ?? (async () => CURRENT_SLOT),
    replayStore: extra.replayStore ?? new MemoryNonceReplayStore(),
    ...(extra.acceptRatedEscrows !== undefined ? { acceptRatedEscrows: extra.acceptRatedEscrows } : {}),
  });
}

describe('provider terms and offer', () => {
  it('quotes the estimate, a default maximum of twice the estimate, and the 2.5% fee', () => {
    const offer = meteredOffer(terms, messages, undefined, 'solana-devnet');
    expect(offer).toMatchObject({
      settlement: 'metered-escrow',
      network: 'solana-devnet',
      currency: 'USDC',
      inputPerMillion: '3',
      outputPerMillion: '15',
      maxOutputTokens: 500,
      estimate: { inputTokens: 100, outputTokens: 500 },
      estimatedCost: '0.0078',
      suggestedMaxCharge: '0.0156',
      suggestedMaxChargeBaseUnits: '15600',
      estimatedFee: '0.000195',
      minimumLockBaseUnits: '7800',
      escrowProgramId: PROGRAM.toBase58(),
      mint: USDC.toBase58(),
      payTo: payee.toBase58(),
    });
  });

  it("holds a request's own output limit to the provider's", () => {
    expect(meteredOffer(terms, messages, 100).estimate.outputTokens).toBe(100);
    expect(meteredOffer(terms, messages, 9_999).estimate.outputTokens).toBe(500);
  });

  it('refuses SOL, an unknown currency, a zero price and a malformed address', () => {
    const base = { inputPerMillion: '3', outputPerMillion: '15', programId: PROGRAM, mint: USDC, payee };
    expect(() => providerMeteredTerms({ ...base, currency: 'SOL' })).toThrow(/not a token currency/);
    expect(() => providerMeteredTerms({ ...base, currency: 'DOGE' })).toThrow(/unsupported currency/);
    expect(() => providerMeteredTerms({ ...base, currency: 'USDC', inputPerMillion: '0', outputPerMillion: '0' })).toThrow(/above zero/);
    expect(() => providerMeteredTerms({ ...base, currency: 'USDC', inputPerMillion: '0.0000001' })).toThrow();
    expect(() => providerMeteredTerms({ ...base, currency: 'USDC', payee: 'not-a-key' })).toThrow();
    expect(() => providerMeteredTerms({ ...base, currency: 'USDC', maxOutputTokens: 0 })).toThrow(/maxOutputTokens/);
  });
});

describe('metered payment header', () => {
  it('round-trips the value a buyer sends', () => {
    const value = meteredPaymentHeaderValue({ payer, nonce: header.nonce, programId: PROGRAM });
    const read = readMeteredPaymentHeader(new Headers({ 'x402-payment': value }));
    expect(read && !('error' in read) && read.escrow.equals(header.escrow) && read.payer.equals(payer)).toBe(true);
  });

  it('ignores other payments and names a bad nonce', () => {
    expect(readMeteredPaymentHeader(new Headers())).toBeUndefined();
    expect(readMeteredPaymentHeader(new Headers({ 'x402-payment': JSON.stringify({ signature: 'abc' }) }))).toBeUndefined();
    expect(readMeteredPaymentHeader(new Headers({ 'x402-payment': JSON.stringify({ settlement: 'metered-escrow', nonce: 'zz' }) }))).toHaveProperty('error');
  });
});

describe('verifyMeteredLock', () => {
  it('accepts a matching lock and returns the terms to settle with', async () => {
    const lock = await verify();
    expect(lock.ok).toBe(true);
    if (lock.ok) {
      expect(lock.maxBaseUnits).toBe(BigInt(15_600));
      expect(lock.terms.metered).toBe(true);
      expect(lock.terms.cancelWindowSlots).toBe(BigInt(4_500));
    }
  });

  it.each<[string, Fields | 'missing' | 'rpc-down', string, { owner?: PublicKey }?]>([
    ['no account', 'missing', 'invalid_receipt'],
    ['an unreadable chain', 'rpc-down', 'payment_check_unavailable'],
    ['an account another program owns', {}, 'invalid_receipt', { owner: TOKEN_PROGRAM }],
    ['a settled escrow', { status: 1 }, 'duplicate_nonce'],
    ['an escrow that is not metered', { metered: false }, 'invalid_receipt'],
    ['an escrow with no stated windows', { windows: null }, 'invalid_receipt'],
    ['under 10 minutes of refund window left', { createdSlot: CURRENT_SLOT - BigInt(3_001) }, 'invalid_receipt'],
    ['another provider as payee', { payee: Keypair.generate().publicKey }, 'wrong_payee'],
    ['another mint', { mint: Keypair.generate().publicKey }, 'wrong_currency'],
    ['a recipient the provider does not use', { recipient: Keypair.generate().publicKey }, 'wrong_payee'],
    ['a maximum below the estimate', { amount: MINIMUM - BigInt(1) }, 'wrong_amount'],
  ])('refuses %s', async (...row) => {
    const [, fields, reason, extra] = row;
    const lock = await verify(fields, extra);
    expect(lock).toMatchObject({ ok: false, reason });
  });

  it('accepts exactly the minimum time left and exactly the minimum amount', async () => {
    expect((await verify({ createdSlot: CURRENT_SLOT - BigInt(3_000), amount: MINIMUM })).ok).toBe(true);
  });

  it('refuses when the slot cannot be read, an address the payer and nonce do not give, and a lock used twice', async () => {
    expect(await verify({}, { slot: async () => { throw new Error('rpc'); } })).toMatchObject({ ok: false, reason: 'payment_check_unavailable' });
    expect(await verify({}, { header: { ...header, escrow: Keypair.generate().publicKey } })).toMatchObject({ ok: false, reason: 'invalid_receipt' });
    const replayStore = new MemoryNonceReplayStore();
    expect((await verify({}, { replayStore })).ok).toBe(true);
    expect(await verify({}, { replayStore })).toMatchObject({ ok: false, reason: 'duplicate_nonce' });
  });
});

describe('payout accounts', () => {
  const TOKEN_2022 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
  const ata22 = (owner: PublicKey, mint: PublicKey) => treasuryTokenAccount({ mint, tokenProgram: TOKEN_2022 }, owner);
  /** A Token-2022 account or mint: the base layout padded to 165 bytes, the account type, then one extension. */
  const withExtension = (base: Uint8Array, accountType: number, extension: number, body: Uint8Array): Uint8Array => {
    const data = Buffer.alloc(165 + 1 + 4 + body.length);
    Buffer.from(base).copy(data, 0);
    data[165] = accountType;
    data.writeUInt16LE(extension, 166);
    data.writeUInt16LE(body.length, 168);
    Buffer.from(body).copy(data, 170);
    return data;
  };

  it.each<[string, (accounts: Accounts) => void, string]>([
    ['a closed buyer account', (a) => a.delete(ata(payer).toBase58()), 'refund_account_unusable'],
    ['a frozen buyer account', (a) => a.set(ata(payer).toBase58(), { owner: TOKEN_PROGRAM, data: tokenAccount(USDC, payer, 2) }), 'refund_account_unusable'],
    ['an uninitialised buyer account', (a) => a.set(ata(payer).toBase58(), { owner: TOKEN_PROGRAM, data: tokenAccount(USDC, payer, 0) }), 'refund_account_unusable'],
    ['a buyer account someone else now owns', (a) => a.set(ata(payer).toBase58(), { owner: TOKEN_PROGRAM, data: tokenAccount(USDC, Keypair.generate().publicKey) }), 'refund_account_unusable'],
    ['a missing treasury account', (a) => a.delete(ata(ESCROW_PROTOCOL_TREASURY).toBase58()), 'provider_not_ready'],
    ['a frozen treasury account', (a) => a.set(ata(ESCROW_PROTOCOL_TREASURY).toBase58(), { owner: TOKEN_PROGRAM, data: tokenAccount(USDC, ESCROW_PROTOCOL_TREASURY, 2) }), 'provider_not_ready'],
    ["a frozen provider account with no recovery account", (a) => a.set(ata(payee).toBase58(), { owner: TOKEN_PROGRAM, data: tokenAccount(USDC, payee, 2) }), 'provider_not_ready'],
  ])('refuses the lock before any work on %s, and does not use it up', async (...row) => {
    const [, change, reason] = row;
    const accounts = payoutAccounts();
    change(accounts);
    const replayStore = new MemoryNonceReplayStore();
    expect(await verify({}, { accounts, replayStore })).toMatchObject({ ok: false, reason });
    // Once the account is back, the same lock is accepted.
    expect((await verify({}, { replayStore })).ok).toBe(true);
  });

  it('pays the provider at its recovery account when its usual account is frozen', async () => {
    const recovery = Keypair.generate().publicKey;
    const accounts = payoutAccounts();
    accounts.set(ata(payee).toBase58(), { owner: TOKEN_PROGRAM, data: tokenAccount(USDC, payee, 2) });
    accounts.set(recovery.toBase58(), { owner: TOKEN_PROGRAM, data: tokenAccount(USDC, payee) });
    const recoveryTerms = { ...terms, payoutAccount: recovery };
    const lock = (await verify({}, { accounts, terms: recoveryTerms })) as Extract<VerifiedLock, { ok: true }>;
    expect(lock.ok).toBe(true);
    expect(lock.payout.payTo?.equals(recovery)).toBe(true);
    const { instruction } = meteredSettlement(recoveryTerms, lock, { inputTokens: 120, outputTokens: 333 });
    expect(instruction.keys[5].pubkey.equals(recovery)).toBe(true);

    // A recovery account the provider does not own is not used.
    accounts.set(recovery.toBase58(), { owner: TOKEN_PROGRAM, data: tokenAccount(USDC, Keypair.generate().publicKey) });
    expect(await verify({}, { accounts, terms: recoveryTerms })).toMatchObject({ ok: false, reason: 'provider_not_ready' });
  });

  it("falls back to the buyer's associated account, and creates one, only when asked", async () => {
    const other = Keypair.generate().publicKey; // the lock was funded from a non-associated account
    const escrow = { payer, source: other, recipient: ata(payee) };
    const accounts = payoutAccounts();
    const readAccount = async (address: PublicKey) => accounts.get(address.toBase58()) ?? null;
    // The recorded source is gone; the associated account exists.
    expect(await checkMeteredPayout({ terms, escrow, readAccount })).toMatchObject({ ok: false, reason: 'refund_account_unusable' });
    const fallback = await checkMeteredPayout({ terms, escrow, readAccount, allowPayerAssociatedAccount: true });
    expect(fallback.ok && fallback.payout.refundTo.equals(ata(payer)) && fallback.payout.createRefundAccount === undefined).toBe(true);

    // Neither exists: nothing is created unless the operator opted in.
    accounts.delete(ata(payer).toBase58());
    expect(await checkMeteredPayout({ terms, escrow, readAccount, allowPayerAssociatedAccount: true })).toMatchObject({ ok: false, reason: 'refund_account_unusable' });
    const created = await checkMeteredPayout({ terms, escrow, readAccount, createRefundAccount: true });
    expect(created).toMatchObject({ ok: true, payout: { createRefundAccount: true } });
    const lock = { ...((await verify()) as Extract<VerifiedLock, { ok: true }>) };
    const { instructions } = meteredSettlement(terms, lock, { inputTokens: 120, outputTokens: 333 }, created.ok ? created.payout : undefined);
    expect(instructions).toHaveLength(2);
    expect(instructions[0].keys[0].pubkey.equals(payee)).toBe(true); // the provider funds it
    expect(instructions[0].keys[2].pubkey.equals(payer)).toBe(true); // the buyer owns it

    // A frozen associated account cannot be created over, opt-in or not.
    accounts.set(ata(payer).toBase58(), { owner: TOKEN_PROGRAM, data: tokenAccount(USDC, payer, 2) });
    expect(await checkMeteredPayout({ terms, escrow, readAccount, createRefundAccount: true })).toMatchObject({ ok: false, reason: 'refund_account_unusable' });
  });

  it('reports an unreadable chain as unavailable, not as a bad account', async () => {
    const escrow = { payer, source: ata(payer), recipient: ata(payee) };
    expect(await checkMeteredPayout({ terms, escrow, readAccount: async () => { throw new Error('rpc'); } })).toMatchObject({ ok: false, reason: 'payment_check_unavailable' });
  });

  it('on Token-2022, refuses a buyer account that requires memos and passes the mint writable when it withholds fees', async () => {
    const mint = Keypair.generate().publicKey;
    const t22 = { ...terms, mint, tokenProgram: TOKEN_2022 };
    const escrow = { payer, source: ata22(payer, mint), recipient: ata22(payee, mint) };
    const plain = (owner: PublicKey) => ({ owner: TOKEN_2022, data: tokenAccount(mint, owner) });
    const mintBase = Buffer.alloc(82);
    mintBase[45] = 1; // initialised
    const accounts: Accounts = new Map([
      [ata22(payee, mint).toBase58(), plain(payee)],
      [ata22(ESCROW_PROTOCOL_TREASURY, mint).toBase58(), plain(ESCROW_PROTOCOL_TREASURY)],
      [ata22(payer, mint).toBase58(), plain(payer)],
      [mint.toBase58(), { owner: TOKEN_2022, data: withExtension(mintBase, 1, 1, new Uint8Array(108)) }], // TransferFeeConfig
    ]);
    const readAccount = async (address: PublicKey) => accounts.get(address.toBase58()) ?? null;
    const withFees = await checkMeteredPayout({ terms: t22, escrow, readAccount });
    expect(withFees).toMatchObject({ ok: true, payout: { harvestWithheldFees: true } });

    // No transfer fee extension: the mint stays read-only.
    accounts.set(mint.toBase58(), { owner: TOKEN_2022, data: withExtension(mintBase, 1, 3, new Uint8Array(32)) }); // MintCloseAuthority
    expect(await checkMeteredPayout({ terms: t22, escrow, readAccount })).toMatchObject({ ok: true, payout: { harvestWithheldFees: false } });

    accounts.set(ata22(payer, mint).toBase58(), { owner: TOKEN_2022, data: withExtension(tokenAccount(mint, payer), 2, 8, Uint8Array.of(1)) }); // MemoTransfer on
    expect(await checkMeteredPayout({ terms: t22, escrow, readAccount })).toMatchObject({ ok: false, reason: 'refund_account_unusable' });

    accounts.delete(mint.toBase58());
    accounts.set(ata22(payer, mint).toBase58(), plain(payer));
    expect(await checkMeteredPayout({ terms: t22, escrow, readAccount })).toMatchObject({ ok: false, reason: 'provider_not_ready' });
  });
});

describe('confirmed settlement', () => {
  const escrowKey = header.escrow;
  const expected = { programId: PROGRAM, escrow: escrowKey, mint: USDC, destination: ata(payee), treasuryToken: ata(ESCROW_PROTOCOL_TREASURY), refundTo: ata(payer), maxBaseUnits: BigInt(15_600) };
  const row = (account: PublicKey, before: number, after: number) => ({ account: account.toBase58(), mint: USDC.toBase58(), before: BigInt(before), after: BigInt(after) });
  const record = (provider: number, fee: number, refund: number, extra: Partial<SettlementRecord> = {}): SettlementRecord => ({
    failed: false,
    programIds: [PROGRAM.toBase58()],
    accounts: [escrowKey.toBase58(), ata(payee).toBase58()],
    tokenBalances: [row(ata(payee), 1_000, 1_000 + provider), row(ata(ESCROW_PROTOCOL_TREASURY), 50, 50 + fee), row(ata(payer), 0, refund)],
    ...extra,
  });

  it('reads the provider credit, the fee and the refund from the balance changes', () => {
    expect(confirmMeteredSettlement(record(5_222, 133, 10_245), expected)).toEqual({
      ok: true, paidBaseUnits: BigInt(5_355), feeBaseUnits: BigInt(133), providerBaseUnits: BigInt(5_222), refundedBaseUnits: BigInt(10_245), surplusBaseUnits: BigInt(0),
    });
  });

  it('keeps tokens someone donated to the vault apart from the refund', () => {
    expect(confirmMeteredSettlement(record(5_222, 133, 10_245 + 700), expected)).toMatchObject({ ok: true, paidBaseUnits: BigInt(5_355), refundedBaseUnits: BigInt(10_245), surplusBaseUnits: BigInt(700) });
  });

  it('bills what the provider was actually credited, and refuses when the amounts no longer add up', () => {
    // A reduced credit with the buyer made whole is billed at the reduced amount.
    expect(confirmMeteredSettlement(record(5_000, 133, 10_467), expected)).toMatchObject({ ok: true, paidBaseUnits: BigInt(5_133), providerBaseUnits: BigInt(5_000) });
    // Tokens withheld on the way: the buyer got back less than the maximum less what was billed.
    expect(confirmMeteredSettlement(record(5_000, 133, 10_245), expected)).toEqual({ ok: false, reason: 'amounts_do_not_add_up' });
    expect(confirmMeteredSettlement(record(15_600, 400, 0), expected)).toEqual({ ok: false, reason: 'amounts_do_not_add_up' });
    expect(confirmMeteredSettlement(record(0, 0, 15_600), expected)).toEqual({ ok: false, reason: 'amounts_do_not_add_up' });
  });

  it('refuses a transaction that is missing, failed, for another program or for another escrow', () => {
    expect(confirmMeteredSettlement(null, expected)).toEqual({ ok: false, reason: 'not_found' });
    expect(confirmMeteredSettlement(record(5_222, 133, 10_245, { failed: true }), expected)).toEqual({ ok: false, reason: 'failed' });
    expect(confirmMeteredSettlement(record(5_222, 133, 10_245, { programIds: [TOKEN_PROGRAM.toBase58()] }), expected)).toEqual({ ok: false, reason: 'wrong_transaction' });
    expect(confirmMeteredSettlement(record(5_222, 133, 10_245, { accounts: [ata(payee).toBase58()] }), expected)).toEqual({ ok: false, reason: 'wrong_transaction' });
  });
});

describe('rated escrows', () => {
  const shape = (ix: { data: Buffer; keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] }) => ({ data: ix.data.toString('hex'), keys: ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]) });
  const rating = ratingPda(header.escrow, PROGRAM);
  const usage = { inputTokens: 120, outputTokens: 333 };
  const slotHex = (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(OPENED_SLOT); return b.toString('hex'); })();

  it('declines a rated escrow before serving unless the provider accepts rated jobs, and does not remember it', async () => {
    const replayStore = new MemoryNonceReplayStore();
    for (const acceptRatedEscrows of [undefined, false]) {
      expect(await verify({ rated: true }, { replayStore, ...(acceptRatedEscrows === undefined ? {} : { acceptRatedEscrows }) })).toMatchObject({ ok: false, reason: 'rated_escrow_declined' });
    }
    // Not remembered: the same escrow is still accepted by a provider that takes rated jobs.
    expect(await verify({ rated: true }, { replayStore, acceptRatedEscrows: true })).toMatchObject({ ok: true, rated: true });
  });

  it('reads the flag byte by its bits: a rated metered escrow stores 3 and is metered; a rated fixed-price one stores 2 and is not', async () => {
    expect(escrowBytes({ rated: true })[202]).toBe(3);
    expect(await verify({ rated: true }, { acceptRatedEscrows: true })).toMatchObject({ ok: true, rated: true, terms: { metered: true } });
    expect(escrowBytes({ rated: true, metered: false })[202]).toBe(2);
    expect(await verify({ rated: true, metered: false }, { acceptRatedEscrows: true })).toMatchObject({ ok: false, reason: 'invalid_receipt', message: 'This escrow was not locked as a metered escrow.' });
  });

  it('passes the rating account, writable, as the tenth account of the settle and the eighth of the decline', async () => {
    const lock = (await verify({ rated: true }, { acceptRatedEscrows: true })) as Extract<VerifiedLock, { ok: true }>;
    const plain = (await verify()) as Extract<VerifiedLock, { ok: true }>;
    const settle = meteredSettlement(terms, lock, usage);
    const plainSettle = meteredSettlement(terms, plain, usage);
    expect(settle.settlement).toEqual(plainSettle.settlement);
    expect(lock.openedSlot).toBe(OPENED_SLOT);
    expect(shape(settle.instruction)).toEqual({ data: shape(plainSettle.instruction).data + slotHex, keys: [...shape(plainSettle.instruction).keys, [rating.toBase58(), false, true]] });
    expect(settle.instruction.keys).toHaveLength(10);
    expect(settle.instructions[settle.instructions.length - 1]).toBe(settle.instruction);
    const decline = meteredDecline(terms, lock);
    const plainDecline = meteredDecline(terms, plain);
    expect(shape(decline)).toEqual({ data: shape(plainDecline).data + slotHex, keys: [...shape(plainDecline).keys, [rating.toBase58(), false, true]] });
    expect(decline.keys).toHaveLength(8);
    expect(meteredRatingAccount(lock)?.equals(rating)).toBe(true);
    // A rated lock that lost its opened slot builds no exit: the program would refuse it (6051).
    const { openedSlot: _slot, ...withoutSlot } = lock;
    expect(() => meteredSettlement(terms, withoutSlot, usage)).toThrow('openedSlot');
    expect(() => meteredDecline(terms, withoutSlot)).toThrow('openedSlot');
  });

  it('reads the opened slot with the lock, and refuses a rated escrow whose rating account is not this job\'s', async () => {
    const accounts = (rating: { owner: PublicKey; data: Uint8Array } | null) => {
      const map = payoutAccounts();
      map.set(ratingPda(header.escrow, PROGRAM).toBase58(), rating);
      return map;
    };
    expect(await verify({ rated: true }, { acceptRatedEscrows: true, accounts: accounts({ owner: PROGRAM, data: ratingBytes({ openedSlot: BigInt(77) }) }) })).toMatchObject({ ok: true, openedSlot: BigInt(77) });
    for (const rating of [null, { owner: Keypair.generate().publicKey, data: ratingBytes() }, { owner: PROGRAM, data: ratingBytes({ escrow: Keypair.generate().publicKey }) }, { owner: PROGRAM, data: ratingBytes({ state: 1 }) }, { owner: PROGRAM, data: new Uint8Array(10) }]) {
      const replayStore = new MemoryNonceReplayStore();
      expect(await verify({ rated: true }, { acceptRatedEscrows: true, replayStore, accounts: accounts(rating) })).toMatchObject({ ok: false, reason: 'invalid_receipt' });
      // Not remembered either.
      expect(await verify({ rated: true }, { acceptRatedEscrows: true, replayStore })).toMatchObject({ ok: true });
    }
    // An unrated lock never reads the rating account and carries no opened slot.
    expect('openedSlot' in ((await verify({}, { acceptRatedEscrows: true, accounts: accounts(null) })) as object)).toBe(false);
  });

  it('leaves an escrow that is not rated exactly as before, whether or not rated jobs are accepted', async () => {
    const before = (await verify()) as Extract<VerifiedLock, { ok: true }>;
    const accepting = (await verify({}, { acceptRatedEscrows: true })) as Extract<VerifiedLock, { ok: true }>;
    expect(before.rated).toBe(false);
    expect(accepting).toEqual(before);
    expect(meteredRatingAccount(before)).toBeUndefined();
    const direct = buildSettleTokenEscrowInstruction(before.terms, false, payee, { actual: BigInt(5355), treasuryToken: ata(ESCROW_PROTOCOL_TREASURY), refundTo: ata(payer) });
    expect(shape(meteredSettlement(terms, accepting, usage).instruction)).toEqual(shape(direct));
    expect(shape(meteredDecline(terms, accepting))).toEqual(shape(buildSettleTokenEscrowInstruction(before.terms, true, payee)));
    // A lock verified before `rated` existed (no such field) settles as an unrated one.
    const { rated: _rated, ...older } = before;
    expect(shape(meteredSettlement(terms, older as typeof before, usage).instruction)).toEqual(shape(direct));
  });

  // The flag byte as stored: 0 neither, 1 metered, 2 rated, 3 metered and rated.
  it.each([[0, false, false], [1, true, false], [2, false, true], [3, true, true]] as const)('flag byte %i: decision and exit accounts for a provider that does and one that does not take rated jobs', async (flag, metered, rated) => {
    const fields = { metered, rated };
    expect(escrowBytes(fields)[202]).toBe(flag);
    const plain = (await verify()) as Extract<VerifiedLock, { ok: true }>;
    for (const acceptRatedEscrows of [false, true]) {
      const result = await verify(fields, { acceptRatedEscrows });
      if (!metered) {
        // Not metered: never a metered lock, whatever the rated bit.
        expect(result).toMatchObject({ ok: false, reason: 'invalid_receipt' });
        continue;
      }
      if (rated && !acceptRatedEscrows) {
        expect(result).toMatchObject({ ok: false, reason: 'rated_escrow_declined' });
        continue;
      }
      expect(result).toMatchObject({ ok: true, rated });
      const lock = result as Extract<VerifiedLock, { ok: true }>;
      const extra = rated ? [[rating.toBase58(), false, true]] : [];
      const tail = rated ? slotHex : '';
      expect(shape(meteredSettlement(terms, lock, usage).instruction)).toEqual({ data: shape(meteredSettlement(terms, plain, usage).instruction).data + tail, keys: [...shape(meteredSettlement(terms, plain, usage).instruction).keys, ...extra] });
      expect(shape(meteredDecline(terms, lock))).toEqual({ data: shape(meteredDecline(terms, plain)).data + tail, keys: [...shape(meteredDecline(terms, plain)).keys, ...extra] });
    }
  });

  it('confirms a settle that names the rating account, and refuses one that should and does not', () => {
    const expected = { programId: PROGRAM, escrow: header.escrow, mint: USDC, destination: ata(payee), treasuryToken: ata(ESCROW_PROTOCOL_TREASURY), refundTo: ata(payer), maxBaseUnits: BigInt(15_600) };
    const row = (account: PublicKey, before: number, after: number) => ({ account: account.toBase58(), mint: USDC.toBase58(), before: BigInt(before), after: BigInt(after) });
    const record = (accounts: PublicKey[]): SettlementRecord => ({
      failed: false,
      programIds: [PROGRAM.toBase58()],
      accounts: accounts.map((k) => k.toBase58()),
      tokenBalances: [row(ata(payee), 0, 5_222), row(ata(ESCROW_PROTOCOL_TREASURY), 0, 133), row(ata(payer), 0, 10_245)],
    });
    const amounts = { ok: true, paidBaseUnits: BigInt(5_355), feeBaseUnits: BigInt(133), providerBaseUnits: BigInt(5_222), refundedBaseUnits: BigInt(10_245), surplusBaseUnits: BigInt(0) };
    // The extra account changes nothing for a caller that does not ask about it.
    expect(confirmMeteredSettlement(record([header.escrow, rating]), expected)).toEqual(amounts);
    expect(confirmMeteredSettlement(record([header.escrow, rating]), { ...expected, rating })).toEqual(amounts);
    expect(confirmMeteredSettlement(record([header.escrow]), { ...expected, rating })).toEqual({ ok: false, reason: 'wrong_transaction' });
  });
});

describe('settlement', () => {
  const locked = async () => (await verify()) as Extract<VerifiedLock, { ok: true }>;

  it('charges the actual cost, takes 2.5% rounded down, and builds the same bytes as the instruction builder', async () => {
    const lock = await locked();
    const { settlement, instruction, instructions } = meteredSettlement(terms, lock, { inputTokens: 120, outputTokens: 333 });
    // 120*3 + 333*15 = 5355 base units; fee floor(5355 * 0.025) = 133
    expect(settlement.chargedBaseUnits).toBe(BigInt(5355));
    expect(settlement).toMatchObject({ charged: '0.005355', fee: '0.000133', provider: '0.005222', refund: '0.010245', capped: false });
    // Paid into the accounts the lock check read: the recorded source takes the unused part, and nothing is created.
    const direct = buildSettleTokenEscrowInstruction(lock.terms, false, payee, { actual: BigInt(5355), treasuryToken: ata(ESCROW_PROTOCOL_TREASURY), refundTo: ata(payer) });
    expect(instruction.data.equals(direct.data)).toBe(true);
    expect(instruction.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable])).toEqual(direct.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]));
    expect(instructions).toEqual([instruction]);
    expect(prepareTokenPayout(lock.terms, payee).instructions).toEqual([]);
  });

  it('holds the charge to the locked maximum', async () => {
    const { settlement } = meteredSettlement(terms, await locked(), { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(settlement).toMatchObject({ capped: true, charged: '0.0156', refund: '0' });
  });

  it('settles nothing for zero tokens, and a decline refunds the payer in full', async () => {
    const lock = await locked();
    expect(() => meteredSettlement(terms, lock, { inputTokens: 0, outputTokens: 0 })).toThrow(/nothing to settle/);
    const decline = meteredDecline(terms, lock);
    expect(decline.data.equals(buildSettleTokenEscrowInstruction(lock.terms, true, payee).data)).toBe(true);
    expect(decline.keys[2]).toMatchObject({ isSigner: true });
    expect(decline.keys[2].pubkey.equals(payee)).toBe(true);
  });

  it('counts reported usage, and estimates from the text when none is reported', () => {
    expect(usageFrom({ usage: { prompt_tokens: 7, completion_tokens: 9 } }, 100)).toEqual({ inputTokens: 7, outputTokens: 9 });
    expect(usageFrom({ choices: [{ message: { content: 'x'.repeat(40) } }] }, 100)).toEqual({ inputTokens: 100, outputTokens: 10 });
    expect(usageFrom({ usage: { prompt_tokens: -1, completion_tokens: 1.5 } }, 3)).toEqual({ inputTokens: 3, outputTokens: 0 });
  });
});

describe('checkProviderCluster', () => {
  it('accepts the configured cluster and refuses another', async () => {
    expect(await checkProviderCluster(async () => SOLANA_GENESIS_HASHES['solana-devnet'], 'solana-devnet')).toEqual({ ok: true });
    expect(await checkProviderCluster(async () => SOLANA_GENESIS_HASHES['solana-devnet'], 'solana-mainnet-beta')).toMatchObject({ ok: false, reason: 'wrong_cluster' });
  });

  it('never lets the mainnet hash be replaced, allows a local validator hash elsewhere, and fails closed when unreadable', async () => {
    expect(await checkProviderCluster(async () => 'local', 'solana-mainnet-beta', 'local')).toMatchObject({ ok: false, reason: 'wrong_cluster' });
    expect(await checkProviderCluster(async () => 'local', 'solana-devnet', 'local')).toEqual({ ok: true });
    expect(await checkProviderCluster(async () => { throw new Error('rpc'); }, 'solana-devnet')).toMatchObject({ ok: false, reason: 'payment_check_unavailable' });
  });
});
