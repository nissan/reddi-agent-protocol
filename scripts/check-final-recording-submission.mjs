#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { SUBMISSION_PREP_LATEST_PATH, resolveSubmissionPrepPath } from "./lib/submission-prep-path.mjs";

const steps = [
  ["product naming", ["npm", "run", "check:product:naming"]],
  ["claim boundaries", ["npm", "run", "check:submission:claim-boundaries"]],
  ["submission prep", ["npm", "run", "check:economic-demo:submission-prep"]],
  ["Pay.sh reddi-x402 evidence", ["npm", "run", "evidence:pay-sh:reddi-x402", "--", "artifacts/pay-sh-reddi-x402/20260507T064842Z"]],
  ["Umbra SDK imports", ["npm", "run", "check:umbra:sdk-imports"]],
  ["Umbra adapter imports", ["npm", "run", "check:umbra:adapter-imports"]],
  ["Umbra private x402 evidence", ["npm", "run", "evidence:umbra:private-x402", "--", "artifacts/umbra-private-x402/20260507T074334Z"]],
  ["Umbra devnet smoke artifact", ["node", "-e", "const fs=require('fs'); const p='artifacts/umbra-devnet-smoke/20260507T075904Z/SUMMARY.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); if(!j.ok || !j.transactions?.deposit?.queueSignature || !j.transactions?.deposit?.callbackSignature) process.exit(1); console.log('[umbra-devnet-smoke] OK '+p)"]],
  ["BDD index", ["npm", "run", "test:bdd:index"]],
  ["payment readiness + Umbra unit", ["npx", "jest", "--runTestsByPath", "lib/__tests__/economic-demo-payment-readiness.test.ts", "lib/__tests__/umbra-private-payment.test.ts", "lib/__tests__/umbra-private-x402-adapter.test.ts", "--runInBand"]],
  ["Quasar submission", ["npm", "run", "check:quasar:submission"]],
];

function runStep(label, command) {
  console.log(`\n[final-recording] ${label}: ${command.join(" ")}`);
  const result = spawnSync(command[0], command.slice(1), { stdio: "inherit", shell: false });
  if (result.status !== 0) {
    console.error(`[final-recording] FAIL: ${label}`);
    process.exit(result.status ?? 1);
  }
}

for (const [label, command] of steps) runStep(label, command);

const resolvedPrepPath = resolveSubmissionPrepPath();
if (!existsSync(resolvedPrepPath)) {
  console.error(`[final-recording] FAIL: missing ${SUBMISSION_PREP_LATEST_PATH} and no timestamped fallback exists`);
  process.exit(1);
}
const prep = readFileSync(resolvedPrepPath, "utf8");
const reportMatch = prep.match(/`(artifacts\/economic-demo-run-report\/\d{8}T\d{6}Z\/run-report\.json)`/);
if (!reportMatch) {
  console.error("[final-recording] FAIL: submission prep does not reference a timestamped run-report JSON");
  process.exit(1);
}
const reportPath = reportMatch[1];
if (!existsSync(reportPath)) {
  console.error(`[final-recording] FAIL: referenced run report missing: ${reportPath}`);
  process.exit(1);
}
const report = JSON.parse(readFileSync(reportPath, "utf8"));
if (!report.payShReddix402Compatibility) {
  console.error(`[final-recording] FAIL: run report missing payShReddix402Compatibility: ${reportPath}`);
  process.exit(1);
}
if (!report.umbraPrivateX402) {
  console.error(`[final-recording] FAIL: run report missing umbraPrivateX402: ${reportPath}`);
  process.exit(1);
}
const protocolFeeReceipts = report.paymentReceipts?.filter((receipt) => receipt.category === "protocol_rail_fee") ?? [];
const protocolFeeLamports = protocolFeeReceipts.reduce((sum, receipt) => sum + (receipt.amountLamports ?? 0), 0);
if (protocolFeeReceipts.length < 1 || protocolFeeLamports <= 0 || !protocolFeeReceipts.every((receipt) => receipt.toProfileId === "reddi-protocol-treasury")) {
  console.error(`[final-recording] FAIL: run report missing Reddi Agent Protocol rail fee receipts: ${JSON.stringify(protocolFeeReceipts)}`);
  process.exit(1);
}
const upfrontPackPath = report.sourceArtifacts?.upfrontPack;
if (!upfrontPackPath || !existsSync(upfrontPackPath)) {
  console.error(`[final-recording] FAIL: missing upfront protocol-fee evidence pack: ${upfrontPackPath}`);
  process.exit(1);
}
const upfrontPack = JSON.parse(readFileSync(upfrontPackPath, "utf8"));
if (upfrontPack.protocolRailFee?.bps !== 5 || upfrontPack.budgetProof?.protocolFeeMatchesExpectedBps !== true) {
  console.error(`[final-recording] FAIL: upfront evidence pack does not prove 0.05% protocol fee: ${JSON.stringify(upfrontPack.protocolRailFee ?? null)}`);
  process.exit(1);
}
if (report.umbraPrivateX402.proofStatus !== "mocked_adapter_contract" || report.umbraPrivateX402.liveSettlementClaimed !== false) {
  console.error(`[final-recording] FAIL: Umbra adapter proof overclaims live settlement: ${JSON.stringify(report.umbraPrivateX402)}`);
  process.exit(1);
}
if (report.umbraPrivateX402.devnetSmoke?.proofStatus !== "devnet_encrypted_balance_deposit_confirmed") {
  console.error(`[final-recording] FAIL: Umbra devnet encrypted-balance smoke missing: ${JSON.stringify(report.umbraPrivateX402.devnetSmoke ?? null)}`);
  process.exit(1);
}

console.log("\n[final-recording] OK");
console.log(`[final-recording] submission prep: ${resolvedPrepPath}`);
console.log(`[final-recording] run report: ${reportPath}`);
console.log(`[final-recording] protocol rail fee: ${protocolFeeLamports} lamports across ${protocolFeeReceipts.length} receipt(s)`);
console.log(`[final-recording] Pay.sh proof: ${report.payShReddix402Compatibility.proofStatus}`);
console.log(`[final-recording] Umbra proof: ${report.umbraPrivateX402.proofStatus} + ${report.umbraPrivateX402.devnetSmoke.proofStatus}`);
