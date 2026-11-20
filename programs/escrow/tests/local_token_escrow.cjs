/* Local-validator exercise for Reddi Agent Protocol classic SPL escrow (#746).
 * Written for the trimmed program: allowlisted 6-decimal mints only, a 100-unit cap,
 * `authority` signer on release and refund, payee decline at any time, payer refund after
 * 648,000 slots and payee claim after 1,512,000 slots.
 * Requirements: root @solana/web3.js and @solana/spl-token dependencies (or NODE_PATH),
 * pinned solana-test-validator, a freshly built default-feature target/deploy/escrow.so.
 * Run: RAP_LOCAL_TEST_DIR=/absolute/disposable/path node programs/escrow/tests/local_token_escrow.cjs
 * Optional: RAP_TEST_VALIDATOR=/absolute/path/to/solana-test-validator (the solana CLI is
 * resolved beside it, or from PATH when only a bare command name is given).
 * All keys are generated in memory. Nothing reads the operator wallet. The test
 * starts its own loopback validator and loads the program at genesis. The program only
 * accepts allowlisted mints, so a disposable mint whose authority is the in-memory payer
 * is installed at the allowlisted mainnet USDC address when the validator starts. It is
 * a local stand-in: no real USDC and no external RPC are involved.
 * The two time-gated cases reload an exact public-account snapshot into a fresh local
 * validator with a slot warp. Account data is compared before settling; neither state
 * bytes nor the windows are edited.
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
// Allowlisted in the default build (constants.rs USDC_MAINNET_MINT). Only the address is reused.
const MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const CANCEL_WINDOW_SLOTS = 648_000; // constants.rs CANCEL_WINDOW_SLOTS
const CLAIM_WINDOW_SLOTS = 1_512_000; // constants.rs CLAIM_WINDOW_SLOTS
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
  // The stand-in mint, written as a genesis account file. The payer is its mint authority.
  const mintData = Buffer.alloc(token.MINT_SIZE);
  token.MintLayout.encode({ mintAuthorityOption: 1, mintAuthority: payer.publicKey, supply: 0n, decimals: 6,
    isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, mintData);
  const mintFile = path.join(dir, 'stand-in-mint.json');
  fs.writeFileSync(mintFile, JSON.stringify({ pubkey: MINT.toBase58(), account: {
    lamports: (token.MINT_SIZE + 128) * 6960, data: [mintData.toString('base64'), 'base64'], owner: TOKEN.toBase58(),
    executable: false, rentEpoch: JSON.rawJSON('18446744073709551615'), space: token.MINT_SIZE } }), { mode: 0o600 });
  async function start(phase, snapshot, warp = 0) {
    const log = fs.openSync(path.join(dir, `validator-${phase}.log`), 'w', 0o600);
    const args = ['--quiet', '--config', config, '--ledger', path.join(dir, `ledger-${phase}`), '--bind-address', '127.0.0.1',
      '--rpc-port', String(base), '--faucet-port', String(base + 2), '--gossip-port', String(base + 3),
      '--dynamic-port-range', `${base + 4}-${base + 40}`, '--mint', payer.publicKey.toBase58(),
      '--bpf-program', PROGRAM.toBase58(), escrowElf, '--reset'];
    // A snapshot already carries the mint with its current supply.
    if (snapshot) args.push('--account-dir', snapshot, '--warp-slot', String(warp));
    else args.push('--account', MINT.toBase58(), mintFile);
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
        fs.writeFileSync(path.join(dir, `token-program-${phase}.json`), tokenInfo);
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
  const source = Keypair.generate(), recipient = Keypair.generate();
  const nonces = { release: Buffer.alloc(16, 91), decline: Buffer.alloc(16, 92), refund: Buffer.alloc(16, 93), claim: Buffer.alloc(16, 94) };
  const escrowPda = nonce => PublicKey.findProgramAddressSync([Buffer.from('token-escrow'), payer.publicKey.toBuffer(), nonce], PROGRAM)[0];
  const vaultPda = escrow => PublicKey.findProgramAddressSync([Buffer.from('token-vault'), escrow.toBuffer()], PROGRAM)[0];
  const lock = (nonce, amount, accounts = { mint: MINT, source: source.publicKey, recipient: recipient.publicKey }) => {
    const escrow = escrowPda(nonce), vault = vaultPda(escrow);
    return new TransactionInstruction({ programId: PROGRAM, data: Buffer.concat([disc('lock_token_escrow'), u64(amount), nonce]), keys: [
      meta(escrow, true), meta(vault, true), meta(payer.publicKey, true, true), meta(payee.publicKey), meta(accounts.mint),
      meta(accounts.source, true), meta(accounts.recipient), meta(TOKEN), meta(SystemProgram.programId),
    ] });
  };
  // Release and refund share one account list: escrow, vault, authority (signer), payer (rent), mint, destination, token program.
  const settle = (nonce, refund, authority, dest = refund ? source.publicKey : recipient.publicKey) => {
    const escrow = escrowPda(nonce);
    return new TransactionInstruction({ programId: PROGRAM, data: disc(refund ? 'cancel_token_escrow' : 'release_token_escrow'), keys: [
      meta(escrow, true), meta(vaultPda(escrow), true), meta(authority.publicKey, false, true), meta(payer.publicKey, true),
      meta(MINT), meta(dest, true), meta(TOKEN),
    ] });
  };
  const release = (nonce, authority, dest) => settle(nonce, false, authority, dest);
  const refund = (nonce, authority, dest) => settle(nonce, true, authority, dest);
  const signersFor = authority => (authority === payer ? [payer] : [payer, authority]);
  const balance = async key => (await token.getAccount(conn, key)).amount;
  const balances = async () => [await balance(source.publicKey), await balance(recipient.publicKey)];
  async function rejected(ix, signers = [payer]) {
    const before = await balances();
    await assert.rejects(send([ix], signers));
    assert.deepEqual(await balances(), before);
  }
  const closed = async nonce => {
    assert.equal(await conn.getAccountInfo(vaultPda(escrowPda(nonce))), null);
    assert.equal(await conn.getAccountInfo(escrowPda(nonce)), null);
  };
  const createdSlotOf = async nonce => Number((await conn.getAccountInfo(escrowPda(nonce))).data.readBigUInt64LE(193));
  async function tokenAccount(keypair, mint, owner) {
    return send([
      SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: keypair.publicKey,
        lamports: await conn.getMinimumBalanceForRentExemption(token.ACCOUNT_SIZE), space: token.ACCOUNT_SIZE, programId: TOKEN }),
      token.createInitializeAccount3Instruction(keypair.publicKey, mint, owner, TOKEN),
    ], [payer, keypair]);
  }
  // Writes the named accounts exactly as the validator reports them, for --account-dir.
  async function snapshot(name, keys) {
    const accounts = await conn.getMultipleAccountsInfo(keys);
    // Preserve u64 rentEpoch exactly. Parsing it through web3.js/JS Number can
    // round u64::MAX beyond the validator JSON account loader's accepted range.
    const response = await fetch(rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getMultipleAccounts',
        params: [keys.map(key => key.toBase58()), { encoding: 'base64', commitment: 'finalized' }] }) });
    const lossless = JSON.parse(await response.text(), (key, value, context) =>
      key === 'rentEpoch' ? JSON.rawJSON(context.source) : value);
    assert(!lossless.error, JSON.stringify(lossless.error));
    const snapshotDir = path.join(dir, name);
    fs.mkdirSync(snapshotDir);
    const hashes = {};
    for (let i = 0; i < keys.length; i++) {
      assert(accounts[i], 'snapshot account must exist');
      const pubkey = keys[i].toBase58();
      const dump = { pubkey, account: lossless.result.value[i] };
      assert(dump.account, 'lossless snapshot account must exist');
      assert.deepEqual(Buffer.from(dump.account.data[0], 'base64'), accounts[i].data);
      const serialized = JSON.stringify(dump);
      hashes[pubkey] = createHash('sha256').update(serialized).digest('hex');
      fs.writeFileSync(path.join(snapshotDir, `${pubkey}.json`), serialized, { mode: 0o600 });
    }
    return { snapshotDir, keys, accounts, hashes };
  }
  async function reload(phase, shot, warp) {
    await stop();
    await start(phase, shot.snapshotDir, warp);
    const reloaded = await conn.getMultipleAccountsInfo(shot.keys);
    for (let i = 0; i < shot.keys.length; i++) {
      assert(reloaded[i], 'reloaded snapshot account must exist');
      assert.deepEqual(reloaded[i].data, shot.accounts[i].data, 'snapshot data must be byte-identical');
      assert(reloaded[i].owner.equals(shot.accounts[i].owner));
      assert.equal(reloaded[i].lamports, shot.accounts[i].lamports);
    }
  }
  const signatures = [];
  try {
    await start('main');
    const installed = token.unpackMint(MINT, await conn.getAccountInfo(MINT), TOKEN);
    assert(installed.mintAuthority.equals(payer.publicKey) && installed.decimals === 6, 'stand-in mint not installed as written');
    signatures.push(await tokenAccount(source, MINT, payer.publicKey));
    signatures.push(await tokenAccount(recipient, MINT, payee.publicKey));
    signatures.push(await send([token.createMintToInstruction(MINT, source.publicKey, payer.publicKey, 200_000_000n)]));

    // Lock refusals: zero amount, above the 100-unit cap, and a mint that is not allowlisted (RAP-LANE-S2).
    await rejected(lock(nonces.release, 0));
    await rejected(lock(nonces.release, 100_000_001));
    const otherMint = Keypair.generate(), otherSource = Keypair.generate(), otherRecipient = Keypair.generate();
    await send([
      SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: otherMint.publicKey,
        lamports: await conn.getMinimumBalanceForRentExemption(token.MINT_SIZE), space: token.MINT_SIZE, programId: TOKEN }),
      token.createInitializeMint2Instruction(otherMint.publicKey, 6, payer.publicKey, null, TOKEN),
    ], [payer, otherMint]);
    await tokenAccount(otherSource, otherMint.publicKey, payer.publicKey);
    await tokenAccount(otherRecipient, otherMint.publicKey, payee.publicKey);
    await send([token.createMintToInstruction(otherMint.publicKey, otherSource.publicKey, payer.publicKey, 1_000_000n)]);
    await rejected(lock(nonces.release, 400_000, { mint: otherMint.publicKey, source: otherSource.publicKey, recipient: otherRecipient.publicKey }));
    assert.equal(await balance(otherSource.publicKey), 1_000_000n);
    assert.equal(await conn.getAccountInfo(escrowPda(nonces.release)), null);

    // Payer release to the recorded recipient.
    signatures.push(await send([lock(nonces.release, 400_000)]));
    assert.deepEqual(await balances(), [199_600_000n, 0n]);
    assert.equal(await balance(vaultPda(escrowPda(nonces.release))), 400_000n);
    await rejected(release(nonces.release, attacker), signersFor(attacker));
    await rejected(release(nonces.release, payee), signersFor(payee)); // payee claim before the claim window
    await rejected(release(nonces.release, payer, source.publicKey));
    signatures.push(await send([release(nonces.release, payer)]));
    assert.deepEqual(await balances(), [199_600_000n, 400_000n]);
    await closed(nonces.release);
    await rejected(release(nonces.release, payer)); // replay

    // Payee decline at any time, back to the recorded source only.
    signatures.push(await send([lock(nonces.decline, 200_000)]));
    assert.deepEqual(await balances(), [199_400_000n, 400_000n]);
    await rejected(refund(nonces.decline, attacker), signersFor(attacker));
    await rejected(refund(nonces.decline, payer)); // payer refund before the cancel window
    await rejected(refund(nonces.decline, payee, recipient.publicKey), signersFor(payee));
    signatures.push(await send([refund(nonces.decline, payee)], signersFor(payee)));
    assert.deepEqual(await balances(), [199_600_000n, 400_000n]);
    await closed(nonces.decline);
    await rejected(refund(nonces.decline, payee), signersFor(payee)); // replay

    // Two escrows for the time-gated cases.
    signatures.push(await send([lock(nonces.refund, 150_000)]));
    signatures.push(await send([lock(nonces.claim, 100_000)]));
    assert.deepEqual(await balances(), [199_350_000n, 400_000n]);
    const refundCreatedSlot = await createdSlotOf(nonces.refund), claimCreatedSlot = await createdSlotOf(nonces.claim);
    const lastCreatedSlot = Math.max(refundCreatedSlot, claimCreatedSlot);
    const refundSlot = lastCreatedSlot + CANCEL_WINDOW_SLOTS, claimSlot = claimCreatedSlot + CLAIM_WINDOW_SLOTS;
    const tokenKeys = [MINT, source.publicKey, recipient.publicKey];
    const lockedShot = await snapshot('locked-account-snapshot', [...tokenKeys,
      escrowPda(nonces.refund), vaultPda(escrowPda(nonces.refund)), escrowPda(nonces.claim), vaultPda(escrowPda(nonces.claim))]);

    // Past the cancel window, before the claim window: the payer refunds, the payee still cannot claim.
    await reload('refund', lockedShot, refundSlot + 100);
    assert((await conn.getSlot('confirmed')) < claimSlot, 'refund phase must run before the claim window');
    await rejected(refund(nonces.refund, attacker), signersFor(attacker));
    await rejected(release(nonces.claim, payee), signersFor(payee));
    signatures.push(await send([refund(nonces.refund, payer)]));
    assert.deepEqual(await balances(), [199_500_000n, 400_000n]);
    await closed(nonces.refund);
    await rejected(refund(nonces.refund, payer)); // replay
    await rejected(release(nonces.refund, payer));
    const claimShot = await snapshot('claim-account-snapshot', [...tokenKeys, escrowPda(nonces.claim), vaultPda(escrowPda(nonces.claim))]);

    // Past the claim window: a stranger is still refused, the payee claims to the recorded recipient.
    await reload('claim', claimShot, claimSlot + 100);
    await rejected(release(nonces.claim, attacker), signersFor(attacker));
    await rejected(release(nonces.claim, payee, source.publicKey), signersFor(payee));
    signatures.push(await send([release(nonces.claim, payee)], signersFor(payee)));
    assert.deepEqual(await balances(), [199_500_000n, 500_000n]);
    await closed(nonces.claim);
    await rejected(release(nonces.claim, payee), signersFor(payee)); // replay
    await rejected(refund(nonces.claim, payer));

    const evidence = { label: 'LOCAL STAND-IN MINT at the allowlisted USDC address; not real USDC; no devnet or mainnet proof', validator: version, rpc,
      mint: MINT.toBase58(), mintAuthority: 'in-memory test payer', tokenProgram: TOKEN.toBase58(), decimals: 6,
      escrowElfSha256, cancelWindowSlots: CANCEL_WINDOW_SLOTS, claimWindowSlots: CLAIM_WINDOW_SLOTS,
      refundCreatedSlot, claimCreatedSlot, refundSlot, claimSlot,
      snapshotHashes: { locked: lockedShot.hashes, claim: claimShot.hashes },
      method: 'normal-slot local validator for lock, release and decline; byte-identical public-account snapshots reloaded into fresh local validators with a slot warp for payer refund and payee claim',
      program: PROGRAM.toBase58(), signatures, sourceBalance: '199500000', recipientBalance: '500000',
      checks: ['zero, above-cap and non-allowlisted locks refused', 'exact lock', 'payer release to the recorded recipient',
        'payee decline to the recorded source', 'payer refund refused before and allowed after the cancel window',
        'payee claim refused before and allowed after the claim window', 'stranger refused on every path',
        'closed escrow records and vaults', 'replay rejection'] };
    fs.writeFileSync(path.join(dir, 'result.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(JSON.stringify(evidence, null, 2));
  } finally { await stop(); }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
