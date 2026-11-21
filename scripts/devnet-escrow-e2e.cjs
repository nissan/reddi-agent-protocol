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
 *                 settle above the maximum, payee settle of an unmetered escrow, any settle by the payer,
 *                 replay) is simulated, not sent,
 *                 and must fail. Then it locks one escrow per currency for each time-gated case and leaves it
 *                 open for the finish modes below.
 *   finish-claim  After the claim window the locks named (750 slots, about 5 minutes): payee claims the "claim" escrows.
 *   finish-refund After the cancel window the locks named (1,500 slots, about 10 minutes): payer refunds the "refund" escrows.
 *                 Before a window has passed, a finish mode simulates the action, shows it is refused, and stops.
 *
 * Rated lane (ratings and judge attestations of a job paid through escrow; separate modes, so the lane above
 * still runs alone). It needs a deployment of the build that has the rating instructions: the modes that sign
 * first check that the deployed program answers `accept_rating`, and refuse otherwise.
 *   plan-rated    Read only. Prints every transaction and refused case of the rated lane, in order, then checks the
 *                 network, balances and which parties are registered agents. With `--offline` it prints the plan
 *                 and opens no connection. RAP_E2E_PAYER, RAP_E2E_PAYEE, and optionally RAP_E2E_JUDGE (addresses).
 *   run-rated     Signs on devnet. Job 1: SOL metered lock and `open_rating` in one transaction, payee settle with
 *                 the rating account, both commits, both reveals, judge attestation confirmed and closed, buyer
 *                 `close_rating`. Job 2: USDC fixed-price lock and `open_rating`, seller `accept_rating`, payer
 *                 release, the buyer commits and the seller does not; left open. Then a rated escrow the payee
 *                 declines, and one the payer releases without the seller's agreement. Refused cases are
 *                 simulated and must fail with the exact program error number.
 *                 Each job is named by its rating's `opened_slot` (the slot of `open_rating`), read from the rating
 *                 account after the lock: every exit of a rated escrow, `accept_rating` (built with
 *                 `buildSellerAcceptRating`, which checks the job against what the seller expects), `commit_rating`
 *                 and the commitments, `attest_quality` and the buyer's `confirm_attestation` carry it. No exit is
 *                 ever in the transaction of `open_rating`: each is sent once the chain is past the opened slot.
 *                 A held seller settle, an acceptance or an attestation naming another slot is refused (6051), and
 *                 lock, `open_rating` and release in one transaction is refused (6050); all are simulated only.
 *   finish-rated  After job 2's commit deadline (1,512,000 slots after its release, about 7 days): `expire_rating`,
 *                 then the buyer's `close_rating`. Before the deadline it shows the refusal and the slots left.
 * RAP_E2E_JUDGE_KEYPAIR (optional, a third wallet) is the judge. Without it no judge is named and the attestation
 * steps are skipped. A judge with no agent record is registered as an attestation agent (0.01 SOL fee, burned).
 * RAP_E2E_REGISTER_PARTIES=1 (optional) registers the payer and the payee as agents when they are not, so that the
 * changes to their records can be checked; without it an unregistered party is checked to have no record.
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
// Builders and decoders of the rating and attestation instructions: the package's built output, which is committed.
const rating = require(path.join(__dirname, '..', 'packages', 'x402-solana', 'dist', 'rating.js'));

const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const PROGRAM = new PublicKey('DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu');
const PROGRAM_DATA = new PublicKey('8cCmxnMPU8EQR7ECfff19Dr4gu1n7jyFCuEEyaYspRn2');
const PROGRAM_LEN = 96_272;
const PROGRAM_SHA256 = '2576a9cccb15ea09aa675e1a2d415043f8d231179772e5fa23728402b10a32ac';
const TREASURY = new PublicKey('5CsBuTBFKu12JSs4CUbmv5MR218RYtNmAoQmLf5x3Hxe');
const USDC = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'); // constants.rs USDC_DEVNET_MINT
const TOKEN = token.TOKEN_PROGRAM_ID;
const TREASURY_USDC = token.getAssociatedTokenAddressSync(USDC, TREASURY, true, TOKEN);
// Windows this script names on every lock, in slots (about 400 ms each): the payee may claim from the first, the
// payer may refund from the second. Short on purpose, so the finish modes can run minutes after `run`.
const CLAIM_WINDOW_SLOTS = 750; // about 5 minutes
const CANCEL_WINDOW_SLOTS = 1_500; // about 10 minutes
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

// ── rated lane constants ──────────────────────────────────────────────────────────────────────
// Amounts of the rated lane, in lamports and USDC base units.
const RATED_AMOUNTS = { solMeteredMax: 20_000_000n, solMeteredActual: 8_000_000n, usdcFixed: 1_000_000n,
  solDecline: 5_000_000n, solUnaccepted: 5_000_000n, solUnrated: 2_000_000n };
// Every escrow label `run-rated` creates. They differ from RUN_LABELS, so one run id can serve both lanes.
const RATED_LABELS = ['rated-sol-metered', 'rated-usdc-fixed', 'rated-sol-decline', 'rated-sol-unaccepted', 'rated-sol-unrated'];
const RATED_SCORES = { job1Consumer: 9, job1Specialist: 8, job2Consumer: 7, attestation: [8, 8, 9, 7, 9] };
// The judge pays its registration (0.01 SOL fee plus the record's rent) and the attestation's rent.
const JUDGE_FLOOR = 20_000_000n;
const JUDGE_TOPUP = 25_000_000n;
const AGENT_REGISTRATION_FEE = 10_000_000n;
const AGENT_FEE_BURN_ADDRESS = new PublicKey('1nc1nerator11111111111111111111111111111111');
const RATING_RENT_README = 2_770_080n; // 270 bytes at 6,960 lamports per byte; reported, not asserted
const SLOT_MS = 400; // nominal
const SCORE_MAX = 10_000;
const RATING_EXPIRE_PENALTY = 500;
const ATTESTATION_CONFIRM_WEIGHT = 1_000;
// Program error numbers the rated lane asserts (program README, "Interface of the rating and attestation instructions").
const ERR = { InstructionFallbackNotFound: 101, AccountNotInitialized: 3012, UnauthorisedSigner: 6000, BothMustCommitFirst: 6011,
  NotExpired: 6014, AttestationAlreadyResolved: 6018, RatingAccountRequired: 6033, RatingOptInClosed: 6036, JobNotPaid: 6039,
  RatingAlreadyAccepted: 6046, AlreadyAttested: 6048, RatingJustOpened: 6050, RatingJobMismatch: 6051 };

const RUN_ID = /^[A-Za-z0-9-]{3,40}$/;
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

// ── instruction builders (layouts from archive/anchor-escrow/src) ─────────────────────────────────────

const solEscrow = (payer, nonce) => PublicKey.findProgramAddressSync([Buffer.from('escrow'), payer.toBuffer(), nonce], PROGRAM)[0];
const tokenEscrow = (payer, nonce) => PublicKey.findProgramAddressSync([Buffer.from('token-escrow'), payer.toBuffer(), nonce], PROGRAM)[0];
const tokenVault = escrow => PublicKey.findProgramAddressSync([Buffer.from('token-vault'), escrow.toBuffer()], PROGRAM)[0];

function solLock({ payer, payee, nonce, amount, metered = false }) {
  return new TransactionInstruction({ programId: PROGRAM,
    data: Buffer.concat([disc(metered ? 'lock_metered_escrow' : 'lock_escrow'), u64(amount), nonce, u64(CLAIM_WINDOW_SLOTS), u64(CANCEL_WINDOW_SLOTS)]),
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
    data: Buffer.concat([disc(metered ? 'lock_metered_token_escrow' : 'lock_token_escrow'), u64(amount), nonce, u64(CLAIM_WINDOW_SLOTS), u64(CANCEL_WINDOW_SLOTS)]),
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
  // As `refused`, and the refusal must be exactly this program error number.
  async function refusedWith(label, ixs, signers, code) {
    const tx = await build(ixs, signers);
    const sim = await conn.simulateTransaction(tx, undefined, false);
    const got = customError(sim.value.err);
    assert(sim.value.err, `${label}: expected refusal, but the simulation succeeded`);
    assert.equal(got, code, `${label}: refused with ${JSON.stringify(sim.value.err)}, not with program error ${code}:\n${(sim.value.logs || []).join('\n')}`);
    console.log(`  ✓ refused (simulated): ${label} [${code}]`);
    return { label, expected: code, err: sim.value.err };
  }
  return { send, refused, refusedWith };
}
// The program error number of a failed simulation or transaction, or null when it failed some other way.
function customError(err) {
  const custom = err?.InstructionError?.[1]?.Custom;
  return typeof custom === 'number' ? custom : null;
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
  // Optional: close escrows left open by an earlier, interrupted run. The payee declines each, which the program
  // allows at any time, so the whole amount comes back to the payer and no fee is taken.
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
      const ix = sol
        ? solCancel({ payer, nonce, authority: payee })
        : usdcCancel({ payer, nonce, authority: payee, destination: source });
      const sig = await send(`close leftover ${leftoverRunId}/${label}`, [ix], asPayee);
      if (sol) await assertClosed(conn, address); else await assertClosed(conn, address, tokenVault(address));
      step(`close leftover ${leftoverRunId}/${label}`, sig, { escrow: address.toBase58(), declinedByPayee: true });
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
    out.refusals.push(await refused('sol payer settle of an unmetered escrow', [solPayout({ payer, payee, nonce: n('sol-release'), signer: 'payer', actual: a.release / 2n })], [payerKp], 'UnauthorisedSigner'));
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
    out.refusals.push(await refused('sol payer settle of a metered escrow', [solPayout({ payer, payee, nonce: n('sol-metered'), signer: 'payer', actual: 1n })], [payerKp], 'UnauthorisedSigner'));
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
    out.refusals.push(await refused('usdc payer settle of an unmetered escrow', [payout('usdc-release', payer, a.release / 2n)], [payerKp], 'UnauthorisedSigner'));
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
    out.refusals.push(await refused('usdc payer settle of a metered escrow', [payout('usdc-metered', payer, 1n)], [payerKp], 'UnauthorisedSigner'));
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

// ── rated lane: instructions and plan (no network) ────────────────────────────────────────────

// The package may load its own copy of web3.js; rebuild what it returns with this script's classes.
const key = k => new PublicKey(k.toBytes());
const local = ix => new TransactionInstruction({ programId: key(ix.programId), data: Buffer.from(ix.data),
  keys: ix.keys.map(k => ({ pubkey: key(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })) });
const ratingOf = escrow => key(rating.ratingPda(escrow, PROGRAM));
const attestationOf = escrow => key(rating.attestationPda(escrow, PROGRAM));
const agentOf = owner => key(rating.agentPda(owner, PROGRAM));

// Salts derive from the run id so that a later mode could reveal. Fine for a devnet test, wrong for a real
// rating: a real salt is random and kept secret until the reveal.
function saltFor(runId, label, role) {
  return createHash('sha256').update(`rap-devnet-escrow-e2e:salt:${runId}:${label}:${role}`).digest();
}

// register_agent (one of the 13 instructions the Anchor IDL describes; layout mirrored in lib/program.ts).
function registerAgent({ owner, agentType, model }) {
  const name = Buffer.from(model, 'utf8');
  assert(name.length <= 64 && [0, 1, 2].includes(agentType), 'invalid agent registration');
  const len = Buffer.alloc(4); len.writeUInt32LE(name.length);
  return new TransactionInstruction({ programId: PROGRAM,
    data: Buffer.concat([disc('register_agent'), Buffer.from([agentType]), len, name, u64(1_000n), Buffer.from([0])]),
    keys: [meta(agentOf(owner), true), meta(owner, true, true), meta(AGENT_FEE_BURN_ADDRESS, true), meta(SystemProgram.programId)] });
}

// An agent record: a 45-byte head, the model name, then the fields the ratings change (state.rs, AgentTerms).
function decodeAgent(data) {
  assert(data.length >= 150 && Buffer.from(data.subarray(0, 8)).equals(createHash('sha256').update('account:AgentAccount').digest().subarray(0, 8)),
    'not an agent record');
  const modelLength = data.readUInt32LE(41);
  assert(modelLength <= 64, 'not an agent record');
  const t = 45 + modelLength;
  return { agentType: data[40], reputation: data.readUInt16LE(t + 9), jobsCompleted: data.readBigUInt64LE(t + 11),
    jobsFailed: data.readBigUInt64LE(t + 19), active: data[t + 35] === 1, accuracy: data.readUInt16LE(t + 36) };
}
// Nine parts the old reputation, one part the score scaled to 0..10000.
const foldRating = (reputation, score) => Math.min(Math.floor((reputation * 9 + score * 1000) / 10), SCORE_MAX);

// When `expire_rating` is first accepted for a rating that stopped before both sides committed: the slot after
// `settled_slot + 1,512,000`. The date assumes the nominal 400 ms per slot; real slot times drift.
function expiryEstimate({ settledSlot, currentSlot, now = Date.now() }) {
  const expireFromSlot = BigInt(settledSlot) + rating.RATING_COMMIT_SLOTS + 1n;
  const slotsRemaining = expireFromSlot > BigInt(currentSlot) ? expireFromSlot - BigInt(currentSlot) : 0n;
  return { settledSlot: BigInt(settledSlot).toString(), expireFromSlot: expireFromSlot.toString(), slotsRemaining: slotsRemaining.toString(),
    estimatedEarliest: new Date(now + Number(slotsRemaining) * SLOT_MS).toISOString() };
}

/* Every transaction and refused case of the rated lane, in the order the modes execute them. Pure: it reads no
 * account and signs nothing. `judge` is optional; without it no judge is named and the attestation steps are
 * listed as skipped. Each step: { id, mode, kind: 'send' | 'refuse', signer: 'payer' | 'payee' | 'judge', ixs }
 * and, for a refusal, the program error number it must fail with.
 * `openedSlots` maps a job (job1, job2, decline, unaccepted) to its rating's `opened_slot`, which only the chain
 * knows: run-rated reads it from the rating account after the lock and builds the lane again. An instruction that
 * names a job is built with slot 0 until then, and its step lists the job under `openedSlotOf`. */
function ratedLane({ payer, payee, judge, runId, openedSlots = {} }) {
  assert(RUN_ID.test(runId), 'run id must be 3-40 letters, digits or dashes');
  for (const [name, slot] of Object.entries(openedSlots)) assert(typeof slot === 'bigint' && slot >= 0n, `opened slot of ${name} must be a u64 bigint`);
  assert(!payer.equals(payee), 'payer and payee must differ');
  assert(!judge || (!judge.equals(payer) && !judge.equals(payee)), 'the judge must be neither the payer nor the payee');
  const a = RATED_AMOUNTS;
  const n = label => nonceFor(runId, label);
  const windows = { claimWindowSlots: BigInt(CLAIM_WINDOW_SLOTS), cancelWindowSlots: BigInt(CANCEL_WINDOW_SLOTS) };
  const solTerms = (label, amount, metered = false) => ({ programId: PROGRAM, payer, payee, amount, nonce: n(label), metered, ...windows });
  const source = token.getAssociatedTokenAddressSync(USDC, payer, true, TOKEN);
  const recipient = token.getAssociatedTokenAddressSync(USDC, payee, true, TOKEN);
  const usdcTerms = { programId: PROGRAM, tokenProgram: TOKEN, payer, payee, mint: USDC, source, recipient, amount: a.usdcFixed,
    nonce: n('rated-usdc-fixed'), ...windows };

  const job1Lock = rating.buildRatedSolEscrowLock(solTerms('rated-sol-metered', a.solMeteredMax, true), { judge });
  const job2Lock = rating.buildRatedTokenEscrowLock(usdcTerms);
  const declineLock = rating.buildRatedSolEscrowLock(solTerms('rated-sol-decline', a.solDecline));
  const unacceptedLock = rating.buildRatedSolEscrowLock(solTerms('rated-sol-unaccepted', a.solUnaccepted));
  const escrows = { job1: key(job1Lock.escrow), job2: key(job2Lock.escrow), decline: key(declineLock.escrow),
    unaccepted: key(unacceptedLock.escrow), unrated: solEscrow(payer, n('rated-sol-unrated')) };
  const of = escrow => ({ programId: PROGRAM, escrow });
  const sol = escrow => ({ ...of(escrow), payer, payee, treasury: TREASURY });
  const parties = { consumer: payer, specialist: payee };
  const who = { payer, payee, judge };
  // The opened slot of a job, as far as the lane knows it. Each use is recorded on the step it builds.
  let namesJob = new Set();
  const slot = name => { namesJob.add(name); return openedSlots[name] ?? 0n; };
  // A slot that is not the job's: what an exit, acceptance or attestation signed for an earlier job at the address names.
  const staleSlot = name => { const s = slot(name); return s > 0n ? s - 1n : 1n; };
  // `job` is the job whose opened slot the commitment hashes; null for an escrow that was never opted in (slot 0).
  const commit = (escrow, role, score, label, job = label) => {
    const openedSlot = job ? slot(job) : 0n;
    return rating.buildCommitRatingInstruction({ ...of(escrow), signer: who[role], openedSlot,
      commitment: rating.ratingCommitment(ratingOf(escrow), openedSlot, who[role], score, saltFor(runId, label, role)) });
  };
  const reveal = (escrow, role, score, label) => rating.buildRevealRatingInstruction({ ...of(escrow), ...parties, signer: who[role],
    score, salt: saltFor(runId, label, role) });
  const attest = (escrow, signer, job, openedSlot = slot(job)) => rating.buildAttestQualityInstruction({ ...of(escrow), judge: signer,
    scores: RATED_SCORES.attestation, openedSlot });
  const accept = (escrow, openedSlot) => rating.buildAcceptRatingInstruction({ ...of(escrow), specialist: payee, openedSlot });
  const unknownSelector = name => new TransactionInstruction({ programId: PROGRAM, data: disc(name),
    keys: [meta(escrows.job1, true), meta(payer, true, true)] });

  const steps = [];
  let mode = 'run-rated';
  // The instructions are built (and `namesJob` filled) before these run, as they are the arguments.
  const jobs = () => { const named = [...namesJob]; namesJob = new Set(); return named.length ? { openedSlotOf: named } : {}; };
  const send = (id, signer, ixs, note) => steps.push({ id, mode, kind: 'send', signer, ixs: ixs.map(local), note, ...jobs() });
  const refuse = (id, signer, ixs, code, note, extra = {}) => steps.push({ id, mode, kind: 'refuse', signer, ixs: ixs.map(local), code, note, ...extra, ...jobs() });
  const needsJudge = (id, build) => { if (judge) build(); else steps.push({ id, mode, kind: 'skip', note: 'no judge: attestation steps are skipped' }); };

  // Job 1: SOL, metered, rated, with a judge. The seller agrees by being the authority of the settle.
  send('job1.lock-and-open-rating', 'payer', job1Lock.instructions, 'lock_metered_escrow and open_rating in one transaction');
  refuse('job1.settle-without-rating-account', 'payee', [rating.buildSettleSolEscrowInstruction({ ...sol(escrows.job1), actual: a.solMeteredActual, rated: false })],
    ERR.RatingAccountRequired, 'every exit of a rated escrow takes the rating account');
  refuse('job1.commit-before-paid', 'payer', [commit(escrows.job1, 'payer', RATED_SCORES.job1Consumer, 'job1')], ERR.JobNotPaid, 'rating not open yet');
  refuse('job1.settle-stale-slot', 'payee', [rating.buildSettleSolEscrowInstruction({ ...sol(escrows.job1), actual: a.solMeteredActual, rated: true,
    openedSlot: staleSlot('job1') })], ERR.RatingJobMismatch, 'a held settle naming another opened slot: signed for another job at this address');
  send('job1.settle', 'payee', [rating.buildSettleSolEscrowInstruction({ ...sol(escrows.job1), actual: a.solMeteredActual, rated: true, openedSlot: slot('job1') })],
    'signed by the payee alone: that is the seller\'s agreement; names the job by its opened slot');
  send('job1.commit-consumer', 'payer', [commit(escrows.job1, 'payer', RATED_SCORES.job1Consumer, 'job1')]);
  refuse('job1.reveal-before-both-committed', 'payer', [reveal(escrows.job1, 'payer', RATED_SCORES.job1Consumer, 'job1')], ERR.BothMustCommitFirst);
  send('job1.commit-specialist', 'payee', [commit(escrows.job1, 'payee', RATED_SCORES.job1Specialist, 'job1')]);
  send('job1.reveal-consumer', 'payer', [reveal(escrows.job1, 'payer', RATED_SCORES.job1Consumer, 'job1')]);
  send('job1.reveal-specialist', 'payee', [reveal(escrows.job1, 'payee', RATED_SCORES.job1Specialist, 'job1')]);
  // attest_quality reads the signer's agent record before it compares the signer with the named judge.
  refuse('job1.attest-by-payee', 'payee', [attest(escrows.job1, payee, 'job1')], ERR.UnauthorisedSigner, 'the payee is not the judge the rating names',
    { codeIfSignerUnregistered: ERR.AccountNotInitialized });
  needsJudge('job1.attest-stale-slot', () => refuse('job1.attest-stale-slot', 'judge', [attest(escrows.job1, judge, 'job1', staleSlot('job1'))],
    ERR.RatingJobMismatch, 'scores naming another opened slot: signed for another job at this address'));
  needsJudge('job1.attest', () => send('job1.attest', 'judge', [attest(escrows.job1, judge, 'job1')], 'attest_quality, naming the job by its opened slot, before the rating account is closed'));
  needsJudge('job1.attest-again', () => refuse('job1.attest-again', 'judge', [attest(escrows.job1, judge, 'job1')], ERR.AlreadyAttested));
  needsJudge('job1.confirm-attestation', () => send('job1.confirm-attestation', 'payer',
    [rating.buildConfirmAttestationInstruction({ ...of(escrows.job1), judge, consumer: payer, openedSlot: slot('job1') })],
    'names the job by the opened slot the attestation stores'));
  needsJudge('job1.dispute-after-confirm', () => refuse('job1.dispute-after-confirm', 'payer',
    [rating.buildDisputeAttestationInstruction({ ...of(escrows.job1), judge, consumer: payer, openedSlot: slot('job1') })], ERR.AttestationAlreadyResolved));
  needsJudge('job1.close-attestation', () => send('job1.close-attestation', 'judge', [rating.buildCloseAttestationInstruction({ ...of(escrows.job1), judge })]));
  send('job1.close-rating', 'payer', [rating.buildCloseRatingInstruction({ ...of(escrows.job1), consumer: payer })], 'rent of the rating account back to the buyer');

  // Job 2: USDC, fixed price, rated, no judge. The seller agrees with accept_rating; the payer releases.
  send('job2.lock-and-open-rating', 'payer', job2Lock.instructions, 'lock_token_escrow and open_rating in one transaction');
  refuse('job2.accept-rating-stale-slot', 'payee', [accept(escrows.job2, staleSlot('job2'))], ERR.RatingJobMismatch,
    'an acceptance naming another opened slot: signed for another job at this address');
  send('job2.accept-rating', 'payee', [accept(escrows.job2, slot('job2'))],
    'run-rated builds it with buildSellerAcceptRating, which checks the opened slot, judge, amount and mint the seller expects');
  refuse('job2.accept-rating-again', 'payee', [accept(escrows.job2, slot('job2'))], ERR.RatingAlreadyAccepted);
  send('job2.release', 'payer', [rating.buildTokenEscrowExitInstruction(usdcTerms, { rated: true, openedSlot: slot('job2'), options: { treasuryToken: TREASURY_USDC } })],
    'the payer\'s release opens the rating because the seller accepted');
  needsJudge('job2.attest-by-unnamed-judge', () => refuse('job2.attest-by-unnamed-judge', 'judge', [attest(escrows.job2, judge, 'job2')], ERR.UnauthorisedSigner,
    'job 2 names no judge'));
  send('job2.commit-consumer', 'payer', [commit(escrows.job2, 'payer', RATED_SCORES.job2Consumer, 'job2')],
    'the seller does not commit; finish-rated expires the rating after the deadline');

  // A rated escrow the payee declines.
  send('decline.lock-and-open-rating', 'payer', declineLock.instructions);
  send('decline.cancel', 'payee', [rating.buildCancelSolEscrowInstruction({ ...of(escrows.decline), payer, authority: payee, rated: true, openedSlot: slot('decline') })],
    'rating account closed, its rent back to the payer');

  // A rated escrow the payer releases without the seller's agreement: paid as usual, never rated.
  send('unaccepted.lock-and-open-rating', 'payer', unacceptedLock.instructions);
  send('unaccepted.release', 'payer', [rating.buildReleaseSolEscrowInstruction({ ...sol(escrows.unaccepted), signer: 'payer', rated: true, openedSlot: slot('unaccepted') })]);
  refuse('unaccepted.commit-after-unrated-close', 'payer', [commit(escrows.unaccepted, 'payer', 5, 'unaccepted')], ERR.AccountNotInitialized,
    'no rating account is left');

  // A rated escrow cannot end in the slot its rating was opened in. Simulated only: nothing of it lands. The
  // program checks the slot before the job the release names, so the release names slot 0.
  const sameSlotLock = rating.buildRatedSolEscrowLock(solTerms('rated-sol-same-slot', a.solDecline));
  refuse('same-slot.lock-open-and-release', 'payer', [...sameSlotLock.instructions,
    rating.buildReleaseSolEscrowInstruction({ ...sol(key(sameSlotLock.escrow)), signer: 'payer', rated: true, openedSlot: 0n })], ERR.RatingJustOpened,
    'lock, open_rating and release in one transaction');

  // An escrow that was never opted in.
  send('unrated.lock', 'payer', [rating.buildLockSolEscrowInstruction(solTerms('rated-sol-unrated', a.solUnrated))]);
  refuse('unrated.open-rating-in-a-later-slot', 'payer', [rating.buildOpenRatingInstruction({ ...of(escrows.unrated), payer })], ERR.RatingOptInClosed);
  refuse('unrated.commit-never-opted-in', 'payer', [commit(escrows.unrated, 'payer', 5, 'unrated', null)], ERR.AccountNotInitialized);
  send('unrated.decline', 'payee', [rating.buildCancelSolEscrowInstruction({ ...of(escrows.unrated), payer, authority: payee, rated: false })]);

  // PER is not part of V1: the build answers neither selector.
  refuse('per.delegate_escrow', 'payer', [unknownSelector('delegate_escrow')], ERR.InstructionFallbackNotFound);
  refuse('per.release_escrow_per', 'payer', [unknownSelector('release_escrow_per')], ERR.InstructionFallbackNotFound);

  mode = 'finish-rated';
  const expire = rating.buildExpireRatingInstruction({ ...of(escrows.job2), ...parties, caller: payer });
  refuse('job2.expire-before-deadline', 'payer', [expire], ERR.NotExpired, 'only when finish-rated runs before the deadline; then nothing is sent');
  send('job2.expire-rating', 'payer', [expire], 'from the slot after settled_slot + 1,512,000');
  send('job2.close-rating', 'payer', [rating.buildCloseRatingInstruction({ ...of(escrows.job2), consumer: payer })]);

  return { payer, payee, judge, runId, escrows, source, recipient, usdcTerms, steps, openedSlots: { ...openedSlots },
    ratings: Object.fromEntries(Object.entries(escrows).map(([name, escrow]) => [name, ratingOf(escrow)])),
    attestation: attestationOf(escrows.job1) };
}

const INSTRUCTION_NAMES = new Map(['lock_escrow', 'lock_metered_escrow', 'release_escrow', 'settle_escrow', 'cancel_escrow', 'lock_token_escrow',
  'lock_metered_token_escrow', 'release_token_escrow', 'settle_token_escrow', 'cancel_token_escrow', 'register_agent', 'open_rating', 'accept_rating',
  'commit_rating', 'reveal_rating', 'expire_rating', 'close_rating', 'attest_quality', 'confirm_attestation', 'dispute_attestation',
  'close_attestation', 'delegate_escrow', 'release_escrow_per'].map(name => [disc(name).toString('hex'), name]));
const describeInstruction = ix => ({ name: INSTRUCTION_NAMES.get(Buffer.from(ix.data.subarray(0, 8)).toString('hex')) ?? 'unknown',
  dataHex: Buffer.from(ix.data).toString('hex'),
  accounts: ix.keys.map(k => ({ address: k.pubkey.toBase58(), writable: k.isWritable, signer: k.isSigner })) });

// The lane as plain data, for `plan-rated` and the unit test.
function ratedPlan(input) {
  const lane = ratedLane(input);
  const text = k => k.toBase58();
  return { runId: lane.runId, payer: text(lane.payer), payee: text(lane.payee), judge: lane.judge ? text(lane.judge) : null,
    amounts: Object.fromEntries(Object.entries(RATED_AMOUNTS).map(([name, value]) => [name, value.toString()])),
    scores: RATED_SCORES,
    escrows: Object.fromEntries(Object.entries(lane.escrows).map(([name, escrow]) => [name, { escrow: text(escrow), rating: text(lane.ratings[name]) }])),
    attestation: text(lane.attestation),
    openedSlots: Object.fromEntries(['job1', 'job2', 'decline', 'unaccepted'].map(name => [name, lane.openedSlots[name]?.toString() ?? null])),
    openedSlotNote: 'every rated exit, accept_rating, commit_rating and the commitments, attest_quality and the decision on an attestation '
      + 'name the job by its rating\'s opened_slot, which run-rated reads from the rating account after each lock. A step listing '
      + 'openedSlotOf is shown with slot 0 until then (a stale-slot refusal with 1).',
    steps: lane.steps.map(step => step.kind === 'skip' ? { id: step.id, mode: step.mode, kind: 'skip', note: step.note } : {
      id: step.id, mode: step.mode, kind: step.kind, signer: step.signer, ...(step.kind === 'refuse' ? { mustFailWith: step.code } : {}),
      ...(step.codeIfSignerUnregistered ? { mustFailWithIfSignerUnregistered: step.codeIfSignerUnregistered } : {}),
      ...(step.openedSlotOf ? { openedSlotOf: step.openedSlotOf } : {}),
      ...(step.note ? { note: step.note } : {}), instructions: step.ixs.map(describeInstruction) }) };
}

// ── rated lane: modes ─────────────────────────────────────────────────────────────────────────

const agentView = record => record && { agentType: record.agentType, active: record.active, reputation: record.reputation,
  jobsCompleted: record.jobsCompleted.toString(), jobsFailed: record.jobsFailed.toString(), accuracy: record.accuracy };
async function readAgent(conn, owner) {
  const info = await conn.getAccountInfo(agentOf(owner), 'finalized');
  return info ? decodeAgent(info.data) : null;
}
async function readRating(conn, escrow) {
  const info = await conn.getAccountInfo(ratingOf(escrow), 'finalized');
  return info ? { lamports: BigInt(info.lamports), ...rating.decodeRatingAccount(info.data) } : null;
}
async function lamportsOf(conn, address) {
  const info = await conn.getAccountInfo(address, 'finalized');
  assert(info, `${address.toBase58()} should exist`);
  return BigInt(info.lamports);
}
// What a rating or attestation must have done to a party's agent record. `change` maps the record before to the
// fields expected after. A party with no record must still have none: the program skips it.
function assertRecord(what, before, after, change) {
  if (!before) {
    assert.equal(after, null, `${what}: was not registered, so no agent record may exist afterwards`);
    return { registered: false, asserted: 'no agent record before or after' };
  }
  assert(after, `${what}: agent record is gone`);
  const expected = { reputation: before.reputation, jobsCompleted: before.jobsCompleted, jobsFailed: before.jobsFailed, accuracy: before.accuracy, ...change(before) };
  for (const [field, value] of Object.entries(expected)) assert.equal(after[field], value, `${what}: ${field}`);
  return { registered: true, before: agentView(before), after: agentView(after) };
}

// The rated lane needs the build with the rating instructions. An unsigned simulation of `accept_rating` with no
// accounts tells: that build refuses it for its missing accounts, an earlier build does not know the selector.
async function ratingBuildProbe(conn, feePayer) {
  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer, recentBlockhash: blockhash }).add(new TransactionInstruction({ programId: PROGRAM, data: disc('accept_rating'), keys: [] }));
  const sim = await conn.simulateTransaction(tx.compileMessage(), undefined);
  const code = customError(sim.value.err);
  return { answersRatingInstructions: sim.value.err !== null && code !== null && code !== ERR.InstructionFallbackNotFound, error: sim.value.err };
}
async function assertRatingBuild(conn, feePayer) {
  const probe = await ratingBuildProbe(conn, feePayer);
  assert(probe.answersRatingInstructions, `refusing: the deployed program does not answer accept_rating (${JSON.stringify(probe.error)}). `
    + 'The rated lane needs the devnet deployment upgraded to the build with ratings, and PROGRAM_LEN and PROGRAM_SHA256 in this script set to it.');
}

async function planRated(conn) {
  const payer = new PublicKey(env('RAP_E2E_PAYER'));
  const payee = new PublicKey(env('RAP_E2E_PAYEE'));
  const judgeAddress = env('RAP_E2E_JUDGE', { required: false });
  const judge = judgeAddress ? new PublicKey(judgeAddress) : undefined;
  const runId = env('RAP_E2E_RUN_ID', { required: false }) || 'plan';
  const out = { mode: 'plan-rated', offline: conn === null, plan: ratedPlan({ payer, payee, judge, runId }) };
  if (!judge) out.note = 'RAP_E2E_JUDGE is not set: no judge is named and the attestation steps are skipped';
  if (conn === null) return out;

  out.cluster = await checkCluster(conn);
  out.program = await ratingBuildProbe(conn, payer);
  const source = token.getAssociatedTokenAddressSync(USDC, payer, true, TOKEN);
  const recipient = token.getAssociatedTokenAddressSync(USDC, payee, true, TOKEN);
  const wallet = async (address, usdcAccount) => ({ address: address.toBase58(), lamports: await conn.getBalance(address),
    ...(usdcAccount ? { usdcAccount: usdcAccount.toBase58(), usdc: (await tokenAmount(conn, usdcAccount))?.toString() ?? null } : {}),
    agentRecord: agentView(await readAgent(conn, address)) });
  out.wallets = { payer: await wallet(payer, source), payee: await wallet(payee, recipient), ...(judge ? { judge: await wallet(judge) } : {}) };
  const a = RATED_AMOUNTS;
  // Locks, four rating accounts' rent (three come back within the run), top-ups, and room for escrow rent and fees.
  const solNeeded = a.solMeteredMax + a.solDecline + a.solUnaccepted + a.solUnrated + 4n * RATING_RENT_README + PAYEE_FEE_TOPUP
    + (judge ? JUDGE_TOPUP : 0n) + 50_000_000n;
  out.needs = { lamports: solNeeded.toString(), usdc: a.usdcFixed.toString() };
  const shortfalls = out.shortfalls = [];
  if (!out.program.answersRatingInstructions) shortfalls.push('the deployed program did not answer accept_rating in a simulation paid by the payer: run-rated refuses until devnet runs the build with ratings (an unfunded payer wallet also gives this result)');
  if (BigInt(out.wallets.payer.lamports) < solNeeded) shortfalls.push(`payer needs at least ${Number(solNeeded) / 1e9} devnet SOL`);
  if (BigInt(out.wallets.payer.usdc ?? 0) < a.usdcFixed) shortfalls.push(`payer needs at least ${Number(a.usdcFixed) / 1e6} devnet USDC in ${source.toBase58()}`);
  if (BigInt(out.wallets.payee.lamports) < PAYEE_FEE_FLOOR) shortfalls.push(`payee holds under ${Number(PAYEE_FEE_FLOOR) / 1e9} SOL; \`run-rated\` sends it ${Number(PAYEE_FEE_TOPUP) / 1e9} SOL from the payer`);
  if (out.wallets.payee.usdc === null) shortfalls.push('payee has no devnet USDC account yet; `run-rated` creates it (payer pays rent)');
  for (const role of ['payer', 'payee']) {
    if (!out.wallets[role].agentRecord) shortfalls.push(`${role} is not a registered agent: its record cannot change, and the lane checks only that none exists (RAP_E2E_REGISTER_PARTIES=1 registers it)`);
  }
  if (judge) {
    const record = out.wallets.judge.agentRecord;
    if (!record) shortfalls.push('judge is not registered: `run-rated` registers it as an attestation agent (0.01 SOL fee, burned, paid by the judge)');
    else if (record.agentType === 0 || !record.active) shortfalls.push('judge is registered but not as an active attestation agent: the attestation steps will be skipped');
    if (BigInt(out.wallets.judge.lamports) < JUDGE_FLOOR) shortfalls.push(`judge holds under ${Number(JUDGE_FLOOR) / 1e9} SOL; \`run-rated\` sends it ${Number(JUDGE_TOPUP) / 1e9} SOL from the payer`);
  }
  return out;
}

async function runRated(conn, runId) {
  const payerKp = loadKeypair('RAP_E2E_PAYER_KEYPAIR');
  const payeeKp = loadKeypair('RAP_E2E_PAYEE_KEYPAIR');
  const judgeKp = env('RAP_E2E_JUDGE_KEYPAIR', { required: false }) ? loadKeypair('RAP_E2E_JUDGE_KEYPAIR') : null;
  const payer = payerKp.publicKey, payee = payeeKp.publicKey;
  assert(!payer.equals(payee), 'payer and payee must differ');
  assert(!judgeKp || (!judgeKp.publicKey.equals(payer) && !judgeKp.publicKey.equals(payee)), 'the judge must be a third wallet');
  const cluster = await checkCluster(conn);
  await assertRatingBuild(conn, payer);
  const { send, refusedWith } = makeSender(conn);
  const out = { mode: 'run-rated', runId, cluster, payer: payer.toBase58(), payee: payee.toBase58(), judge: null, steps: [], refusals: [], skipped: [], agentRecords: {} };
  const step = (name, signature, checks) => { out.steps.push({ name, signature, explorer: explorer(signature), ...checks }); };

  // A run id can be used once. Job 2's rating account outlives its escrow, so both addresses are checked.
  const probe = ratedLane({ payer, payee, runId });
  for (const [name, escrow] of Object.entries(probe.escrows)) {
    for (const address of [escrow, probe.ratings[name]]) {
      assert(!(await conn.getAccountInfo(address, 'confirmed')), `RAP_E2E_RUN_ID ${runId} was already used by the rated lane (${name}: ${address.toBase58()} exists). Pick a new run id.`);
    }
  }
  const topUp = async (name, address, floor, amount) => {
    if (BigInt(await conn.getBalance(address, 'confirmed')) >= floor) return;
    const sig = await send(`fund ${name} for its own fees`, [SystemProgram.transfer({ fromPubkey: payer, toPubkey: address, lamports: amount })], [payerKp]);
    step(`fund ${name} for fees`, sig, { lamports: amount.toString() });
  };
  const register = async (name, keypair, agentType) => {
    const sig = await send(`register ${name} as an agent (type ${agentType})`, [registerAgent({ owner: keypair.publicKey, agentType, model: `rap-devnet-e2e-${name}` })], [keypair]);
    assert.equal(await solDelta(conn, sig, AGENT_FEE_BURN_ADDRESS), AGENT_REGISTRATION_FEE, `register ${name}: registration fee`);
    step(`register ${name}`, sig, { agentType, registrationFee: AGENT_REGISTRATION_FEE.toString() });
  };
  // The payee signs and pays for its own actions, and so does the judge.
  await topUp('payee', payee, PAYEE_FEE_FLOOR, PAYEE_FEE_TOPUP);

  // Optional: close escrows an earlier, interrupted rated run left locked. The payee declines each.
  const leftoverRunId = env('RAP_E2E_LEFTOVER_RUN_ID', { required: false });
  if (leftoverRunId) {
    assert(RUN_ID.test(leftoverRunId) && leftoverRunId !== runId, 'RAP_E2E_LEFTOVER_RUN_ID must be an earlier run id');
    const old = ratedLane({ payer, payee, runId: leftoverRunId });
    for (const [name, escrow] of Object.entries(old.escrows)) {
      const info = await conn.getAccountInfo(escrow, 'confirmed');
      if (!info) continue;
      const rated = rating.isRatedEscrow(info.data);
      // A rated decline names the job: the opened slot of the rating now at this escrow, one of this lane's own.
      const leftoverRating = rated ? await readRating(conn, escrow) : null;
      assert(!rated || leftoverRating, `leftover ${leftoverRunId}/${name}: rated escrow without its rating account`);
      const openedSlot = leftoverRating ? leftoverRating.openedSlot : undefined;
      const ix = name === 'job2'
        ? rating.buildTokenEscrowExitInstruction(old.usdcTerms, { rated, openedSlot, refund: true, authority: payee })
        : rating.buildCancelSolEscrowInstruction({ programId: PROGRAM, escrow, payer, authority: payee, rated, openedSlot });
      const sig = await send(`close leftover ${leftoverRunId}/${name}`, [local(ix)], [payeeKp]);
      await assertClosed(conn, escrow, ...(rated ? [old.ratings[name]] : []));
      step(`close leftover ${leftoverRunId}/${name}`, sig, { escrow: escrow.toBase58(), declinedByPayee: true, rated });
    }
  }

  // The judge: a third wallet, registered as an attestation agent (type 1 or 2) with an active record.
  let judge;
  if (!judgeKp) {
    out.skipped.push('RAP_E2E_JUDGE_KEYPAIR is not set: no judge is named and the attestation steps are skipped');
  } else {
    await topUp('judge', judgeKp.publicKey, JUDGE_FLOOR, JUDGE_TOPUP);
    let record = await readAgent(conn, judgeKp.publicKey);
    if (!record) { await register('judge', judgeKp, 1); record = await readAgent(conn, judgeKp.publicKey); }
    assert(record, 'judge agent record missing after registration');
    if (record.agentType === 0) out.skipped.push('the judge wallet is registered as a primary agent (type 0), not an attestation agent: attestation steps are skipped');
    else if (!record.active) out.skipped.push('the judge wallet\'s agent record is not active: attestation steps are skipped');
    else judge = judgeKp.publicKey;
  }
  for (const message of out.skipped) console.log(`  – ${message}`);
  out.judge = judge ? judge.toBase58() : null;
  if (env('RAP_E2E_REGISTER_PARTIES', { required: false }) === '1') {
    if (!(await readAgent(conn, payer))) await register('payer', payerKp, 0);
    if (!(await readAgent(conn, payee))) await register('payee', payeeKp, 0);
  }

  const lane = ratedLane({ payer, payee, judge, runId });
  const { escrows, ratings } = lane;
  const a = RATED_AMOUNTS;
  const signers = { payer: [payerKp], payee: [payeeKp], judge: [judgeKp] };
  // The opened slot of each job, read from its rating account after the lock. The lane is built again with them,
  // so a step that names a job carries the slot the chain recorded.
  const openedSlots = {};
  const planned = id => {
    const s = ratedLane({ payer, payee, judge, runId, openedSlots }).steps.find(x => x.id === id);
    for (const job of s?.openedSlotOf ?? []) assert(openedSlots[job] !== undefined, `${id}: the opened slot of ${job} has not been read`);
    return s;
  };
  const done = [];
  // Each transaction and refusal comes from the plan, so `plan-rated` shows exactly what is sent here.
  const go = async id => {
    const s = planned(id);
    assert(s?.kind === 'send' && s.mode === 'run-rated', `${id} is not a transaction of the plan`);
    done.push(id);
    return send(id, s.ixs, signers[s.signer]);
  };
  const no = async (id, code) => {
    const s = planned(id);
    assert(s?.kind === 'refuse' && s.mode === 'run-rated', `${id} is not a refusal of the plan`);
    done.push(id);
    out.refusals.push(await refusedWith(id, s.ixs, signers[s.signer], code ?? s.code));
  };
  // The slot a finalized transaction landed in.
  const slotOf = async signature => BigInt((await conn.getTransaction(signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 })).slot);
  // A rating is opened in the slot of its lock transaction; record it for the steps that name the job.
  const recordOpenedSlot = async (name, lockSignature, r) => {
    const lockSlot = await slotOf(lockSignature);
    assert.equal(r.openedSlot, lockSlot, `${name}: opened_slot is the slot of the lock and open_rating`);
    openedSlots[name] = r.openedSlot;
    return lockSlot;
  };
  // No exit of a rated escrow goes out until the chain is past the slot its rating was opened in (6050 otherwise).
  const pastOpenedSlot = async name => {
    const deadline = Date.now() + 60_000;
    while (BigInt(await conn.getSlot('finalized')) <= openedSlots[name]) {
      assert(Date.now() < deadline, `${name}: the chain did not pass the opened slot`);
      await sleep(400);
    }
  };
  const state = async (name, expected) => {
    const r = await readRating(conn, escrows[name]);
    assert(r, `${name}: rating account missing`);
    assert.equal(r.state, expected, `${name}: rating state`);
    return r;
  };
  const text = k => (k ? k.toBase58() : null);

  console.log('Job 1: SOL, metered, rated, both sides rate');
  {
    let sig = await go('job1.lock-and-open-rating');
    const flags = rating.escrowAccountFlags((await conn.getAccountInfo(escrows.job1, 'finalized')).data);
    assert.deepEqual(flags, { kind: 'sol', metered: true, rated: true }, 'job1: escrow flag byte');
    let r = await state('job1', 'awaiting_settlement');
    assert.equal(text(r.escrow), text(escrows.job1), 'job1: rating names the escrow');
    assert.equal(text(r.consumer), text(payer), 'job1: consumer');
    assert.equal(text(r.specialist), text(payee), 'job1: specialist');
    assert.equal(text(r.judge), text(judge), 'job1: judge');
    assert.equal(r.accepted, false, 'job1: not accepted by accept_rating');
    await recordOpenedSlot('job1', sig, r);
    const ratingRent = r.lamports;
    step('job1 lock and open_rating', sig, { escrow: text(escrows.job1), rating: text(ratings.job1), max: a.solMeteredMax.toString(),
      openedSlot: r.openedSlot.toString(), ratingRent: ratingRent.toString(), ratingRentMatchesReadme: ratingRent === RATING_RENT_README });
    await pastOpenedSlot('job1');
    await no('job1.settle-without-rating-account');
    await no('job1.commit-before-paid');
    await no('job1.settle-stale-slot');

    sig = await go('job1.settle');
    const settleFee = fee(a.solMeteredActual, true);
    assert.equal(await solDelta(conn, sig, TREASURY), settleFee, 'job1 settle: treasury fee (2.5%)');
    assert.equal(await solDelta(conn, sig, payee), a.solMeteredActual - settleFee, 'job1 settle: payee share');
    await assertClosed(conn, escrows.job1);
    r = await state('job1', 'open');
    assert.equal(r.paid, a.solMeteredActual, 'job1: paid amount on the rating');
    assert.equal(r.mint, undefined, 'job1: no mint for SOL');
    assert(r.settledSlot > 0n, 'job1: settled slot');
    step('job1 payee settle', sig, { actual: a.solMeteredActual.toString(), treasuryFee: settleFee.toString(), payeeReceived: (a.solMeteredActual - settleFee).toString(),
      ratingState: r.state, settledSlot: r.settledSlot.toString() });

    sig = await go('job1.commit-consumer');
    r = await state('job1', 'open');
    assert(r.consumerCommitment && !r.specialistCommitment, 'job1: only the consumer has committed');
    step('job1 consumer commit', sig, {});
    await no('job1.reveal-before-both-committed');
    sig = await go('job1.commit-specialist');
    r = await state('job1', 'both_committed');
    assert(r.committedSlot > 0n, 'job1: committed slot');
    step('job1 specialist commit', sig, { ratingState: r.state });

    const before = { payer: await readAgent(conn, payer), payee: await readAgent(conn, payee) };
    sig = await go('job1.reveal-consumer');
    r = await state('job1', 'both_committed');
    assert.equal(r.consumerScore, RATED_SCORES.job1Consumer, 'job1: consumer score');
    step('job1 consumer reveal', sig, { score: RATED_SCORES.job1Consumer });
    sig = await go('job1.reveal-specialist');
    r = await state('job1', 'revealed');
    assert.equal(r.consumerScore, RATED_SCORES.job1Consumer, 'job1: consumer score');
    assert.equal(r.specialistScore, RATED_SCORES.job1Specialist, 'job1: specialist score');
    // Each score is folded into the other party's record, and both job counts rise by one.
    out.agentRecords.job1 = {
      payee: assertRecord('job1 payee (specialist)', before.payee, await readAgent(conn, payee),
        b => ({ reputation: foldRating(b.reputation, RATED_SCORES.job1Consumer), jobsCompleted: b.jobsCompleted + 1n })),
      payer: assertRecord('job1 payer (consumer)', before.payer, await readAgent(conn, payer),
        b => ({ reputation: foldRating(b.reputation, RATED_SCORES.job1Specialist), jobsCompleted: b.jobsCompleted + 1n })),
    };
    step('job1 specialist reveal', sig, { score: RATED_SCORES.job1Specialist, ratingState: r.state, agentRecords: out.agentRecords.job1 });

    // The payee is not the judge. attest_quality reads the signer's agent record first, so an unregistered
    // payee is refused for that (3012) before the judge check (6000).
    await no('job1.attest-by-payee', (await readAgent(conn, payee)) ? ERR.UnauthorisedSigner : ERR.AccountNotInitialized);
    if (judge) {
      const judgeBefore = await readAgent(conn, judge);
      await no('job1.attest-stale-slot');
      sig = await go('job1.attest');
      const info = await conn.getAccountInfo(lane.attestation, 'finalized');
      assert(info, 'job1: attestation account missing');
      let attestation = rating.decodeAttestationAccount(info.data);
      const attestationRent = BigInt(info.lamports);
      assert.equal(text(attestation.judge), text(judge), 'job1 attestation: judge');
      assert.equal(text(attestation.consumer), text(payer), 'job1 attestation: consumer');
      assert.deepEqual(attestation.scores, RATED_SCORES.attestation, 'job1 attestation: scores');
      assert.equal(attestation.resolution, 'pending', 'job1 attestation: pending');
      assert.equal((await state('job1', 'revealed')).attested, true, 'job1: rating remembers the attestation');
      step('job1 judge attest_quality', sig, { attestation: text(lane.attestation), scores: RATED_SCORES.attestation, attestationRent: attestationRent.toString() });
      await no('job1.attest-again');
      sig = await go('job1.confirm-attestation');
      attestation = rating.decodeAttestationAccount((await conn.getAccountInfo(lane.attestation, 'finalized')).data);
      assert.equal(attestation.resolution, 'confirmed', 'job1 attestation: confirmed');
      // Confirming raises the judge's accuracy by 10.00 and folds a top score into its reputation.
      out.agentRecords.judge = assertRecord('judge', judgeBefore, await readAgent(conn, judge),
        b => ({ accuracy: Math.min(b.accuracy + ATTESTATION_CONFIRM_WEIGHT, SCORE_MAX), reputation: foldRating(b.reputation, 10) }));
      step('job1 buyer confirm_attestation', sig, { judgeRecord: out.agentRecords.judge });
      await no('job1.dispute-after-confirm');
      sig = await go('job1.close-attestation');
      assert.equal(await solDelta(conn, sig, judge), attestationRent, 'job1: attestation rent back to the judge');
      await assertClosed(conn, lane.attestation);
      step('job1 judge close_attestation', sig, { returnedToJudge: attestationRent.toString() });
    }
    sig = await go('job1.close-rating');
    assert.equal(await solDelta(conn, sig, payer), ratingRent, 'job1: rating rent back to the buyer');
    await assertClosed(conn, ratings.job1);
    step('job1 buyer close_rating', sig, { returnedToPayer: ratingRent.toString() });
  }

  console.log('Job 2: USDC, fixed price, rated, seller accepts, payer releases, only the buyer commits');
  {
    assert((await tokenAmount(conn, lane.source)) !== null, `payer has no devnet USDC account at ${lane.source.toBase58()}`);
    if ((await tokenAmount(conn, lane.recipient)) === null) {
      const created = await send('create payee USDC account', [token.createAssociatedTokenAccountIdempotentInstruction(payer, lane.recipient, payee, USDC, TOKEN)], [payerKp]);
      step('create payee USDC account', created, { account: lane.recipient.toBase58() });
    }
    let sig = await go('job2.lock-and-open-rating');
    const flags = rating.escrowAccountFlags((await conn.getAccountInfo(escrows.job2, 'finalized')).data);
    assert.deepEqual(flags, { kind: 'token', metered: false, rated: true }, 'job2: escrow flag byte');
    let r = await state('job2', 'awaiting_settlement');
    assert.equal(r.judge, undefined, 'job2: names no judge');
    // What the seller saw: the slot of the lock transaction. It accepts only that job.
    const lockSlot = await recordOpenedSlot('job2', sig, r);
    step('job2 lock and open_rating', sig, { escrow: text(escrows.job2), rating: text(ratings.job2), amount: a.usdcFixed.toString(),
      openedSlot: r.openedSlot.toString(), ratingRent: r.lamports.toString() });
    await no('job2.accept-rating-stale-slot');
    const sellerInput = { programId: PROGRAM, escrow: escrows.job2, seller: payee, commitment: 'finalized',
      expected: { openedSlot: lockSlot, judge: null, amount: a.usdcFixed, mint: USDC } };
    // The seller's helper refuses, before anything is signed, a job other than the one it expects.
    for (const [what, expected, reason] of [['another opened slot', { openedSlot: lockSlot - 1n }, 'opened_slot_mismatch'],
      ['another amount', { amount: a.usdcFixed + 1n }, 'amount_mismatch'], ['a judge', { judge: payer }, 'judge_mismatch']]) {
      await assert.rejects(rating.buildSellerAcceptRating(conn, { ...sellerInput, expected: { ...sellerInput.expected, ...expected } }),
        err => err?.name === 'SellerAcceptRatingError' && err.reason === reason, `job2: the seller's helper must refuse ${what}`);
    }
    const accepted = await rating.buildSellerAcceptRating(conn, sellerInput);
    assert.equal(accepted.openedSlot, lockSlot, 'job2: seller helper opened slot');
    assert.equal(text(key(accepted.consumer)), text(payer), 'job2: seller helper consumer');
    assert.equal(accepted.judge, undefined, 'job2: seller helper judge');
    assert.equal(accepted.kind, 'token', 'job2: seller helper kind');
    const planAccept = planned('job2.accept-rating').ixs[0];
    const helperAccept = local(accepted.instruction);
    assert(helperAccept.data.equals(planAccept.data) && JSON.stringify(describeInstruction(helperAccept)) === JSON.stringify(describeInstruction(planAccept)),
      'job2: the seller helper built another accept_rating than the plan');
    sig = await go('job2.accept-rating');
    r = await state('job2', 'awaiting_settlement');
    assert.equal(r.accepted, true, 'job2: accepted');
    assert.equal(rating.payerReleaseOpensRating(r), true, 'job2: a payer release now opens the rating');
    step('job2 seller accept_rating', sig, { accepted: true, openedSlot: accepted.openedSlot.toString(),
      sellerHelperRefused: ['opened_slot_mismatch', 'amount_mismatch', 'judge_mismatch'] });
    await no('job2.accept-rating-again');
    await pastOpenedSlot('job2');
    sig = await go('job2.release');
    const releaseFee = fee(a.usdcFixed, false);
    assert.equal(await tokenDelta(conn, sig, TREASURY_USDC), releaseFee, 'job2 release: treasury fee (2.5%)');
    assert.equal(await tokenDelta(conn, sig, lane.recipient), a.usdcFixed - releaseFee, 'job2 release: payee share');
    await assertClosed(conn, escrows.job2, tokenVault(escrows.job2));
    r = await state('job2', 'open');
    assert.equal(r.paid, a.usdcFixed, 'job2: paid amount on the rating');
    assert.equal(text(r.mint), text(USDC), 'job2: mint on the rating');
    step('job2 payer release', sig, { treasuryFee: releaseFee.toString(), payeeReceived: (a.usdcFixed - releaseFee).toString(), ratingState: r.state });
    if (judge) await no('job2.attest-by-unnamed-judge');
    sig = await go('job2.commit-consumer');
    r = await state('job2', 'open');
    assert(r.consumerCommitment && !r.specialistCommitment, 'job2: only the consumer has committed');
    step('job2 consumer commit (left open)', sig, {});
    out.openRating = { rating: text(ratings.job2), escrow: text(escrows.job2),
      ...expiryEstimate({ settledSlot: r.settledSlot, currentSlot: await conn.getSlot('confirmed') }),
      next: 'run finish-rated with the same run id on or after estimatedEarliest; before that it only shows the refusal' };
  }

  console.log('Rated escrow declined by the payee');
  {
    let sig = await go('decline.lock-and-open-rating');
    await recordOpenedSlot('decline', sig, await state('decline', 'awaiting_settlement'));
    const held = (await lamportsOf(conn, escrows.decline)) + (await lamportsOf(conn, ratings.decline));
    step('decline-case lock and open_rating', sig, { amount: a.solDecline.toString() });
    await pastOpenedSlot('decline');
    sig = await go('decline.cancel');
    assert.equal(await solDelta(conn, sig, TREASURY), 0n, 'decline: no fee');
    assert.equal(await solDelta(conn, sig, payer), held, 'decline: locked amount, escrow rent and rating rent back to the payer');
    await assertClosed(conn, escrows.decline, ratings.decline);
    step('payee decline of a rated escrow', sig, { returnedToPayer: held.toString(), treasuryFee: '0', ratingClosed: true });
  }

  console.log('Rated escrow released by the payer without the seller\'s agreement');
  {
    let sig = await go('unaccepted.lock-and-open-rating');
    const r = await state('unaccepted', 'awaiting_settlement');
    await recordOpenedSlot('unaccepted', sig, r);
    assert.equal(rating.payerReleaseOpensRating(r), false, 'unaccepted: a payer release will not open the rating');
    const held = (await lamportsOf(conn, escrows.unaccepted)) + r.lamports;
    step('unaccepted-case lock and open_rating', sig, { amount: a.solUnaccepted.toString() });
    const before = { payer: await readAgent(conn, payer), payee: await readAgent(conn, payee) };
    await pastOpenedSlot('unaccepted');
    sig = await go('unaccepted.release');
    const releaseFee = fee(a.solUnaccepted, true);
    assert.equal(await solDelta(conn, sig, TREASURY), releaseFee, 'unaccepted release: treasury fee (2.5%)');
    assert.equal(await solDelta(conn, sig, payee), a.solUnaccepted - releaseFee, 'unaccepted release: payee share');
    assert.equal(await solDelta(conn, sig, payer), held - a.solUnaccepted, 'unaccepted release: escrow rent and rating rent back to the payer');
    await assertClosed(conn, escrows.unaccepted, ratings.unaccepted);
    // Paid, never rated: neither record moves.
    out.agentRecords.unaccepted = {
      payee: assertRecord('unaccepted payee', before.payee, await readAgent(conn, payee), () => ({})),
      payer: assertRecord('unaccepted payer', before.payer, await readAgent(conn, payer), () => ({})),
    };
    step('payer release without acceptance', sig, { treasuryFee: releaseFee.toString(), payeeReceived: (a.solUnaccepted - releaseFee).toString(), ratingClosed: true });
    await no('unaccepted.commit-after-unrated-close');
  }

  console.log('No rated escrow ends in the slot its rating was opened in');
  await no('same-slot.lock-open-and-release');

  console.log('Escrow never opted in, and the PER selectors');
  {
    let sig = await go('unrated.lock');
    const flags = rating.escrowAccountFlags((await conn.getAccountInfo(escrows.unrated, 'finalized')).data);
    assert.deepEqual(flags, { kind: 'sol', metered: false, rated: false }, 'unrated: escrow flag byte');
    step('unrated-case lock', sig, { amount: a.solUnrated.toString() });
    await no('unrated.open-rating-in-a-later-slot');
    await no('unrated.commit-never-opted-in');
    sig = await go('unrated.decline');
    await assertClosed(conn, escrows.unrated);
    step('payee decline of the unrated escrow', sig, {});
    await no('per.delegate_escrow');
    await no('per.release_escrow_per');
  }

  // Everything the plan lists for this mode was executed, in the plan's order.
  assert.deepEqual(done, lane.steps.filter(s => s.mode === 'run-rated' && s.kind !== 'skip').map(s => s.id), 'the run did not follow the plan');
  out.result = 'passed';
  return out;
}

async function finishRated(conn, runId) {
  const payerKp = loadKeypair('RAP_E2E_PAYER_KEYPAIR');
  const payeeKp = loadKeypair('RAP_E2E_PAYEE_KEYPAIR');
  const payer = payerKp.publicKey, payee = payeeKp.publicKey;
  const cluster = await checkCluster(conn);
  await assertRatingBuild(conn, payer);
  const { send, refusedWith } = makeSender(conn);
  const lane = ratedLane({ payer, payee, runId });
  const ixs = id => lane.steps.find(s => s.id === id).ixs;
  const out = { mode: 'finish-rated', runId, cluster, rating: lane.ratings.job2.toBase58(), steps: [], refusals: [] };
  const before = await readRating(conn, lane.escrows.job2);
  assert(before, 'job 2 rating account not found (already closed, or the run id differs)');
  assert(before.state === 'open' && before.consumerCommitment && !before.specialistCommitment,
    `job 2 rating is not in the state run-rated left it in (state ${before.state})`);
  out.before = expiryEstimate({ settledSlot: before.settledSlot, currentSlot: await conn.getSlot('confirmed') });
  if (out.before.slotsRemaining !== '0') {
    out.refusals.push(await refusedWith('job2.expire-before-deadline', ixs('job2.expire-before-deadline'), [payerKp], ERR.NotExpired));
    out.result = 'commit deadline not yet passed; nothing sent';
    return out;
  }
  const records = { payer: await readAgent(conn, payer), payee: await readAgent(conn, payee) };
  let sig = await send('job2.expire-rating', ixs('job2.expire-rating'), [payerKp]);
  const after = await readRating(conn, lane.escrows.job2);
  assert.equal(after?.state, 'expired', 'job2: rating state');
  // One side committed: the silent side loses 5.00 points and gains a failed job. The other record does not move.
  out.agentRecords = {
    payee: assertRecord('job2 payee (silent)', records.payee, await readAgent(conn, payee),
      b => ({ reputation: Math.max(0, b.reputation - RATING_EXPIRE_PENALTY), jobsFailed: b.jobsFailed + 1n })),
    payer: assertRecord('job2 payer (committed)', records.payer, await readAgent(conn, payer), () => ({})),
  };
  out.steps.push({ name: 'job2 expire_rating', signature: sig, explorer: explorer(sig), agentRecords: out.agentRecords });
  sig = await send('job2.close-rating', ixs('job2.close-rating'), [payerKp]);
  assert.equal(await solDelta(conn, sig, payer), before.lamports, 'job2: rating rent back to the buyer');
  await assertClosed(conn, lane.ratings.job2);
  out.steps.push({ name: 'job2 buyer close_rating', signature: sig, explorer: explorer(sig), returnedToPayer: before.lamports.toString() });
  out.result = 'passed';
  return out;
}

const MODES = ['plan', 'run', 'finish-refund', 'finish-claim', 'plan-rated', 'run-rated', 'finish-rated'];

async function main() {
  const mode = process.argv[2];
  assert(MODES.includes(mode), `mode must be one of: ${MODES.join(', ')}`);
  const offline = process.argv.slice(3).includes('--offline');
  assert(!offline || mode === 'plan-rated', '--offline goes with plan-rated only');
  // An offline plan opens no connection at all.
  const conn = offline ? null : new Connection(env('RAP_E2E_RPC', { required: false }) || 'https://api.devnet.solana.com', 'confirmed');
  let result;
  if (mode === 'plan') {
    result = await plan(conn);
  } else if (mode === 'plan-rated') {
    result = await planRated(conn);
  } else {
    const runId = env('RAP_E2E_RUN_ID');
    assert(RUN_ID.test(runId), 'RAP_E2E_RUN_ID must be 3-40 letters, digits or dashes');
    if (mode === 'run') result = await run(conn, runId);
    else if (mode === 'run-rated') result = await runRated(conn, runId);
    else if (mode === 'finish-rated') result = await finishRated(conn, runId);
    else result = await finish(conn, runId, mode.slice('finish-'.length));
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

if (require.main === module) {
  main().catch(err => { console.error(err.message || err); process.exitCode = 1; });
}

// For the offline unit test (scripts/__tests__/devnet-escrow-e2e-rated.test.mjs). Nothing here signs or connects.
module.exports = { PROGRAM, TREASURY, TREASURY_USDC, USDC, MODES, ERR, RATED_AMOUNTS, RATED_LABELS, RATED_SCORES,
  ratedLane, ratedPlan, registerAgent, decodeAgent, foldRating, customError, expiryEstimate, nonceFor, saltFor, fee };
