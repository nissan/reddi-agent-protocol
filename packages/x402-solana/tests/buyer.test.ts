import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { buildX402Challenge } from '../src/payment';
import { parseX402Challenge, planBuyerDirectPayment } from '../src/buyer';
import type { BuyerDirectPaymentInput } from '../src/buyer';

const provider = Keypair.generate().publicKey.toBase58();
const other = Keypair.generate().publicKey.toBase58();
const treasury = Keypair.generate().publicKey.toBase58();
const buyer = Keypair.generate().publicKey;
const usdcMint = Keypair.generate().publicKey;
const endpoint = '/v1/chat/completions';

const challengeFor = (overrides: Record<string, unknown> = {}, withFee = true) => ({
  ...buildX402Challenge(
    { network: 'solana-devnet', payTo: provider, amount: '0.01', currency: 'SOL', endpoint, nonce: 'buyer-1' },
    withFee ? { protocolFee: { treasury } } : {},
  ),
  ...overrides,
});

const plan = (challenge: unknown, overrides: Partial<BuyerDirectPaymentInput> = {}) => planBuyerDirectPayment({
  challenge,
  listing: { payTo: provider, amount: '0.01', currency: 'SOL' },
  network: 'solana-devnet',
  spendCap: '0.02',
  payer: buyer,
  ...overrides,
});

describe('buyer direct payment plan', () => {
  // RAP-738-S1 (buyer half): a matching challenge yields instructions and a receipt for the real signature.
  it('plans a SOL payment that pays the listed price in total and names the split', () => {
    const result = plan(JSON.stringify(challengeFor()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalBaseUnits).toBe(BigInt(10_000_000));
    expect(result.instructions).toHaveLength(2);
    expect(result.instructions.every((ix) => ix.programId.equals(SystemProgram.programId))).toBe(true);
    const paid = result.instructions.reduce((sum, ix) => sum + ix.data.readBigUInt64LE(4), BigInt(0));
    expect(paid).toBe(BigInt(10_000_000));
    expect(result.fee).toMatchObject({ bps: 5, payTo: treasury, amount: '0.000005', providerAmount: '0.009995' });
    expect(result.receiptFor('5ig')).toEqual({
      network: 'solana-devnet', payTo: provider, amount: '0.01', currency: 'SOL', nonce: 'buyer-1', signature: '5ig', payer: buyer.toBase58(),
    });
  });

  it('plans a USDC payment with the buyer configured mint and puts that mint on the receipt', () => {
    const challenge = buildX402Challenge({ network: 'solana-devnet', payTo: provider, amount: '1', currency: 'USDC', endpoint, nonce: 'buyer-usdc' }, { protocolFee: { treasury } });
    const result = plan(challenge, { listing: { payTo: provider, amount: '1', currency: 'USDC' }, spendCap: '1', usdcMint });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.instructions).toHaveLength(2);
    expect(result.instructions.every((ix) => ix.programId.equals(TOKEN_PROGRAM_ID))).toBe(true);
    expect(result.receiptFor('sig').mint).toBe(usdcMint.toBase58());
  });

  it('plans a single transfer when the challenge states no fee', () => {
    const result = plan(challengeFor({}, false));
    expect(result.ok && result.instructions.length).toBe(1);
  });

  it('accepts a price below the listed price', () => {
    const cheaper = buildX402Challenge({ network: 'solana-devnet', payTo: provider, amount: '0.004', currency: 'SOL', endpoint, nonce: 'cheap' });
    expect(plan(cheaper).ok).toBe(true);
  });

  // RAP-738-S3 (buyer half): nothing is built for a challenge that does not match what the buyer selected.
  it.each([
    ['a different payee', { payTo: other }, {}, 'wrong_payee'],
    ['a different network', { network: 'solana-mainnet-beta' }, {}, 'wrong_network'],
    ['a different currency', { currency: 'USDC' }, {}, 'wrong_currency'],
    ['an unsupported currency', { currency: 'EURC', fee: undefined }, { listing: { payTo: provider, amount: '0.01', currency: 'EURC' } }, 'wrong_currency'],
    ['a price above the listing', { amount: '0.010000001', fee: undefined }, {}, 'price_above_listing'],
    ['a price above the spend cap', {}, { spendCap: '0.009999999' }, 'above_spend_cap'],
    ['a zero spend cap', {}, { spendCap: 0 }, 'above_spend_cap'],
    ['a fee rate above the accepted rate', { fee: { bps: 50, payTo: treasury, amount: '0.00005', providerAmount: '0.00995' } }, {}, 'fee_terms_rejected'],
    ['fee terms that do not add up', { fee: { bps: 5, payTo: treasury, amount: '0.000005', providerAmount: '0.01' } }, {}, 'fee_terms_rejected'],
    ['a fee paid to the payee', { fee: { bps: 5, payTo: provider, amount: '0.000005', providerAmount: '0.009995' } }, {}, 'fee_terms_rejected'],
    ['a missing nonce', { nonce: '' }, {}, 'invalid_challenge'],
    ['an invalid payee address', { payTo: 'not-a-key' }, {}, 'invalid_challenge'],
    ['a negative amount', { amount: '-1', fee: undefined }, {}, 'invalid_challenge'],
  ])('refuses %s', (_name, challengeOverrides, inputOverrides, reason) => {
    const result = plan(challengeFor(challengeOverrides as Record<string, unknown>), inputOverrides as Partial<BuyerDirectPaymentInput>);
    expect(result).toMatchObject({ ok: false, reason });
    expect('instructions' in result).toBe(false);
  });

  it('refuses USDC when the buyer has no mint configured, whatever the challenge says', () => {
    const challenge = { ...buildX402Challenge({ network: 'solana-devnet', payTo: provider, amount: '1', currency: 'USDC', endpoint, nonce: 'no-mint' }), mint: other };
    const result = plan(challenge, { listing: { payTo: provider, amount: '1', currency: 'USDC' }, spendCap: '1' });
    expect(result).toMatchObject({ ok: false, reason: 'invalid_challenge' });
  });

  it.each([['not json'], ['[]'], ['null'], [42], [undefined]])('refuses an unreadable challenge: %p', (raw) => {
    expect(plan(raw)).toMatchObject({ ok: false, reason: 'invalid_challenge' });
    expect(parseX402Challenge(raw)).toBeUndefined();
  });

  // RAP-738-S5 (buyer half): a placeholder signature never becomes a receipt.
  it('will not build a receipt from an empty or mock signature', () => {
    const result = plan(challengeFor());
    if (!result.ok) throw new Error('expected a plan');
    expect(() => result.receiptFor('')).toThrow('real transaction signature');
    expect(() => result.receiptFor('mock_tx_signature_abc')).toThrow('real transaction signature');
  });

  it('drops fields it does not know from the parsed challenge', () => {
    const parsed = parseX402Challenge({ ...challengeFor(), mint: other, payerAddress: other });
    expect(parsed && Object.keys(parsed).sort()).toEqual(['amount', 'currency', 'endpoint', 'fee', 'network', 'nonce', 'payTo', 'version']);
  });
});
