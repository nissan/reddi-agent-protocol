#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const runbookPath = join(rootDir, "docs", "SUPERTEAM-AUSTRALIA-DEVNET-DEMO-RUNBOOK-2026-06-23.md");
const packageJsonPath = join(rootDir, "package.json");
const agentProtocolPackagePath = join(rootDir, "packages", "agent-protocol", "package.json");

const requiredFiles = [
  runbookPath,
  join(rootDir, "app", "economic-demo", "public-proof", "page.tsx"),
  join(rootDir, "app", "api", "economic-demo", "public-proof-page-data", "route.ts"),
  join(rootDir, "e2e", "economic-demo-public-proof.spec.ts"),
  join(rootDir, "scripts", "judge-replication-check.mjs"),
  join(rootDir, "scripts", "check-economic-demo-live-payment-gate.mjs"),
  join(rootDir, "scripts", "verify-economic-demo-devnet-usdc-receipt.mjs"),
  join(rootDir, "scripts", "plan-economic-demo-devnet-usdc-sender.mjs"),
  join(rootDir, "docs", "JUDGE-REPLICATION-GUIDE.md"),
];

const requiredRunbookPhrases = [
  "Superteam Australia",
  "https://agent-protocol.reddi.tech/economic-demo",
  "https://agent-protocol.reddi.tech/economic-demo/public-proof",
  "https://agent-protocol.reddi.tech/api/economic-demo/public-proof-page-data",
  "npm --prefix packages/agent-protocol run example:ard:no-spend",
  "npm run check:superteam:devnet-demo",
  "node scripts/judge-replication-check.mjs",
  "npm run check:economic-demo:live-payment-gate",
  "npm run verify:economic-demo:devnet-usdc-receipt",
  "RAP_MCP_DEVNET_MAX_USDC_MICRO_UNITS=60000",
  "No mainnet",
  "No production Pay.sh activation",
  "Not safe to say yet:",
  "AUDD is live as a production payment rail",
  "USDC auto-pay is enabled by default for marketplace agents",
];

function toRepoPath(path) {
  return relative(rootDir, path);
}

function fail(message, details = []) {
  console.error(`[superteam-devnet-demo-check] FAIL: ${message}`);
  for (const detail of details) console.error(`- ${detail}`);
  process.exit(1);
}

const missingFiles = requiredFiles.filter((path) => !existsSync(path)).map(toRepoPath);
if (missingFiles.length > 0) {
  fail("required demo files are missing", missingFiles);
}

const runbook = readFileSync(runbookPath, "utf8");
const missingPhrases = requiredRunbookPhrases.filter((phrase) => !runbook.includes(phrase));
if (missingPhrases.length > 0) {
  fail("runbook is missing required phrases", missingPhrases);
}

const rootPackage = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const agentProtocolPackage = JSON.parse(readFileSync(agentProtocolPackagePath, "utf8"));

const requiredRootScripts = [
  "check:superteam:devnet-demo",
  "check:economic-demo:live-payment-gate",
  "verify:economic-demo:devnet-usdc-receipt",
  "plan:economic-demo:devnet-usdc-sender",
  "test:bdd:index",
];

const missingRootScripts = requiredRootScripts.filter((scriptName) => !rootPackage.scripts?.[scriptName]);
if (missingRootScripts.length > 0) {
  fail("package.json is missing required scripts", missingRootScripts);
}

if (agentProtocolPackage.scripts?.["example:ard:no-spend"] !== "npm run build && node examples/ard-no-spend-demo.mjs") {
  fail("agent-protocol no-spend example script is missing or changed", ["packages/agent-protocol package script example:ard:no-spend"]);
}

const forbiddenFreshSpendCommands = [
  "npm run run:economic-demo:devnet-signed-action",
  "npm run run:economic-demo:devnet-wallet-backed-jupiter-swap",
];
const unsafeMention = forbiddenFreshSpendCommands.filter((command) => runbook.includes(command));
if (unsafeMention.length > 0) {
  fail("runbook includes fresh mutation commands outside the approved optional gate", unsafeMention);
}

console.log("[superteam-devnet-demo-check] OK");
console.log(`[superteam-devnet-demo-check] runbook: ${toRepoPath(runbookPath)}`);
console.log(`[superteam-devnet-demo-check] required files: ${requiredFiles.length}`);
