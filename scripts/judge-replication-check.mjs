#!/usr/bin/env node
import { Connection, PublicKey } from '@solana/web3.js';

const RPC = process.env.DEMO_DEVNET_RPC || 'https://api.devnet.solana.com';
const connection = new Connection(RPC, 'confirmed');

const publicRoutes = [
  'https://app.agent-protocol.reddi.tech/',
  'https://app.agent-protocol.reddi.tech/setup',
  'https://app.agent-protocol.reddi.tech/agents',
  'https://app.agent-protocol.reddi.tech/register',
  'https://app.agent-protocol.reddi.tech/sandbox',
];

const txs = [
  ['Claude Code MCP x402 specialist receipt', '3oVM9kKqMME6J4sufvWRT5s6F1N9HcLnUGTDeLbxXQNyuAEkC7Nt4JxKs9aoxun7FVTCvzeS4Pwt2PqPMwF1oGGV'],
  ['Z-picture planning x402 payment', '2TwZD3kGTCLu3hbKa4ebkfPDVEtJbCqTcuCyw1JRENxfg9G7S4VNwDU5TKvXdnn1gHRemveoQHPdKt5B4rno8aGX'],
  ['Z-picture content x402 payment', '5eDbe4JAJwnpjncjDYKsja9hK5bUvK1gafxR5cp1JURLPP21x3Bim1NDfuHEJ6BugiEh2sUTRCXWWji8kF8j9no4'],
  ['Z-picture codegen x402 payment', 'kHcf2e9RFWKFFudBenGboffkty7eup58gp1v5FD3VKgVytV965PQpYtwwAeNarBNMEzuADcb6vTzYWKCNjGJknq'],
  ['Z-picture verification x402 payment', '3xgcj4A6Tq1vePakcDXsGZWh4symCFtdkm6Xd5A93xETDmXzfQMZGcirqPyGx3wMrGxE7h6jLMmxKqZDcWA38hDH'],
  ['CLI registration funding tx', '32yUENPMHQNQPCbcecbQForcbq4DzmE3AgZogykC8GQrmZ2bbUvPrz6UkNswo6p69v7RSJDwJRn2MdLPEc6FAijL'],
  ['CLI register_agent tx', 'fUip7uF6NcrFP9HZeVY1nVsP9XTn9feALhLHLY3uWWjyxVxWbJ3Fj2V5NNe44sc7HQ2X4GqqC5KvcvzXZeTy4PV'],
];

const registryProgram = new PublicKey('Xk7jczJZ1HHJZuE1ZUWDqFmowxYhnom7mWzrNSGf9FU');
const agentPda = new PublicKey('FVPc5cJvDfk7QH7B7aHxP5TKnswwYir57xmL6fRwm3DN');

let failures = 0;

async function checkRoutes() {
  console.log('\nPublic website routes');
  for (const url of publicRoutes) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      const ok = res.status >= 200 && res.status < 400;
      console.log(`${ok ? '✅' : '❌'} ${url} -> ${res.status}`);
      if (!ok) failures++;
    } catch (error) {
      console.log(`❌ ${url} -> ${error.message}`);
      failures++;
    }
  }
}

async function checkTxs() {
  console.log(`\nSolana devnet transactions via ${RPC}`);
  for (const [label, sig] of txs) {
    try {
      const tx = await connection.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
      const ok = Boolean(tx) && tx.meta?.err == null;
      const slot = tx?.slot ?? 'missing';
      console.log(`${ok ? '✅' : '❌'} ${label}: ${sig} slot=${slot} err=${JSON.stringify(tx?.meta?.err ?? null)}`);
      if (!ok) failures++;
    } catch (error) {
      console.log(`❌ ${label}: ${sig} -> ${error.message}`);
      failures++;
    }
  }
}

async function checkRegistrationPda() {
  console.log('\nCLI registration PDA readback');
  const account = await connection.getAccountInfo(agentPda, 'confirmed');
  if (!account) {
    console.log(`❌ agent PDA missing: ${agentPda.toBase58()}`);
    failures++;
    return;
  }
  const ownerOk = account.owner.equals(registryProgram);
  console.log(`${ownerOk ? '✅' : '❌'} agent PDA exists: ${agentPda.toBase58()}`);
  console.log(`${ownerOk ? '✅' : '❌'} owner program: ${account.owner.toBase58()}`);
  console.log(`   data bytes: ${account.data.length}`);
  console.log(`   lamports: ${account.lamports}`);
  if (!ownerOk) failures++;
}

await checkRoutes();
await checkTxs();
await checkRegistrationPda();

console.log(`\n${failures === 0 ? '✅ All public replication checks passed.' : `❌ ${failures} check(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
