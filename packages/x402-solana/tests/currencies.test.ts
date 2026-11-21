import { Keypair, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  buildX402Challenge,
  DIRECT_PAYMENT_CURRENCIES,
  directPaymentCurrency,
  MAINNET_STABLECOIN_MINTS,
  SolanaReceiptVerifier,
} from '../src/payment';
import { buildDirectPaymentInstructions } from '../src/direct-payment';
import { planBuyerDirectPayment } from '../src/buyer';
import { MemoryNonceReplayStore } from '../src/nonce';

const CLASSIC = TOKEN_PROGRAM_ID.toBase58();
const TOKEN_2022 = TOKEN_2022_PROGRAM_ID.toBase58();
const provider = Keypair.generate().publicKey.toBase58();
const buyer = Keypair.generate().publicKey;
const treasury = Keypair.generate().publicKey.toBase58();
const endpoint = '/v1/chat/completions';
const fee = { treasury };

// Disposable mints standing in for each currency. Never the real mainnet mints.
const mints: Record<string, string> = {
  USDC: Keypair.generate().publicKey.toBase58(),
  AUDD: Keypair.generate().publicKey.toBase58(),
  PYUSD: Keypair.generate().publicKey.toBase58(),
  USDG: Keypair.generate().publicKey.toBase58(),
};
const cases: [string, string][] = [['USDC', CLASSIC], ['AUDD', CLASSIC], ['PYUSD', TOKEN_2022], ['USDG', TOKEN_2022]];

const challengeFor = (currency: string, nonce: string, amount = '1') =>
  buildX402Challenge({ network: 'solana-devnet', payTo: provider, amount, currency, endpoint, nonce }, { protocolFee: fee });
const receiptFor = (currency: string, nonce: string, amount = '1') =>
  ({ network: 'solana-devnet', payTo: provider, amount, currency, nonce, payer: buyer.toBase58(), signature: `sig-${currency}-${nonce}` });
const leg = (programId: string, mint: string, destination: string, baseUnits: string) => ({
  program: 'spl-token', programId,
  parsed: { type: 'transferChecked', info: { mint, authority: buyer.toBase58(), destination, tokenAmount: { amount: baseUnits, decimals: 6 } } },
});
const tx = (mint: string, instructions: unknown[]) => ({
  meta: { err: null, postTokenBalances: [{ accountIndex: 1, mint, owner: provider }, { accountIndex: 2, mint, owner: treasury }] },
  transaction: { message: { accountKeys: ['buyer-ta', 'provider-ta', 'treasury-ta'], instructions } },
});
const verifier = (parsed: unknown, options: Record<string, unknown> = { mints }) => new SolanaReceiptVerifier({ payerProof: 'not-required',
  allowRealPayment: true,
  protocolFee: fee,
  connection: { async getParsedTransaction() { return parsed; } },
  ...options,
} as never);
const splitTx = (currency: string, programId: string, mint = mints[currency]) =>
  tx(mint, [leg(programId, mint, 'provider-ta', '975000'), leg(programId, mint, 'treasury-ta', '25000')]);

describe('direct payment currencies', () => {
  it('fixes the token program and six decimals for each stablecoin', () => {
    expect(Object.keys(DIRECT_PAYMENT_CURRENCIES).sort()).toEqual(['AUDD', 'PYUSD', 'SOL', 'USDC', 'USDG']);
    for (const [currency, program] of cases) expect(directPaymentCurrency(currency)).toEqual({ decimals: 6, tokenProgram: program });
    expect(directPaymentCurrency('SOL')).toEqual({ decimals: 9 });
    expect(directPaymentCurrency('toString')).toBeUndefined();
    expect(directPaymentCurrency('usdc')).toBeUndefined();
    expect(Object.keys(MAINNET_STABLECOIN_MINTS).sort()).toEqual(['AUDD', 'PYUSD', 'USDC', 'USDG']);
    for (const mint of Object.values(MAINNET_STABLECOIN_MINTS)) expect(() => new PublicKey(mint)).not.toThrow();
  });

  // RAP-TOK-S4
  describe.each(cases)('%s', (currency, program) => {
    const mint = new PublicKey(mints[currency]);
    const programKey = new PublicKey(program);

    it('builds both legs under its own token program, to accounts derived from that program', () => {
      const instructions = buildDirectPaymentInstructions({ challenge: challengeFor(currency, 'build'), payer: buyer, mint });
      expect(instructions).toHaveLength(2);
      expect(instructions.every((ix) => ix.programId.equals(programKey))).toBe(true);
      const ata = (owner: string) => getAssociatedTokenAddressSync(mint, new PublicKey(owner), true, programKey);
      expect(instructions[0].keys[0].pubkey.equals(ata(buyer.toBase58()))).toBe(true);
      expect(instructions[0].keys[1].pubkey.equals(mint)).toBe(true);
      expect(instructions[0].keys[2].pubkey.equals(ata(provider))).toBe(true);
      expect(instructions[1].keys[2].pubkey.equals(ata(treasury))).toBe(true);
      expect(instructions[0].data.readBigUInt64LE(1)).toBe(BigInt(975_000));
      expect(instructions[1].data.readBigUInt64LE(1)).toBe(BigInt(25_000));
    });

    it('plans a buyer payment and names the configured mint on the receipt', () => {
      const result = planBuyerDirectPayment({
        challenge: challengeFor(currency, 'plan'), listing: { payTo: provider, amount: '1', currency }, network: 'solana-devnet', spendCap: '1', payer: buyer, mint,
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.receiptFor('sig').mint).toBe(mint.toBase58());
    });

    it('refuses to plan without a configured mint', () => {
      const result = planBuyerDirectPayment({
        challenge: challengeFor(currency, 'no-mint'), listing: { payTo: provider, amount: '1', currency }, network: 'solana-devnet', spendCap: '1', payer: buyer,
      });
      expect(result).toMatchObject({ ok: false, reason: 'invalid_challenge' });
    });

    it('verifies a split paid under its own token program', async () => {
      const result = await verifier(splitTx(currency, program))
        .verifyReceipt(receiptFor(currency, 'ok'), challengeFor(currency, 'ok'), new MemoryNonceReplayStore());
      expect(result).toMatchObject({ ok: true, fee: { amount: '0.025', providerAmount: '0.975' } });
    });

    it('refuses the same transfers made under the other token program', async () => {
      const other = program === CLASSIC ? TOKEN_2022 : CLASSIC;
      const result = await verifier(splitTx(currency, other))
        .verifyReceipt(receiptFor(currency, 'prog'), challengeFor(currency, 'prog'), new MemoryNonceReplayStore());
      expect(result).toMatchObject({ ok: false, reason: 'invalid_receipt' });
      if (!result.ok) expect(result.message).toContain('protocol fee');
    });

    // RAP-TOK-S5
    it('refuses a transfer of a different mint presented under this currency', async () => {
      const impostor = Keypair.generate().publicKey.toBase58();
      const result = await verifier(splitTx(currency, program, impostor))
        .verifyReceipt(receiptFor(currency, 'mint'), challengeFor(currency, 'mint'), new MemoryNonceReplayStore());
      expect(result.ok).toBe(false);
      const named = await verifier(splitTx(currency, program))
        .verifyReceipt({ ...receiptFor(currency, 'named'), mint: impostor }, challengeFor(currency, 'named'), new MemoryNonceReplayStore());
      expect(named.ok).toBe(false);
    });

    it('refuses a payment that leaves out the fee leg', async () => {
      const whole = tx(mints[currency], [leg(program, mints[currency], 'provider-ta', '1000000')]);
      const result = await verifier(whole).verifyReceipt(receiptFor(currency, 'nofee'), challengeFor(currency, 'nofee'), new MemoryNonceReplayStore());
      expect(result.ok).toBe(false);
    });
  });

  it.each([['AUDD'], ['PYUSD'], ['USDG']])('refuses %s when the operator has not configured its mint, even with a USDC mint set', async (currency) => {
    const program = directPaymentCurrency(currency)!.tokenProgram!;
    const result = await verifier(splitTx(currency, program), { usdcMint: mints.USDC })
      .verifyReceipt(receiptFor(currency, 'unset'), challengeFor(currency, 'unset'), new MemoryNonceReplayStore());
    expect(result).toMatchObject({ ok: false, reason: 'unsupported_receipt' });
  });

  it('does not read an inherited key as a configured mint', async () => {
    const proto = Object.create({ PYUSD: mints.PYUSD });
    const result = await verifier(splitTx('PYUSD', TOKEN_2022), { mints: proto })
      .verifyReceipt(receiptFor('PYUSD', 'proto'), challengeFor('PYUSD', 'proto'), new MemoryNonceReplayStore());
    expect(result).toMatchObject({ ok: false, reason: 'unsupported_receipt' });
  });

  it('refuses a fee-bearing AUDD receipt through the legacy auddMint option, which has no fee split', async () => {
    const result = await verifier(splitTx('AUDD', CLASSIC), { auddMint: mints.AUDD })
      .verifyReceipt(receiptFor('AUDD', 'legacy'), challengeFor('AUDD', 'legacy'), new MemoryNonceReplayStore());
    expect(result).toMatchObject({ ok: false, reason: 'unsupported_receipt' });
    if (!result.ok) expect(result.message).toContain('mints');
  });

  it('keeps the older usdcMint option working for USDC', async () => {
    const result = await verifier(splitTx('USDC', CLASSIC), { usdcMint: mints.USDC })
      .verifyReceipt(receiptFor('USDC', 'old'), challengeFor('USDC', 'old'), new MemoryNonceReplayStore());
    expect(result.ok).toBe(true);
  });
});
