// Layer 2 of the Surfpool Budget tests (#1202): the whole Budget stack, as
// deployed, run together on an embedded Surfpool fork of devnet.
//
// Every part is the repository's own code, wired the way its routes and
// projects wire it, with only the outside world swapped out:
//
//   - the app's Budget page steps (lib/budget/page.ts: prepare, start, action)
//     and relay (lib/budget/relay.ts), with the chat route's dependencies;
//   - the Budget signer (lib/budget/signer-service.ts) behind the app's own
//     signer client (lib/budget/signer-client.ts): requests go through the
//     real handlers, with a local P-256 key in place of Vercel KMS;
//   - a provider kit provider (packages/provider-kit) with its mock model, its
//     Budget desk and its sweep, signing with a local wallet;
//   - the watcher (lib/budget/watch.ts) with alerts captured, not emailed;
//   - the RAP judge (lib/budget/judge/pass.ts) with a local judge key.
//
// The database is the in-memory custody and judge stores, shared the way the
// Supabase tables are shared. Nothing touches a real network: the fork reads
// devnet but every transaction lands on the local Surfnet, and time travel
// stands in for the days a Budget runs.
//
//   npm run test:surfpool:stack

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPrivateKey, generateKeyPairSync, randomBytes, sign as cryptoSign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import { Surfnet } from '@solana/surfpool';
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_CLOCK_PUBKEY, Transaction, TransactionInstruction } from '@solana/web3.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const jiti = createJiti(import.meta.url, {
  alias: {
    '@/': `${root}/`,
    '@redditech/x402-solana/': `${root}/packages/x402-solana/src/`,
    '@redditech/x402-solana': `${root}/packages/x402-solana/src/index.ts`,
    '@redditech/agent-protocol/': `${root}/packages/agent-protocol/src/`,
    '@redditech/agent-protocol': `${root}/packages/agent-protocol/src/index.ts`,
    // Next's server-only guard: these modules are loaded server side here too.
    'server-only': path.join(here, 'server-only-stub.mjs'),
  },
});
const load = (p) => jiti.import(path.join(root, p));
const [B, page, custody, relay, signerService, signerClient, store, watch, chainMod, judgePass, judgeChainMod, judgeStoreMod, kit] = await Promise.all([
  load('packages/x402-solana/src/budget.ts'),
  load('lib/budget/page.ts'),
  load('lib/budget/custody.ts'),
  load('lib/budget/relay.ts'),
  load('lib/budget/signer-service.ts'),
  load('lib/budget/signer-client.ts'),
  load('lib/budget/store.ts'),
  load('lib/budget/watch.ts'),
  load('lib/budget/chain.ts'),
  load('lib/budget/judge/pass.ts'),
  load('lib/budget/judge/chain.ts'),
  load('lib/budget/judge/store.ts'),
  load('packages/provider-kit/src/index.ts'),
]);

const PROGRAM = new PublicKey('DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu');
const TREASURY = new PublicKey('5CsBuTBFKu12JSs4CUbmv5MR218RYtNmAoQmLf5x3Hxe');
const USDC = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const BURN = new PublicKey('1nc1nerator11111111111111111111111111111111');
const MODEL = 'test/model-1';
const TOTAL = 5_000_000n; // 5 USDC, the page's default
const PAYER_USDC = 20_000_000n;

// ── keys and signing ──────────────────────────────────────────────────────

const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
/** A raw Ed25519 signature by `kp`, as a wallet's signMessage makes. */
const edSign = (kp, message) => new Uint8Array(cryptoSign(null, Buffer.from(message), createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(kp.secretKey.subarray(0, 32))]), format: 'der', type: 'pkcs8' })));

/** A P-256 key standing in for the Budget signer's KMS key. */
function localSpenderSigner() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  const compressed = B.compressP256PublicKey(raw);
  return {
    signer: { publicKey: compressed, sign: async (message) => new Uint8Array(cryptoSign('sha256', Buffer.from(message), privateKey)) },
    // The main app's copy names the key and cannot sign (`readSpenderPublicKey`).
    publicOnly: { publicKey: compressed, publicKeyOnly: true, sign: async () => { throw new Error('the main app cannot sign'); } },
  };
}

// ── the chain ─────────────────────────────────────────────────────────────

let surfnet;
let conn;
let forwarder;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const disc = (name) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const agentOf = (owner) => PublicKey.findProgramAddressSync([Buffer.from('agent'), owner.toBuffer()], PROGRAM)[0];
const tokenBalance = async (owner) => {
  const info = await conn.getAccountInfo(page.associatedTokenAddress(owner, USDC), 'confirmed');
  return info ? Buffer.from(info.data).readBigUInt64LE(64) : 0n;
};
const clockSlot = async () => (await conn.getAccountInfo(SYSVAR_CLOCK_PUBKEY, 'processed')).data.readBigUInt64LE(0);

/** Jumps forward to `target` and waits until the clock sysvar reads it (Surfpool 1.5.0 can lag a slot behind). */
async function travelTo(target) {
  if ((await clockSlot()) < target) surfnet.timeTravelToSlot(Number(target));
  for (let i = 0; i < 400; i += 1) {
    if ((await clockSlot()) >= target) return;
    await sleep(20);
  }
  throw new Error(`clock did not reach slot ${target}`);
}

/** Sends and waits for `confirmed` by polling; returns the signature. */
async function send(tx, signers = []) {
  if (signers.length) {
    tx.feePayer ??= signers[0].publicKey;
    tx.recentBlockhash ??= (await conn.getLatestBlockhash('confirmed')).blockhash;
    tx.partialSign(...signers);
  }
  const sig = await conn.sendRawTransaction(tx.serialize(), { preflightCommitment: 'confirmed' });
  for (let i = 0; i < 400; i += 1) {
    const st = (await conn.getSignatureStatus(sig)).value;
    if (st?.err) throw Object.assign(new Error(`failed: ${JSON.stringify(st.err)}`), { err: st.err });
    if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return sig;
    await sleep(25);
  }
  throw new Error(`not confirmed: ${sig}`);
}
const sendIxs = (ixs, signers) => send(new Transaction().add(...ixs), signers);

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

/**
 * web3.js confirms over a websocket on the RPC port + 1; Surfnet serves its
 * websocket on a port of its own. A plain TCP pipe from one to the other lets
 * the provider kit's own chain code confirm as it does against devnet.
 */
function startWsForwarder() {
  const rpcPort = Number(new URL(surfnet.rpcUrl).port);
  const wsPort = Number(new URL(surfnet.wsUrl).port);
  return new Promise((resolve, reject) => {
    const server = net.createServer((client) => {
      const upstream = net.connect(wsPort, '127.0.0.1');
      client.pipe(upstream).pipe(client);
      client.on('error', () => upstream.destroy());
      upstream.on('error', () => client.destroy());
    });
    server.once('error', reject);
    server.listen(rpcPort + 1, '127.0.0.1', () => resolve(server));
  });
}

// ── the stack ─────────────────────────────────────────────────────────────

/**
 * One Surfnet with every part of the stack wired to it, as the routes and
 * projects wire them. A fresh one per group: Surfnet only travels forward.
 */
async function startStack() {
  surfnet = Surfnet.startWithConfig({ offline: false, remoteRpcUrl: process.env.RAP_BUDGET_SURFPOOL_REMOTE ?? 'https://api.devnet.solana.com' });
  conn = new Connection(surfnet.rpcUrl, 'confirmed');
  forwarder = await startWsForwarder();
  assert.ok((await conn.getAccountInfo(PROGRAM))?.executable, 'the escrow program is not on the fork');

  const payer = Keypair.generate();
  const provider = Keypair.generate();
  const judge = Keypair.generate();
  surfnet.fundSol(payer.publicKey.toBase58(), 2_000_000_000);
  surfnet.fundSol(provider.publicKey.toBase58(), 2_000_000_000);
  surfnet.fundSol(judge.publicKey.toBase58(), 1_000_000_000);
  surfnet.fundToken(payer.publicKey.toBase58(), USDC.toBase58(), Number(PAYER_USDC));
  // A reserve names the provider's USDC account, which must exist (the kit's doctor checks it before a provider goes live).
  surfnet.fundToken(provider.publicKey.toBase58(), USDC.toBase58(), 0);
  if (!(await conn.getAccountInfo(page.associatedTokenAddress(TREASURY, USDC)))) surfnet.fundToken(TREASURY.toBase58(), USDC.toBase58(), 0);
  // The judge must be a registered attestation agent (open_budget checks it, #1210); the provider a registered agent.
  await sendIxs([registerAgentIx(judge.publicKey, 1, 'rap/judge-stack')], [judge]);
  await sendIxs([registerAgentIx(provider.publicKey, 0, MODEL)], [provider]);

  const env = {
    BUDGET_DEFAULT_JUDGE: judge.publicKey.toBase58(),
    BUDGET_USDC_PROVIDERS: JSON.stringify([{ id: 'kit-test', name: 'Kit test provider', model: MODEL, url: 'https://kit.provider.test/v1/chat/completions', payee: provider.publicKey.toBase58(), inputPerMillionUsd: '3', outputPerMillionUsd: '15' }]),
    // Alerts are captured below; these only satisfy the "alerts can reach someone" checks.
    RESEND_API_KEY: 're_local_test_only',
    BUDGET_ALERT_FROM: 'alerts@example.test',
    BUDGET_OPS_EMAIL: 'ops@example.test',
    BUDGET_LINK_ORIGIN: 'https://app.example.test',
    BUDGET_SIGNER_URL: 'https://signer.example.test',
    BUDGET_SIGNER_TOKEN: randomBytes(24).toString('hex'),
  };
  // Some page helpers read process.env directly (the provider directory in status views).
  Object.assign(process.env, env);

  const alerts = [];
  const sender = {
    email: async (to, subject, text) => (alerts.push({ to, subject, text }), 'sent'),
    webhook: async (url, body) => (alerts.push({ to: url, subject: body?.subject ?? '', text: JSON.stringify(body) }), 'sent'),
  };
  const custodyStore = new store.MemoryBudgetCustodyStore();
  // The judge reads the relay's call log from the same database (`budget_spender_uses`), as the Supabase store does.
  const judgeStore = new (class extends judgeStoreMod.MemoryJudgeStore {
    async signedCalls(slice) {
      const record = await custodyStore.byBudget(slice.budget);
      if (!record) return { count: 0, bodyHashes: new Set() };
      const calls = custodyStore.uses.filter((u) => u.spenderId === record.id && u.purpose === 'call' && u.payee === slice.payee && u.detail?.createdSlot === slice.createdSlot);
      return { count: calls.length, bodyHashes: new Set(calls.map((u) => u.detail?.bodyHash).filter((h) => /^[0-9a-f]{64}$/.test(h ?? ''))) };
    }
  })();
  const keys = localSpenderSigner();
  const appChain = chainMod.budgetChainFor(conn, PROGRAM);

  // The Budget signer project, reached through the app's own client.
  const signerCtx = { custody: { store: custodyStore, signer: keys.signer, sender, network: 'solana-devnet', env }, chain: chainMod.budgetChainFor(new Connection(surfnet.rpcUrl, 'confirmed'), PROGRAM), programId: PROGRAM, env, network: 'solana-devnet' };
  const signerFetch = async (url, init) => {
    const request = new Request(url, { method: init.method, headers: init.headers, body: init.body });
    const route = new URL(url).pathname;
    if (route === '/api/v1/approve') return signerService.handleApprove(request, signerCtx);
    if (route === '/api/v1/sign-call') return signerService.handleSignCall(request, signerCtx);
    return new Response('not found', { status: 404 });
  };

  // The provider: the kit's handler with its mock model, on a wallet of its own.
  const parsed = kit.parseProviderConfig(
    {
      name: 'Kit test provider',
      description: 'The layer 2 Surfpool test provider.',
      network: 'solana-devnet',
      wallet: provider.publicKey.toBase58(),
      publicUrl: 'https://kit.provider.test',
      model: MODEL,
      upstream: { mock: true },
      price: { currency: 'USDC', inputPerMillion: '3', outputPerMillion: '15', maxOutputTokens: 500 },
      budgets: { enabled: true, acceptedJudges: [judge.publicKey.toBase58()] },
    },
    {},
  );
  assert.ok(parsed.ok, `provider config: ${parsed.ok ? '' : parsed.errors.join('; ')}`);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rap-stack-'));
  const kitLog = [];
  const kitHandler = kit.createProviderHandler(parsed.config, {
    chain: kit.createProviderChain(surfnet.rpcUrl, provider),
    upstream: kit.createMockUpstream(),
    replayStore: new kit.FileReplayStore(path.join(dir, 'replay.log')),
    signMessage: (message) => edSign(provider, message),
    log: (event) => kitLog.push(event),
  });

  // The chat route's relay dependencies (app/api/budget/v1/chat/completions/route.ts).
  const relayDeps = {
    store: custodyStore,
    programId: PROGRAM,
    env,
    callProvider: async (p, bodyText, headers) => {
      const res = await kitHandler(new Request(p.endpoint.url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: bodyText }));
      const out = {};
      res.headers.forEach((value, name) => {
        out[name] = value;
      });
      return { status: res.status, headers: out, bodyText: await res.text() };
    },
    reservedOnChain: async (budget, createdSlot, payee) => {
      const account = await conn.getAccountInfo(B.reservationAddress(new PublicKey(budget), new PublicKey(payee), PROGRAM), 'confirmed');
      if (!account || !account.owner.equals(PROGRAM)) return 0n;
      const slice = B.decodeReservation(account.data);
      return slice.budgetCreatedSlot === createdSlot ? slice.reserved : 0n;
    },
    signCall: (input) => signerClient.signCallViaSigner(input, { env, fetchImpl: signerFetch }),
    approve: (input) => signerClient.approveViaSigner(input, { programId: PROGRAM, env, fetchImpl: signerFetch }),
    blockhash: async () => (await conn.getLatestBlockhash('confirmed')).blockhash,
    saveReceipt: ({ budget, createdSlot, payee, receipt }) => judgeStore.addReceipt({ budget, createdSlot, payee }, 'relay', receipt),
  };

  const judgeDeps = {
    chain: judgeChainMod.judgeChainFor(conn, PROGRAM),
    store: judgeStore,
    signer: { address: judge.publicKey, sign: async (message) => edSign(judge, message) },
    programId: PROGRAM,
    network: 'solana-devnet',
    env: {},
    notify: async (subject, text) => (alerts.push({ to: 'judge-operator', subject, text }), true),
  };
  const watchDeps = { store: custodyStore, chain: appChain, programId: PROGRAM, sender, origin: env.BUDGET_LINK_ORIGIN, env, network: 'solana-devnet' };

  return {
    payer, provider, judge, env, alerts, custodyStore, judgeStore, keys, appChain, kitHandler, kitLog, relayDeps, judgeDeps, watchDeps,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

let s;
function freshStack() {
  before(async () => {
    s = await startStack();
  });
  after(async () => {
    s?.cleanup();
    await new Promise((r) => (forwarder ? forwarder.close(() => r()) : r()));
    try {
      surfnet?.stop();
    } catch {
      // already gone
    }
  });
}

// ── the payer's and agent's steps ─────────────────────────────────────────

/** The Budget page's open: prepare, the wallet's signature, start, the wallet sends, activate. */
async function openBudget({ total = TOTAL } = {}) {
  const prepared = page.prepareBudget({ payer: s.payer.publicKey.toBase58(), token: 'USDC', total: total.toString(), providerIds: ['kit-test'], email: 'payer@example.test' }, PROGRAM, Date.now(), s.env);
  assert.ok(prepared.ok, `prepare: ${prepared.code} ${prepared.message}`);
  const signature = Buffer.from(edSign(s.payer, Buffer.from(prepared.message, 'base64'))).toString('base64');
  const appCustody = { store: s.custodyStore, signer: s.keys.publicOnly, sender: { email: async () => 'sent', webhook: async () => 'sent' }, env: s.env };
  const started = await page.startBudget({ terms: prepared.terms, signature, programId: PROGRAM, blockhash: () => s.appChain.latestBlockhash(), env: s.env }, appCustody);
  assert.ok(started.ok, `start: ${started.code} ${started.message}`);
  await send(Transaction.from(Buffer.from(started.transaction, 'base64')), [s.payer]);
  // Activation reads the Budget at `finalized`: retry until it is.
  let activated;
  for (let i = 0; i < 120; i += 1) {
    activated = await custody.activateSpender({ id: started.id, programId: PROGRAM }, { ...appCustody, chain: s.appChain });
    if (activated.ok || activated.code !== 'budget_not_found') break;
    await sleep(500);
  }
  assert.ok(activated.ok, `activate: ${activated.code} ${activated.message}`);
  return { id: started.id, budget: new PublicKey(started.budget), key: page.budgetAgentKey(started.id, started.agentSecret), record: activated.record };
}

/** One agent call through the relay, as the chat route makes it. */
const call = (b, content, extra = {}) =>
  relay.relayBudgetCall({ key: `Bearer ${b.key}`, bodyText: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content }], max_tokens: 100, ...extra }), caller: 'relay:stack-test' }, s.relayDeps);

/** One of the page's actions, signed by the payer's wallet and sent. */
async function payerAction(b, action) {
  const built = await page.buildBudgetAction({ budget: b.budget.toBase58(), payee: s.provider.publicKey.toBase58(), action, account: s.payer.publicKey.toBase58(), programId: PROGRAM, chain: s.appChain });
  assert.ok(built.ok, `${action}: ${built.code} ${built.message}`);
  return send(Transaction.from(Buffer.from(built.transaction, 'base64')), [s.payer]);
}

const budgetOf = async (b) => B.decodeBudget((await conn.getAccountInfo(b.budget, 'confirmed')).data);
const sliceOf = async (b) => {
  const info = await conn.getAccountInfo(B.reservationAddress(b.budget, s.provider.publicKey, PROGRAM), 'confirmed');
  return info ? B.decodeReservation(info.data) : null;
};
const sweep = () => s.kitHandler.settleDueBudgets();
/** The protocol fee on `paid` base units of a stablecoin at the launch rate: 2.5%, rounded down, no cap. */
const launchFee = (paid) => paid / 40n;
const balances = async () => ({ payer: await tokenBalance(s.payer.publicKey), provider: await tokenBalance(s.provider.publicKey), treasury: await tokenBalance(TREASURY) });
/** How many of the provider's signed receipts the relay kept for the judge. */
async function receiptCount(b, createdSlot) {
  const receipts = await s.judgeStore.receipts({ budget: b.budget.toBase58(), createdSlot: createdSlot.toString(), payee: s.provider.publicKey.toBase58() }, 200);
  return receipts.length;
}

// ── the tests ─────────────────────────────────────────────────────────────

describe('an honest provider, no dispute: open, calls, close, post, watch, payout', () => {
  freshStack();
  let b;
  let before0;

  test('the page opens a USDC Budget the relay activates, naming the RAP judge and the provider', async () => {
    before0 = await balances();
    b = await openBudget();
    const budget = await budgetOf(b);
    assert.equal(budget.total, TOTAL);
    assert.equal(budget.judge.toBase58(), s.judge.publicKey.toBase58());
    assert.deepEqual(budget.allowlist.map((k) => k.toBase58()), [s.provider.publicKey.toBase58()]);
    assert.ok(budget.p256Spender, 'opened with a P-256 spender');
    assert.equal(b.record.status, 'open');
    assert.equal((await balances()).payer, before0.payer - TOTAL);
  });

  test('the relay refuses a wrong key and a model the Budget does not name', async () => {
    const wrong = await relay.relayBudgetCall({ key: `Bearer rap_budget_${'A'.repeat(43)}.${b.id}`, bodyText: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: 'hi' }] }) }, s.relayDeps);
    assert.equal(wrong.status, 401);
    const other = await relay.relayBudgetCall({ key: `Bearer ${b.key}`, bodyText: JSON.stringify({ model: 'someone/else', messages: [{ role: 'user', content: 'hi' }] }) }, s.relayDeps);
    assert.equal(other.status, 400);
    assert.equal(await sliceOf(b), null, 'nothing was reserved');
  });

  test('a first call reserves a slice through the signer and is served; a second rides on it', async () => {
    const first = await call(b, 'What is a pooled Budget?');
    assert.equal(first.status, 200, `first call: ${first.bodyText.slice(0, 300)} kit: ${JSON.stringify(s.kitLog.slice(-3))}`);
    assert.match(JSON.parse(first.bodyText).choices[0].message.content, /Mock answer/);
    const slice = await sliceOf(b);
    assert.ok(slice && slice.reserved > 0n, 'the reserve landed');
    assert.equal(slice.state, 'open');
    const second = await call(b, 'And who judges a dispute?');
    assert.equal(second.status, 200, `second call: ${second.bodyText.slice(0, 300)}`);
    assert.equal((await sliceOf(b)).reserved, slice.reserved, 'no second reserve was needed');
    const calls = s.custodyStore.uses.filter((u) => u.purpose === 'call');
    assert.deepEqual(calls.map((u) => Number(u.detail.sequence)), [1, 2], 'the signer numbered both calls');
    assert.equal(await receiptCount(b, (await budgetOf(b)).createdSlot), 2, 'both receipts were kept for the judge');
  });

  test('the payer closes early; the sweep posts what was served; the watcher tells the payer', async () => {
    await payerAction(b, 'close');
    assert.ok((await budgetOf(b)).closed);
    const swept = await sweep();
    assert.deepEqual(swept.map((x) => x.status), ['posted']);
    const slice = await sliceOf(b);
    assert.equal(slice.state, 'posted');
    assert.ok(slice.finalAmount > 0n && slice.finalAmount <= slice.reserved, `posted ${slice.finalAmount} of ${slice.reserved}`);
    const reports = await watch.watchBudgets(s.watchDeps);
    assert.ok(reports.complete, JSON.stringify(reports));
    const toPayer = s.alerts.filter((a) => a.to === 'payer@example.test');
    assert.ok(toPayer.length > 0, `the payer was alerted: ${JSON.stringify(s.alerts.map((a) => a.subject))}`);
    const posted = toPayer.find((a) => /owed/.test(a.subject));
    assert.ok(posted, `the payer is told what the provider posted: ${JSON.stringify(toPayer.map((a) => a.subject))}`);
    assert.ok(posted.text.includes(slice.finalAmount.toString()), 'the alert names the amount posted');
    // The dispute link is a Solana Pay link to the app's own dispute route.
    assert.ok(decodeURIComponent(posted.text).includes('https://app.example.test/api/budget/v1/dispute?budget='), 'the alert carries the dispute link');
  });

  test('after the dispute window the sweep pays out: provider less the fee, the fee to the treasury, the rest back', async () => {
    const budget = await budgetOf(b);
    const slice = await sliceOf(b);
    const ends = B.disputeEnds(budget, slice);
    assert.ok(ends !== null);
    // Inside the window the payout waits.
    assert.deepEqual((await sweep()).map((x) => x.status), ['posted']);
    const mid = await balances();
    await travelTo(ends);
    assert.deepEqual((await sweep()).map((x) => x.status), ['paid']);
    const end = await balances();
    const fee = launchFee(slice.finalAmount);
    assert.equal(end.provider - mid.provider, slice.finalAmount - fee);
    assert.equal(end.treasury - mid.treasury, fee);
    assert.equal(end.payer, before0.payer - slice.finalAmount, 'the payer got back everything not posted');
    assert.equal(await sliceOf(b), null, 'the slice is closed');
    assert.deepEqual((await sweep()).map((x) => x.status), ['done']);
  });
});

describe('a dispute of an honest post: the judge pays it in full from the receipts', () => {
  freshStack();
  let b;

  test('calls, close, post, then the payer disputes from the page', async () => {
    b = await openBudget();
    for (const q of ['one', 'two', 'three']) assert.equal((await call(b, `question ${q}`)).status, 200);
    await payerAction(b, 'close');
    assert.deepEqual((await sweep()).map((x) => x.status), ['posted']);
    await payerAction(b, 'dispute');
    assert.equal((await sliceOf(b)).state, 'disputed');
    assert.deepEqual((await sweep()).map((x) => x.status), ['disputed'], 'the provider waits for the judge');
  });

  test('the judge pass finds the dispute on chain and rules the whole post', async () => {
    const slice = await sliceOf(b);
    const before1 = await balances();
    const pass = await judgePass.runJudgePass(s.judgeDeps);
    assert.ok(pass.ok, JSON.stringify(pass));
    assert.equal(pass.disputed, 1);
    assert.equal(pass.slices[0].status, 'ruled', JSON.stringify(pass.slices[0]));
    assert.equal(pass.slices[0].payout, slice.finalAmount.toString());
    const after1 = await balances();
    const fee = launchFee(slice.finalAmount);
    assert.equal(after1.provider - before1.provider, slice.finalAmount - fee);
    assert.equal(after1.treasury - before1.treasury, fee);
    // The close already returned what was never reserved; the ruling returns the rest of the slice.
    assert.equal(after1.payer - before1.payer, slice.reserved - slice.finalAmount);
    assert.ok(s.alerts.some((a) => a.to === 'judge-operator' && /ruled/.test(a.subject)));
    assert.equal(await sliceOf(b), null);
    assert.deepEqual((await sweep()).map((x) => x.status), ['done']);
  });
});

describe('an overcharge: the provider posts more than it served, the payer disputes, the judge pays the receipts', () => {
  freshStack();
  let b;
  let served;

  test('two calls, then the provider posts its whole slice by hand', async () => {
    b = await openBudget();
    for (const q of ['one', 'two']) assert.equal((await call(b, `question ${q}`)).status, 200);
    const slice = await sliceOf(b);
    assert.deepEqual((await sweep()).map((x) => x.status), ['open'], 'nothing is due while the Budget is open');
    // The kit would post what it served; a provider that overcharges posts the whole reservation.
    await sendIxs([B.postFinalInstruction({ programId: PROGRAM, budget: b.budget, createdSlot: (await budgetOf(b)).createdSlot, payee: s.provider.publicKey, amount: slice.reserved })], [s.provider]);
    assert.equal((await sliceOf(b)).finalAmount, slice.reserved);
  });

  test('the payer closes and disputes; the judge waits for evidence, then pays only what the receipts show', async () => {
    await payerAction(b, 'close');
    await payerAction(b, 'dispute');
    const budget = await budgetOf(b);
    const slice = await sliceOf(b);
    const first = await judgePass.runJudgePass(s.judgeDeps);
    assert.equal(first.slices[0].status, 'waiting_for_evidence', JSON.stringify(first.slices[0]));
    served = BigInt(first.slices[0].payout);
    assert.ok(served > 0n && served < slice.finalAmount, `receipts show ${served} of a ${slice.finalAmount} post`);
    const before1 = await balances();
    await travelTo(judgePass.judgeWindows(budget, slice).evidenceEnds);
    const second = await judgePass.runJudgePass(s.judgeDeps);
    assert.equal(second.slices[0].status, 'ruled', JSON.stringify(second.slices[0]));
    assert.equal(second.slices[0].payout, served.toString());
    const after1 = await balances();
    const fee = launchFee(served);
    assert.equal(after1.provider - before1.provider, served - fee);
    assert.equal(after1.treasury - before1.treasury, fee);
    assert.equal(after1.payer - before1.payer, slice.reserved - served, 'the overcharge went back to the payer');
    const ruling = s.judgeStore.rows.find((r) => r.kind === 'ruling');
    assert.ok(ruling, 'the ruling is on the judge log');
  });
});
