#!/usr/bin/env node
// Read-only watch on the allowlisted Token-2022 mints (PYUSD, USDG).
//
// The issuer (Paxos) can switch on a transfer hook, raise the transfer fee,
// freeze accounts or move funds with the permanent delegate. A hook or a fee
// change can stall escrows in that mint. This compares each live mint with the
// posture recorded in config/escrow/token2022-mint-posture.json and exits 1 on
// any change, 2 when the RPC cannot be read. It signs and sends nothing.
//
//   (cd packages/x402-solana && npm ci && npm run build)
//   node scripts/check-token2022-mint-posture.mjs [--url <rpc>] [--json]
//
// RPC: --url, else SOLANA_RPC_URL, else the public mainnet RPC.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'packages/x402-solana/package.json'));
const { Connection, PublicKey } = require('@solana/web3.js');
const { token2022MintPosture, mintPostureChanges } = require(path.join(root, 'packages/x402-solana/dist/index.js'));

const i = process.argv.indexOf('--url');
const url = (i === -1 ? undefined : process.argv[i + 1]) ?? process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
const host = (() => { try { return new URL(url).host; } catch { return 'invalid url'; } })();
const recorded = JSON.parse(readFileSync(path.join(root, 'config/escrow/token2022-mint-posture.json'), 'utf8'));
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

const connection = new Connection(url, 'finalized');
const report = [];
try {
  for (const [symbol, entry] of Object.entries(recorded.mints)) {
    const address = new PublicKey(entry.address);
    const info = await connection.getAccountInfo(address, 'finalized');
    if (!info) { report.push({ symbol, address: entry.address, changes: ['mint account not found'] }); continue; }
    if (info.owner.toBase58() !== TOKEN_2022) { report.push({ symbol, address: entry.address, changes: [`owner is ${info.owner.toBase58()}`] }); continue; }
    report.push({ symbol, address: entry.address, changes: mintPostureChanges(entry.posture, token2022MintPosture(info.data, address)) });
  }
} catch (error) {
  console.error(`Could not read the mints from ${host}: ${error instanceof Error ? error.message.split('\n')[0] : 'unknown error'}. Nothing was checked.`);
  process.exit(2);
}

const changed = report.some((r) => r.changes.length > 0);
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ rpcHost: host, changed, report }, null, 2));
} else {
  console.log(`Token-2022 mint posture (RPC ${host})`);
  for (const r of report) {
    console.log(`${r.changes.length ? 'CHANGED' : 'same   '} ${r.symbol} ${r.address}`);
    for (const c of r.changes) console.log(`        ${c}`);
  }
  if (changed) console.log('An issuer changed a mint the escrow accepts. Re-assess escrow risk before updating config/escrow/token2022-mint-posture.json.');
}
process.exit(changed ? 1 : 0);
