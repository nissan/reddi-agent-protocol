// The RAP judge's own pass (`lib/budget/judge/pass.ts`) ruling disputed USDC
// Budget slices on an embedded Surfpool (#1210, RAP-MB8-S2 and S3).
//
// Surfpool forks devnet, so the program is the one deployed there (DcfW3Cxt…)
// and the mint is devnet USDC. The judge is a throwaway registered agent whose
// key is held in memory; the evidence (signed calls and receipts) sits in the
// in-memory judge store, with receipts signed by the provider exactly as the
// provider kit signs them (receipt v2). Nothing here touches a real network:
// the fork is read-only and every transaction lands on the local Surfnet.
//
// What this does not show: the deployed judge service, its database or its
// alert emails. Those were shown on devnet with a SOL Budget (#1144).
//
//   npm run test:surfpool:budget-judge

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPrivateKey, randomBytes, sign as nodeSign } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import { Surfnet } from '@solana/surfpool';
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_CLOCK_PUBKEY, Transaction, TransactionInstruction } from '@solana/web3.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const jiti = createJiti(import.meta.url, {
  alias: {
    '@redditech/x402-solana': path.join(root, 'packages/x402-solana/src'),
    '@redditech/agent-protocol': path.join(root, 'packages/agent-protocol/src'),
    '@': root,
  },
});
const B = await jiti.import(path.join(root, 'packages/x402-solana/src/budget.ts'));
const { signReddiReceiptV2 } = await jiti.import(path.join(root, 'packages/agent-protocol/src/index.ts'));
const { runJudgePass, MEMO_PROGRAM_ID } = await jiti.import(path.join(root, 'lib/budget/judge/pass.ts'));
const { judgeChainFor } = await jiti.import(path.join(root, 'lib/budget/judge/chain.ts'));
const { MemoryJudgeStore } = await jiti.import(path.join(root, 'lib/budget/judge/store.ts'));
const { JUDGE_RULE_VERSION } = await jiti.import(path.join(root, 'lib/budget/judge/rule.ts'));
const require = createRequire(import.meta.url);
const spl = require('@solana/spl-token');

const PROGRAM = new PublicKey(process.env.RAP_BUDGET_SURFPOOL_PROGRAM_ID ?? 'DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu');
const TREASURY = new PublicKey('5CsBuTBFKu12JSs4CUbmv5MR218RYtNmAoQmLf5x3Hxe');
const BURN = new PublicKey('1nc1nerator11111111111111111111111111111111');
const USDC = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const NETWORK = 'solana-devnet';

// The app's windows (lib/budget/page.ts): open 72 h, 24 h to dispute, 72 h for the judge.
const OPEN = 648_000n;
const DISPUTE = 216_000n;
const JUDGE = 648_000n;
const TOTAL = 10_000_000n; // 10 USDC
const RESERVED = TOTAL / 4n;
const CALL_COST = 300_000n; // 0.30 USDC a call

let surfnet;
let c;

const sha = (text) => createHash('sha256').update(text).digest('hex');
const disc = (name) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const agentOf = (owner) => PublicKey.findProgramAddressSync([Buffer.from('agent'), owner.toBuffer()], PROGRAM)[0];
const fund = (who, lamports = 2_000_000_000) => surfnet.fundSol(who.publicKey.toBase58(), lamports);
const slot = async () => BigInt(await c.getSlot('processed'));
const clockSlot = async () => (await c.getAccountInfo(SYSVAR_CLOCK_PUBKEY, 'processed')).data.readBigUInt64LE(0);
const amount = async (a) => BigInt((await c.getTokenAccountBalance(a, 'processed')).value.amount);
/** Jumps forward to `target` and waits until the clock sysvar itself reads it (see budget-litmus.test.mjs). */
const travelTo = async (target) => {
  if ((await clockSlot()) < target) surfnet.timeTravelToSlot(Number(target));
  for (let i = 0; i < 200; i += 1) {
    if ((await clockSlot()) >= target) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`clock did not reach slot ${target}`);
};
/** Jumps to `target` and waits until the slot the judge reads (confirmed) has reached it too. */
const reach = async (target) => {
  await travelTo(target);
  for (let i = 0; i < 400; i += 1) {
    if (BigInt(await c.getSlot('confirmed')) >= target) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`confirmed slot did not reach ${target}`);
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

async function send(ixs, signers) {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = signers[0].publicKey;
  tx.recentBlockhash = (await c.getLatestBlockhash('processed')).blockhash;
  tx.sign(...signers);
  const sig = await c.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: 'processed' });
  let st;
  for (let i = 0; i < 200; i += 1) {
    st = await c.getSignatureStatus(sig);
    if (st.value) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  if (!st?.value) throw new Error(`not confirmed: ${sig}`);
  if (st.value.err) throw new Error(`failed: ${JSON.stringify(st.value.err)}`);
  return sig;
}

async function newAgent(agentType, model) {
  const kp = Keypair.generate();
  fund(kp);
  await send([registerAgentIx(kp.publicKey, agentType, model)], [kp]);
  return kp;
}

/** Node's Ed25519 key for a Solana keypair. */
const edKey = (kp) => createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(kp.secretKey.subarray(0, 32))]), format: 'der', type: 'pkcs8' });

/**
 * A USDC Budget that names a registered judge, one provider with a reserved
 * slice, and the judge's dependencies wired to this Surfnet.
 */
async function world() {
  const payer = Keypair.generate();
  const spender = Keypair.generate();
  fund(payer);
  fund(spender, 100_000_000);
  const judge = await newAgent(1, 'rap/judge-surfpool');
  const provider = await newAgent(0, 'rap/provider-surfpool');
  surfnet.fundToken(payer.publicKey.toBase58(), USDC.toBase58(), Number(TOTAL));
  surfnet.fundToken(provider.publicKey.toBase58(), USDC.toBase58(), 0);
  const token = spl.TOKEN_PROGRAM_ID;
  const payerAta = spl.getAssociatedTokenAddressSync(USDC, payer.publicKey);
  const payeeAta = spl.getAssociatedTokenAddressSync(USDC, provider.publicKey);
  const treasuryAta = spl.getAssociatedTokenAddressSync(USDC, TREASURY, true);
  if (!(await c.getAccountInfo(treasuryAta))) surfnet.fundToken(TREASURY.toBase58(), USDC.toBase58(), 0);

  const nonce = randomBytes(16);
  const budget = B.budgetAddress(payer.publicKey, nonce, PROGRAM);
  await send([B.openBudgetInstruction({
    programId: PROGRAM, payer: payer.publicKey, nonce, spender: spender.publicKey, judge: judge.publicKey,
    openSlots: OPEN, disputeSlots: DISPUTE, judgeSlots: JUDGE, total: TOTAL, token: { mint: USDC, source: payerAta, tokenProgram: token },
  })], [payer]);
  const state = B.decodeBudget((await c.getAccountInfo(budget, 'processed')).data);
  await advance(1n);
  const of = { programId: PROGRAM, budget, createdSlot: state.createdSlot };
  await send([B.reserveInstruction({ ...of, spender: spender.publicKey, payee: provider.publicKey, amount: RESERVED, payoutAccount: payeeAta })], [provider, spender]);
  const reservation = B.reservationAddress(budget, provider.publicKey, PROGRAM);
  const slice = { budget: budget.toBase58(), createdSlot: state.createdSlot.toString(), payee: provider.publicKey.toBase58() };

  const store = new MemoryJudgeStore();
  const notes = [];
  const judgeKey = edKey(judge);
  const deps = {
    chain: judgeChainFor(new Connection(surfnet.rpcUrl, 'confirmed'), PROGRAM),
    store,
    signer: { address: judge.publicKey, sign: async (m) => Uint8Array.from(nodeSign(null, Buffer.from(m), judgeKey)) },
    programId: PROGRAM,
    network: NETWORK,
    env: {},
    notify: async (subject) => (notes.push(subject), true),
  };

  const providerKey = edKey(provider);
  /** One call the Budget's spender signed, and the provider's receipt for it as the relay keeps it. */
  async function servedCall(sequence) {
    const body = `call ${sequence} of ${slice.budget}`;
    store.calls.push({ ...slice, bodyHash: sha(body) });
    const receipt = {
      schemaVersion: 'reddi.receipt.v2',
      providerId: slice.payee,
      declaredModel: 'rap/provider-surfpool',
      requestHash: sha(body),
      responseHash: sha(`answer ${body}`),
      session: {
        escrow: reservation.toBase58(), payer: payer.publicKey.toBase58(), network: NETWORK, currency: 'USDC', mint: USDC.toBase58(), maxAmount: RESERVED.toString(),
        sequence: String(sequence), inputTokens: '10', outputTokens: '5', cumulativeInputTokens: String(10 * sequence), cumulativeOutputTokens: String(5 * sequence),
        cumulativeCost: (CALL_COST * BigInt(sequence)).toString(), ...(sequence > 1 ? { previousReceiptHash: sha(`receipt ${sequence - 1}`) } : {}), closed: false,
      },
      budget: { address: slice.budget, createdSlot: slice.createdSlot, reservation: reservation.toBase58() },
      issuedAt: '2026-11-26T01:00:00.000Z',
    };
    const signed = await signReddiReceiptV2(receipt, (m) => nodeSign(null, m, providerKey));
    await store.addReceipt(slice, 'relay', Buffer.from(JSON.stringify(signed), 'utf8').toString('base64url'));
  }

  const post = (value) => send([B.postFinalInstruction({ ...of, payee: provider.publicKey, amount: value })], [provider]);
  const dispute = () => send([B.disputeInstruction({ ...of, payee: provider.publicKey, payer: payer.publicKey })], [payer]);
  const reservationNow = async () => {
    const info = await c.getAccountInfo(reservation, 'processed');
    return info ? B.decodeReservation(info.data) : null;
  };
  /** The outcome of one judge pass for this slice. */
  const pass = async () => {
    const result = await runJudgePass(deps);
    return { result, mine: result.slices.find((s) => s.budget === slice.budget && s.payee === slice.payee) };
  };
  return { payer, provider, judge, budget, state, slice, store, notes, deps, payerAta, payeeAta, treasuryAta, servedCall, post, dispute, reservationNow, pass };
}

/** The memo and the resolve payout of a ruling the judge sent. */
async function rulingOnChain(signature) {
  const tx = await c.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  assert.ok(tx, `ruling ${signature} not found on the Surfnet`);
  assert.equal(tx.meta.err, null);
  const keys = tx.transaction.message.getAccountKeys ? tx.transaction.message.getAccountKeys().staticAccountKeys : tx.transaction.message.accountKeys;
  const ixs = tx.transaction.message.compiledInstructions ?? tx.transaction.message.instructions;
  const programOf = (ix) => keys[ix.programIdIndex];
  const dataOf = (ix) => (typeof ix.data === 'string' ? Buffer.from(require('bs58').decode(ix.data)) : Buffer.from(ix.data));
  const memo = ixs.find((ix) => programOf(ix).equals(MEMO_PROGRAM_ID));
  const resolve = ixs.find((ix) => programOf(ix).equals(PROGRAM));
  return { memo: memo ? dataOf(memo).toString('utf8') : undefined, feePayer: keys[0], resolveData: dataOf(resolve) };
}

function freshSurfnet() {
  before(async () => {
    surfnet = Surfnet.startWithConfig({ offline: false, remoteRpcUrl: process.env.RAP_BUDGET_SURFPOOL_REMOTE ?? 'https://api.devnet.solana.com' });
    c = new Connection(surfnet.rpcUrl, 'processed');
    const program = await c.getAccountInfo(PROGRAM);
    assert.ok(program?.executable, `program ${PROGRAM.toBase58()} is not on the Surfnet`);
  });
  after(() => {
    try {
      surfnet?.stop();
    } catch {
      // already gone
    }
  });
}

const fee = (paid) => paid / 40n; // 2.5% launch rate, rounded down; no cap on tokens

describe('RAP judge, USDC Budget: receipts cover the post', () => {
  freshSurfnet();

  test('rules on the first pass: the post stands, fee to the treasury, the rest back to the payer', async () => {
    const w = await world();
    for (const n of [1, 2, 3]) await w.servedCall(n);
    const posted = CALL_COST * 3n;
    await w.post(posted);
    await w.dispute();
    assert.equal((await w.reservationNow()).state, 'disputed');
    const treasuryBefore = await amount(w.treasuryAta);

    const { result, mine } = await w.pass();
    assert.equal(mine?.status, 'ruled', JSON.stringify(result));
    assert.equal(mine.payout, posted.toString());
    assert.equal(await amount(w.payeeAta), posted - fee(posted));
    assert.equal((await amount(w.treasuryAta)) - treasuryBefore, fee(posted));
    assert.equal(await amount(w.payerAta), RESERVED - posted, 'the unpaid part of the slice back to the payer');
    assert.equal((await w.reservationNow()).state, 'paid', 'the slice is settled');

    const onChain = await rulingOnChain(mine.signature);
    assert.ok(onChain.feePayer.equals(w.judge.publicKey), 'the judge signed and paid for its ruling');
    const row = w.store.rows.find((r) => r.kind === 'ruling');
    assert.equal(onChain.memo, `rap-judge ${JUDGE_RULE_VERSION} ${row.detail.evidenceHash}`);
    assert.equal(row.detail.basis, 'evidence');
    assert.deepEqual(w.notes, ['RAP judge: a Budget slice was disputed', 'RAP judge ruled a dispute']);

    // A second pass finds nothing left to rule for this slice.
    assert.equal((await w.pass()).mine, undefined);
  });
});

describe('RAP judge, USDC Budget: post above the receipts', () => {
  freshSurfnet();

  test('waits for evidence for a third of its window, then pays the receipted amount and refunds the rest', async () => {
    const w = await world();
    for (const n of [1, 2, 3]) await w.servedCall(n);
    const receipted = CALL_COST * 3n; // 0.90 USDC
    const posted = 1_500_000n; // 1.50 USDC: above what the receipts cover
    await w.post(posted);
    await w.dispute();
    const disputedSlot = (await w.reservationNow()).disputedSlot;
    const treasuryBefore = await amount(w.treasuryAta);

    const first = await w.pass();
    assert.equal(first.mine?.status, 'waiting_for_evidence', JSON.stringify(first.result));
    assert.equal(first.mine.payout, receipted.toString());
    assert.equal(await amount(w.payeeAta), 0n, 'nothing is paid while the judge waits');
    assert.equal((await w.reservationNow()).state, 'disputed');

    await travelTo(disputedSlot + JUDGE / 3n - 50n);
    assert.equal((await w.pass()).mine?.status, 'waiting_for_evidence', 'still waiting just before the evidence window ends');

    await reach(disputedSlot + JUDGE / 3n);
    const { result, mine } = await w.pass();
    assert.equal(mine?.status, 'ruled', JSON.stringify(result));
    assert.equal(mine.payout, receipted.toString());
    assert.equal(await amount(w.payeeAta), receipted - fee(receipted), 'the provider gets the receipted amount less the fee');
    assert.equal((await amount(w.treasuryAta)) - treasuryBefore, fee(receipted));
    assert.equal(await amount(w.payerAta), RESERVED - receipted, 'the payer gets the rest of the slice');
    assert.equal((await w.reservationNow()).state, 'paid');

    const onChain = await rulingOnChain(mine.signature);
    assert.equal(onChain.resolveData.readBigUInt64LE(16), receipted, 'the resolve names the receipted amount');
    const row = w.store.rows.find((r) => r.kind === 'ruling');
    assert.equal(row.detail.posted, posted.toString());
    assert.equal(row.detail.payout, receipted.toString());
    assert.equal(onChain.memo, `rap-judge ${JUDGE_RULE_VERSION} ${row.detail.evidenceHash}`);
  });

  test('with no receipt at all, the whole slice goes back to the payer once the evidence window ends', async () => {
    const w = await world();
    await w.post(600_000n);
    await w.dispute();
    const disputedSlot = (await w.reservationNow()).disputedSlot;
    const treasuryBefore = await amount(w.treasuryAta);
    assert.equal((await w.pass()).mine?.status, 'waiting_for_evidence');

    await reach(disputedSlot + JUDGE / 3n);
    const { result, mine } = await w.pass();
    assert.equal(mine?.status, 'ruled', JSON.stringify(result));
    assert.equal(mine.payout, '0');
    assert.equal(await amount(w.payeeAta), 0n);
    assert.equal((await amount(w.treasuryAta)) - treasuryBefore, 0n, 'no fee on nothing paid');
    assert.equal(await amount(w.payerAta), RESERVED);
    assert.equal(w.store.rows.find((r) => r.kind === 'ruling').detail.basis, 'no_evidence');
  });
});
