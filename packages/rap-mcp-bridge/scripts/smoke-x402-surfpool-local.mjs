import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import {
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { SolanaReceiptVerifier, buildX402Challenge } from '@redditech/x402-solana';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, '');
const repoDir = join(packageDir, '..', '..');
const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const artifactDir = join(repoDir, 'artifacts', 'rap-mcp-bridge-x402-surfpool-local', timestamp);
mkdirSync(artifactDir, { recursive: true });

const surfpoolPort = Number(process.env.RAP_MCP_SURFPOOL_X402_PORT ?? 19221);
const surfpoolWsPort = Number(process.env.RAP_MCP_SURFPOOL_X402_WS_PORT ?? 19222);
const specialistPort = Number(process.env.RAP_MCP_SURFPOOL_X402_SPECIALIST_PORT ?? 19223);
const rpcUrl = `http://127.0.0.1:${surfpoolPort}`;
const endpoint = `http://127.0.0.1:${specialistPort}/v1/chat/completions`;
const amount = '0.05';
const amountMicroUnits = 50_000n;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRpc(connection) {
  let lastError;
  for (let i = 0; i < 80; i += 1) {
    try {
      await connection.getVersion();
      return;
    } catch (error) {
      lastError = error;
      await sleep(500);
    }
  }
  throw new Error(`surfpool_rpc_not_ready:${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function startSurfpool() {
  const logPath = join(artifactDir, 'surfpool.log');
  const child = spawn('surfpool', [
    'start', '--ci', '--legacy-anchor-compatibility', '-y', '--offline',
    '--port', String(surfpoolPort), '--ws-port', String(surfpoolWsPort), '--no-studio', '--no-tui', '--log-level', 'info',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks = [];
  child.stdout.on('data', (chunk) => chunks.push(chunk));
  child.stderr.on('data', (chunk) => chunks.push(chunk));
  child.on('close', () => writeFileSync(logPath, Buffer.concat(chunks)));
  return { child, logPath };
}

async function confirmAirdrop(connection, publicKey, lamports) {
  const signature = await connection.requestAirdrop(publicKey, lamports);
  const latest = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature, ...latest }, 'confirmed');
  return signature;
}

async function sendTx(connection, payer, instructions, signers = []) {
  const { Transaction, sendAndConfirmTransaction } = await import('@solana/web3.js');
  const tx = new Transaction().add(...instructions);
  return sendAndConfirmTransaction(connection, tx, [payer, ...signers], { commitment: 'confirmed' });
}

async function createLocalUsdcMintAndFundPayer(connection, payer, payee) {
  const mint = Keypair.generate();
  const rent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  const payerAta = getAssociatedTokenAddressSync(mint.publicKey, payer.publicKey);
  const payeeAta = getAssociatedTokenAddressSync(mint.publicKey, payee.publicKey);
  await sendTx(connection, payer, [
    (await import('@solana/web3.js')).SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint.publicKey,
      space: MINT_SIZE,
      lamports: rent,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(mint.publicKey, 6, payer.publicKey, null),
    createAssociatedTokenAccountInstruction(payer.publicKey, payerAta, payer.publicKey, mint.publicKey),
    createAssociatedTokenAccountInstruction(payer.publicKey, payeeAta, payee.publicKey, mint.publicKey),
    createMintToInstruction(mint.publicKey, payerAta, payer.publicKey, 100_000n),
  ], [mint]);
  return { mint: mint.publicKey, payerAta, payeeAta };
}

function readRequest(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function startLocalSpecialist({ connection, challenge, mint }) {
  const verifier = new SolanaReceiptVerifier({ allowRealPayment: true, connection, usdcMint: mint.toBase58() });
  const calls = [];
  const server = createServer(async (req, res) => {
    const body = await readRequest(req);
    calls.push({ url: req.url, hasPayment: Boolean(req.headers['x402-payment']), bodyLength: body.length });
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404).end('not found');
      return;
    }
    const paymentHeader = req.headers['x402-payment'];
    if (!paymentHeader) {
      res.writeHead(402, { 'content-type': 'application/json', 'x402-request': JSON.stringify(challenge) });
      res.end(JSON.stringify({ error: 'payment_required', x402: challenge }));
      return;
    }
    const verification = await verifier.verifyReceipt(JSON.parse(String(paymentHeader)), challenge);
    if (!verification.ok) {
      res.writeHead(402, { 'content-type': 'application/json', 'x402-request': JSON.stringify(challenge) });
      res.end(JSON.stringify({ error: 'invalid_payment', verification }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ answer: 'local surfpool specialist completed after verified x402 payment', verification: { ok: true, boundary: 'surfpool-local-validator' } }));
  });
  await new Promise((resolve) => server.listen(specialistPort, '127.0.0.1', resolve));
  return { server, calls };
}

const tmp = mkdtempSync(join(tmpdir(), 'rap-mcp-x402-surfpool-local-'));
const surfpool = startSurfpool();
let specialistServer;
const client = new Client({ name: 'rap-mcp-x402-surfpool-local-smoke', version: '0.1.0' });
try {
  const connection = new Connection(rpcUrl, 'confirmed');
  await waitForRpc(connection);

  const payer = Keypair.generate();
  const payee = Keypair.generate();
  await confirmAirdrop(connection, payer.publicKey, LAMPORTS_PER_SOL);
  const { mint, payerAta, payeeAta } = await createLocalUsdcMintAndFundPayer(connection, payer, payee);
  const walletPath = join(tmp, 'payer-wallet.json');
  writeFileSync(walletPath, JSON.stringify(Array.from(payer.secretKey)), { mode: 0o600 });

  const challenge = buildX402Challenge({
    version: '1',
    network: 'solana-devnet',
    payTo: payee.publicKey.toBase58(),
    amount,
    currency: 'USDC',
    endpoint,
    nonce: `surfpool-local-${timestamp}`,
    memo: 'RAP MCP x402 Surfpool local proof before devnet funding',
  });
  specialistServer = await startLocalSpecialist({ connection, challenge, mint });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['dist/src/server.js'],
    cwd: packageDir,
    env: {
      ...process.env,
      REDDI_RAP_MCP_MODE: 'devnet',
      REDDI_MCP_STORE_DIR: join(tmp, 'store'),
      RAP_MCP_DEVNET_PROOF_APPROVED: '1',
      RAP_MCP_ALLOW_SPECIALIST_INVOKE: '1',
      RAP_MCP_DEVNET_WALLET_KEYPAIR: walletPath,
      RAP_MCP_DEVNET_RPC_URL: rpcUrl,
      RAP_MCP_DEVNET_USDC_MINT: mint.toBase58(),
      RAP_MCP_SPECIALIST_ENDPOINT_ALLOWLIST: endpoint,
      RAP_MCP_DEVNET_MAX_USDC_MICRO_UNITS: '60000',
    },
    stderr: 'pipe',
  });
  await client.connect(transport);

  const parseToolJson = (result, label) => {
    const text = result.content?.[0]?.text;
    try { return JSON.parse(text); } catch { throw new Error(`${label} returned non-JSON: ${text}`); }
  };

  const tools = await client.listTools();
  const names = tools.tools.map((tool) => tool.name).sort();
  for (const name of ['reddi.execute_x402_specialist_call', 'reddi.verify_x402_specialist_receipt', 'reddi.export_disclosure_ledger']) {
    if (!names.includes(name)) throw new Error(`missing MCP tool: ${name}`);
  }

  const execute = parseToolJson(await client.callTool({
    name: 'reddi.execute_x402_specialist_call',
    arguments: {
      endpoint,
      body: { messages: [{ role: 'user', content: 'Produce a one-line local Surfpool proof answer.' }] },
      idempotencyKey: `surfpool-local-x402-${timestamp}`,
      maxUsdcMicroUnits: 60_000,
      approvalPhrase: 'EXECUTE_DEVNET_X402_SPECIALIST_CALL',
    },
  }), 'execute_x402_specialist_call');
  if (execute.response?.status !== 200) throw new Error(`paid retry did not complete: ${JSON.stringify(execute.response)}`);

  const verify = parseToolJson(await client.callTool({
    name: 'reddi.verify_x402_specialist_receipt',
    arguments: { receiptId: execute.receiptId },
  }), 'verify_x402_specialist_receipt');
  if (verify.verified !== true) throw new Error(`MCP receipt verification failed: ${JSON.stringify(verify)}`);

  const ledger = parseToolJson(await client.callTool({
    name: 'reddi.export_disclosure_ledger',
    arguments: { x402ReceiptIds: [execute.receiptId] },
  }), 'export_disclosure_ledger');
  if (ledger.entries?.length !== 1) throw new Error(`ledger entry missing: ${JSON.stringify(ledger)}`);

  const payerBalance = await connection.getTokenAccountBalance(payerAta, 'confirmed');
  const payeeBalance = await connection.getTokenAccountBalance(payeeAta, 'confirmed');
  if (BigInt(payeeBalance.value.amount) !== amountMicroUnits) throw new Error(`payee token balance mismatch:${payeeBalance.value.amount}`);

  const summary = {
    ok: true,
    schemaVersion: 'reddi.rap-mcp-bridge.x402-surfpool-local-smoke.v1',
    generatedAt: new Date().toISOString(),
    boundary: 'surfpool_local_validator_only_no_devnet_no_mainnet',
    rpcUrl,
    endpoint,
    tools: names.filter((name) => name.includes('x402_specialist') || name === 'reddi.export_disclosure_ledger'),
    mint: mint.toBase58(),
    payer: payer.publicKey.toBase58(),
    payee: payee.publicKey.toBase58(),
    payerTokenAccount: payerAta.toBase58(),
    payeeTokenAccount: payeeAta.toBase58(),
    spend: { amount, amountMicroUnits: String(amountMicroUnits), maxUsdcMicroUnits: '60000', capRespected: true },
    receiptId: execute.receiptId,
    signature: execute.paymentReceipt?.signature ?? execute.paymentReceipt?.txSignature,
    specialistCalls: specialistServer.calls,
    balances: { payerMicroUnits: payerBalance.value.amount, payeeMicroUnits: payeeBalance.value.amount },
    verification: { mcpReceiptVerified: verify.verified, specialistHttpCompletion: execute.verification?.specialistHttpCompletion, mainnetSettlement: verify.mainnetSettlement },
    ledgerEntryCount: ledger.entries.length,
    nextGate: 'bounded_devnet_treasury_funding_for_demo_wallets',
    guardrails: ['local Surfpool validator only', 'local specialist HTTP server only', 'no devnet mutation', 'no mainnet path', 'no private key material in artifact'],
  };
  const jsonPath = join(artifactDir, 'summary.json');
  const mdPath = join(artifactDir, 'SUMMARY.md');
  writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(mdPath, `# RAP MCP x402 Surfpool Local Smoke\n\n- Boundary: ${summary.boundary}\n- MCP receipt verified: ${summary.verification.mcpReceiptVerified}\n- Specialist paid retry: ${summary.verification.specialistHttpCompletion}\n- Payee credited micro-USDC: ${summary.balances.payeeMicroUnits}\n- Signature: ${summary.signature}\n- Receipt: ${summary.receiptId}\n- Ledger entries: ${summary.ledgerEntryCount}\n- Next gate: ${summary.nextGate}\n- JSON: ${jsonPath}\n`);
  console.log(JSON.stringify({ ok: true, jsonPath, mdPath, receiptId: summary.receiptId, signature: summary.signature, payeeMicroUnits: summary.balances.payeeMicroUnits }, null, 2));
} finally {
  await client.close().catch(() => undefined);
  if (specialistServer) await new Promise((resolve) => specialistServer.server.close(resolve));
  if (surfpool.child.exitCode === null) {
    surfpool.child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => surfpool.child.once('exit', resolve)),
      sleep(1500).then(() => { if (surfpool.child.exitCode === null) surfpool.child.kill('SIGKILL'); }),
    ]);
  }
  rmSync(tmp, { recursive: true, force: true });
}
