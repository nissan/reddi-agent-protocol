#!/usr/bin/env node
// Helpers for scripts/rehearse-mainnet-deploy.sh. Read-only: never signs, never
// reads a keypair, prints only RPC hosts.
//
//   verify-file --record <record> --so <pinocchio_escrow.so>
//       size, sha256 and executable hash of the file against the release record.
//   mints
//       the four mainnet escrow mints as "<symbol> <mint> <token program>" lines
//       (needs packages/x402-solana built).
//   check --record <record> --url <local rpc> --program-id <rehearsal id> --deployer <address>
//       the deployment check of scripts/check-escrow-deployment.mjs against a local
//       validator standing in for mainnet: same record, with the rehearsal's
//       throwaway program id and deployer in place of the real ones.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  GENESIS, base58Encode, checkDeployment, isAddress, readAccount, readDeployerBuffers, rpc, trimmedHash,
} from './check-escrow-deployment.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function need(name) {
  const value = arg(name);
  if (!value) {
    console.error(`--${name} is required`);
    process.exit(2);
  }
  return value;
}

const readRecord = () => JSON.parse(readFileSync(need('record'), 'utf8'));
const hostOf = (url) => { try { return new URL(url).host; } catch { return 'invalid url'; } };

function verifyFile() {
  const record = readRecord();
  const bytes = new Uint8Array(readFileSync(need('so')));
  const sha = createHash('sha256').update(bytes).digest('hex');
  const exec = trimmedHash(bytes);
  const lines = [
    ['size', bytes.length === record.size, `${bytes.length} bytes, record says ${record.size}`],
    ['sha256', sha === record.sha256, sha === record.sha256 ? `matches ${record.sha256}` : `${sha}, record says ${record.sha256}`],
    ['executable hash', exec === record.executableHash, exec === record.executableHash ? `matches ${record.executableHash}` : `${exec}, record says ${record.executableHash}`],
  ];
  for (const [name, ok, detail] of lines) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`);
  return lines.every(([, ok]) => ok) ? 0 : 1;
}

function mints() {
  const require = createRequire(path.join(root, 'packages/x402-solana/package.json'));
  const { ESCROW_MAINNET_MINTS } = require(path.join(root, 'packages/x402-solana/dist/index.js'));
  for (const m of ESCROW_MAINNET_MINTS) console.log(`${m.symbol} ${m.mint.toBase58()} ${m.tokenProgram.toBase58()}`);
  return 0;
}

async function check() {
  const record = readRecord();
  const url = need('url');
  const programId = need('program-id');
  const deployer = need('deployer');
  if (!isAddress(programId) || !isAddress(deployer)) {
    console.error('--program-id and --deployer must be addresses');
    return 2;
  }
  const host = hostOf(url);
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
    console.error(`Refusing: the rehearsal check runs only against a local validator, not ${host}.`);
    return 2;
  }
  const rehearsal = {
    ...record,
    programId,
    forbiddenAuthorities: [...(record.forbiddenAuthorities ?? []), deployer],
  };
  const localGenesis = await rpc(url, 'getGenesisHash', []);
  const program = await readAccount(url, programId);
  const programData = program && program.data.length === 36
    ? await readAccount(url, base58Encode(program.data.subarray(4, 36)))
    : null;
  const buffers = await readDeployerBuffers(url, deployer);
  // The local validator has its own genesis; every other line is the real check.
  const result = checkDeployment(rehearsal, { genesisHash: GENESIS[record.network], program, programData, buffers });
  result.items[0].detail = `local validator ${localGenesis.slice(0, 8)}… standing in for ${record.network} (rehearsal)`;
  console.log(`Rehearsal of the ${record.network} deployment check (RPC ${host}): ${programId}`);
  for (const item of result.items) console.log(`${item.ok ? 'ok  ' : 'FAIL'} ${item.name}: ${item.detail}`);
  if (programData) console.log(`info program data account holds ${programData.data.length - 45} program bytes`);
  return result.ok ? 0 : 1;
}

const command = process.argv[2];
const run = { 'verify-file': verifyFile, mints, check }[command];
if (!run) {
  console.error('Usage: node scripts/rehearse-escrow-deployment.mjs verify-file|mints|check [options]');
  process.exit(2);
}
process.exit(await run());
