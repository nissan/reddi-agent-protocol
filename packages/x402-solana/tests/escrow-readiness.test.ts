import * as fs from 'fs';
import * as path from 'path';
import { Keypair, PublicKey } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import {
  ESCROW_MAINNET_MINTS,
  ESCROW_PROTOCOL_TREASURY,
  SYSTEM_ACCOUNT_RENT_EXEMPT_LAMPORTS,
  TREASURY_MIN_LAMPORTS,
  checkTreasuryReadiness,
  minimumSolPayout,
  prepareTokenPayout,
  mintPostureChanges,
  solPayoutWouldFail,
  token2022MintPosture,
  type ReadAccount,
  type Token2022MintPosture,
} from '../src';

describe('SOL payouts and rent', () => {
  it('flags a payout that would leave an empty account below the rent-exempt minimum', () => {
    expect(solPayoutWouldFail(0n, 195_000n)).toBe(true);
    expect(solPayoutWouldFail(0n, SYSTEM_ACCOUNT_RENT_EXEMPT_LAMPORTS - 1n)).toBe(true);
    expect(solPayoutWouldFail(0n, SYSTEM_ACCOUNT_RENT_EXEMPT_LAMPORTS)).toBe(false);
    expect(solPayoutWouldFail(SYSTEM_ACCOUNT_RENT_EXEMPT_LAMPORTS, 1n)).toBe(false);
    expect(solPayoutWouldFail(0n, 0n)).toBe(false);
  });

  it('says how much an unfunded payee must receive at least', () => {
    expect(minimumSolPayout(0n)).toBe(SYSTEM_ACCOUNT_RENT_EXEMPT_LAMPORTS);
    expect(minimumSolPayout(5_000_000n)).toBe(0n);
  });
});

describe('token payout preparation', () => {
  const payer = Keypair.generate().publicKey;
  const payee = Keypair.generate().publicKey;

  it.each([
    ['USDC', TOKEN_PROGRAM_ID],
    ['PYUSD', TOKEN_2022_PROGRAM_ID],
  ])('creates the %s treasury and payer token accounts only when asked, idempotently, paid by the funder', (symbol, tokenProgram) => {
    const { mint } = ESCROW_MAINNET_MINTS.find((m) => m.symbol === symbol)!;
    const plain = prepareTokenPayout({ mint, tokenProgram, payer }, payee);
    expect(plain.instructions).toEqual([]);
    expect(plain.treasuryToken.equals(getAssociatedTokenAddressSync(mint, ESCROW_PROTOCOL_TREASURY, true, tokenProgram))).toBe(true);
    expect(plain.refundTo.equals(getAssociatedTokenAddressSync(mint, payer, true, tokenProgram))).toBe(true);

    const prep = prepareTokenPayout({ mint, tokenProgram, payer }, payee, undefined, { createTreasuryAccount: true, createRefundAccount: true });
    expect(prep.instructions).toHaveLength(2);
    const [treasuryCreate, refundCreate] = prep.instructions;
    for (const ix of prep.instructions) {
      expect(ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
      expect(Array.from(ix.data)).toEqual([1]); // CreateIdempotent
      expect(ix.keys[0].pubkey.equals(payee)).toBe(true);
      expect(ix.keys[0].isSigner).toBe(true);
      expect(ix.keys[5].pubkey.equals(tokenProgram)).toBe(true);
    }
    expect(treasuryCreate.keys[1].pubkey.equals(prep.treasuryToken)).toBe(true);
    expect(treasuryCreate.keys[2].pubkey.equals(ESCROW_PROTOCOL_TREASURY)).toBe(true);
    expect(refundCreate.keys[1].pubkey.equals(prep.refundTo)).toBe(true);
    expect(refundCreate.keys[2].pubkey.equals(payer)).toBe(true);

    // A named refund account is used as given, and only the associated account can be created.
    const named = Keypair.generate().publicKey;
    expect(prepareTokenPayout({ mint, tokenProgram, payer }, payee, undefined, { refundTo: named }).refundTo.equals(named)).toBe(true);
    expect(() => prepareTokenPayout({ mint, tokenProgram, payer }, payee, undefined, { refundTo: named, createRefundAccount: true })).toThrow(/associated/);
  });

  it('refuses a third token program', () => {
    expect(() => prepareTokenPayout({ mint: ESCROW_MAINNET_MINTS[0].mint, tokenProgram: Keypair.generate().publicKey, payer }, payee)).toThrow('token program');
  });
});

describe('treasury readiness', () => {
  const tokenAccount = (mint: PublicKey, owner: PublicKey, state = 1): Uint8Array => {
    const data = new Uint8Array(165);
    data.set(mint.toBytes(), 0);
    data.set(owner.toBytes(), 32);
    data[108] = state; // 0 uninitialised, 1 initialised, 2 frozen
    return data;
  };
  const ready = (): Map<string, ReadAccount> => {
    const accounts = new Map<string, ReadAccount>();
    accounts.set(ESCROW_PROTOCOL_TREASURY.toBase58(), { lamports: TREASURY_MIN_LAMPORTS, owner: PublicKey.default, data: new Uint8Array() });
    for (const m of ESCROW_MAINNET_MINTS) {
      const ata = getAssociatedTokenAddressSync(m.mint, ESCROW_PROTOCOL_TREASURY, true, m.tokenProgram);
      accounts.set(ata.toBase58(), { lamports: 2_039_280, owner: m.tokenProgram, data: tokenAccount(m.mint, ESCROW_PROTOCOL_TREASURY) });
    }
    return accounts;
  };
  const lookup = (accounts: Map<string, ReadAccount>) => async (address: PublicKey) => accounts.get(address.toBase58()) ?? null;

  it('passes when the treasury holds enough SOL and a token account for every mint', async () => {
    const result = await checkTreasuryReadiness(lookup(ready()));
    expect(result.ok).toBe(true);
    expect(result.items.map((i) => i.name)).toEqual([
      'Treasury SOL balance',
      'Treasury USDC token account',
      'Treasury AUDD token account',
      'Treasury PYUSD token account',
      'Treasury USDG token account',
    ]);
  });

  it('fails on an unfunded treasury', async () => {
    const accounts = ready();
    accounts.set(ESCROW_PROTOCOL_TREASURY.toBase58(), { lamports: TREASURY_MIN_LAMPORTS - 1n, owner: PublicKey.default, data: new Uint8Array() });
    const result = await checkTreasuryReadiness(lookup(accounts));
    expect(result.ok).toBe(false);
    expect(result.items[0].ok).toBe(false);
  });

  it('fails on a missing, wrongly owned or wrong-program token account', async () => {
    const usdg = ESCROW_MAINNET_MINTS.find((m) => m.symbol === 'USDG')!;
    const ata = getAssociatedTokenAddressSync(usdg.mint, ESCROW_PROTOCOL_TREASURY, true, usdg.tokenProgram).toBase58();

    const missing = ready(); missing.delete(ata);
    expect((await checkTreasuryReadiness(lookup(missing))).items[4].detail).toMatch(/missing/);

    const stranger = ready();
    stranger.set(ata, { lamports: 1, owner: usdg.tokenProgram, data: tokenAccount(usdg.mint, Keypair.generate().publicKey) });
    expect((await checkTreasuryReadiness(lookup(stranger))).items[4].detail).toMatch(/not the treasury/);

    const wrongProgram = ready();
    wrongProgram.set(ata, { lamports: 1, owner: TOKEN_PROGRAM_ID, data: tokenAccount(usdg.mint, ESCROW_PROTOCOL_TREASURY) });
    const result = await checkTreasuryReadiness(lookup(wrongProgram));
    expect(result.ok).toBe(false);
    expect(result.items[4].detail).toMatch(/expected/);
  });

  it('fails on a frozen, uninitialised or truncated canonical token account', async () => {
    const usdc = ESCROW_MAINNET_MINTS[0];
    const ata = getAssociatedTokenAddressSync(usdc.mint, ESCROW_PROTOCOL_TREASURY, true, usdc.tokenProgram).toBase58();

    const frozen = ready();
    frozen.set(ata, { lamports: 2_039_280, owner: usdc.tokenProgram, data: tokenAccount(usdc.mint, ESCROW_PROTOCOL_TREASURY, 2) });
    const result = await checkTreasuryReadiness(lookup(frozen));
    expect(result.ok).toBe(false);
    expect(result.items[1]).toMatchObject({ ok: false, detail: 'frozen by the issuer' });

    const uninitialised = ready();
    uninitialised.set(ata, { lamports: 2_039_280, owner: usdc.tokenProgram, data: tokenAccount(usdc.mint, ESCROW_PROTOCOL_TREASURY, 0) });
    expect((await checkTreasuryReadiness(lookup(uninitialised))).items[1]).toMatchObject({ ok: false, detail: 'not initialised' });

    const truncated = ready();
    truncated.set(ata, { lamports: 1, owner: usdc.tokenProgram, data: tokenAccount(usdc.mint, ESCROW_PROTOCOL_TREASURY).subarray(0, 72) });
    expect((await checkTreasuryReadiness(lookup(truncated))).items[1]).toMatchObject({ ok: false, detail: 'not a token account' });
  });
});

describe('the mint list mirrors the program allowlist', () => {
  it('matches programs/pinocchio-escrow/program/src/consts.rs', () => {
    const consts = fs.readFileSync(path.join(__dirname, '../../../programs/pinocchio-escrow/program/src/consts.rs'), 'utf8');
    for (const m of ESCROW_MAINNET_MINTS) {
      const line = consts.split('\n').find((l) => l.includes(`pub const ${m.symbol}_MAINNET_MINT`));
      expect(line).toBeDefined();
      expect(line).toContain(m.mint.toBase58());
    }
    expect(consts).toContain(`PROTOCOL_TREASURY: Address = address!("${ESCROW_PROTOCOL_TREASURY.toBase58()}")`);
    const token2022 = consts.match(/ALLOWED_TOKEN_2022_MINTS: &\[Address\] = &\[([^\]]*)\]/)![1];
    for (const m of ESCROW_MAINNET_MINTS) {
      expect(token2022.includes(`${m.symbol}_MAINNET_MINT`)).toBe(m.tokenProgram.equals(TOKEN_2022_PROGRAM_ID));
    }
  });
});

describe('Token-2022 mint posture', () => {
  const recorded = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../config/escrow/token2022-mint-posture.json'), 'utf8'));

  it.each(['PYUSD', 'USDG'])('the recorded %s posture matches its mainnet fixture', (symbol) => {
    const entry = recorded.mints[symbol];
    const data = fs.readFileSync(path.join(__dirname, '../../..', entry.recordedFrom));
    expect(token2022MintPosture(data)).toEqual(entry.posture);
    expect(entry.address).toBe(ESCROW_MAINNET_MINTS.find((m) => m.symbol === symbol)!.mint.toBase58());
    // No hook, no fee, and the issuer holds the permanent delegate: the risk the docs describe.
    expect(entry.posture.transferHookProgram).toBeNull();
    expect(entry.posture.transferFee.newerBps).toBe(0);
    expect(entry.posture.permanentDelegate).not.toBeNull();
  });

  it('reports a transfer hook being switched on, and nothing when the posture is unchanged', () => {
    const before: Token2022MintPosture = recorded.mints.PYUSD.posture;
    expect(mintPostureChanges(before, before)).toEqual([]);
    const hook = Keypair.generate().publicKey.toBase58();
    const changes = mintPostureChanges(before, { ...before, transferHookProgram: hook, transferFee: { ...before.transferFee!, newerBps: 50 } });
    expect(changes).toHaveLength(2);
    expect(changes[0]).toBe(`transferHookProgram: null -> "${hook}"`);
    expect(changes[1]).toMatch(/^transferFee: .*"newerBps":0.* -> .*"newerBps":50/);
  });
});
