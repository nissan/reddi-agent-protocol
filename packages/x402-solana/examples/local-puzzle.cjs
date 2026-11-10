/* Reddi Agent Protocol disposable LOCAL TEST MINT example. No wallet files, external RPC or devnet signing.
 * Start with RAP_LOCAL_EXAMPLE_DIR=/fresh/absolute/task/path node packages/x402-solana/examples/local-puzzle.cjs
 * Requires pinned Agave 4.2.2 RAP_TEST_VALIDATOR and freshly built target/deploy/escrow.so.
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
const rap = require('../dist');
const { startSeller, runBuyer, syntheticRequest, checkAnalysis } = require('./puzzle-service.cjs');
const { Connection, Keypair, PublicKey, Transaction } = require('@solana/web3.js');
const token = require('@solana/spl-token');
const PROGRAM = new PublicKey('794nTFNyJknzDrR13ApSfVyNCRvcvnCN3BVDfic8dcZD');
const TOKEN = token.TOKEN_PROGRAM_ID;
const decimals = Number(process.env.RAP_DECIMALS || '6');
assert(Number.isInteger(decimals) && decimals >= 0 && decimals <= 9, 'local test decimals: 0..9');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const dir = process.env.RAP_LOCAL_EXAMPLE_DIR;
  assert(dir && path.isAbsolute(dir), 'RAP_LOCAL_EXAMPLE_DIR must name a fresh absolute disposable directory');
  const validatorBin = process.env.RAP_TEST_VALIDATOR;
  assert(validatorBin && path.isAbsolute(validatorBin), 'RAP_TEST_VALIDATOR must name the absolute path of the pinned Agave 4.2.2 solana-test-validator');
  fs.mkdirSync(dir, { recursive: false, mode: 0o700 }); // Never reuse a ledger or another task's keys.
  const version = execFileSync(validatorBin, ['--version'], { encoding: 'utf8' }).trim();
  assert.match(version, /^solana-test-validator 4\.2\.2\b/);
  const payer = Keypair.generate(), payee = Keypair.generate();
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
  const escrowElf = process.env.RAP_ESCROW_SO || path.resolve(__dirname, '../../../target/deploy/escrow.so');
  const escrowElfSha256 = createHash('sha256').update(fs.readFileSync(escrowElf)).digest('hex');
  let validator;
  async function start(snapshot, warp = 0) {
    const log = fs.openSync(path.join(dir, snapshot ? 'validator-snapshot.log' : 'validator.log'), 'w', 0o600);
    const args = ['--quiet', '--config', config, '--ledger', path.join(dir, snapshot ? 'snapshot-ledger' : 'ledger'), '--bind-address', '127.0.0.1',
      '--rpc-port', String(base), '--faucet-port', String(base + 2), '--gossip-port', String(base + 3),
      '--dynamic-port-range', `${base + 4}-${base + 40}`, '--mint', payer.publicKey.toBase58(),
      '--bpf-program', PROGRAM.toBase58(), escrowElf, '--reset'];
    if (snapshot) args.push('--account-dir', snapshot, '--warp-slot', String(warp));
    validator = spawn(validatorBin, args, { stdio: ['ignore', log, log] });
    fs.closeSync(log);
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      assert(validator.exitCode === null, `validator exited: ${validator.exitCode}; inspect task-local log`);
      const slot = await conn.getSlot('confirmed').catch(() => null);
      if (slot !== null && slot >= warp + 5) {
        const tokenAccount = await conn.getAccountInfo(TOKEN, 'confirmed');
        assert(tokenAccount?.executable, 'classic Token program is not executable');
        const tokenInfo = execFileSync(path.join(path.dirname(validatorBin), 'solana'),
          ['--config', config, '--url', rpc, 'account', TOKEN.toBase58(), '--output', 'json'], { encoding: 'utf8' });
        fs.writeFileSync(path.join(dir, snapshot ? 'token-account-snapshot.json' : 'token-account.json'), tokenInfo);
        console.log(`Local validator ready at slot ${slot}; Tokenkeg executable`);
        return;
      }
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
  let server;
  try {
    await start();
    // Preserve public Tokenkeg + its linked programdata, then reload byte-identically
    // into a fresh ledger and warp. This is explicit local snapshot-and-warp evidence.
    const program = await conn.getAccountInfo(TOKEN, 'confirmed');
    assert(program && program.data.length === 36, 'expected upgradeable classic Token program');
    const programData = new PublicKey(program.data.subarray(4, 36));
    const snapshotKeys = [TOKEN, programData];
    const response = await fetch(rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getMultipleAccounts',
        params: [snapshotKeys.map(key => key.toBase58()), { encoding: 'base64', commitment: 'confirmed' }] }) });
    const lossless = JSON.parse(await response.text(), (key, value, context) =>
      key === 'rentEpoch' ? JSON.rawJSON(context.source) : value);
    assert(!lossless.error, JSON.stringify(lossless.error));
    const snapshotDir = path.join(dir, 'public-token-snapshot');
    fs.mkdirSync(snapshotDir);
    const snapshotHashes = {};
    for (let i = 0; i < snapshotKeys.length; i++) {
      const account = lossless.result.value[i]; assert(account, 'public Token account missing');
      const serialized = JSON.stringify({ pubkey: snapshotKeys[i].toBase58(), account });
      snapshotHashes[snapshotKeys[i].toBase58()] = createHash('sha256').update(serialized).digest('hex');
      fs.writeFileSync(path.join(snapshotDir, `${snapshotKeys[i].toBase58()}.json`), serialized);
    }
    await stop();
    await start(snapshotDir, 1000);
    for (let i = 0; i < snapshotKeys.length; i++) {
      const reloaded = await conn.getAccountInfo(snapshotKeys[i], 'confirmed'); assert(reloaded);
      assert.deepEqual(reloaded.data, Buffer.from(lossless.result.value[i].data[0], 'base64'));
    }
    const mint = await token.createMint(conn, payer, payer.publicKey, null, decimals, undefined, { commitment: 'finalized' }, TOKEN);
    const source = await token.createAccount(conn, payer, mint, payer.publicKey, undefined, { commitment: 'finalized' }, TOKEN);
    const recipient = await token.createAccount(conn, payer, mint, payee.publicKey, undefined, { commitment: 'finalized' }, TOKEN);
    await token.mintTo(conn, payer, mint, source, payer, 1000000n, [], { commitment: 'finalized' }, TOKEN);
    const config = { network: 'solana-local-validator', genesisHash: await conn.getGenesisHash(),
      programId: PROGRAM.toBase58(), payer: payer.publicKey.toBase58(), payee: payee.publicKey.toBase58(),
      mint: mint.toBase58(), source: source.toBase58(), recipient: recipient.toBase58(),
      tokenProgram: TOKEN.toBase58(), decimals, amount: '400000' };
    server = await startSeller(conn, config);
    const { result, receipt, challenge } = await runBuyer(conn, payer, config, server.endpoint);
    checkAnalysis(syntheticRequest, result);
    assert.equal(receipt.status, 'locked');
    assert.equal((await token.getAccount(conn, recipient)).amount, 0n);
    const replay = await fetch(server.endpoint, { method: 'POST', body: JSON.stringify(syntheticRequest),
      headers: { 'x402-payment': JSON.stringify({ nonce: receipt.nonce, lockSignature: receipt.lockSignature }) } });
    assert.equal(replay.status, 409);
    const releaseSignature = await send([rap.buildSettleTokenEscrowInstruction(rap.escrowTerms(challenge))]);
    assert.equal((await token.getAccount(conn, source)).amount, 600000n);
    assert.equal((await token.getAccount(conn, recipient)).amount, 400000n);
    assert.equal(await conn.getAccountInfo(new PublicKey(receipt.escrow), 'finalized'), null);
    const proof = { label: 'LOCAL TEST MINT ONLY — not AUDD; no devnet proof', config, escrowElfSha256,
      method: 'public Tokenkeg + linked programdata snapshot reloaded byte-identically; warp-slot 1000; local-only evidence', snapshotHashes,
      result, receipt, releaseSignature, checks: ['HTTP 402', 'finalized exact lock', 'paid retry', 'separate puzzle analysis check', 'replay rejected', 'payer release to recorded recipient', 'escrow closed'] };
    fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(proof, null, 2) + '\n');
    console.log(JSON.stringify(proof, null, 2));
  } finally {
    if (server) await server.close();
    await stop();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
