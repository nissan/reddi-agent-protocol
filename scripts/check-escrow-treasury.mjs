#!/usr/bin/env node
// Read-only launch check for the V1 escrow treasury (the Squads vault).
//
// Before the first payout on a network, the treasury must hold at least
// 0.001 SOL, or a SOL fee below the rent-exempt minimum fails, and it must
// have a token account for every allowlisted mint, or every token release,
// claim and settle in that mint fails. This script only reads accounts; it
// signs and sends nothing. Exit code 0 means ready, 1 means not ready.
//
//   (cd packages/x402-solana && npm ci && npm run build)
//   node scripts/check-escrow-treasury.mjs --network mainnet [--url <rpc>] [--json]
//
// RPC: --url, else SOLANA_RPC_URL, else the network profile's public RPC.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// web3.js from the x402-solana package's install, so a CI job only needs that one install.
const require = createRequire(path.join(root, 'packages/x402-solana/package.json'));
const { Connection } = require('@solana/web3.js');
const { checkTreasuryReadiness, ESCROW_MAINNET_MINTS, ESCROW_DEVNET_MINTS } = require(path.join(root, 'packages/x402-solana/dist/index.js'));

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const network = arg('network') ?? 'mainnet';
if (network !== 'mainnet' && network !== 'devnet') {
  console.error('--network must be mainnet or devnet');
  process.exit(2);
}
const profile = JSON.parse(readFileSync(path.join(root, `config/networks/${network}.json`), 'utf8'));
const url = arg('url') ?? process.env.SOLANA_RPC_URL ?? profile.solana.rpcHttp;
const host = (() => { try { return new URL(url).host; } catch { return 'invalid url'; } })();
const mints = network === 'mainnet' ? ESCROW_MAINNET_MINTS : ESCROW_DEVNET_MINTS;

const connection = new Connection(url, 'confirmed');
const lookup = async (address) => {
  const info = await connection.getAccountInfo(address, 'confirmed');
  return info ? { lamports: info.lamports, owner: info.owner, data: info.data } : null;
};

let result;
try {
  result = await checkTreasuryReadiness(lookup, mints);
} catch (error) {
  console.error(`Could not read accounts from ${host}: ${error instanceof Error ? error.message.split('\n')[0] : 'unknown error'}. Nothing was checked.`);
  process.exit(2);
}
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ network, rpcHost: host, ...result }, null, 2));
} else {
  // Only the host is printed, so a keyed RPC URL never reaches a log.
  console.log(`Escrow treasury readiness on ${network} (RPC ${host})`);
  for (const item of result.items) console.log(`${item.ok ? 'ok  ' : 'FAIL'} ${item.name} ${item.address}: ${item.detail}`);
  console.log(result.ok ? 'Ready for payouts.' : 'Not ready: fix the FAIL lines before the first lock on this network.');
}
process.exit(result.ok ? 0 : 1);
