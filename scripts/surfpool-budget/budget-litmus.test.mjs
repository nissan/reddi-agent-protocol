// Litmus and edge tests for pooled Budgets on an embedded Surfpool (#1202).
//
// By default Surfpool forks devnet, so the program under test is the one
// deployed there (DcfW3Cxt…), with its registry records and the treasury.
// Set RAP_BUDGET_SURFPOOL_SO to a built program `.so` to deploy that instead
// (offline, no devnet reads). Budget windows run for days; time travel makes
// each edge a matter of seconds. Nothing here touches a real network: the
// fork is read-only and every transaction lands on the local Surfnet.
//
//   npm run test:surfpool:budget

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import { Surfnet } from '@solana/surfpool';
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_CLOCK_PUBKEY, Transaction, TransactionInstruction } from '@solana/web3.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const jiti = createJiti(import.meta.url);
const B = await jiti.import(path.join(root, 'packages/x402-solana/src/budget.ts'));
const require = createRequire(import.meta.url);
const spl = require('@solana/spl-token');

const PROGRAM = new PublicKey(process.env.RAP_BUDGET_SURFPOOL_PROGRAM_ID ?? 'DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu');
const TREASURY = new PublicKey('5CsBuTBFKu12JSs4CUbmv5MR218RYtNmAoQmLf5x3Hxe');
const BURN = new PublicKey('1nc1nerator11111111111111111111111111111111');
const DEVNET_USDC = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const LAUNCH_RATE_ENDS_UNIX = 1_806_537_600;

// The app's windows (lib/budget/page.ts): open 72 h, 24 h to dispute, 72 h for the judge.
const OPEN = 648_000n;
const DISPUTE = 216_000n;
const JUDGE = 648_000n;
const SOL_TOTAL = 100_000_000n; // 0.1 SOL
const E = {
  AccountNotInitialized: 3012,
  NotAttestationAgent: 6016,
  BudgetJustOpened: 6077,
  BudgetNotOpen: 6078,
  BudgetNotClosed: 6079,
  BudgetBalanceTooLow: 6081,
  AboveProviderCap: 6082,
  ReservationTooSmall: 6083,
  ReservationLocked: 6088,
  ReservationNotPosted: 6089,
  InvalidFinalAmount: 6090,
  ReservationDisputed: 6091,
  BudgetDisputeWindowClosed: 6093,
  ReservationNotDisputed: 6094,
  PayoutNotOpen: 6096,
  BudgetJudgeWindowClosed: 6097,
  InvalidResolution: 6071,
  UnauthorisedSigner: 6000,
};

let surfnet;
let c;

const disc = (name) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const agentOf = (owner) => PublicKey.findProgramAddressSync([Buffer.from('agent'), owner.toBuffer()], PROGRAM)[0];
const fund = (who, lamports = 2_000_000_000) => surfnet.fundSol(who.publicKey.toBase58(), lamports);
const slot = async () => BigInt(await c.getSlot('processed'));
const lamports = async (k) => BigInt(await c.getBalance(k, 'processed'));
const clockSlot = async () => (await c.getAccountInfo(SYSVAR_CLOCK_PUBKEY, 'processed')).data.readBigUInt64LE(0);
/**
 * Jumps to `target`. Right after a jump Surfpool 1.5.0 can serve a clock
 * sysvar whose slot is not the new slot (seen on a devnet fork: 16345 after a
 * jump to 527056345) until the next slot ticks, and a transaction in that gap
 * reads the wrong slot. So wait until the clock itself reads `target` or later.
 */
const travelTo = async (target) => {
  // A jump to a slot already passed fails (-32603): slots keep ticking, so only jump forward.
  if ((await clockSlot()) < target) surfnet.timeTravelToSlot(Number(target));
  for (let i = 0; i < 200; i += 1) {
    if ((await clockSlot()) >= target) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`clock did not reach slot ${target}`);
};
const advance = async (n = 1n) => travelTo((await slot()) + n);

function registerAgentIx(owner, agentType, model) {
  const name = Buffer.from(model, 'utf8');
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

/** Sends and confirms; returns the signature. */
async function send(ixs, signers) {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = signers[0].publicKey;
  tx.recentBlockhash = (await c.getLatestBlockhash('processed')).blockhash;
  tx.sign(...signers);
  const sig = await c.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: 'processed' });
  // Poll rather than subscribe: no websocket needed.
  let st;
  for (let i = 0; i < 200; i += 1) {
    st = await c.getSignatureStatus(sig);
    if (st.value) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  if (!st?.value) throw new Error(`not confirmed: ${sig}`);
  if (st.value.err) throw Object.assign(new Error(`failed: ${JSON.stringify(st.value.err)}`), { err: st.value.err });
  return sig;
}

/** The program error number a failed send carried, or undefined. */
function errorNumber(e) {
  const text = [e?.message ?? '', ...(e?.transactionLogs ?? e?.logs ?? [])].join('\n');
  const hex = text.match(/custom program error: 0x([0-9a-f]+)/i);
  if (hex) return parseInt(hex[1], 16);
  const custom = JSON.stringify(e?.err ?? '').match(/"Custom":(\d+)/);
  return custom ? Number(custom[1]) : undefined;
}

async function refuses(code, ixs, signers, what) {
  await assert.rejects(send(ixs, signers), (e) => {
    assert.equal(errorNumber(e), code, `${what}: expected ${code}, got ${errorNumber(e)} (${e.message.slice(0, 200)})`);
    return true;
  }, `${what}: expected error ${code} but it landed`);
}

async function budgetOf(address) {
  return B.decodeBudget((await c.getAccountInfo(address, 'processed')).data);
}
async function reservationOf(budget, payee) {
  const info = await c.getAccountInfo(B.reservationAddress(budget, payee, PROGRAM), 'processed');
  return info ? B.decodeReservation(info.data) : null;
}

async function newAgent(agentType = 0, model = 'sandbox/litmus') {
  const kp = Keypair.generate();
  fund(kp);
  await send([registerAgentIx(kp.publicKey, agentType, model)], [kp]);
  return kp;
}

/**
 * A fresh SOL Budget: payer, spender, judge (registered attestation agent
 * unless `judge` is given as null or a key) and its address. Moves one slot on
 * so it can be used.
 */
async function openSol({ judge, total = SOL_TOTAL, perProviderCap, allowlist } = {}) {
  const payer = Keypair.generate();
  const spender = Keypair.generate();
  fund(payer);
  fund(spender, 100_000_000);
  const judgeKp = judge === undefined ? await newAgent(1, 'rap/judge-litmus') : judge;
  const nonce = randomBytes(16);
  const budget = B.budgetAddress(payer.publicKey, nonce, PROGRAM);
  await send(
    [
      B.openBudgetInstruction({
        programId: PROGRAM,
        payer: payer.publicKey,
        nonce,
        spender: spender.publicKey,
        judge: judgeKp ? judgeKp.publicKey ?? judgeKp : null,
        openSlots: OPEN,
        disputeSlots: DISPUTE,
        judgeSlots: JUDGE,
        total,
        perProviderCap,
        allowlist,
      }),
    ],
    [payer],
  );
  const state = await budgetOf(budget);
  await advance(1n);
  const of = { programId: PROGRAM, budget, createdSlot: state.createdSlot };
  return { payer, spender, judge: judgeKp, budget, of, state };
}

const reserve = (b, payee, amount) => send([B.reserveInstruction({ ...b.of, spender: b.spender.publicKey, payee: payee.publicKey, amount })], [payee, b.spender]);
const post = (b, payee, amount) => send([B.postFinalInstruction({ ...b.of, payee: payee.publicKey, amount })], [payee]);
const close = (b, signer = b.payer) => send([B.closeBudgetInstruction({ ...b.of, signer: signer.publicKey, payer: b.payer.publicKey })], [signer]);
const exit = (b, payee) => ({ ...b.of, payee: payee.publicKey, payer: b.payer.publicKey, treasury: TREASURY });
const payout = (b, payee, by = b.payer) => send([B.payoutInstruction(exit(b, payee))], [by]);
const dispute = (b, payee) => send([B.disputeInstruction({ ...b.of, payee: payee.publicKey, payer: b.payer.publicKey })], [b.payer]);
const waive = (b, payee) => send([B.waiveInstruction({ ...b.of, payee: payee.publicKey, signer: b.payer.publicKey })], [b.payer]);
const resolve = (b, payee, amount, judge = b.judge) =>
  send([B.resolveInstruction({ ...exit(b, payee), judge: judge.publicKey, payout: amount })], [judge]);

/** The launch-rate fee the program takes from `paid` lamports now (2.5% rounded down, capped at 0.1 SOL). */
const launchFee = (paid) => {
  const fee = paid / 40n;
  return fee > 100_000_000n ? 100_000_000n : fee;
};

async function startSurfnet() {
  const so = process.env.RAP_BUDGET_SURFPOOL_SO;
  surfnet = so
    ? Surfnet.startWithConfig({ offline: true })
    : Surfnet.startWithConfig({ offline: false, remoteRpcUrl: process.env.RAP_BUDGET_SURFPOOL_REMOTE ?? 'https://api.devnet.solana.com' });
  if (so) {
    surfnet.deploy({ programId: PROGRAM.toBase58(), soPath: so });
    surfnet.fundSol(TREASURY.toBase58(), 10_000_000);
  }
  c = new Connection(surfnet.rpcUrl, 'processed');
  const program = await c.getAccountInfo(PROGRAM);
  assert.ok(program?.executable, `program ${PROGRAM.toBase58()} is not deployed on the Surfnet`);
}

/**
 * Each group gets its own Surfnet: jumps only go forward, and one long-lived
 * fork that has jumped many times grew unstable (a failed jump, then a dead
 * RPC) in a full run.
 */
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

describe('open', () => {
  freshSurfnet();

  test('opens with a registered judge, holding the total', async () => {
    const b = await openSol();
    assert.equal(b.state.total, SOL_TOTAL);
    assert.equal(b.state.unreserved, SOL_TOTAL);
    assert.ok(b.state.judge.equals(b.judge.publicKey));
    assert.equal(b.state.closed, false);
  });

  test('refuses a judge with no registry record (the 26 Nov devnet outage)', async () => {
    const payer = Keypair.generate();
    fund(payer);
    const nonce = randomBytes(16);
    const ix = B.openBudgetInstruction({
      programId: PROGRAM, payer: payer.publicKey, nonce, spender: Keypair.generate().publicKey, judge: Keypair.generate().publicKey,
      openSlots: OPEN, disputeSlots: DISPUTE, judgeSlots: JUDGE, total: SOL_TOTAL,
    });
    await refuses(E.AccountNotInitialized, [ix], [payer], 'unregistered judge');
    assert.equal(await c.getAccountInfo(B.budgetAddress(payer.publicKey, nonce, PROGRAM)), null);
  });

  test('refuses a judge whose agent type cannot attest', async () => {
    const plain = await newAgent(0);
    const payer = Keypair.generate();
    fund(payer);
    const ix = B.openBudgetInstruction({
      programId: PROGRAM, payer: payer.publicKey, nonce: randomBytes(16), spender: Keypair.generate().publicKey, judge: plain.publicKey,
      openSlots: OPEN, disputeSlots: DISPUTE, judgeSlots: JUDGE, total: SOL_TOTAL,
    });
    await refuses(E.NotAttestationAgent, [ix], [payer], 'non-attestation judge');
  });

  test('a Budget cannot be used in the slot it opened in', async () => {
    const payer = Keypair.generate();
    const spender = Keypair.generate();
    fund(payer);
    fund(spender, 100_000_000);
    const judge = await newAgent(1);
    const payee = await newAgent(0);
    const nonce = randomBytes(16);
    const budget = B.budgetAddress(payer.publicKey, nonce, PROGRAM);
    const open = B.openBudgetInstruction({
      programId: PROGRAM, payer: payer.publicKey, nonce, spender: spender.publicKey, judge: judge.publicKey,
      openSlots: OPEN, disputeSlots: DISPUTE, judgeSlots: JUDGE, total: SOL_TOTAL,
    });
    const createdSlot = await slot();
    // Same transaction, so certainly the same slot.
    const res = B.reserveInstruction({ programId: PROGRAM, budget, createdSlot, spender: spender.publicKey, payee: payee.publicKey, amount: SOL_TOTAL / 4n });
    await assert.rejects(send([open, res], [payer, spender, payee]));
  });
});

describe('reserve and post', () => {
  freshSurfnet();

  test('reserve, raise, cap and floor edges', async () => {
    const b = await openSol();
    const p = await newAgent(0);
    const cap = b.state.perProviderCap; // half the total by default
    await refuses(E.ReservationTooSmall, [B.reserveInstruction({ ...b.of, spender: b.spender.publicKey, payee: p.publicKey, amount: B.minReservation(SOL_TOTAL) - 1n })], [p, b.spender], 'below 1%');
    await refuses(E.AboveProviderCap, [B.reserveInstruction({ ...b.of, spender: b.spender.publicKey, payee: p.publicKey, amount: cap + 1n })], [p, b.spender], 'above cap');
    await reserve(b, p, cap / 4n);
    assert.equal((await reservationOf(b.budget, p.publicKey)).reserved, cap / 4n);
    await reserve(b, p, cap);
    assert.equal((await reservationOf(b.budget, p.publicKey)).reserved, cap);
    assert.equal((await budgetOf(b.budget)).unreserved, SOL_TOTAL - cap);
  });

  test('the total runs out across providers', async () => {
    const b = await openSol({ perProviderCap: 0n }); // 0 = the whole total
    const p1 = await newAgent(0);
    const p2 = await newAgent(0);
    await reserve(b, p1, (SOL_TOTAL * 3n) / 4n);
    await refuses(E.BudgetBalanceTooLow, [B.reserveInstruction({ ...b.of, spender: b.spender.publicKey, payee: p2.publicKey, amount: SOL_TOTAL / 2n })], [p2, b.spender], 'over the total');
    await reserve(b, p2, SOL_TOTAL / 4n);
    assert.equal((await budgetOf(b.budget)).unreserved, 0n);
  });

  test('the spender must sign a reserve', async () => {
    const b = await openSol();
    const p = await newAgent(0);
    const thief = Keypair.generate();
    fund(thief, 100_000_000);
    await assert.rejects(send([B.reserveInstruction({ ...b.of, spender: thief.publicKey, payee: p.publicKey, amount: SOL_TOTAL / 8n })], [p, thief]));
    assert.equal(await reservationOf(b.budget, p.publicKey), null);
  });

  test('post at most the slice, and a re-post only goes down', async () => {
    const b = await openSol();
    const p = await newAgent(0);
    await reserve(b, p, SOL_TOTAL / 4n);
    await refuses(E.InvalidFinalAmount, [B.postFinalInstruction({ ...b.of, payee: p.publicKey, amount: SOL_TOTAL / 4n + 1n })], [p], 'above slice');
    await post(b, p, 1_000n);
    await refuses(E.InvalidFinalAmount, [B.postFinalInstruction({ ...b.of, payee: p.publicKey, amount: 1_001n })], [p], 're-post up');
    await post(b, p, 900n);
    const r = await reservationOf(b.budget, p.publicKey);
    assert.equal(r.state, 'posted');
    assert.equal(r.finalAmount, 900n);
  });

  test('no reserve once the open period ends, and then anyone may close', async () => {
    const b = await openSol();
    const p = await newAgent(0);
    const stranger = Keypair.generate();
    fund(stranger, 100_000_000);
    await refuses(E.UnauthorisedSigner, [B.closeBudgetInstruction({ ...b.of, signer: stranger.publicKey, payer: b.payer.publicKey })], [stranger], 'stranger close while open');
    await travelTo(b.state.openEnds);
    await refuses(E.BudgetNotOpen, [B.reserveInstruction({ ...b.of, spender: b.spender.publicKey, payee: p.publicKey, amount: SOL_TOTAL / 4n })], [p, b.spender], 'reserve after open end');
    const payerBefore = await lamports(b.payer.publicKey);
    await close(b, stranger);
    // Nothing reserved: the close refunds the whole total and the Budget account goes with it.
    assert.equal(await c.getAccountInfo(b.budget, 'processed'), null);
    assert.ok((await lamports(b.payer.publicKey)) - payerBefore >= SOL_TOTAL);
  });
});

describe('payout after the dispute window', () => {
  freshSurfnet();

  test('closing early refunds the unreserved part; payout waits for the window to the slot; fee goes to the treasury', async () => {
    const b = await openSol();
    const p = await newAgent(0);
    await reserve(b, p, SOL_TOTAL / 4n);
    await post(b, p, 420n);
    const payerBefore = await lamports(b.payer.publicKey);
    await close(b);
    const closed = await budgetOf(b.budget);
    assert.equal(closed.closed, true);
    // The unreserved three quarters came back to the payer at close (less the fee for the close).
    assert.ok((await lamports(b.payer.publicKey)) - payerBefore >= (SOL_TOTAL * 3n) / 4n - 10_000n);

    const r = await reservationOf(b.budget, p.publicKey);
    const ends = B.disputeEnds(closed, r);
    await refuses(E.PayoutNotOpen, [B.payoutInstruction(exit(b, p))], [b.payer], 'payout before close+window');
    await travelTo(ends - 2n);
    await refuses(E.PayoutNotOpen, [B.payoutInstruction(exit(b, p))], [b.payer], 'payout one slot early');
    await travelTo(ends);
    const payeeBefore = await lamports(p.publicKey);
    const treasuryBefore = await lamports(TREASURY);
    const anyone = Keypair.generate();
    fund(anyone, 100_000_000);
    await payout(b, p, anyone);
    const fee = launchFee(420n);
    assert.equal((await lamports(TREASURY)) - treasuryBefore, fee);
    // The payee gets the posted amount less the fee, plus its reservation's rent back.
    assert.ok((await lamports(p.publicKey)) - payeeBefore >= 420n - fee);
    assert.equal(await reservationOf(b.budget, p.publicKey), null);
  });

  test('a slice never posted pays the provider nothing and refunds the payer once the window ends', async () => {
    const b = await openSol();
    const p = await newAgent(0);
    await reserve(b, p, SOL_TOTAL / 4n);
    await close(b);
    await refuses(E.PayoutNotOpen, [B.payoutInstruction(exit(b, p))], [b.payer], 'unposted payout inside the window');
    await travelTo((await budgetOf(b.budget)).closedSlot + DISPUTE);
    const payeeBefore = await lamports(p.publicKey);
    const treasuryBefore = await lamports(TREASURY);
    const payerBefore = await lamports(b.payer.publicKey);
    const anyone = Keypair.generate();
    fund(anyone, 100_000_000);
    await payout(b, p, anyone);
    assert.equal((await lamports(TREASURY)) - treasuryBefore, 0n);
    assert.ok((await lamports(b.payer.publicKey)) - payerBefore >= SOL_TOTAL / 4n);
    assert.ok((await lamports(p.publicKey)) - payeeBefore < 2_000_000n, 'payee gets only its rent back');
  });

  test('approve (waive) pays at once, before the window', async () => {
    const b = await openSol();
    const p = await newAgent(0);
    await reserve(b, p, SOL_TOTAL / 4n);
    await post(b, p, 10_000n);
    await close(b);
    await waive(b, p);
    const treasuryBefore = await lamports(TREASURY);
    await payout(b, p);
    assert.equal((await lamports(TREASURY)) - treasuryBefore, launchFee(10_000n));
    assert.equal(await reservationOf(b.budget, p.publicKey), null);
  });

  test('a waived slice cannot then be disputed', async () => {
    const b = await openSol();
    const p = await newAgent(0);
    await reserve(b, p, SOL_TOTAL / 4n);
    await post(b, p, 10_000n);
    await close(b);
    await waive(b, p);
    await assert.rejects(dispute(b, p));
  });
});

describe('dispute and the judge', () => {
  freshSurfnet();

  async function disputed(posted = 10_000n) {
    const b = await openSol();
    const p = await newAgent(0);
    await reserve(b, p, SOL_TOTAL / 4n);
    await post(b, p, posted);
    await close(b);
    await dispute(b, p);
    return { b, p };
  }

  test('a disputed slice cannot be paid out or re-posted; only the judge rules', async () => {
    const { b, p } = await disputed();
    assert.equal((await reservationOf(b.budget, p.publicKey)).state, 'disputed');
    await refuses(E.PayoutNotOpen, [B.payoutInstruction(exit(b, p))], [b.payer], 'payout while disputed');
    await assert.rejects(post(b, p, 5_000n));
    const impostor = await newAgent(1);
    await assert.rejects(resolve(b, p, 5_000n, impostor));
  });

  test('the judge rules a partial payout; the rest refunds the payer', async () => {
    const { b, p } = await disputed(10_000n);
    await refuses(E.InvalidResolution, [B.resolveInstruction({ ...exit(b, p), judge: b.judge.publicKey, payout: 10_001n })], [b.judge], 'ruling above posted');
    const payeeBefore = await lamports(p.publicKey);
    const treasuryBefore = await lamports(TREASURY);
    const payerBefore = await lamports(b.payer.publicKey);
    await resolve(b, p, 6_000n);
    const fee = launchFee(6_000n);
    assert.equal((await lamports(TREASURY)) - treasuryBefore, fee);
    assert.ok((await lamports(p.publicKey)) - payeeBefore >= 6_000n - fee);
    // The payer gets back the unpaid part of the slice: reserved minus the 6,000 paid.
    assert.ok((await lamports(b.payer.publicKey)) - payerBefore >= SOL_TOTAL / 4n - 6_000n);
    assert.equal(await reservationOf(b.budget, p.publicKey), null);
  });

  test('the judge may rule right up to the end of its window, and not after', async () => {
    const { b, p } = await disputed();
    const r = await reservationOf(b.budget, p.publicKey);
    const ends = B.judgeEnds(await budgetOf(b.budget), r);
    await travelTo(ends);
    await refuses(E.BudgetJudgeWindowClosed, [B.resolveInstruction({ ...exit(b, p), judge: b.judge.publicKey, payout: 1n })], [b.judge], 'ruling after window');
  });

  test('a judge that never rules: payout after its window refunds the payer in full, no fee', async () => {
    const { b, p } = await disputed(10_000n);
    const r = await reservationOf(b.budget, p.publicKey);
    await travelTo(B.judgeEnds(await budgetOf(b.budget), r) - 2n);
    await refuses(E.PayoutNotOpen, [B.payoutInstruction(exit(b, p))], [b.payer], 'refund before judge window ends');
    await travelTo(B.judgeEnds(await budgetOf(b.budget), r));
    const payeeBefore = await lamports(p.publicKey);
    const treasuryBefore = await lamports(TREASURY);
    const payerBefore = await lamports(b.payer.publicKey);
    const anyone = Keypair.generate();
    fund(anyone, 100_000_000);
    await payout(b, p, anyone);
    assert.equal((await lamports(TREASURY)) - treasuryBefore, 0n);
    assert.ok((await lamports(b.payer.publicKey)) - payerBefore >= SOL_TOTAL / 4n);
    // The payee gets only its reservation rent back.
    assert.ok((await lamports(p.publicKey)) - payeeBefore < 10_000n + 2_000_000n);
  });

  test('no dispute after the window', async () => {
    const b = await openSol();
    const p = await newAgent(0);
    await reserve(b, p, SOL_TOTAL / 4n);
    await post(b, p, 10_000n);
    await close(b);
    const r = await reservationOf(b.budget, p.publicKey);
    await travelTo(B.disputeEnds(await budgetOf(b.budget), r));
    await refuses(E.BudgetDisputeWindowClosed, [B.disputeInstruction({ ...b.of, payee: p.publicKey, payer: b.payer.publicKey })], [b.payer], 'late dispute');
  });

  test('the payer may dispute a posted slice before closing', async () => {
    const b = await openSol();
    const p = await newAgent(0);
    await reserve(b, p, SOL_TOTAL / 4n);
    await post(b, p, 10_000n);
    await dispute(b, p);
    assert.equal((await reservationOf(b.budget, p.publicKey)).state, 'disputed');
  });

  test('only the payer may dispute', async () => {
    const b = await openSol();
    const p = await newAgent(0);
    await reserve(b, p, SOL_TOTAL / 4n);
    await post(b, p, 10_000n);
    await close(b);
    const stranger = Keypair.generate();
    fund(stranger, 100_000_000);
    await assert.rejects(send([B.disputeInstruction({ ...b.of, payee: p.publicKey, payer: stranger.publicKey })], [stranger]));
  });
});

describe('USDC Budget', () => {
  freshSurfnet();

  test('open, reserve, post, close early, payout after the window: amounts and fee in USDC', async () => {
    if (process.env.RAP_BUDGET_SURFPOOL_SO) return; // needs the forked devnet USDC mint
    const token = spl.TOKEN_PROGRAM_ID;
    const mint = DEVNET_USDC;
    const payer = Keypair.generate();
    const spender = Keypair.generate();
    fund(payer);
    fund(spender, 100_000_000);
    const judge = await newAgent(1);
    const p = await newAgent(0);
    const total = 10_000_000n; // 10 USDC
    surfnet.fundToken(payer.publicKey.toBase58(), mint.toBase58(), Number(total));
    surfnet.fundToken(p.publicKey.toBase58(), mint.toBase58(), 0);
    const payerAta = spl.getAssociatedTokenAddressSync(mint, payer.publicKey);
    const payeeAta = spl.getAssociatedTokenAddressSync(mint, p.publicKey);
    const treasuryAta = spl.getAssociatedTokenAddressSync(mint, TREASURY, true);
    if (!(await c.getAccountInfo(treasuryAta))) surfnet.fundToken(TREASURY.toBase58(), mint.toBase58(), 0);
    const amount = async (a) => BigInt((await c.getTokenAccountBalance(a, 'processed')).value.amount);

    const nonce = randomBytes(16);
    const budget = B.budgetAddress(payer.publicKey, nonce, PROGRAM);
    await send([B.openBudgetInstruction({
      programId: PROGRAM, payer: payer.publicKey, nonce, spender: spender.publicKey, judge: judge.publicKey,
      openSlots: OPEN, disputeSlots: DISPUTE, judgeSlots: JUDGE, total, token: { mint, source: payerAta, tokenProgram: token },
    })], [payer]);
    assert.equal(await amount(payerAta), 0n);
    assert.equal(await amount(B.budgetVaultAddress(budget, PROGRAM)), total);
    const state = await budgetOf(budget);
    await advance(1n);
    const of = { programId: PROGRAM, budget, createdSlot: state.createdSlot };
    await send([B.reserveInstruction({ ...of, spender: spender.publicKey, payee: p.publicKey, amount: total / 4n, payoutAccount: payeeAta })], [p, spender]);
    await send([B.postFinalInstruction({ ...of, payee: p.publicKey, amount: 1_234_567n })], [p]);
    await send([B.closeBudgetInstruction({ ...of, signer: payer.publicKey, payer: payer.publicKey, token: { mint, refund: payerAta, tokenProgram: token } })], [payer]);
    assert.equal(await amount(payerAta), total - total / 4n, 'unreserved USDC back at close');

    const closed = await budgetOf(budget);
    await travelTo(B.disputeEnds(closed, await reservationOf(budget, p.publicKey)));
    const treasuryBefore = await amount(treasuryAta);
    const tokenOut = { mint, payoutAccount: payeeAta, treasuryToken: treasuryAta, refund: payerAta, tokenProgram: token };
    await send([B.payoutInstruction({ ...of, payee: p.publicKey, payer: payer.publicKey, treasury: TREASURY, token: tokenOut })], [payer]);
    const fee = 1_234_567n / 40n; // 2.5%, no cap on tokens
    assert.equal(await amount(payeeAta), 1_234_567n - fee);
    assert.equal((await amount(treasuryAta)) - treasuryBefore, fee);
    assert.equal(await amount(payerAta), total - 1_234_567n, 'unpaid part of the slice back to the payer');
  });
});

describe('spender closes early', () => {
  freshSurfnet();

  test('without an allowlist the dispute window runs from the end of the open period', async () => {
    const b = await openSol();
    const p = await newAgent(0);
    await reserve(b, p, SOL_TOTAL / 4n);
    await post(b, p, 10_000n);
    await close(b, b.spender);
    const state = await budgetOf(b.budget);
    assert.equal(state.reviewFromOpenEnd, true);
    const ends = B.disputeEnds(state, await reservationOf(b.budget, p.publicKey));
    assert.equal(ends, state.openEnds + DISPUTE);
    // Where a payer close would already pay out, this one still waits.
    await travelTo(state.closedSlot + DISPUTE + 1n);
    await refuses(E.PayoutNotOpen, [B.payoutInstruction(exit(b, p))], [b.payer], 'payout from the close, not the open end');
    await dispute(b, p);
    assert.equal((await reservationOf(b.budget, p.publicKey)).state, 'disputed');
  });
});

describe('fee rate', () => {
  freshSurfnet();

  test('5% once the launch rate ends (cluster clock moved to 1 Apr 2027)', async () => {
    const b = await openSol();
    const p = await newAgent(0);
    await reserve(b, p, SOL_TOTAL / 4n);
    await post(b, p, 1_000_000n);
    await close(b);
    await waive(b, p);
    surfnet.timeTravelToTimestamp(LAUNCH_RATE_ENDS_UNIX * 1000 + 60_000);
    await advance(2n);
    const treasuryBefore = await lamports(TREASURY);
    await payout(b, p);
    assert.equal((await lamports(TREASURY)) - treasuryBefore, 50_000n);
  });
});
