// All five currencies end to end on an embedded Surfpool (#1155, S7.10).
//
// The program under test is the deployed devnet build, forked from devnet
// (its allowlist takes mainnet USDC and AUDD, and the Token-2022 PYUSD and
// USDG, as well as devnet USDC). The mainnet mints are not on devnet, so their
// account bytes come from a snapshot taken from mainnet
// (`fixtures/mainnet-mints.json`) and are written into the fork. Token
// balances are set with Surfpool's cheatcodes; nothing here signs on a real
// network.
//
// Per currency: metered lock and payee settle below the maximum; fixed lock
// and payer release; payee decline; payer refund refused before its window and
// paid after it; and a Budget open, reserve, post, close early and payout
// after the dispute window. Every payout checks the provider's, treasury's and
// payer's amounts against the fee math (2.5% launch rate, rounded down, no cap
// on tokens, 0.1 SOL cap on SOL).
//
//   npm run test:surfpool:currencies

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import { Surfnet } from '@solana/surfpool';
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_CLOCK_PUBKEY, Transaction, TransactionInstruction } from '@solana/web3.js';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const jiti = createJiti(import.meta.url);
const B = await jiti.import(path.join(root, 'packages/x402-solana/src/budget.ts'));
const TE = await jiti.import(path.join(root, 'packages/x402-solana/src/token-escrow.ts'));
const R = await jiti.import(path.join(root, 'packages/x402-solana/src/rating.ts'));
const P = await jiti.import(path.join(root, 'packages/x402-solana/src/payment.ts'));
const D = await jiti.import(path.join(root, 'packages/x402-solana/src/direct-payment.ts'));
const NONCE = await jiti.import(path.join(root, 'packages/x402-solana/src/nonce.ts'));
const require = createRequire(import.meta.url);
const spl = require('@solana/spl-token');

const PROGRAM = new PublicKey('DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu');
const TREASURY = new PublicKey('5CsBuTBFKu12JSs4CUbmv5MR218RYtNmAoQmLf5x3Hxe');
const BURN = new PublicKey('1nc1nerator11111111111111111111111111111111');
const FIXTURE = path.join(here, 'fixtures/mainnet-mints.json');
const snapshot = fs.existsSync(FIXTURE) ? JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) : null;

const CURRENCIES = [
  { symbol: 'USDC (devnet)', mint: new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'), program: spl.TOKEN_PROGRAM_ID },
  ...['USDC', 'AUDD', 'PYUSD', 'USDG'].map((symbol) => ({
    symbol,
    fromSnapshot: true,
    mint: snapshot?.[symbol] ? new PublicKey(snapshot[symbol].address) : null,
    program: snapshot?.[symbol] ? new PublicKey(snapshot[symbol].owner) : null,
  })),
];

const OPEN = 648_000n;
const DISPUTE = 216_000n;
const JUDGE = 648_000n;
const CLAIM = 1_500n;
const CANCEL = 4_500n;
const launchFee = (paid, sol) => {
  const fee = paid / 40n;
  return sol && fee > 100_000_000n ? 100_000_000n : fee;
};

let surfnet;
let c;
const disc = (name) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const agentOf = (owner) => PublicKey.findProgramAddressSync([Buffer.from('agent'), owner.toBuffer()], PROGRAM)[0];
const fund = (who, lamports = 2_000_000_000) => surfnet.fundSol(who.publicKey.toBase58(), lamports);
const clockSlot = async () => (await c.getAccountInfo(SYSVAR_CLOCK_PUBKEY, 'processed')).data.readBigUInt64LE(0);
const lamports = async (k) => BigInt(await c.getBalance(k, 'processed'));

/** Jump to `target`, then wait for the clock sysvar itself (Surfpool 1.5.0 can serve a stale clock right after a jump). */
async function travelTo(target) {
  // A jump to a slot already passed fails (-32603): slots keep ticking, so only jump forward.
  if ((await clockSlot()) < target) surfnet.timeTravelToSlot(Number(target));
  for (let i = 0; i < 200; i += 1) {
    if ((await clockSlot()) >= target) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`clock did not reach slot ${target}`);
}

/** Sends, waits, returns the landing slot. */
async function send(ixs, signers) {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = signers[0].publicKey;
  tx.recentBlockhash = (await c.getLatestBlockhash('processed')).blockhash;
  tx.sign(...signers);
  const sig = await c.sendRawTransaction(tx.serialize(), { preflightCommitment: 'processed' });
  let st;
  for (let i = 0; i < 200; i += 1) {
    st = await c.getSignatureStatus(sig);
    if (st.value) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  if (!st?.value) throw new Error(`not confirmed: ${sig}`);
  if (st.value.err) throw new Error(`failed: ${JSON.stringify(st.value.err)}`);
  return BigInt(st.value.slot);
}

function errorNumber(e) {
  const text = [e?.message ?? '', ...(e?.transactionLogs ?? [])].join('\n');
  const hex = text.match(/custom program error: 0x([0-9a-f]+)/i);
  return hex ? parseInt(hex[1], 16) : undefined;
}
async function refuses(code, ixs, signers, what) {
  await assert.rejects(send(ixs, signers), (e) => {
    assert.equal(errorNumber(e), code, `${what}: expected ${code}, got ${errorNumber(e)} (${e.message.slice(0, 200)})`);
    return true;
  }, `${what}: expected error ${code} but it landed`);
}

function registerAgentIx(owner, agentType) {
  const name = Buffer.from('sandbox/currencies', 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(name.length);
  const rate = Buffer.alloc(8);
  rate.writeBigUInt64LE(1_000n);
  return new TransactionInstruction({
    programId: PROGRAM,
    data: Buffer.concat([disc('register_agent'), Buffer.from([agentType]), len, name, rate, Buffer.from([0])]),
    keys: [
      { pubkey: agentOf(owner), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: BURN, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
}
async function newAgent(agentType = 0) {
  const kp = Keypair.generate();
  fund(kp);
  await send([registerAgentIx(kp.publicKey, agentType)], [kp]);
  return kp;
}

async function startSurfnet() {
  surfnet = Surfnet.startWithConfig({ offline: false, remoteRpcUrl: process.env.RAP_BUDGET_SURFPOOL_REMOTE ?? 'https://api.devnet.solana.com' });
  c = new Connection(surfnet.rpcUrl, 'processed');
  assert.ok((await c.getAccountInfo(PROGRAM))?.executable, 'the escrow program is not on the fork');
  for (const symbol of ['USDC', 'AUDD', 'PYUSD', 'USDG']) {
    const a = snapshot?.[symbol];
    if (a) surfnet.setAccount(a.address, Number(a.lamports), Buffer.from(a.dataBase64, 'base64'), a.owner);
  }
  for (const [, a] of Object.entries(snapshot?.extra ?? {})) {
    if (a?.address && a.dataBase64 !== undefined) surfnet.setAccount(a.address, Number(a.lamports), Buffer.from(a.dataBase64, 'base64'), a.owner);
  }
}
/** Each group gets its own fork: a long-lived one with many jumps grew unstable. */
function freshSurfnet() {
  before(startSurfnet);
  after(() => {
    try {
      surfnet?.stop();
    } catch {
      // already gone
    }
  });
}

/** A payer with `amount` of the currency, a registered payee with an empty account, and the treasury's account. */
async function parties(cur, amount) {
  const payer = Keypair.generate();
  fund(payer);
  const payee = await newAgent(0);
  const ata = (k) => spl.getAssociatedTokenAddressSync(cur.mint, k, true, cur.program);
  // Create the accounts through the associated token program, so they carry the
  // extensions the mint requires (TransferFeeAmount for PYUSD and USDG), as on a
  // real cluster; Surfpool's fundToken alone makes a bare account. Then set the balance.
  const create = [payer.publicKey, payee.publicKey, TREASURY]
    .filter((k, i, all) => all.indexOf(k) === i)
    .map((k) => spl.createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata(k), k, cur.mint, cur.program));
  await send(create, [payer]);
  // Surfpool's balance cheatcode rewrites a token account without its
  // extensions, so give the balance to a throwaway holder and transfer it in
  // (with the mint charging no fee at that moment).
  const holder = Keypair.generate();
  fund(holder, 100_000_000);
  surfnet.setTokenBalance(holder.publicKey.toBase58(), cur.mint.toBase58(), Number(amount), cur.program.toBase58());
  await send([spl.createTransferCheckedInstruction(ata(holder.publicKey), cur.mint, ata(payer.publicKey), holder.publicKey, amount, 6, [], cur.program)], [holder]);
  const treasuryToken = ata(TREASURY);
  return { payer, payee, source: ata(payer.publicKey), recipient: ata(payee.publicKey), treasuryToken };
}
const balance = async (account) => BigInt((await c.getTokenAccountBalance(account, 'processed')).value.amount);

function tokenTerms(cur, p, amount, metered) {
  return {
    programId: PROGRAM, tokenProgram: cur.program, payer: p.payer.publicKey, payee: p.payee.publicKey, mint: cur.mint,
    source: p.source, recipient: p.recipient, amount, nonce: randomBytes(16), metered, claimWindowSlots: CLAIM, cancelWindowSlots: CANCEL,
  };
}

for (const cur of CURRENCIES) {
  describe(cur.symbol, { skip: cur.fromSnapshot && !cur.mint ? 'no mainnet mint snapshot (fixtures/mainnet-mints.json)' : false }, () => {
    freshSurfnet();
    const MAX = 2_000_000n; // 2 units at 6 decimals

    test('mint is as the program expects: 6 decimals, the allowlisted token program', async () => {
      const info = await c.getAccountInfo(cur.mint, 'processed');
      assert.ok(info, 'mint present on the fork');
      assert.ok(info.owner.equals(cur.program));
      const mint = spl.unpackMint(cur.mint, info, cur.program);
      assert.equal(mint.decimals, 6);
      if (cur.program.equals(spl.TOKEN_2022_PROGRAM_ID)) {
        const types = spl.getExtensionTypes(mint.tlvData).map((t) => spl.ExtensionType[t]);
        console.log(`${cur.symbol} Token-2022 extensions: ${types.join(', ') || 'none'}`);
        const fee = spl.getTransferFeeConfig(mint);
        if (fee) console.log(`${cur.symbol} transfer fee now: ${fee.newerTransferFee.transferFeeBasisPoints} bps (older ${fee.olderTransferFee.transferFeeBasisPoints})`);
      }
    });

    test('metered: lock the maximum, payee settles less; payee, treasury and payer amounts match the fee math', async () => {
      const p = await parties(cur, MAX);
      const t = tokenTerms(cur, p, MAX, true);
      const created = await send([TE.buildLockTokenEscrowInstruction(t)], [p.payer]);
      assert.equal(await balance(p.source), 0n);
      await travelTo(created + 1n);
      const actual = 1_234_567n;
      const before = await balance(p.treasuryToken);
      await send([R.buildTokenEscrowExitInstruction(t, { rated: false, createdSlot: created, authority: p.payee.publicKey, options: { actual } })], [p.payee]);
      const fee = launchFee(actual, false);
      assert.equal(await balance(p.recipient), actual - fee, 'provider');
      assert.equal((await balance(p.treasuryToken)) - before, fee, 'treasury');
      assert.equal(await balance(p.source), MAX - actual, 'payer refund of the unused maximum');
    });

    test('fixed price: payer releases in full', async () => {
      const p = await parties(cur, MAX);
      const t = tokenTerms(cur, p, MAX, false);
      const created = await send([TE.buildLockTokenEscrowInstruction(t)], [p.payer]);
      await travelTo(created + 1n);
      const before = await balance(p.treasuryToken);
      await send([R.buildTokenEscrowExitInstruction(t, { rated: false, createdSlot: created })], [p.payer]);
      const fee = launchFee(MAX, false);
      assert.equal(await balance(p.recipient), MAX - fee);
      assert.equal((await balance(p.treasuryToken)) - before, fee);
      assert.equal(await balance(p.source), 0n);
    });

    test('payee declines: everything back to the payer, no fee', async () => {
      const p = await parties(cur, MAX);
      const t = tokenTerms(cur, p, MAX, true);
      const created = await send([TE.buildLockTokenEscrowInstruction(t)], [p.payer]);
      await travelTo(created + 1n);
      const before = await balance(p.treasuryToken);
      await send([R.buildTokenEscrowExitInstruction(t, { rated: false, createdSlot: created, refund: true, authority: p.payee.publicKey })], [p.payee]);
      assert.equal(await balance(p.source), MAX);
      assert.equal(await balance(p.treasuryToken), before);
    });

    test('payer refund: refused before the cancel window, paid in full after it', async () => {
      const p = await parties(cur, MAX);
      const t = tokenTerms(cur, p, MAX, false);
      const created = await send([TE.buildLockTokenEscrowInstruction(t)], [p.payer]);
      await travelTo(created + CANCEL - 2n);
      await refuses(6006, [R.buildTokenEscrowExitInstruction(t, { rated: false, createdSlot: created, refund: true })], [p.payer], 'early refund');
      await travelTo(created + CANCEL);
      await send([R.buildTokenEscrowExitInstruction(t, { rated: false, createdSlot: created, refund: true })], [p.payer]);
      assert.equal(await balance(p.source), MAX);
      assert.equal(await balance(p.recipient), 0n);
    });

    test('Budget: open, reserve, post, close early, payout after the dispute window', async () => {
      const total = 10_000_000n;
      const p = await parties(cur, total);
      const spender = Keypair.generate();
      fund(spender, 100_000_000);
      const judge = await newAgent(1);
      const nonce = randomBytes(16);
      const budget = B.budgetAddress(p.payer.publicKey, nonce, PROGRAM);
      const created = await send([B.openBudgetInstruction({
        programId: PROGRAM, payer: p.payer.publicKey, nonce, spender: spender.publicKey, judge: judge.publicKey,
        openSlots: OPEN, disputeSlots: DISPUTE, judgeSlots: JUDGE, total, token: { mint: cur.mint, source: p.source, tokenProgram: cur.program },
      })], [p.payer]);
      assert.equal(await balance(B.budgetVaultAddress(budget, PROGRAM)), total);
      await travelTo(created + 1n);
      const of = { programId: PROGRAM, budget, createdSlot: created };
      await send([B.reserveInstruction({ ...of, spender: spender.publicKey, payee: p.payee.publicKey, amount: total / 4n, payoutAccount: p.recipient })], [p.payee, spender]);
      const posted = 987_654n;
      await send([B.postFinalInstruction({ ...of, payee: p.payee.publicKey, amount: posted })], [p.payee]);
      await send([B.closeBudgetInstruction({ ...of, signer: p.payer.publicKey, payer: p.payer.publicKey, token: { mint: cur.mint, refund: p.source, tokenProgram: cur.program } })], [p.payer]);
      assert.equal(await balance(p.source), total - total / 4n, 'unreserved part back at close');
      const state = B.decodeBudget((await c.getAccountInfo(budget, 'processed')).data);
      const slice = B.decodeReservation((await c.getAccountInfo(B.reservationAddress(budget, p.payee.publicKey, PROGRAM), 'processed')).data);
      await travelTo(B.disputeEnds(state, slice));
      const before = await balance(p.treasuryToken);
      await send([B.payoutInstruction({
        ...of, payee: p.payee.publicKey, payer: p.payer.publicKey, treasury: TREASURY,
        token: { mint: cur.mint, payoutAccount: p.recipient, treasuryToken: p.treasuryToken, refund: p.source, tokenProgram: cur.program },
      })], [p.payer]);
      const fee = launchFee(posted, false);
      assert.equal(await balance(p.recipient), posted - fee, 'provider');
      assert.equal((await balance(p.treasuryToken)) - before, fee, 'treasury');
      assert.equal(await balance(p.source), total - posted, 'payer');
    });
  });
}

describe('SOL', () => {
  freshSurfnet();
  const MAX = 50_000_000n; // 0.05 SOL

  async function solParties() {
    const payer = Keypair.generate();
    fund(payer);
    const payee = await newAgent(0);
    return { payer, payee };
  }
  const solLock = async (p, metered) => {
    const nonce = randomBytes(16);
    const terms = { programId: PROGRAM, payer: p.payer.publicKey, payee: p.payee.publicKey, amount: MAX, nonce, metered, claimWindowSlots: CLAIM, cancelWindowSlots: CANCEL };
    const created = await send([R.buildLockSolEscrowInstruction(terms)], [p.payer]);
    await travelTo(created + 1n);
    return { escrow: R.solEscrowPda(p.payer.publicKey, nonce, PROGRAM), created };
  };

  test('metered: payee settles less; amounts and fee', async () => {
    const p = await solParties();
    const { escrow, created } = await solLock(p, true);
    const actual = 12_345_678n;
    const payeeBefore = await lamports(p.payee.publicKey);
    const treasuryBefore = await lamports(TREASURY);
    const payerBefore = await lamports(p.payer.publicKey);
    await send([R.buildSettleSolEscrowInstruction({ programId: PROGRAM, escrow, payer: p.payer.publicKey, payee: p.payee.publicKey, createdSlot: created, actual })], [p.payee]);
    const fee = launchFee(actual, true);
    assert.equal((await lamports(TREASURY)) - treasuryBefore, fee);
    // The payee paid the transaction fee (5,000 lamports) and gets actual - fee.
    assert.equal((await lamports(p.payee.publicKey)) - payeeBefore, actual - fee - 5_000n);
    // The payer gets the unused maximum and the escrow's rent back.
    assert.ok((await lamports(p.payer.publicKey)) - payerBefore >= MAX - actual);
  });

  test('payer releases in full; payer refund only after the window', async () => {
    const p = await solParties();
    const a = await solLock(p, false);
    const treasuryBefore = await lamports(TREASURY);
    await send([R.buildReleaseSolEscrowInstruction({ programId: PROGRAM, escrow: a.escrow, payer: p.payer.publicKey, payee: p.payee.publicKey, createdSlot: a.created })], [p.payer]);
    assert.equal((await lamports(TREASURY)) - treasuryBefore, launchFee(MAX, true));

    const b = await solLock(p, false);
    const cancel = R.buildCancelSolEscrowInstruction({ programId: PROGRAM, escrow: b.escrow, payer: p.payer.publicKey, authority: p.payer.publicKey, createdSlot: b.created });
    await refuses(6006, [cancel], [p.payer], 'early SOL refund');
    await travelTo(b.created + CANCEL);
    const payerBefore = await lamports(p.payer.publicKey);
    await send([cancel], [p.payer]);
    assert.ok((await lamports(p.payer.publicKey)) - payerBefore >= MAX - 5_000n);
  });
});

// S2: a Token-2022 issuer switches on a transfer fee. Today PYUSD and USDG
// charge 0 bps; their issuer can raise it at any time. The mint bytes of the
// snapshot are changed here to charge 50 bps (older and newer schedule alike).
describe('PYUSD with a transfer fee switched on (S2)', { skip: snapshot?.PYUSD ? false : 'no mainnet mint snapshot' }, () => {
  freshSurfnet();
  const cur = CURRENCIES.find((x) => x.symbol === 'PYUSD');
  const FEE_BPS = 50;

  /** The PYUSD snapshot with TransferFeeConfig (extension 1) charging `bps`, maximum fee unbounded. */
  function setTransferFee(bps) {
    const a = snapshot.PYUSD;
    const data = Buffer.from(a.dataBase64, 'base64');
    let at = 166; // 165-byte base (mint padded to an account) and the account-type byte
    let found = false;
    while (at + 4 <= data.length) {
      const type = data.readUInt16LE(at);
      const len = data.readUInt16LE(at + 2);
      if (type === 1) {
        const v = at + 4 + 32 + 32 + 8; // authorities, withheld amount
        for (const schedule of [v, v + 18]) {
          data.writeBigUInt64LE(0n, schedule); // epoch
          data.writeBigUInt64LE(0xffffffffffffffffn, schedule + 8); // maximum fee
          data.writeUInt16LE(bps, schedule + 16);
        }
        found = true;
        break;
      }
      at += 4 + len;
    }
    assert.ok(found, 'TransferFeeConfig extension present on the PYUSD snapshot');
    surfnet.setAccount(a.address, Number(a.lamports), data, a.owner);
  }

  test('the copied mint now charges the fee', async () => {
    setTransferFee(FEE_BPS);
    const mint = spl.unpackMint(cur.mint, await c.getAccountInfo(cur.mint, 'processed'), cur.program);
    assert.equal(spl.getTransferFeeConfig(mint).newerTransferFee.transferFeeBasisPoints, FEE_BPS);
  });

  test('escrow lock is refused while a fee is charged (6024)', async () => {
    setTransferFee(0);
    const p = await parties(cur, 2_000_000n);
    setTransferFee(FEE_BPS);
    await refuses(6024, [TE.buildLockTokenEscrowInstruction(tokenTerms(cur, p, 2_000_000n, true))], [p.payer], 'lock under a transfer fee');
    assert.equal(await balance(p.source), 2_000_000n);
  });

  test('Budget open is refused while a fee is charged (6024)', async () => {
    setTransferFee(0);
    const p = await parties(cur, 10_000_000n);
    setTransferFee(FEE_BPS);
    const spender = Keypair.generate();
    const judge = await newAgent(1);
    await refuses(6024, [B.openBudgetInstruction({
      programId: PROGRAM, payer: p.payer.publicKey, nonce: randomBytes(16), spender: spender.publicKey, judge: judge.publicKey,
      openSlots: OPEN, disputeSlots: DISPUTE, judgeSlots: JUDGE, total: 10_000_000n, token: { mint: cur.mint, source: p.source, tokenProgram: cur.program },
    })], [p.payer], 'open under a transfer fee');
  });

  test('fee switched on after the lock: settle still lands, pays what arrives, and closes the escrow and vault', async () => {
    setTransferFee(0);
    const MAX = 2_000_000n;
    const p = await parties(cur, MAX);
    const t = tokenTerms(cur, p, MAX, true);
    const created = await send([TE.buildLockTokenEscrowInstruction(t)], [p.payer]);
    await travelTo(created + 1n);
    setTransferFee(FEE_BPS);
    const actual = 1_000_000n;
    const fee = launchFee(actual, false);
    await send([R.buildTokenEscrowExitInstruction(t, {
      rated: false, createdSlot: created, authority: p.payee.publicKey, options: { actual, harvestWithheldFees: true },
    })], [p.payee]);
    const sent = actual - fee;
    const transferFee = (sent * BigInt(FEE_BPS)) / 10_000n;
    const got = await balance(p.recipient);
    assert.ok(got < sent && got >= sent - transferFee - 1n, `provider got ${got} of ${sent} sent, the issuer withheld the rest`);
    const { escrow, vault } = TE.tokenEscrowAddresses(t);
    assert.equal(await c.getAccountInfo(escrow, 'processed'), null, 'escrow record closed');
    assert.equal(await c.getAccountInfo(vault, 'processed'), null, 'vault closed after harvesting withheld fees');
  });

  test('direct payment under a fee: the receipt verifier refuses it (the payee gets less than the price)', async () => {
    setTransferFee(0);
    const p = await parties(cur, 2_000_000n);
    setTransferFee(FEE_BPS);
    const challenge = P.buildX402Challenge({
      network: 'solana-devnet', payTo: p.payee.publicKey.toBase58(), amount: '1', currency: 'PYUSD', endpoint: 'https://example.test/v1', nonce: `s2-${Date.now()}`,
    });
    const ixs = D.buildDirectPaymentInstructions({ challenge, payer: p.payer.publicKey, mint: cur.mint });
    const tx = new Transaction().add(...ixs);
    tx.feePayer = p.payer.publicKey;
    tx.recentBlockhash = (await c.getLatestBlockhash('processed')).blockhash;
    tx.sign(p.payer);
    const sig = await c.sendRawTransaction(tx.serialize(), { preflightCommitment: 'processed' });
    for (let i = 0; i < 200 && !(await c.getSignatureStatus(sig)).value; i += 1) await new Promise((r) => setTimeout(r, 25));
    for (let i = 0; i < 200 && !(await c.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }).catch(() => null)); i += 1) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok((await balance(p.recipient)) < 1_000_000n, 'the payee received less than the price');
    const verifier = new P.SolanaReceiptVerifier({ allowRealPayment: true, connection: c, mints: { PYUSD: cur.mint.toBase58() }, payerProof: 'not-required', protocolFee: 'disabled' });
    const result = await verifier.verifyReceipt(
      { network: 'solana-devnet', payTo: challenge.payTo, amount: challenge.amount, currency: 'PYUSD', nonce: challenge.nonce, txSignature: sig, payer: p.payer.publicKey.toBase58(), mint: cur.mint.toBase58() },
      challenge,
      new NONCE.MemoryNonceReplayStore(),
    );
    console.log('verifier:', JSON.stringify(result));
    assert.equal(result.ok, false);
  });
});
