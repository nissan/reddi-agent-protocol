import { createHash } from 'node:crypto';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  buildSettleTokenEscrowInstruction,
  checkProviderCluster,
  MemoryNonceReplayStore,
  meteredDecline,
  meteredOffer,
  meteredPaymentHeaderValue,
  meteredSettlement,
  prepareTokenPayout,
  providerMeteredTerms,
  readMeteredPaymentHeader,
  SOLANA_GENESIS_HASHES,
  tokenEscrowAddresses,
  treasuryTokenAccount,
  usageFrom,
  verifyMeteredLock,
  type MeteredPaymentHeader,
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

interface Fields { amount?: bigint; payee?: PublicKey; mint?: PublicKey; recipient?: PublicKey; status?: number; metered?: boolean; payer?: PublicKey; windows?: { claim: bigint; cancel: bigint } | null; createdSlot?: bigint }
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
  data[202] = f.metered === false ? 0 : 1;
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

function verify(fields: Fields | 'missing' | 'rpc-down' = {}, extra: { owner?: PublicKey; slot?: () => Promise<bigint>; replayStore?: MemoryNonceReplayStore; header?: MeteredPaymentHeader } = {}) {
  return verifyMeteredLock({
    header: extra.header ?? header,
    terms,
    minimum: MINIMUM,
    readAccount: async () => {
      if (fields === 'rpc-down') throw new Error('rpc');
      if (fields === 'missing') return null;
      return { owner: extra.owner ?? PROGRAM, data: escrowBytes(fields) };
    },
    readSlot: extra.slot ?? (async () => CURRENT_SLOT),
    replayStore: extra.replayStore ?? new MemoryNonceReplayStore(),
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

describe('settlement', () => {
  const locked = async () => (await verify()) as Extract<VerifiedLock, { ok: true }>;

  it('charges the actual cost, takes 2.5% rounded down, and builds the same bytes as the instruction builder', async () => {
    const lock = await locked();
    const { settlement, instruction, instructions } = meteredSettlement(terms, lock, { inputTokens: 120, outputTokens: 333 });
    // 120*3 + 333*15 = 5355 base units; fee floor(5355 * 0.025) = 133
    expect(settlement.chargedBaseUnits).toBe(BigInt(5355));
    expect(settlement).toMatchObject({ charged: '0.005355', fee: '0.000133', provider: '0.005222', refund: '0.010245', capped: false });
    const prep = prepareTokenPayout(lock.terms, payee);
    const direct = buildSettleTokenEscrowInstruction(lock.terms, false, payee, { actual: BigInt(5355), treasuryToken: prep.treasuryToken, refundTo: prep.refundTo });
    expect(instruction.data.equals(direct.data)).toBe(true);
    expect(instruction.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable])).toEqual(direct.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]));
    expect(instructions[instructions.length - 1]).toBe(instruction);
    expect(instructions.length).toBe(prep.instructions.length + 1);
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
