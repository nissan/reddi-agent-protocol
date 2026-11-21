/* Devnet end-to-end exercise of the V1 escrow program in SOL and devnet USDC.
 *
 * Program DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu (devnet build, see DEPLOY.md). Every payout sends the 2.5%
 * protocol fee to the treasury (Squads vault 5CsBuTBF…3Hxe), or to its USDC associated token account.
 *
 * Modes (one per run):
 *   plan          Read only. Checks the network, the deployed program hash, the treasury accounts and the two
 *                 wallets' balances, then simulates the two lock instructions without signatures. Needs only the
 *                 wallets' public addresses: RAP_E2E_PAYER and RAP_E2E_PAYEE.
 *   run           Signs on devnet. Per currency: lock then payer release; metered lock then payee settle at a
 *                 lower actual cost; lock then payee decline. Each refused case (early claim, early payer refund,
 *                 settle above the maximum, payee settle of an unmetered escrow, replay) is simulated, not sent,
 *                 and must fail. Then it locks one escrow per currency for each time-gated case and leaves it
 *                 open for the finish modes below.
 *   finish-refund After the cancel window (648,000 slots, about 3 days): payer refunds the "refund" escrows.
 *   finish-claim  After the claim window (1,512,000 slots, about 7 days): payee claims the "claim" escrows.
 *                 Before a window has passed, a finish mode simulates the action, shows it is refused, and stops.
 *
 * Signing modes read two keypair files by path: RAP_E2E_PAYER_KEYPAIR and RAP_E2E_PAYEE_KEYPAIR. The script never
 * prints, copies or writes key material. The payer pays rent and the fees of its own actions. The payee signs its
 * actions alone and pays their fees (the SOL release and settle instructions treat a payer signature as a payer
 * action, and a fee payer always signs), so `run` first sends the payee 0.01 SOL when it holds under 0.005 SOL.
 * A run id can be used once. RAP_E2E_LEFTOVER_RUN_ID (optional, `run` only) names an earlier interrupted run whose
 * open escrows the payer closes first, paying the payee one base unit so the rest returns to the payer.
 * RAP_E2E_RUN_ID (letters, digits, dashes) names the run: escrow nonces are derived from it, so the finish modes find
 * the escrows that `run` left open. RAP_E2E_OUT_DIR (absolute) receives one JSON result file per mode.
 * Optional: RAP_E2E_RPC (default https://api.devnet.solana.com). The script refuses any cluster whose genesis hash
 * is not devnet's, and refuses to sign if the deployed program bytes do not hash to the recorded value.
 *
 * Fee amounts are checked per transaction from its own balance changes, so other traffic to the treasury (sandbox
 * settles) cannot disturb them.
 *
 * Run: node scripts/devnet-escrow-e2e.cjs <mode>
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } = require('@solana/web3.js');
const token = require('@solana/spl-token');

const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const PROGRAM = new PublicKey('DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu');
const PROGRAM_DATA = new PublicKey('8cCmxnMPU8EQR7ECfff19Dr4gu1n7jyFCuEEyaYspRn2');
const PROGRAM_LEN = 337_760;
const PROGRAM_SHA256 = '5055df469642a3429c524a312b129c7e9b7cb6fdbeb37fa2e8275ab87b8e142a';
const TREASURY = new PublicKey('5CsBuTBFKu12JSs4CUbmv5MR218RYtNmAoQmLf5x3Hxe');
const USDC = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'); // constants.rs USDC_DEVNET_MINT
const TOKEN = token.TOKEN_PROGRAM_ID;
const TREASURY_USDC = token.getAssociatedTokenAddressSync(USDC, TREASURY, true, TOKEN);
const CANCEL_WINDOW_SLOTS = 648_000; // constants.rs
const CLAIM_WINDOW_SLOTS = 1_512_000; // constants.rs
const FEE_BPS = 250n;
const SOL_FEE_CAP = 100_000_000n;
const SOL_CREATED_SLOT_OFFSET = 8 + 32 + 32 + 8 + 16 + 1 + 8; // EscrowAccount.created_slot
const TOKEN_CREATED_SLOT_OFFSET = 193; // TokenEscrowAccount.created_slot

// Amounts per case, in lamports for SOL and base units (6 dp) for USDC. Kept small.
const AMOUNTS = {
  sol: { release: 10_000_000n, meteredMax: 20_000_000n, meteredActual: 8_000_000n, decline: 5_000_000n, refund: 2_000_000n, claim: 2_000_000n },
  usdc: { release: 1_000_000n, meteredMax: 2_000_000n, meteredActual: 800_000n, decline: 500_000n, refund: 100_000n, claim: 100_000n },
};

// Every escrow label `run` creates, in order. Used to refuse a run id that was already used.
const RUN_LABELS = ['sol-release', 'sol-metered', 'sol-decline', 'sol-refund', 'sol-claim',
  'usdc-release', 'usdc-metered', 'usdc-decline', 'usdc-refund', 'usdc-claim'];
// The payee signs alone for its own actions, so it needs a little SOL for fees.
const PAYEE_FEE_FLOOR = 5_000_000n;
const PAYEE_FEE_TOPUP = 10_000_000n;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const disc = name => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const u64 = value => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b; };
const meta = (pubkey, isWritable = false, isSigner = false) => ({ pubkey, isWritable, isSigner });
const fee = (paid, sol) => { const f = (paid * FEE_BPS) / 10_000n; return sol && f > SOL_FEE_CAP ? SOL_FEE_CAP : f; };
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes) {
  let n = BigInt(`0x${Buffer.from(bytes).toString('hex') || '0'}`);
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = `1${out}`; }
  return out;
}
const explorer = sig => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

function env(name, { required = true } = {}) {
  const value = process.env[name];
  if (required) assert(value && value.trim(), `${name} is required`);
  return value?.trim();
}

function loadKeypair(name) {
  const file = env(name);
  assert(path.isAbsolute(file), `${name} must be an absolute path`);
  const secret = Uint8Array.from(JSON.parse(fs.readFileSync(file, 'utf8')));
  return Keypair.fromSecretKey(secret);
}

function nonceFor(runId, label) {
  return createHash('sha256').update(`rap-devnet-escrow-e2e:${runId}:${label}`).digest().subarray(0, 16);
}

// ── instruction builders (layouts from programs/escrow/src) ─────────────────────────────────────

const solEscrow = (payer, nonce) => PublicKey.findProgramAddressSync([Buffer.from('escrow'), payer.toBuffer(), nonce], PROGRAM)[0];
const tokenEscrow = (payer, nonce) => PublicKey.findProgramAddressSync([Buffer.from('token-escrow'), payer.toBuffer(), nonce], PROGRAM)[0];
const tokenVault = escrow => PublicKey.findProgramAddressSync([Buffer.from('token-vault'), escrow.toBuffer()], PROGRAM)[0];

function solLock({ payer, payee, nonce, amount, metered = false }) {
  return new TransactionInstruction({ programId: PROGRAM,
    data: Buffer.concat([disc(metered ? 'lock_metered_escrow' : 'lock_escrow'), u64(amount), nonce]),
    keys: [meta(solEscrow(payer, nonce), true), meta(payer, true, true), meta(payee), meta(SystemProgram.programId)] });
}
// Release / settle: the payer or the payee signs; whichever signed is the authority.
function solPayout({ payer, payee, nonce, signer, actual }) {
  return new TransactionInstruction({ programId: PROGRAM,
    data: actual === undefined ? disc('release_escrow') : Buffer.concat([disc('settle_escrow'), u64(actual)]),
    keys: [meta(solEscrow(payer, nonce), true), meta(payer, true, signer === 'payer'), meta(payee, true, signer === 'payee'),
      meta(TREASURY, true), meta(SystemProgram.programId)] });
}
function solCancel({ payer, nonce, authority }) {
  return new TransactionInstruction({ programId: PROGRAM, data: disc('cancel_escrow'),
    keys: [meta(solEscrow(payer, nonce), true), meta(authority, false, true), meta(payer, true), meta(SystemProgram.programId)] });
}

function usdcLock({ payer, payee, nonce, amount, source, recipient, metered = false }) {
  const escrow = tokenEscrow(payer, nonce);
  return new TransactionInstruction({ programId: PROGRAM,
    data: Buffer.concat([disc(metered ? 'lock_metered_token_escrow' : 'lock_token_escrow'), u64(amount), nonce]),
    keys: [meta(escrow, true), meta(tokenVault(escrow), true), meta(payer, true, true), meta(payee), meta(USDC),
      meta(source, true), meta(recipient), meta(TOKEN), meta(SystemProgram.programId)] });
}
function usdcPayout({ payer, nonce, authority, destination, refund, actual }) {
  const escrow = tokenEscrow(payer, nonce);
  return new TransactionInstruction({ programId: PROGRAM,
    data: actual === undefined ? disc('release_token_escrow') : Buffer.concat([disc('settle_token_escrow'), u64(actual)]),
    keys: [meta(escrow, true), meta(tokenVault(escrow), true), meta(authority, false, true), meta(payer, true), meta(USDC),
      meta(destination, true), meta(TREASURY_USDC, true), meta(refund, true), meta(TOKEN)] });
}
function usdcCancel({ payer, nonce, authority, destination }) {
  const escrow = tokenEscrow(payer, nonce);
  return new TransactionInstruction({ programId: PROGRAM, data: disc('cancel_token_escrow'),
    keys: [meta(escrow, true), meta(tokenVault(escrow), true), meta(authority, false, true), meta(payer, true), meta(USDC),
      meta(destination, true), meta(TOKEN)] });
}

// ── chain helpers ─────────────────────────────────────────────────────────────────────────────

async function checkCluster(conn) {
  const genesis = await conn.getGenesisHash();
  assert.equal(genesis, DEVNET_GENESIS, `refusing: RPC is not Solana devnet (genesis ${genesis})`);
  const program = await conn.getAccountInfo(PROGRAM);
  assert(program?.executable, 'escrow program is not executable on devnet');
  const data = await conn.getAccountInfo(PROGRAM_DATA);
  assert(data, 'ProgramData account missing');
  const bytes = data.data.subarray(45);
  const sha = createHash('sha256').update(bytes.subarray(0, PROGRAM_LEN)).digest('hex');
  assert.equal(sha, PROGRAM_SHA256, 'refusing: deployed program bytes do not match the recorded hash');
  assert(!bytes.subarray(PROGRAM_LEN).some(b => b !== 0), 'refusing: unexpected bytes after the recorded program length');
  const treasuryUsdc = await token.getAccount(conn, TREASURY_USDC, 'confirmed', TOKEN);
  assert(treasuryUsdc.owner.equals(TREASURY) && treasuryUsdc.mint.equals(USDC), 'treasury USDC account is wrong');
  const slot = await conn.getSlot('confirmed');
  return { genesis, programSha256: sha, slot, treasuryLamports: await conn.getBalance(TREASURY), treasuryUsdc: treasuryUsdc.amount.toString() };
}

async function tokenAmount(conn, address) {
  try { return (await token.getAccount(conn, address, 'confirmed', TOKEN)).amount; } catch { return null; }
}

// The fee payer is the first signer. It matters: a fee payer always signs, and the SOL release and settle
// instructions take whichever party signed as the authority (payer first). So a payee action must be signed, and
// paid for, by the payee alone, or the program sees a payer action.
function makeSender(conn) {
  async function build(ixs, signers) {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
    const tx = new Transaction({ feePayer: signers[0].publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
    tx.sign(...signers);
    return tx;
  }
  async function send(label, ixs, signers) {
    const tx = await build(ixs, signers);
    const local = base58(tx.signature);
    let signature;
    try {
      signature = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed' });
    } catch (err) {
      // A retried request can fail preflight because its own first copy already landed. Check before failing.
      await sleep(2_000);
      const landed = (await conn.getSignatureStatuses([local], { searchTransactionHistory: true })).value[0];
      if (!landed || landed.err) throw err;
      signature = local;
    }
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const status = (await conn.getSignatureStatuses([signature])).value[0];
      if (status?.err) throw new Error(`${label} failed: ${JSON.stringify(status.err)} ${explorer(signature)}`);
      if (status?.confirmationStatus === 'finalized') {
        console.log(`  ✓ ${label}  ${explorer(signature)}`);
        return signature;
      }
      await sleep(800);
    }
    throw new Error(`${label}: confirmation timeout ${explorer(signature)}`);
  }
  // A refused case is simulated with real signatures and never sent; it must return a program error.
  async function refused(label, ixs, signers, expected) {
    const tx = await build(ixs, signers);
    const sim = await conn.simulateTransaction(tx, undefined, false);
    assert(sim.value.err, `${label}: expected refusal, but the simulation succeeded`);
    const logs = (sim.value.logs || []).join('\n');
    if (expected) assert(logs.includes(expected), `${label}: refused, but not with ${expected}:\n${logs}`);
    console.log(`  ✓ refused (simulated): ${label}${expected ? ` [${expected}]` : ''}`);
    return { label, expected: expected || null, err: sim.value.err };
  }
  return { send, refused };
}

// Balance change of `account` in a finalized transaction, from its own pre/post balances.
async function solDelta(conn, signature, account) {
  const tx = await conn.getTransaction(signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
  const keys = tx.transaction.message.getAccountKeys().staticAccountKeys;
  const i = keys.findIndex(k => k.equals(account));
  // An account the transaction does not name cannot have changed (a cancel never names the treasury).
  if (i < 0) return 0n;
  // The fee payer (key 0) also paid the network fee; leave that out so the check sees only the escrow's effect.
  const networkFee = i === 0 ? BigInt(tx.meta.fee) : 0n;
  return BigInt(tx.meta.postBalances[i]) - BigInt(tx.meta.preBalances[i]) + networkFee;
}
async function tokenDelta(conn, signature, account) {
  const tx = await conn.getTransaction(signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
  const keys = tx.transaction.message.getAccountKeys().staticAccountKeys;
  const i = keys.findIndex(k => k.equals(account));
  assert(i >= 0, `${account.toBase58()} not in ${signature}`);
  const pick = list => BigInt((list || []).find(b => b.accountIndex === i)?.uiTokenAmount.amount ?? '0');
  return pick(tx.meta.postTokenBalances) - pick(tx.meta.preTokenBalances);
}
async function assertClosed(conn, ...accounts) {
  for (const a of accounts) assert.equal(await conn.getAccountInfo(a, 'finalized'), null, `${a.toBase58()} should be closed`);
}

// ── modes ─────────────────────────────────────────────────────────────────────────────────────

async function plan(conn) {
  const payer = new PublicKey(env('RAP_E2E_PAYER'));
  const payee = new PublicKey(env('RAP_E2E_PAYEE'));
  assert(!payer.equals(payee), 'payer and payee must differ');
  const cluster = await checkCluster(conn);
  const payerSource = token.getAssociatedTokenAddressSync(USDC, payer, true, TOKEN);
  const payeeRecipient = token.getAssociatedTokenAddressSync(USDC, payee, true, TOKEN);
  const wallets = {
    payer: { address: payer.toBase58(), lamports: await conn.getBalance(payer), usdcAccount: payerSource.toBase58(), usdc: (await tokenAmount(conn, payerSource))?.toString() ?? null },
    payee: { address: payee.toBase58(), lamports: await conn.getBalance(payee), usdcAccount: payeeRecipient.toBase58(), usdc: (await tokenAmount(conn, payeeRecipient))?.toString() ?? null },
  };
  const solNeeded = AMOUNTS.sol.release + AMOUNTS.sol.meteredMax + AMOUNTS.sol.decline + AMOUNTS.sol.refund + AMOUNTS.sol.claim + PAYEE_FEE_TOPUP + 50_000_000n;
  const usdcNeeded = AMOUNTS.usdc.release + AMOUNTS.usdc.meteredMax + AMOUNTS.usdc.decline + AMOUNTS.usdc.refund + AMOUNTS.usdc.claim;
  const shortfalls = [];
  if (BigInt(wallets.payer.lamports) < solNeeded) shortfalls.push(`payer needs at least ${Number(solNeeded) / 1e9} devnet SOL (locks plus rent and fees)`);
  if (BigInt(wallets.payer.usdc ?? 0) < usdcNeeded) shortfalls.push(`payer needs at least ${Number(usdcNeeded) / 1e6} devnet USDC in ${payerSource.toBase58()}`);
  // Simulate both locks with no signatures, to prove the instruction layouts against the live program.
  const nonce = nonceFor('plan', `${Date.now()}`);
  const sims = {};
  for (const [name, ix] of [
    ['sol lock_escrow', solLock({ payer, payee, nonce, amount: AMOUNTS.sol.release })],
    ...(wallets.payer.usdc !== null && wallets.payee.usdc !== null
      ? [['usdc lock_token_escrow', usdcLock({ payer, payee, nonce, amount: AMOUNTS.usdc.release, source: payerSource, recipient: payeeRecipient })]]
      : []),
  ]) {
    const { blockhash } = await conn.getLatestBlockhash('confirmed');
    const tx = new Transaction({ feePayer: payer, recentBlockhash: blockhash }).add(ix);
    const sim = await conn.simulateTransaction(tx.compileMessage(), undefined);
    sims[name] = sim.value.err ? { ok: false, err: sim.value.err, logs: sim.value.logs } : { ok: true, unitsConsumed: sim.value.unitsConsumed };
  }
  if (BigInt(wallets.payee.lamports) < PAYEE_FEE_FLOOR) shortfalls.push(`payee holds under ${Number(PAYEE_FEE_FLOOR) / 1e9} SOL for its own fees; \`run\` sends it ${Number(PAYEE_FEE_TOPUP) / 1e9} SOL from the payer`);
  if (wallets.payee.usdc === null) shortfalls.push('payee has no devnet USDC account yet; `run` creates it (payer pays rent)');
  return { mode: 'plan', cluster, wallets, needs: { lamports: solNeeded.toString(), usdc: usdcNeeded.toString() }, shortfalls, simulations: sims, amounts: AMOUNTS };
}

async function run(conn, runId) {
  const payerKp = loadKeypair('RAP_E2E_PAYER_KEYPAIR');
  const payeeKp = loadKeypair('RAP_E2E_PAYEE_KEYPAIR');
  const payer = payerKp.publicKey, payee = payeeKp.publicKey;
  assert(!payer.equals(payee), 'payer and payee must differ');
  const cluster = await checkCluster(conn);
  const { send, refused } = makeSender(conn);
  const asPayee = [payeeKp]; // the payee signs and pays its own fee, so the program sees a payee action
  const n = label => nonceFor(runId, label);
  const out = { mode: 'run', runId, cluster, payer: payer.toBase58(), payee: payee.toBase58(), steps: [], refusals: [], openEscrows: {} };
  const step = (name, signature, checks) => { out.steps.push({ name, signature, explorer: explorer(signature), ...checks }); };

  // A run id can be used once: its escrow addresses derive from it.
  for (const label of RUN_LABELS) {
    const address = label.startsWith('sol-') ? solEscrow(payer, n(label)) : tokenEscrow(payer, n(label));
    assert(!(await conn.getAccountInfo(address, 'confirmed')), `RAP_E2E_RUN_ID ${runId} was already used (${label} escrow ${address.toBase58()} exists). Pick a new run id.`);
  }
  // The payee pays the fees of its own actions.
  if (BigInt(await conn.getBalance(payee, 'confirmed')) < PAYEE_FEE_FLOOR) {
    const sig = await send('fund payee for its own fees', [SystemProgram.transfer({ fromPubkey: payer, toPubkey: payee, lamports: PAYEE_FEE_TOPUP })], [payerKp]);
    step('fund payee for fees', sig, { lamports: PAYEE_FEE_TOPUP.toString() });
  }
  // Optional: close escrows left open by an earlier, interrupted run. The payer settles each at the smallest amount
  // (one base unit to the payee, no fee at that size), so the rest comes back to the payer.
  const leftoverRunId = env('RAP_E2E_LEFTOVER_RUN_ID', { required: false });
  if (leftoverRunId) {
    assert(/^[A-Za-z0-9-]{3,40}$/.test(leftoverRunId) && leftoverRunId !== runId, 'RAP_E2E_LEFTOVER_RUN_ID must be an earlier run id');
    const source = token.getAssociatedTokenAddressSync(USDC, payer, true, TOKEN);
    const recipient = token.getAssociatedTokenAddressSync(USDC, payee, true, TOKEN);
    for (const label of RUN_LABELS) {
      const nonce = nonceFor(leftoverRunId, label);
      const sol = label.startsWith('sol-');
      const address = sol ? solEscrow(payer, nonce) : tokenEscrow(payer, nonce);
      if (!(await conn.getAccountInfo(address, 'confirmed'))) continue;
      assert(sol || (await tokenAmount(conn, recipient)) !== null, `leftover ${label}: payee has no USDC account yet`);
      const ix = sol
        ? solPayout({ payer, payee, nonce, signer: 'payer', actual: 1n })
        : usdcPayout({ payer, nonce, authority: payer, destination: recipient, refund: source, actual: 1n });
      const sig = await send(`close leftover ${leftoverRunId}/${label}`, [ix], [payerKp]);
      if (sol) await assertClosed(conn, address); else await assertClosed(conn, address, tokenVault(address));
      step(`close leftover ${leftoverRunId}/${label}`, sig, { escrow: address.toBase58(), paidToPayee: '1' });
    }
  }

  console.log('SOL');
  {
    const a = AMOUNTS.sol;
    // Lock, then payer release.
    let sig = await send('sol lock (release case)', [solLock({ payer, payee, nonce: n('sol-release'), amount: a.release })], [payerKp]);
    step('sol lock release-case', sig, { amount: a.release.toString() });
    out.refusals.push(await refused('sol payee claim before the claim window', [solPayout({ payer, payee, nonce: n('sol-release'), signer: 'payee' })], asPayee, 'ClaimWindowNotElapsed'));
    out.refusals.push(await refused('sol payer refund before the cancel window', [solCancel({ payer, nonce: n('sol-release'), authority: payer })], [payerKp], 'CancelWindowNotElapsed'));
    out.refusals.push(await refused('sol payee settle of an unmetered escrow', [solPayout({ payer, payee, nonce: n('sol-release'), signer: 'payee', actual: a.release / 2n })], asPayee, 'NotMetered'));
    sig = await send('sol payer release', [solPayout({ payer, payee, nonce: n('sol-release'), signer: 'payer' })], [payerKp]);
    const relFee = fee(a.release, true);
    assert.equal(await solDelta(conn, sig, TREASURY), relFee, 'sol release: treasury fee');
    assert.equal(await solDelta(conn, sig, payee), a.release - relFee, 'sol release: payee share');
    await assertClosed(conn, solEscrow(payer, n('sol-release')));
    step('sol payer release', sig, { treasuryFee: relFee.toString(), payeeReceived: (a.release - relFee).toString() });
    out.refusals.push(await refused('sol release replay', [solPayout({ payer, payee, nonce: n('sol-release'), signer: 'payer' })], [payerKp]));

    // Metered lock, then payee settle at the actual cost.
    sig = await send('sol metered lock', [solLock({ payer, payee, nonce: n('sol-metered'), amount: a.meteredMax, metered: true })], [payerKp]);
    step('sol metered lock', sig, { max: a.meteredMax.toString() });
    out.refusals.push(await refused('sol settle above the authorised maximum', [solPayout({ payer, payee, nonce: n('sol-metered'), signer: 'payee', actual: a.meteredMax + 1n })], asPayee, 'InvalidSettleAmount'));
    out.refusals.push(await refused('sol settle of zero', [solPayout({ payer, payee, nonce: n('sol-metered'), signer: 'payee', actual: 0n })], asPayee, 'InvalidSettleAmount'));
    sig = await send('sol payee settle at actual cost', [solPayout({ payer, payee, nonce: n('sol-metered'), signer: 'payee', actual: a.meteredActual })], asPayee);
    const setFee = fee(a.meteredActual, true);
    assert.equal(await solDelta(conn, sig, TREASURY), setFee, 'sol settle: treasury fee');
    assert.equal(await solDelta(conn, sig, payee), a.meteredActual - setFee, 'sol settle: payee share');
    await assertClosed(conn, solEscrow(payer, n('sol-metered')));
    step('sol payee settle', sig, { actual: a.meteredActual.toString(), treasuryFee: setFee.toString(), payeeReceived: (a.meteredActual - setFee).toString(),
      returnedToPayer: (a.meteredMax - a.meteredActual).toString() });

    // Lock, then payee decline: full refund, no fee.
    sig = await send('sol lock (decline case)', [solLock({ payer, payee, nonce: n('sol-decline'), amount: a.decline })], [payerKp]);
    step('sol lock decline-case', sig, { amount: a.decline.toString() });
    sig = await send('sol payee decline', [solCancel({ payer, nonce: n('sol-decline'), authority: payee })], asPayee);
    assert.equal(await solDelta(conn, sig, TREASURY), 0n, 'sol decline: no fee');
    await assertClosed(conn, solEscrow(payer, n('sol-decline')));
    step('sol payee decline', sig, { treasuryFee: '0' });

    // Time-gated escrows left open.
    sig = await send('sol lock (refund after window)', [solLock({ payer, payee, nonce: n('sol-refund'), amount: a.refund })], [payerKp]);
    step('sol lock refund-case (left open)', sig, { amount: a.refund.toString() });
    sig = await send('sol lock (claim after window)', [solLock({ payer, payee, nonce: n('sol-claim'), amount: a.claim })], [payerKp]);
    step('sol lock claim-case (left open)', sig, { amount: a.claim.toString() });
  }

  console.log('USDC');
  {
    const a = AMOUNTS.usdc;
    const source = token.getAssociatedTokenAddressSync(USDC, payer, true, TOKEN);
    const recipient = token.getAssociatedTokenAddressSync(USDC, payee, true, TOKEN);
    assert((await tokenAmount(conn, source)) !== null, `payer has no devnet USDC account at ${source.toBase58()}`);
    if ((await tokenAmount(conn, recipient)) === null) {
      const sig = await send('create payee USDC account', [token.createAssociatedTokenAccountIdempotentInstruction(payer, recipient, payee, USDC, TOKEN)], [payerKp]);
      step('create payee USDC account', sig, { account: recipient.toBase58() });
    }
    const lock = (label, amount, metered = false) => usdcLock({ payer, payee, nonce: n(label), amount, source, recipient, metered });
    const payout = (label, authority, actual, destination = recipient) => usdcPayout({ payer, nonce: n(label), authority, destination, refund: source, actual });
    const cancel = (label, authority, destination = source) => usdcCancel({ payer, nonce: n(label), authority, destination });
    const closedPair = label => { const e = tokenEscrow(payer, n(label)); return [e, tokenVault(e)]; };

    let sig = await send('usdc lock (release case)', [lock('usdc-release', a.release)], [payerKp]);
    step('usdc lock release-case', sig, { amount: a.release.toString() });
    out.refusals.push(await refused('usdc payee claim before the claim window', [payout('usdc-release', payee)], asPayee, 'ClaimWindowNotElapsed'));
    out.refusals.push(await refused('usdc payer refund before the cancel window', [cancel('usdc-release', payer)], [payerKp], 'CancelWindowNotElapsed'));
    out.refusals.push(await refused('usdc payer release to its own account', [payout('usdc-release', payer, undefined, source)], [payerKp]));
    sig = await send('usdc payer release', [payout('usdc-release', payer)], [payerKp]);
    const relFee = fee(a.release, false);
    assert.equal(await tokenDelta(conn, sig, TREASURY_USDC), relFee, 'usdc release: treasury fee');
    assert.equal(await tokenDelta(conn, sig, recipient), a.release - relFee, 'usdc release: payee share');
    await assertClosed(conn, ...closedPair('usdc-release'));
    step('usdc payer release', sig, { treasuryFee: relFee.toString(), payeeReceived: (a.release - relFee).toString() });
    out.refusals.push(await refused('usdc release replay', [payout('usdc-release', payer)], [payerKp]));

    sig = await send('usdc metered lock', [lock('usdc-metered', a.meteredMax, true)], [payerKp]);
    step('usdc metered lock', sig, { max: a.meteredMax.toString() });
    out.refusals.push(await refused('usdc settle above the authorised maximum', [payout('usdc-metered', payee, a.meteredMax + 1n)], asPayee, 'InvalidSettleAmount'));
    sig = await send('usdc payee settle at actual cost', [payout('usdc-metered', payee, a.meteredActual)], asPayee);
    const setFee = fee(a.meteredActual, false);
    assert.equal(await tokenDelta(conn, sig, TREASURY_USDC), setFee, 'usdc settle: treasury fee');
    assert.equal(await tokenDelta(conn, sig, recipient), a.meteredActual - setFee, 'usdc settle: payee share');
    assert.equal(await tokenDelta(conn, sig, source), a.meteredMax - a.meteredActual, 'usdc settle: unused maximum back to payer');
    await assertClosed(conn, ...closedPair('usdc-metered'));
    step('usdc payee settle', sig, { actual: a.meteredActual.toString(), treasuryFee: setFee.toString(), payeeReceived: (a.meteredActual - setFee).toString(),
      returnedToPayer: (a.meteredMax - a.meteredActual).toString() });

    sig = await send('usdc lock (decline case)', [lock('usdc-decline', a.decline)], [payerKp]);
    step('usdc lock decline-case', sig, { amount: a.decline.toString() });
    sig = await send('usdc payee decline', [cancel('usdc-decline', payee)], asPayee);
    assert.equal(await tokenDelta(conn, sig, source), a.decline, 'usdc decline: full refund');
    await assertClosed(conn, ...closedPair('usdc-decline'));
    step('usdc payee decline', sig, { refunded: a.decline.toString(), treasuryFee: '0' });

    sig = await send('usdc lock (refund after window)', [lock('usdc-refund', a.refund)], [payerKp]);
    step('usdc lock refund-case (left open)', sig, { amount: a.refund.toString() });
    sig = await send('usdc lock (claim after window)', [lock('usdc-claim', a.claim)], [payerKp]);
    step('usdc lock claim-case (left open)', sig, { amount: a.claim.toString() });
  }
  out.openEscrows = await openEscrowStatus(conn, payer, runId);
  return out;
}

async function openEscrowStatus(conn, payer, runId) {
  const slot = await conn.getSlot('confirmed');
  const status = {};
  for (const [label, address, offset, window] of [
    ['sol-refund', solEscrow(payer, nonceFor(runId, 'sol-refund')), SOL_CREATED_SLOT_OFFSET, CANCEL_WINDOW_SLOTS],
    ['sol-claim', solEscrow(payer, nonceFor(runId, 'sol-claim')), SOL_CREATED_SLOT_OFFSET, CLAIM_WINDOW_SLOTS],
    ['usdc-refund', tokenEscrow(payer, nonceFor(runId, 'usdc-refund')), TOKEN_CREATED_SLOT_OFFSET, CANCEL_WINDOW_SLOTS],
    ['usdc-claim', tokenEscrow(payer, nonceFor(runId, 'usdc-claim')), TOKEN_CREATED_SLOT_OFFSET, CLAIM_WINDOW_SLOTS],
  ]) {
    const info = await conn.getAccountInfo(address, 'confirmed');
    if (!info) { status[label] = { address: address.toBase58(), open: false }; continue; }
    const created = Number(info.data.readBigUInt64LE(offset));
    status[label] = { address: address.toBase58(), open: true, createdSlot: created, opensAtSlot: created + window,
      slotsRemaining: Math.max(0, created + window - slot) };
  }
  return { currentSlot: slot, escrows: status };
}

async function finish(conn, runId, kind) {
  const payerKp = loadKeypair('RAP_E2E_PAYER_KEYPAIR');
  const payeeKp = loadKeypair('RAP_E2E_PAYEE_KEYPAIR');
  const payer = payerKp.publicKey, payee = payeeKp.publicKey;
  const cluster = await checkCluster(conn);
  const { send, refused } = makeSender(conn);
  const asPayee = [payeeKp]; // the payee signs and pays its own fee, so the program sees a payee action
  const before = await openEscrowStatus(conn, payer, runId);
  const out = { mode: `finish-${kind}`, runId, cluster, before, steps: [], refusals: [] };
  const source = token.getAssociatedTokenAddressSync(USDC, payer, true, TOKEN);
  const recipient = token.getAssociatedTokenAddressSync(USDC, payee, true, TOKEN);
  const solLabel = `sol-${kind}`, usdcLabel = `usdc-${kind}`;
  for (const label of [solLabel, usdcLabel]) assert(before.escrows[label].open, `${label} escrow is not open (already finished, or run id differs)`);
  const ready = before.escrows[solLabel].slotsRemaining === 0 && before.escrows[usdcLabel].slotsRemaining === 0;
  const solIx = kind === 'refund'
    ? { ix: solCancel({ payer, nonce: nonceFor(runId, solLabel), authority: payer }), signers: [payerKp], error: 'CancelWindowNotElapsed' }
    : { ix: solPayout({ payer, payee, nonce: nonceFor(runId, solLabel), signer: 'payee' }), signers: asPayee, error: 'ClaimWindowNotElapsed' };
  const usdcIx = kind === 'refund'
    ? { ix: usdcCancel({ payer, nonce: nonceFor(runId, usdcLabel), authority: payer, destination: source }), signers: [payerKp], error: 'CancelWindowNotElapsed' }
    : { ix: usdcPayout({ payer, nonce: nonceFor(runId, usdcLabel), authority: payee, destination: recipient, refund: source }), signers: asPayee, error: 'ClaimWindowNotElapsed' };
  if (!ready) {
    out.refusals.push(await refused(`sol ${kind} before its window`, [solIx.ix], solIx.signers, solIx.error));
    out.refusals.push(await refused(`usdc ${kind} before its window`, [usdcIx.ix], usdcIx.signers, usdcIx.error));
    out.result = 'window not yet elapsed; nothing sent';
    return out;
  }
  if (kind === 'claim') {
    // The cancel window is long past here too, but a stranger still cannot claim, and the payee cannot redirect.
    out.refusals.push(await refused('usdc payee claim to the payer account', [usdcPayout({ payer, nonce: nonceFor(runId, usdcLabel), authority: payee, destination: source, refund: source })], asPayee));
  }
  let sig = await send(`sol ${kind} after window`, [solIx.ix], solIx.signers);
  const solAmount = AMOUNTS.sol[kind];
  if (kind === 'claim') {
    assert.equal(await solDelta(conn, sig, TREASURY), fee(solAmount, true), 'sol claim: treasury fee');
    assert.equal(await solDelta(conn, sig, payee), solAmount - fee(solAmount, true), 'sol claim: payee share');
  } else {
    assert.equal(await solDelta(conn, sig, TREASURY), 0n, 'sol refund: no fee');
  }
  await assertClosed(conn, solEscrow(payer, nonceFor(runId, solLabel)));
  out.steps.push({ name: `sol ${kind}`, signature: sig, explorer: explorer(sig) });
  sig = await send(`usdc ${kind} after window`, [usdcIx.ix], usdcIx.signers);
  const usdcAmount = AMOUNTS.usdc[kind];
  if (kind === 'claim') {
    assert.equal(await tokenDelta(conn, sig, TREASURY_USDC), fee(usdcAmount, false), 'usdc claim: treasury fee');
    assert.equal(await tokenDelta(conn, sig, recipient), usdcAmount - fee(usdcAmount, false), 'usdc claim: payee share');
  } else {
    assert.equal(await tokenDelta(conn, sig, source), usdcAmount, 'usdc refund: full amount back');
  }
  const e = tokenEscrow(payer, nonceFor(runId, usdcLabel));
  await assertClosed(conn, e, tokenVault(e));
  out.steps.push({ name: `usdc ${kind}`, signature: sig, explorer: explorer(sig) });
  out.result = 'passed';
  return out;
}

async function main() {
  const mode = process.argv[2];
  assert(['plan', 'run', 'finish-refund', 'finish-claim'].includes(mode), 'mode must be plan, run, finish-refund or finish-claim');
  const conn = new Connection(env('RAP_E2E_RPC', { required: false }) || 'https://api.devnet.solana.com', 'confirmed');
  let result;
  if (mode === 'plan') {
    result = await plan(conn);
  } else {
    const runId = env('RAP_E2E_RUN_ID');
    assert(/^[A-Za-z0-9-]{3,40}$/.test(runId), 'RAP_E2E_RUN_ID must be 3-40 letters, digits or dashes');
    result = mode === 'run' ? await run(conn, runId) : await finish(conn, runId, mode.slice('finish-'.length));
  }
  const text = `${JSON.stringify(result, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2)}\n`;
  const outDir = env('RAP_E2E_OUT_DIR', { required: false });
  if (outDir) {
    assert(path.isAbsolute(outDir), 'RAP_E2E_OUT_DIR must be absolute');
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `devnet-escrow-e2e-${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(file, text);
    console.log(`Result written to ${file}`);
  }
  console.log(text);
}

main().catch(err => { console.error(err.message || err); process.exitCode = 1; });
