#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, PublicKey } from "@solana/web3.js";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const outDir = join(rootDir, "artifacts", "economic-demo-devnet-usdc-receipt", timestamp);
mkdirSync(outDir, { recursive: true });

const REQUIRED_CONFIRM = "RUN_ECONOMIC_DEMO_LIVE_PAYMENT_RECEIPT_LANE";
const DEVNET_USDC_MINT = process.env.ECONOMIC_DEMO_DEVNET_USDC_MINT || "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const rpcUrl = process.env.ECONOMIC_DEMO_SOLANA_RPC_URL || "https://api.devnet.solana.com";
const signature = process.env.ECONOMIC_DEMO_LIVE_PAYMENT_SIGNATURE || "";
const confirm = process.env.ECONOMIC_DEMO_LIVE_PAYMENT_CONFIRM || "";
const asset = process.env.ECONOMIC_DEMO_LIVE_PAYMENT_ASSET || "";
const network = process.env.ECONOMIC_DEMO_LIVE_PAYMENT_NETWORK || "";
const maxUsdc = Number(process.env.ECONOMIC_DEMO_LIVE_PAYMENT_MAX_USDC || "0");
const recipient = process.env.ECONOMIC_DEMO_LIVE_PAYMENT_RECIPIENT || "";
const payer = process.env.ECONOMIC_DEMO_LIVE_PAYMENT_PAYER || "";
const gatePath = process.env.ECONOMIC_DEMO_LIVE_PAYMENT_GATE_SOURCE
  ? join(rootDir, process.env.ECONOMIC_DEMO_LIVE_PAYMENT_GATE_SOURCE)
  : null;

function checkPublicKey(value) {
  try {
    if (!value) return false;
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

function writeArtifact(artifact) {
  const jsonPath = join(outDir, "receipt-verification.json");
  const mdPath = join(outDir, "SUMMARY.md");
  writeFileSync(jsonPath, `${JSON.stringify(artifact, null, 2)}\n`);
  writeFileSync(
    mdPath,
    [
      "# Economic Demo Devnet USDC Receipt Verification",
      "",
      `- Status: ${artifact.status}`,
      `- Signature: ${artifact.signature || "not provided"}`,
      `- RPC: ${artifact.rpcUrl}`,
      `- Mint: ${artifact.expected.usdcMint}`,
      `- Verified transfer amount: ${artifact.verifiedTransfer?.uiAmount ?? "not verified"} USDC`,
      "",
      "## Checks",
      "",
      ...artifact.checks.map((check) => `- ${check.ok ? "✅" : "❌"} ${check.id}: ${check.summary}`),
      "",
    ].join("\n"),
  );
  console.log(JSON.stringify({ ok: true, status: artifact.status, jsonPath, mdPath, blockers: artifact.checks.filter((check) => !check.ok).map((check) => check.id) }, null, 2));
}

function accountKeyAt(tx, index) {
  const key = tx?.transaction?.message?.accountKeys?.[index];
  return typeof key === "string" ? key : key?.pubkey?.toString?.() ?? key?.toString?.() ?? null;
}

function tokenAccountBalance(tx, tokenAccount) {
  const balances = [...(tx?.meta?.preTokenBalances ?? []), ...(tx?.meta?.postTokenBalances ?? [])];
  return balances.find((balance) => accountKeyAt(tx, balance?.accountIndex) === tokenAccount) ?? null;
}

function recipientDestinationsForTx(tx, recipientKey, mint) {
  const destinations = new Set([recipientKey]);
  for (const balance of tx?.meta?.postTokenBalances ?? []) {
    if (balance?.owner !== recipientKey || balance?.mint !== mint) continue;
    const tokenAccount = accountKeyAt(tx, balance.accountIndex);
    if (tokenAccount) destinations.add(tokenAccount);
  }
  return destinations;
}

const preflightChecks = [
  { id: "explicit_confirmation", ok: confirm === REQUIRED_CONFIRM, summary: `confirmation must equal ${REQUIRED_CONFIRM}` },
  { id: "asset_usdc", ok: asset === "USDC", summary: "asset must be USDC for this direct-payment verifier" },
  { id: "network_devnet", ok: network === "solana-devnet", summary: "network must be solana-devnet" },
  { id: "spend_cap_present", ok: Number.isFinite(maxUsdc) && maxUsdc > 0 && maxUsdc <= 10, summary: "max USDC cap must be >0 and <=10" },
  { id: "payer_reference_present", ok: payer.length > 0, summary: "payer reference must be present" },
  { id: "recipient_pubkey", ok: checkPublicKey(recipient), summary: "recipient must be a valid token account or owner public key" },
  { id: "signature_present", ok: signature.length > 0, summary: "transaction signature must be supplied for verification" },
];

let gate = null;
if (gatePath && existsSync(gatePath)) {
  gate = JSON.parse(readFileSync(gatePath, "utf8"));
  preflightChecks.push({ id: "gate_ready", ok: gate.status === "ready", summary: "referenced live-payment gate artifact must be ready" });
}

const baseArtifact = {
  schemaVersion: "reddi.economic-demo.devnet-usdc-receipt-verification.v1",
  generatedAt: new Date().toISOString(),
  status: "blocked",
  rpcUrl,
  signature: signature || null,
  gateArtifactPath: gatePath ? relative(rootDir, gatePath) : null,
  expected: {
    network: "solana-devnet",
    asset: "USDC",
    usdcMint: DEVNET_USDC_MINT,
    maxUsdc: Number.isFinite(maxUsdc) && maxUsdc > 0 ? maxUsdc : null,
    payerReference: payer || null,
    recipient: recipient || null,
  },
  checks: preflightChecks,
  verifiedTransfer: null,
  guardrails: [
    "Verifier only: this script does not sign or submit transactions.",
    "It verifies an already-produced devnet USDC receipt against explicit cap and recipient constraints.",
    "Mainnet receipts are intentionally rejected by this direct-payment verifier.",
  ],
};

if (!preflightChecks.every((check) => check.ok)) {
  writeArtifact(baseArtifact);
  process.exit(0);
}

const connection = new Connection(rpcUrl, "confirmed");
const tx = await connection.getParsedTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
const checks = [...preflightChecks];
checks.push({ id: "transaction_found", ok: Boolean(tx), summary: "transaction must be retrievable on devnet RPC" });
checks.push({ id: "transaction_success", ok: Boolean(tx) && tx.meta?.err == null, summary: "transaction must have no on-chain execution error" });

let verifiedTransfer = null;
if (tx && tx.meta?.err == null) {
  const recipientKey = new PublicKey(recipient).toBase58();
  const payerKey = checkPublicKey(payer) ? new PublicKey(payer).toBase58() : null;
  const allowedDestinations = recipientDestinationsForTx(tx, recipientKey, DEVNET_USDC_MINT);
  const instructions = tx.transaction.message.instructions;
  for (const instruction of instructions) {
    if (!("parsed" in instruction) || instruction.program !== "spl-token") continue;
    const parsed = instruction.parsed;
    if (parsed?.type !== "transferChecked" && parsed?.type !== "transfer") continue;
    const info = parsed.info || {};
    const mint = info.mint || DEVNET_USDC_MINT;
    const amountRaw = parsed.type === "transferChecked" ? Number(info.tokenAmount?.amount) : Number(info.amount);
    const decimals = parsed.type === "transferChecked" ? Number(info.tokenAmount?.decimals ?? 6) : 6;
    const uiAmount = amountRaw / 10 ** decimals;
    const destination = info.destination || null;
    const authority = info.authority || info.owner || null;
    const destinationBalance = destination ? tokenAccountBalance(tx, destination) : null;
    const destinationMint = info.mint || destinationBalance?.mint || null;
    const destinationMatches = Boolean(destination && allowedDestinations.has(destination));
    const payerMatches = !payerKey || authority === payerKey;
    if (destinationMint === DEVNET_USDC_MINT && destinationMatches && payerMatches && uiAmount > 0 && uiAmount <= maxUsdc) {
      verifiedTransfer = { mint: destinationMint, uiAmount, amountRaw, decimals, destination, authority, instructionType: parsed.type };
      break;
    }
  }
}

checks.push({ id: "verified_usdc_transfer", ok: Boolean(verifiedTransfer), summary: "transaction must include a devnet USDC transfer to recipient within cap" });

const artifact = {
  ...baseArtifact,
  status: checks.every((check) => check.ok) ? "verified" : "blocked",
  checks,
  verifiedTransfer,
  transaction: tx
    ? {
        slot: tx.slot,
        blockTime: tx.blockTime,
        fee: tx.meta?.fee ?? null,
        err: tx.meta?.err ?? null,
      }
    : null,
};

writeArtifact(artifact);
