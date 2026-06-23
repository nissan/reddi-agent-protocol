import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.RAP_MCP_LIVE_X402_SPECIALIST_SMOKE !== '1') {
  throw new Error('set RAP_MCP_LIVE_X402_SPECIALIST_SMOKE=1 to run a live devnet x402 specialist smoke');
}
if (!process.env.RAP_MCP_DEVNET_WALLET_KEYPAIR || !existsSync(process.env.RAP_MCP_DEVNET_WALLET_KEYPAIR)) {
  throw new Error('set RAP_MCP_DEVNET_WALLET_KEYPAIR to an explicitly approved funded devnet demo wallet keypair path');
}
if (process.env.ECONOMIC_DEMO_LIVE_PAYMENT_CONFIRM !== 'RUN_ECONOMIC_DEMO_LIVE_PAYMENT_RECEIPT_LANE') {
  throw new Error('set ECONOMIC_DEMO_LIVE_PAYMENT_CONFIRM=RUN_ECONOMIC_DEMO_LIVE_PAYMENT_RECEIPT_LANE for fresh devnet spend');
}
if (!process.env.ECONOMIC_DEMO_LIVE_PAYMENT_GATE_SOURCE) {
  throw new Error('set ECONOMIC_DEMO_LIVE_PAYMENT_GATE_SOURCE to the ready gate.json artifact produced by npm run check:economic-demo:live-payment-gate');
}

const packageDir = dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, '');
const repoDir = join(packageDir, '..', '..');
const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const artifactDir = join(repoDir, 'artifacts', 'claude-code-mcp-x402-peekaboo-demo', `${timestamp}-live-x402-specialist-smoke`);
mkdirSync(artifactDir, { recursive: true });

const endpoint = process.env.RAP_MCP_LIVE_X402_SPECIALIST_ENDPOINT ?? 'https://reddi-code-generation.preview.reddi.tech/v1/chat/completions';
const rpcUrl = process.env.RAP_MCP_DEVNET_RPC_URL ?? 'https://api.devnet.solana.com';
const usdcMint = process.env.RAP_MCP_DEVNET_USDC_MINT ?? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const maxUsdcMicroUnits = Number(process.env.RAP_MCP_DEVNET_MAX_USDC_MICRO_UNITS ?? '60000');
const storeDir = process.env.REDDI_MCP_STORE_DIR || mkdtempSync(join(tmpdir(), 'rap-mcp-live-x402-specialist-'));
const gateSource = process.env.ECONOMIC_DEMO_LIVE_PAYMENT_GATE_SOURCE;
const gatePath = isAbsolute(gateSource) ? gateSource : join(repoDir, gateSource);

function loadPublicKey(path) {
  const secret = Uint8Array.from(JSON.parse(readFileSync(path, 'utf8')));
  return Keypair.fromSecretKey(secret).publicKey;
}

async function tokenBalance(connection, owner, mint) {
  const ata = getAssociatedTokenAddressSync(mint, owner);
  try {
    const balance = await connection.getTokenAccountBalance(ata, 'confirmed');
    return { ata: ata.toBase58(), amount: balance.value.amount, uiAmountString: balance.value.uiAmountString };
  } catch {
    return { ata: ata.toBase58(), amount: '0', uiAmountString: '0' };
  }
}

const walletPublicKey = loadPublicKey(process.env.RAP_MCP_DEVNET_WALLET_KEYPAIR);
if (!existsSync(gatePath)) throw new Error(`live payment gate artifact not found: ${gatePath}`);
const gate = JSON.parse(readFileSync(gatePath, 'utf8'));
if (gate.status !== 'ready') throw new Error(`live payment gate is not ready: ${gate.status}`);
if (gate.requestedLane !== 'USDC') throw new Error(`live payment gate asset must be USDC: ${gate.requestedLane}`);
if (gate.network !== 'solana-devnet') throw new Error(`live payment gate network must be solana-devnet: ${gate.network}`);
if (gate.specialistEndpoint !== endpoint) throw new Error(`live payment gate endpoint mismatch: ${gate.specialistEndpoint}`);
if (gate.payerReference !== walletPublicKey.toBase58()) throw new Error(`live payment gate payer mismatch: ${gate.payerReference}`);
const expectedPayTo = new PublicKey(String(gate.recipient)).toBase58();
const gateMaxMicroUnits = Math.floor(Number(gate.maxUsdc) * 1_000_000);
if (!Number.isFinite(gateMaxMicroUnits) || gateMaxMicroUnits <= 0) throw new Error('live payment gate cap is invalid');
if (maxUsdcMicroUnits > gateMaxMicroUnits) throw new Error(`live smoke cap exceeds gate cap: ${maxUsdcMicroUnits} > ${gateMaxMicroUnits}`);
const connection = new Connection(rpcUrl, 'confirmed');
const mint = new PublicKey(usdcMint);
const prePayer = await tokenBalance(connection, walletPublicKey, mint);

const client = new Client({ name: 'rap-mcp-live-x402-specialist-smoke', version: '0.1.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['dist/src/server.js'],
  cwd: packageDir,
  env: {
    ...process.env,
    REDDI_RAP_MCP_MODE: 'devnet',
    REDDI_MCP_STORE_DIR: storeDir,
    RAP_MCP_DEVNET_PROOF_APPROVED: '1',
    RAP_MCP_ALLOW_SPECIALIST_INVOKE: '1',
    RAP_MCP_DEVNET_RPC_URL: rpcUrl,
    RAP_MCP_DEVNET_USDC_MINT: usdcMint,
    RAP_MCP_DEVNET_MAX_USDC_MICRO_UNITS: String(maxUsdcMicroUnits),
    RAP_MCP_SPECIALIST_ENDPOINT_ALLOWLIST: endpoint,
  },
  stderr: 'pipe',
});

try {
  await client.connect(transport);
  const parseToolJson = (result, label) => {
    const text = result.content?.[0]?.text;
    try { return JSON.parse(text); } catch { throw new Error(`${label} returned non-JSON: ${text}`); }
  };
  const tools = await client.listTools();
  const names = tools.tools.map((tool) => tool.name).sort();
  for (const name of ['reddi.execute_x402_specialist_call', 'reddi.verify_x402_specialist_receipt', 'reddi.export_disclosure_ledger']) {
    if (!names.includes(name)) throw new Error(`missing live x402 MCP tool: ${name}`);
  }

  const execute = parseToolJson(await client.callTool({
    name: 'reddi.execute_x402_specialist_call',
    arguments: {
      endpoint,
      body: {
        model: 'reddi-code-generation',
        messages: [{ role: 'user', content: 'For a demo recording, reply in one concise sentence explaining what a paid x402 specialist call proves.' }],
        max_tokens: 80,
      },
      idempotencyKey: `live-x402-specialist-${timestamp}`,
      maxUsdcMicroUnits,
      expectedPayTo,
      approvalPhrase: 'EXECUTE_DEVNET_X402_SPECIALIST_CALL',
    },
  }), 'execute_x402_specialist_call');
  if (execute.response?.status !== 200) throw new Error(`paid retry did not return 200: ${JSON.stringify(execute.response)}`);
  if (execute.paymentReceipt?.payTo !== expectedPayTo) throw new Error(`receipt payee mismatch: ${execute.paymentReceipt?.payTo}`);

  const verify = parseToolJson(await client.callTool({
    name: 'reddi.verify_x402_specialist_receipt',
    arguments: { receiptId: execute.receiptId },
  }), 'verify_x402_specialist_receipt');
  if (verify.verified !== true || verify.mainnetSettlement !== 'not_applicable') throw new Error(`verification failed: ${JSON.stringify(verify)}`);

  const ledger = parseToolJson(await client.callTool({
    name: 'reddi.export_disclosure_ledger',
    arguments: { x402ReceiptIds: [execute.receiptId] },
  }), 'export_disclosure_ledger');
  if (ledger.entries?.length !== 1) throw new Error(`ledger export failed: ${JSON.stringify(ledger)}`);

  const payTo = execute.paymentReceipt?.payTo ? new PublicKey(String(execute.paymentReceipt.payTo)) : null;
  const postPayer = await tokenBalance(connection, walletPublicKey, mint);
  const postPayee = payTo ? await tokenBalance(connection, payTo, mint) : null;
  const summary = {
    ok: true,
    schemaVersion: 'reddi.rap-mcp-bridge.live-x402-specialist-smoke.v1',
    generatedAt: new Date().toISOString(),
    boundary: 'solana-devnet-only-no-mainnet',
    endpoint,
    gateArtifactPath: process.env.ECONOMIC_DEMO_LIVE_PAYMENT_GATE_SOURCE,
    rpcUrl,
    payer: walletPublicKey.toBase58(),
    payTo: payTo?.toBase58() ?? null,
    usdcMint,
    maxUsdcMicroUnits,
    receiptId: execute.receiptId,
    signature: execute.paymentReceipt?.signature ?? execute.paymentReceipt?.txSignature,
    response: execute.response,
    verification: { mcpReceiptVerified: verify.verified, specialistHttpCompletion: execute.verification?.specialistHttpCompletion, mainnetSettlement: verify.mainnetSettlement },
    ledgerEntryCount: ledger.entries.length,
    balances: { payerBefore: prePayer, payerAfter: postPayer, payeeAfter: postPayee },
    guardrails: ['devnet only', 'mainnet not applicable', 'exact endpoint allowlist', 'bounded micro-USDC cap', 'no private key material in artifact'],
  };
  const jsonPath = join(artifactDir, 'smoke-summary.json');
  const mdPath = join(artifactDir, 'SUMMARY.md');
  writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(mdPath, `# Live x402 Specialist Smoke\n\n- Boundary: ${summary.boundary}\n- Endpoint: ${endpoint}\n- Payer: ${summary.payer}\n- Payee: ${summary.payTo}\n- Cap: ${maxUsdcMicroUnits} micro-USDC\n- Receipt: ${summary.receiptId}\n- Signature: ${summary.signature}\n- MCP receipt verified: ${summary.verification.mcpReceiptVerified}\n- Specialist completion: ${summary.verification.specialistHttpCompletion}\n- Ledger entries: ${summary.ledgerEntryCount}\n- Payer USDC before: ${prePayer.uiAmountString}\n- Payer USDC after: ${postPayer.uiAmountString}\n- JSON: ${jsonPath}\n`);
  console.log(JSON.stringify({ ok: true, jsonPath, mdPath, receiptId: summary.receiptId, signature: summary.signature, payerBefore: prePayer.uiAmountString, payerAfter: postPayer.uiAmountString }, null, 2));
} finally {
  await client.close().catch(() => undefined);
  if (!process.env.REDDI_MCP_STORE_DIR) rmSync(storeDir, { recursive: true, force: true });
}
