#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";

const defaultFiles = [
  "STATUS.md",
  "docs/PAYSH-AGENT-PAYMENTS-LEVERAGE-2026-05-07.md",
  "docs/PAYSH-REDDI-X402-BDD-PLAYBOOK-2026-05-07.md",
  "docs/UMBRA-PRIVACY-PAYMENTS-BOUNTY-FIT-2026-05-07.md",
  "config/pay-sh/reddi-x402-economic-demo-provider.yml",
  "config/pay-sh/reddi-x402-economic-demo-splits.yml",
  "config/pay-sh/reddi-x402-economic-demo-session-splits.yml",
  "providers/redditech/reddi-agent-protocol/reddi-x402-economic-demo-provider.md",
  "app/economic-demo/page.tsx",
  "lib/economic-demo/payment-readiness.ts",
  "lib/__tests__/economic-demo-payment-readiness.test.ts",
  "artifacts/final-recording-packet-20260507.md",
  "docs/ECONOMIC-DEMO-JUDGE-PACKET-2026-05-05.md",
  "docs/ECONOMIC-DEMO-PROOF-HIERARCHY-2026-05-07.md",
  "docs/HACKATHON-BOUNTY-SHOWCASE-AUDIT-2026-05-07.md",
];

const files = process.argv.slice(2).length ? process.argv.slice(2) : defaultFiles;
// "Reddi Arena" is a distinct product, and "Reddi-hosted" is the hosted-deployment adjective the
// sibling `check:rap:naming` guard also permits; neither is standalone shorthand for the protocol.
const standaloneReddi = /\bReddi\b(?! Agent Protocol| Engage| Arena|tech|-hosted)/;
const allowStandaloneWhenExplainingRule = [
  "not standalone",
  "standalone “Reddi”",
  "standalone \"Reddi\"",
  "Do not use standalone",
  "standalone-Reddi",
];

const failures = [];

for (const file of files) {
  if (!existsSync(file)) continue;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!standaloneReddi.test(line)) return;
    if (allowStandaloneWhenExplainingRule.some((phrase) => line.includes(phrase))) return;
    failures.push(`${file}:${index + 1}: use “Reddi Agent Protocol” or \`reddi-x402\`, not standalone “Reddi”: ${line.trim()}`);
  });
}

if (failures.length) {
  console.error("[product-naming] FAIL");
  for (const failure of failures) console.error(failure);
  process.exit(1);
}

console.log(`[product-naming] OK: checked ${files.filter((file) => existsSync(file)).length} file(s)`);
