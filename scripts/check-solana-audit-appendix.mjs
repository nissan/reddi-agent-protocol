#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const appendixPath = path.join(repoRoot, "docs/SOLANA-CONTRACT-AUDIT-APPENDIX-2026-06-24.md");

const requiredHeadings = [
  "# Solana Contract Audit Appendix",
  "## Scope Boundary",
  "## Active Program Targets",
  "### Quasar Registry",
  "### Quasar Attestation",
  "### Quasar Reputation",
  "### Quasar Escrow PER",
  "### Quasar Escrow Legacy POC",
  "## Legacy Anchor Reference",
  "## Active Client And Instruction Builders",
  "## Scripted Proof Lanes",
  "## Payment Rail Contract Relevance",
  "## Required External Audit Packet Inputs",
  "## Validation",
];

const requiredSourcePaths = [
  "experiments/quasar-registry/src/lib.rs",
  "experiments/quasar-registry/src/state.rs",
  "experiments/quasar-attestation/src/lib.rs",
  "experiments/quasar-attestation/src/state.rs",
  "experiments/quasar-reputation/src/lib.rs",
  "experiments/quasar-reputation/src/state.rs",
  "experiments/quasar-escrow-per/src/lib.rs",
  "experiments/quasar-escrow-per/src/state.rs",
  "experiments/quasar-escrow/src/lib.rs",
  "experiments/quasar-escrow/src/state.rs",
  "programs/escrow/src/lib.rs",
  "programs/escrow/src/state.rs",
  "lib/quasar/instruction-builders.ts",
  "lib/quasar/instructions.ts",
  "lib/register/registration-instruction.ts",
  "packages/demo-agents/src/registration-instruction.ts",
  "packages/per-client/src/client.ts",
  "scripts/run-quasar-program-tests.sh",
  "scripts/check-quasar-boundary-guard.mjs",
  "scripts/check-quasar-runtime-compatibility.mjs",
  "scripts/check-quasar-deployment-inventory.mjs",
  "scripts/run-quasar-per-agent-vault-delegation-smoke.mjs",
  "scripts/run-quasar-per-agent-vault-settlement-smoke.mjs",
  "scripts/run-surfpool-critical-smoke.sh",
];

const requiredBoundaryPhrases = [
  "does not deploy programs",
  "does not approve transaction submission",
  "No current Quasar/Anchor/SPL custody",
  "requires the #441 promotion gate and explicit approval",
  "settlement-finality claims",
  "Current boundary: MagicBlock PER proof lane",
  "binding via `quasar-escrow-ref`",
];

function boundaryPhraseRegExp(phrase) {
  return new RegExp(phrase.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"));
}

function containsPhrase(text, phrase) {
  return boundaryPhraseRegExp(phrase).test(text);
}

function fail(message, details = []) {
  console.error(`[solana-audit-appendix] FAIL: ${message}`);
  for (const detail of details) console.error(`- ${detail}`);
  process.exit(1);
}

if (!fs.existsSync(appendixPath)) {
  fail("appendix file is missing", [path.relative(repoRoot, appendixPath)]);
}

const source = fs.readFileSync(appendixPath, "utf8");

const missingHeadings = requiredHeadings.filter((heading) => !source.includes(heading));
if (missingHeadings.length) fail("required headings are missing", missingHeadings);

const missingReferences = requiredSourcePaths.filter((sourcePath) => !source.includes(sourcePath));
if (missingReferences.length) fail("required source-path references are missing", missingReferences);

const missingFiles = requiredSourcePaths.filter((sourcePath) => !fs.existsSync(path.join(repoRoot, sourcePath)));
if (missingFiles.length) fail("referenced source files are missing from the repository", missingFiles);

const missingBoundaryPhrases = requiredBoundaryPhrases.filter((phrase) => !containsPhrase(source, phrase));
if (missingBoundaryPhrases.length) fail("required boundary phrases are missing", missingBoundaryPhrases);

if (/Status: reference\/legacy unless a later issue reselects it as the active\s+escrow audit target/.test(source)) {
  fail("appendix must not leave quasar-escrow described only as a legacy target after job binding");
}

console.log(`[solana-audit-appendix] OK: ${requiredHeadings.length} headings, ${requiredSourcePaths.length} source references, and ${requiredBoundaryPhrases.length} boundary phrases verified`);
