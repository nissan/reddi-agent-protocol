#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const outDir = join(rootDir, "artifacts", "economic-demo-live-payment-gate", timestamp);
mkdirSync(outDir, { recursive: true });

const REQUIRED_CONFIRM = "RUN_ECONOMIC_DEMO_LIVE_PAYMENT_RECEIPT_LANE";
const asset = process.env.ECONOMIC_DEMO_LIVE_PAYMENT_ASSET ?? "";
const confirm = process.env.ECONOMIC_DEMO_LIVE_PAYMENT_CONFIRM ?? "";
const maxUsdc = Number(process.env.ECONOMIC_DEMO_LIVE_PAYMENT_MAX_USDC ?? "0");
const network = process.env.ECONOMIC_DEMO_LIVE_PAYMENT_NETWORK ?? "";
const payer = process.env.ECONOMIC_DEMO_LIVE_PAYMENT_PAYER ?? "";
const recipient = process.env.ECONOMIC_DEMO_LIVE_PAYMENT_RECIPIENT ?? "";
const specialistEndpoint = process.env.ECONOMIC_DEMO_LIVE_PAYMENT_SPECIALIST_ENDPOINT ?? "";
const jupiterQuote = process.env.ECONOMIC_DEMO_LIVE_PAYMENT_JUPITER_QUOTE ?? "";

const checks = [
  {
    id: "explicit_confirmation",
    ok: confirm === REQUIRED_CONFIRM,
    summary: `ECONOMIC_DEMO_LIVE_PAYMENT_CONFIRM must equal ${REQUIRED_CONFIRM}`,
  },
  {
    id: "asset_selected",
    ok: asset === "USDC" || asset === "SOL",
    summary: "ECONOMIC_DEMO_LIVE_PAYMENT_ASSET must be USDC or SOL",
  },
  {
    id: "network_selected",
    ok: network === "solana-devnet" || network === "solana-mainnet",
    summary: "ECONOMIC_DEMO_LIVE_PAYMENT_NETWORK must be solana-devnet or solana-mainnet",
  },
  {
    id: "spend_cap_present",
    ok: Number.isFinite(maxUsdc) && maxUsdc > 0 && maxUsdc <= 10,
    summary: "ECONOMIC_DEMO_LIVE_PAYMENT_MAX_USDC must be >0 and <=10",
  },
  {
    id: "payer_reference_present",
    ok: payer.length > 0,
    summary: "ECONOMIC_DEMO_LIVE_PAYMENT_PAYER must identify the payer wallet or secure signer reference",
  },
  {
    id: "recipient_present",
    ok: recipient.length > 0,
    summary: "ECONOMIC_DEMO_LIVE_PAYMENT_RECIPIENT must identify orchestrator/escrow recipient",
  },
  {
    id: "specialist_endpoint_present",
    ok: asset !== "USDC" || /^https:\/\/[^*\s]+$/.test(specialistEndpoint),
    summary: "USDC x402 route requires ECONOMIC_DEMO_LIVE_PAYMENT_SPECIALIST_ENDPOINT as one exact HTTPS endpoint",
  },
  {
    id: "sol_route_has_jupiter_quote",
    ok: asset !== "SOL" || jupiterQuote.length > 0,
    summary: "SOL route requires ECONOMIC_DEMO_LIVE_PAYMENT_JUPITER_QUOTE pointing to a quote-proof artifact",
  },
];

const status = checks.every((check) => check.ok) ? "ready" : "blocked";
const artifact = {
  schemaVersion: "reddi.economic-demo.live-payment-gate.v1",
  generatedAt: new Date().toISOString(),
  status,
  requiredConfirmation: REQUIRED_CONFIRM,
  requestedLane: asset || null,
  network: network || null,
  maxUsdc: Number.isFinite(maxUsdc) && maxUsdc > 0 ? maxUsdc : null,
  payerReference: payer || null,
  recipient: recipient || null,
  specialistEndpoint: specialistEndpoint || null,
  jupiterQuoteReference: jupiterQuote || null,
  checks,
  guardrails: [
    "This script does not sign, swap, transfer, or mutate wallets.",
    "It only produces a readiness/gate artifact for the live receipt lane.",
    "Actual live payment/swap execution must be a separate command with the exact confirmation token and spend cap.",
    "Mainnet remains disallowed unless Nissan explicitly approves mainnet spend and cap in the current loop.",
  ],
  nextStep:
    status === "ready"
      ? "Run the dedicated live receipt executor for the selected asset/network after reviewing the exact command and cap."
      : "Fill only the missing gate inputs that are safe and approved; do not execute live payment yet.",
};

const jsonPath = join(outDir, "gate.json");
const mdPath = join(outDir, "SUMMARY.md");
writeFileSync(jsonPath, `${JSON.stringify(artifact, null, 2)}\n`);
writeFileSync(
  mdPath,
  [
    "# Economic Demo Live Payment Gate",
    "",
    `- Status: ${status}`,
    `- Asset: ${asset || "not selected"}`,
    `- Network: ${network || "not selected"}`,
    `- Max USDC cap: ${artifact.maxUsdc ?? "not set"}`,
    `- Payer: ${artifact.payerReference ?? "not set"}`,
    `- Recipient: ${artifact.recipient ?? "not set"}`,
    `- Specialist endpoint: ${artifact.specialistEndpoint ?? "not set"}`,
    "",
    "## Checks",
    "",
    ...checks.map((check) => `- ${check.ok ? "✅" : "❌"} ${check.id}: ${check.summary}`),
    "",
    "## Guardrails",
    "",
    ...artifact.guardrails.map((item) => `- ${item}`),
    "",
  ].join("\n"),
);

console.log(JSON.stringify({ ok: true, status, jsonPath, mdPath, blockers: checks.filter((check) => !check.ok).map((check) => check.id) }, null, 2));
