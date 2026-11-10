/* Local-validator exercise for Reddi Agent Protocol classic SPL escrow.
 * Requirements: root @solana/web3.js and @solana/spl-token dependencies (or NODE_PATH),
 * pinned solana-test-validator, a freshly built target/deploy/escrow.so.
 * Run: RAP_LOCAL_TEST_DIR=/absolute/disposable/path node programs/escrow/tests/local_token_escrow.cjs
 * Optional RAP_TEST_TOKEN_PROGRAM_SO supplies an explicit classic SPL Token SBF fixture (e.g.
 * litesvm-0.16.0/src/programs/elf/spl_token-3.5.0.so from the Cargo registry).
 * Optional: RAP_TEST_VALIDATOR=/absolute/path/to/solana-test-validator
 * All keys are generated in memory. Nothing reads the operator wallet. The test
 * starts its own loopback validator and loads the program at genesis. Refund
 * proof reloads an exact public-account snapshot from the successful local lock
 * into a fresh local validator with a slot warp. Account data is compared before
 * refunding; neither state bytes nor the refund window are edited. No external RPC.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const dgram = require('node:dgram');
const { spawn, execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { once } = require('node:events');
const { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } = require('@solana/web3.js');
const token = require('@solana/spl-token');
const PROGRAM = new PublicKey('794nTFNyJknzDrR13ApSfVyNCRvcvnCN3BVDfic8dcZD');
const TOKEN = token.TOKEN_PROGRAM_ID;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const disc = name => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const u64 = value => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b; };
const meta = (pubkey, isWritable = false, isSigner = false) => ({ pubkey, isWritable, isSigner });

async function main() {
  const dir = process.env.RAP_LOCAL_TEST_DIR;
  assert(dir && path.isAbsolute(dir), 'RAP_LOCAL_TEST_DIR must name a fresh absolute disposable directory');
  fs.mkdirSync(dir, { recursive: false, mode: 0o700 }); // Never reuse a ledger or another task's keys.
  const validatorBin = process.env.RAP_TEST_VALIDATOR || 'solana-test-validator';
  const version = execFileSync(validatorBin, ['--version'], { encoding: 'utf8' }).trim();
  assert.match(version, /^solana-test-validator 4\.2\.2\b/);
  const tokenElf = process.env.RAP_TEST_TOKEN_PROGRAM_SO;
  assert(!tokenElf || path.isAbsolute(tokenElf), 'RAP_TEST_TOKEN_PROGRAM_SO must be absolute when supplied');
  const payer = Keypair.generate(), payee = Keypair.generate(), attacker = Keypair.generate();
  // Reserve/check both TCP and UDP sockets before selecting ports; never kill a listener.
  async function available(port) {
    const tcp = net.createServer(), udp = dgram.createSocket('udp4');
    try {
      await new Promise((resolve, reject) => { tcp.once('error', reject); tcp.listen(port, '127.0.0.1', resolve); });
      await new Promise((resolve, reject) => { udp.once('error', reject); udp.bind(port, '127.0.0.1', resolve); });
      return true;
    } catch { return false; }
    finally { if (tcp.listening) await new Promise(resolve => tcp.close(resolve)); try { udp.close(); } catch {} }
  }
  let base;
  for (let tries = 0; tries < 100; tries++) {
    const candidate = 20000 + Math.floor(Math.random() * 30000);
    let free = true;
    for (let p = candidate; p < candidate + 40; p++) if (!await available(p)) { free = false; break; }
    if (free) { base = candidate; break; }
  }
  assert(base, 'no free port range found');
  const rpc = `http://127.0.0.1:${base}`;
  const config = path.join(dir, 'cli.yml');
  fs.writeFileSync(config, `json_rpc_url: ${rpc}\nwebsocket_url: ws://127.0.0.1:${base + 1}\nkeypair_path: ${path.join(dir, 'unused-wallet.json')}\ncommitment: confirmed\n`);
  const conn = new Connection(rpc, 'confirmed');
  const escrowElf = path.resolve(__dirname, '../../../target/deploy/escrow.so');
  const escrowElfSha256 = createHash('sha256').update(fs.readFileSync(escrowElf)).digest('hex');
  let validator;
  async function start(snapshot, warp = 0) {
    const log = fs.openSync(path.join(dir, snapshot ? 'validator-refund.log' : 'validator.log'), 'w', 0o600);
    const args = ['--quiet', '--config', config, '--ledger', path.join(dir, snapshot ? 'refund-ledger' : 'ledger'), '--bind-address', '127.0.0.1',
      '--rpc-port', String(base), '--faucet-port', String(base + 2), '--gossip-port', String(base + 3),
      '--dynamic-port-range', `${base + 4}-${base + 40}`, '--mint', payer.publicKey.toBase58(),
      '--bpf-program', PROGRAM.toBase58(), escrowElf, '--reset'];
    if (snapshot) args.push('--account-dir', snapshot, '--warp-slot', String(warp));
    if (tokenElf) args.push('--bpf-program', TOKEN.toBase58(), tokenElf);
    validator = spawn(validatorBin, args, { stdio: ['ignore', log, log] });
    fs.closeSync(log);
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      assert(validator.exitCode === null, `validator exited: ${validator.exitCode}; inspect task-local log`);
      try {
        if (await conn.getSlot('confirmed') >= warp + 5) {
          const tokenAccount = await conn.getAccountInfo(TOKEN, 'confirmed');
          assert(tokenAccount?.executable, 'classic Token program is not executable');
          const tokenInfo = execFileSync(path.join(path.dirname(validatorBin), 'solana'),
            ['--config', config, '--url', rpc, 'account', TOKEN.toBase58(), '--output', 'json'], { encoding: 'utf8' });
          fs.writeFileSync(path.join(dir, snapshot ? 'token-account-refund.json' : 'token-account.json'), tokenInfo);
          console.log(`Local validator ready at slot ${await conn.getSlot()}; Tokenkeg executable`);
          return;
        }
      } catch (error) { if (error.code === 'ERR_ASSERTION') throw error; }
      await sleep(500);
    }
    throw new Error('local validator startup timed out');
  }
  async function stop() {
    if (validator && validator.exitCode === null) {
      const exited = once(validator, 'exit');
      validator.kill('SIGINT');
      const timer = setTimeout(() => validator.kill('SIGKILL'), 15000);
      await exited;
      clearTimeout(timer);
    }
  }
  async function send(ixs, signers = [payer]) {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    const tx = new Transaction({ feePayer: payer.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
    tx.sign(...signers);
    const signature = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const result = (await conn.getSignatureStatuses([signature])).value[0];
      if (result?.err) throw new Error(JSON.stringify(result.err));
      if (result?.confirmationStatus === 'finalized') { console.log(`Finalized local transaction ${signature}`); return signature; }
      await sleep(300);
    }
    throw new Error(`local confirmation timeout: ${signature}`);
  }
  const mint = Keypair.generate(), source = Keypair.generate(), recipient = Keypair.generate();
  const nonce = Buffer.alloc(16, 91), refundNonce = Buffer.alloc(16, 92);
  const escrowPda = nonce => PublicKey.findProgramAddressSync([Buffer.from('token-escrow'), payer.publicKey.toBuffer(), nonce], PROGRAM)[0];
  const vaultPda = escrow => PublicKey.findProgramAddressSync([Buffer.from('token-vault'), escrow.toBuffer()], PROGRAM)[0];
  const lock = (nonce, amount) => {
    const escrow = escrowPda(nonce), vault = vaultPda(escrow);
    return new TransactionInstruction({ programId: PROGRAM, data: Buffer.concat([disc('lock_token_escrow'), u64(amount), nonce]), keys: [
      meta(escrow, true), meta(vault, true), meta(payer.publicKey, true, true), meta(payee.publicKey), meta(mint.publicKey),
      meta(source.publicKey, true), meta(recipient.publicKey), meta(TOKEN), meta(SystemProgram.programId),
    ] });
  };
  const settle = (nonce, refund, signer = payer.publicKey, dest = refund ? source.publicKey : recipient.publicKey) => {
    const escrow = escrowPda(nonce);
    return new TransactionInstruction({ programId: PROGRAM, data: disc(refund ? 'cancel_token_escrow' : 'release_token_escrow'), keys: [
      meta(escrow, true), meta(vaultPda(escrow), true), meta(signer, true, true), meta(mint.publicKey), meta(dest, true), meta(TOKEN),
    ] });
  };
  const balance = async key => (await token.getAccount(conn, key)).amount;
  const balances = async () => [await balance(source.publicKey), await balance(recipient.publicKey)];
  async function rejected(ix, signers = [payer]) {
    const before = await balances();
    await assert.rejects(send([ix], signers));
    assert.deepEqual(await balances(), before);
  }
  const signatures = [];
  try {
    await start();
    const mintRent = await conn.getMinimumBalanceForRentExemption(token.MINT_SIZE);
    signatures.push(await send([
      SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey, lamports: mintRent, space: token.MINT_SIZE, programId: TOKEN }),
      token.createInitializeMint2Instruction(mint.publicKey, 6, payer.publicKey, null, TOKEN),
    ], [payer, mint]));
    for (const [account, owner] of [[source, payer.publicKey], [recipient, payee.publicKey]]) {
      signatures.push(await send([
        SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: account.publicKey,
          lamports: await conn.getMinimumBalanceForRentExemption(token.ACCOUNT_SIZE), space: token.ACCOUNT_SIZE, programId: TOKEN }),
        token.createInitializeAccount3Instruction(account.publicKey, mint.publicKey, owner, TOKEN),
      ], [payer, account]));
    }
    signatures.push(await send([token.createMintToInstruction(mint.publicKey, source.publicKey, payer.publicKey, 1_000_000n)]));
    await rejected(lock(nonce, 0));
    signatures.push(await send([lock(nonce, 400_000)]));
    assert.deepEqual(await balances(), [600_000n, 0n]);
    assert.equal(await balance(vaultPda(escrowPda(nonce))), 400_000n);
    await rejected(settle(nonce, false, attacker.publicKey), [payer, attacker]);
    await rejected(settle(nonce, false, payer.publicKey, source.publicKey));
    signatures.push(await send([settle(nonce, false)]));
    assert.deepEqual(await balances(), [600_000n, 400_000n]);
    assert.equal(await conn.getAccountInfo(vaultPda(escrowPda(nonce))), null);
    assert.equal((await conn.getAccountInfo(escrowPda(nonce))).data[192], 1); // Released Borsh enum.
    await rejected(settle(nonce, false));
    await rejected(lock(nonce, 400_000));
    signatures.push(await send([lock(refundNonce, 200_000)]));
    await rejected(settle(refundNonce, true));
    const lockedState = (await conn.getAccountInfo(escrowPda(refundNonce))).data;
    const createdSlot = Number(lockedState.readBigUInt64LE(193));
    const refundSlot = createdSlot + 50_400;
    const snapshotKeys = [mint.publicKey, source.publicKey, recipient.publicKey,
      escrowPda(nonce), escrowPda(refundNonce), vaultPda(escrowPda(refundNonce))];
    const snapshotAccounts = await conn.getMultipleAccountsInfo(snapshotKeys);
    // Preserve u64 rentEpoch exactly. Parsing it through web3.js/JS Number can
    // round u64::MAX beyond the validator JSON account loader's accepted range.
    const response = await fetch(rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getMultipleAccounts',
        params: [snapshotKeys.map(key => key.toBase58()), { encoding: 'base64', commitment: 'finalized' }] }) });
    const losslessSnapshot = JSON.parse(await response.text(), (key, value, context) =>
      key === 'rentEpoch' ? JSON.rawJSON(context.source) : value);
    assert(!losslessSnapshot.error, JSON.stringify(losslessSnapshot.error));
    const snapshotDir = path.join(dir, 'locked-account-snapshot');
    fs.mkdirSync(snapshotDir);
    const snapshotHashes = {};
    for (let i = 0; i < snapshotKeys.length; i++) {
      const account = snapshotAccounts[i];
      assert(account, 'snapshot account must exist');
      const pubkey = snapshotKeys[i].toBase58();
      const dump = { pubkey, account: losslessSnapshot.result.value[i] };
      assert(dump.account, 'lossless snapshot account must exist');
      assert.deepEqual(Buffer.from(dump.account.data[0], 'base64'), account.data);
      const serialized = JSON.stringify(dump);
      snapshotHashes[pubkey] = createHash('sha256').update(serialized).digest('hex');
      fs.writeFileSync(path.join(snapshotDir, `${pubkey}.json`), serialized, { mode: 0o600 });
    }
    await stop();
    await start(snapshotDir, refundSlot + 100);
    const reloaded = await conn.getMultipleAccountsInfo(snapshotKeys);
    for (let i = 0; i < snapshotKeys.length; i++) {
      assert(reloaded[i], 'reloaded snapshot account must exist');
      assert.deepEqual(reloaded[i].data, snapshotAccounts[i].data, 'snapshot data must be byte-identical');
      assert(reloaded[i].owner.equals(snapshotAccounts[i].owner));
      assert.equal(reloaded[i].lamports, snapshotAccounts[i].lamports);
    }
    signatures.push(await send([settle(refundNonce, true)]));
    assert.deepEqual(await balances(), [600_000n, 400_000n]);
    assert.equal(await conn.getAccountInfo(vaultPda(escrowPda(refundNonce))), null);
    assert.equal((await conn.getAccountInfo(escrowPda(refundNonce))).data[192], 2); // Cancelled.
    await rejected(settle(refundNonce, true));
    await rejected(settle(refundNonce, false));
    const evidence = { label: 'LOCAL TEST MINT ONLY — not AUDD; no devnet proof', validator: version, rpc,
      mint: mint.publicKey.toBase58(), tokenProgram: TOKEN.toBase58(), decimals: 6,
      tokenElfSha256: tokenElf ? createHash('sha256').update(fs.readFileSync(tokenElf)).digest('hex') : null,
      escrowElfSha256, createdSlot, refundSlot, snapshotHashes,
      method: 'normal-slot local validator lock/release; byte-identical public-account snapshot reloaded into fresh local validator with slot warp for refund',

      program: PROGRAM.toBase58(), signatures, sourceBalance: '600000', recipientBalance: '400000',
      checks: ['exact lock', 'payer-authorized recorded-recipient release', 'slot-gated original-source refund', 'closed vaults', 'terminal state and replay rejection'] };
    fs.writeFileSync(path.join(dir, 'result.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(JSON.stringify(evidence, null, 2));
  } finally { await stop(); }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
