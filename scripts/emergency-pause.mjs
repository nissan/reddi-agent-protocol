#!/usr/bin/env node
// Emergency pause of the Reddi Agent Protocol program (docs/EMERGENCY-PAUSE-RUNBOOK.md).
//
//   (cd packages/x402-solana && npm ci && npm run build)
//
//   node scripts/emergency-pause.mjs status [--network mainnet|devnet] [--url <rpc>] [--json]
//       Read-only. Prints whether the program is paused, until which slot, and the guardian.
//
//   node scripts/emergency-pause.mjs pause --keypair <guardian keypair file> [--network ...] [--url <rpc>] [--yes]
//       The guardian pauses for about 7 days. Prints the plan and asks first unless --yes.
//       The keypair file is read only to sign; it is never printed.
//
//   node scripts/emergency-pause.mjs vault-ix <init|pause|unpause|set-guardian> [--guardian <address>] [--network ...]
//       Prints one instruction for the Squads vault to propose (program, accounts, data in
//       hex and base58). Signs and sends nothing.
//
//   node scripts/emergency-pause.mjs devnet-admin <init|pause|unpause|set-guardian> --keypair <devnet admin keypair> [--guardian <address>] [--yes]
//       Devnet drills only: signs the same instruction with the devnet admin key
//       (hbr2Fee…tt, the devnet build's PAUSE_ADMIN) and sends it. Refused on mainnet,
//       where only the Squads vault can act.
//
// RPC: --url, else SOLANA_RPC_URL, else the network profile's public RPC. Only the
// host is printed, so a keyed URL stays out of logs.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'packages/x402-solana/package.json'));
const web3 = require('@solana/web3.js');
const { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } = web3;
const { pauseAddress, readPauseStatus, decodePauseState, PAUSE_SLOTS } = require(path.join(root, 'packages/x402-solana/dist/pause.js'));

const PROGRAM_ID = new PublicKey('DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu');
const ADMIN = {
  mainnet: new PublicKey('5CsBuTBFKu12JSs4CUbmv5MR218RYtNmAoQmLf5x3Hxe'),
  devnet: new PublicKey('hbr2Fee3ewDbm33wTDrdEF3e7byNCzNgQ57CwJWaPtt'),
};
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name) => process.argv.includes(`--${name}`);

function base58(bytes) {
  let n = BigInt(`0x${Buffer.from(bytes).toString('hex') || '0'}`);
  let out = '';
  while (n > 0n) {
    out = BASE58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

const selector = (name) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);

const command = process.argv[2];
const network = arg('network') ?? 'mainnet';
if (network !== 'mainnet' && network !== 'devnet') {
  console.error('--network must be mainnet or devnet');
  process.exit(2);
}
const profile = JSON.parse(readFileSync(path.join(root, `config/networks/${network}.json`), 'utf8'));
const url = arg('url') ?? process.env.SOLANA_RPC_URL ?? profile.solana.rpcHttp;
const host = (() => { try { return new URL(url).host; } catch { return 'invalid url'; } })();
const admin = ADMIN[network];
const pause = pauseAddress(PROGRAM_ID);

function instruction(name, guardian) {
  switch (name) {
    case 'init': {
      if (!guardian) throw new Error('init needs --guardian <address>');
      return new TransactionInstruction({
        programId: PROGRAM_ID,
        data: Buffer.concat([selector('init_pause'), guardian.toBuffer()]),
        keys: [
          { pubkey: pause, isSigner: false, isWritable: true },
          { pubkey: admin, isSigner: true, isWritable: false },
          { pubkey: admin, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
      });
    }
    case 'pause':
    case 'unpause':
      return new TransactionInstruction({
        programId: PROGRAM_ID,
        data: selector(name),
        keys: [
          { pubkey: pause, isSigner: false, isWritable: true },
          { pubkey: admin, isSigner: true, isWritable: false },
        ],
      });
    case 'set-guardian': {
      if (!guardian) throw new Error('set-guardian needs --guardian <address>');
      return new TransactionInstruction({
        programId: PROGRAM_ID,
        data: Buffer.concat([selector('set_guardian'), guardian.toBuffer()]),
        keys: [
          { pubkey: pause, isSigner: false, isWritable: true },
          { pubkey: admin, isSigner: true, isWritable: false },
        ],
      });
    }
    default:
      throw new Error('vault-ix takes init, pause, unpause or set-guardian');
  }
}

async function status() {
  const connection = new Connection(url, 'confirmed');
  const s = await readPauseStatus(connection, PROGRAM_ID);
  let guardian = null;
  if (!s.missing) {
    const info = await connection.getAccountInfo(pause, 'confirmed');
    guardian = decodePauseState(info.data).guardian.toBase58();
  }
  const out = {
    network,
    rpcHost: host,
    pauseAccount: pause.toBase58(),
    created: !s.missing,
    paused: s.missing ? null : s.paused,
    pausedUntilSlot: s.pausedUntilSlot.toString(),
    currentSlot: s.slot.toString(),
    slotsLeft: s.paused && !s.missing ? (s.pausedUntilSlot - s.slot).toString() : '0',
    guardian,
  };
  if (flag('json')) {
    console.log(JSON.stringify(out, null, 2));
  } else if (s.missing) {
    console.log(`${network} (${host}): the pause account ${out.pauseAccount} does not exist yet. A build with the pause refuses locks and payouts until the admin runs init_pause.`);
  } else {
    console.log(`${network} (${host}): ${s.paused ? `PAUSED until slot ${out.pausedUntilSlot} (about ${Math.round(Number(out.slotsLeft) * 0.4 / 3600)} h left)` : 'not paused'}; guardian ${guardian}; current slot ${out.currentSlot}`);
  }
}

async function guardianPause() {
  const file = arg('keypair');
  if (!file) throw new Error('pause needs --keypair <guardian keypair file>');
  const guardian = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, 'utf8'))));
  const connection = new Connection(url, 'confirmed');
  const s = await readPauseStatus(connection, PROGRAM_ID);
  if (s.missing) throw new Error('the pause account does not exist: nothing to pause');
  const state = decodePauseState((await connection.getAccountInfo(pause, 'confirmed')).data);
  if (!state.guardian.equals(guardian.publicKey)) throw new Error(`this key ${guardian.publicKey.toBase58()} is not the guardian (${state.guardian.toBase58()})`);
  if (s.paused) {
    console.log(`already paused until slot ${s.pausedUntilSlot}; only the vault can extend it`);
    return;
  }
  console.log(`Pausing ${network} (${host}) for ${PAUSE_SLOTS} slots (about 7 days) as guardian ${guardian.publicKey.toBase58()}.`);
  if (!flag('yes')) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('Type PAUSE to send: ');
    rl.close();
    if (answer.trim() !== 'PAUSE') {
      console.log('not sent');
      return;
    }
  }
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    data: selector('pause'),
    keys: [
      { pubkey: pause, isSigner: false, isWritable: true },
      { pubkey: guardian.publicKey, isSigner: true, isWritable: false },
    ],
  });
  const signature = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [guardian], { commitment: 'confirmed' });
  console.log(`paused: ${signature}`);
  await status();
}

function vaultIx() {
  const name = process.argv[3];
  const guardian = arg('guardian') ? new PublicKey(arg('guardian')) : undefined;
  const ix = instruction(name, guardian);
  const out = {
    network,
    note: network === 'mainnet'
      ? `Propose as a Squads vault transaction from vault ${admin.toBase58()}. Signs and sends nothing.`
      : `The devnet admin ${admin.toBase58()} signs this (devnet-admin sends it). Signs and sends nothing.`,
    programId: ix.programId.toBase58(),
    accounts: ix.keys.map((k) => ({ address: k.pubkey.toBase58(), signer: k.isSigner, writable: k.isWritable })),
    dataHex: Buffer.from(ix.data).toString('hex'),
    dataBase58: base58(ix.data),
  };
  console.log(JSON.stringify(out, null, 2));
}

async function devnetAdmin() {
  if (network !== 'devnet') throw new Error('devnet-admin is for devnet drills; on mainnet propose vault-ix through Squads');
  const name = process.argv[3];
  const file = arg('keypair');
  if (!file) throw new Error('devnet-admin needs --keypair <devnet admin keypair file>');
  const signer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, 'utf8'))));
  if (!signer.publicKey.equals(admin)) throw new Error(`this key ${signer.publicKey.toBase58()} is not the devnet admin (${admin.toBase58()})`);
  const ix = instruction(name, arg('guardian') ? new PublicKey(arg('guardian')) : undefined);
  console.log(`Sending ${name} on devnet (${host}) as admin ${admin.toBase58()}.`);
  if (!flag('yes')) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Type ${name.toUpperCase()} to send: `);
    rl.close();
    if (answer.trim() !== name.toUpperCase()) {
      console.log('not sent');
      return;
    }
  }
  const connection = new Connection(url, 'confirmed');
  const signature = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [signer], { commitment: 'confirmed' });
  console.log(`${name}: ${signature}`);
  await status();
}

try {
  if (command === 'status') await status();
  else if (command === 'devnet-admin') await devnetAdmin();
  else if (command === 'pause') await guardianPause();
  else if (command === 'vault-ix') vaultIx();
  else {
    console.error('usage: emergency-pause.mjs status | pause --keypair <file> | vault-ix <init|pause|unpause|set-guardian> [--guardian <address>] | devnet-admin <init|pause|unpause|set-guardian> --keypair <file> --network devnet');
    process.exit(2);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
