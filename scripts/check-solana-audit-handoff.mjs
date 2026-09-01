#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = process.cwd();
const handoffPath = path.join(repoRoot, "docs/SOLANA-EXTERNAL-AUDIT-HANDOFF-2026-06-24.md");

const requiredHeadings = [
  "# Solana External Audit Handoff",
  "## Handoff Boundary",
  "## Auditor-Facing Scope",
  "## Frozen Handoff Inputs",
  "## Required Artifact Manifest",
  "## Auditor Questions",
  "## Triage And Remediation Flow",
  "## Grant-Facing Reporting",
  "## Validation",
];

const requiredReferences = [
  "docs/SOLANA-CONTRACT-AUDIT-READINESS-2026-06-24.md",
  "docs/SOLANA-CONTRACT-AUDIT-APPENDIX-2026-06-24.md",
  "experiments/quasar-registry",
  "experiments/quasar-attestation",
  "experiments/quasar-reputation",
  "experiments/quasar-escrow-per",
  "experiments/quasar-escrow",
  "programs/escrow",
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

const requiredArtifactTerms = [
  "Exact input evidence commit SHA",
  "final handoff source tree pointer",
  "Program ids",
  "Account/PDA/layout matrix",
  "Instruction ABI and discriminator list",
  "Threat model and trust-boundary summary",
  "Known blockers and product decisions",
  "Latest test/smoke evidence",
  "Surfpool/devnet promotion state",
  "Grant-facing reporting summary",
];

const requiredBoundaryPhrases = [
  "does not select or pay an auditor",
  "does not approve transaction submission",
  "requires explicit Nissan approval",
  "AUDD or USDC custody",
  "Settlement-finality proof",
  "Contracts are audited.",
  "Settlement finality is proven.",
  "Final handoff source commit: the merge commit for PR #534",
  "Current active escrow target for reputation/attestation job binding: `experiments/quasar-escrow`",
  "Current MagicBlock PER proof lane outside that boundary: `experiments/quasar-escrow-per`",
  "Do not send it to an external auditor as-is",
];

const inputEvidencePaths = [
  "docs/SOLANA-CONTRACT-AUDIT-READINESS-2026-06-24.md",
  "docs/SOLANA-CONTRACT-AUDIT-APPENDIX-2026-06-24.md",
];

function fail(message, details = []) {
  console.error(`[solana-audit-handoff] FAIL: ${message}`);
  for (const detail of details) console.error(`- ${detail}`);
  process.exit(1);
}

if (!fs.existsSync(handoffPath)) {
  fail("handoff file is missing", [path.relative(repoRoot, handoffPath)]);
}

const source = fs.readFileSync(handoffPath, "utf8");

const missingHeadings = requiredHeadings.filter((heading) => !source.includes(heading));
if (missingHeadings.length) fail("required headings are missing", missingHeadings);

const missingReferences = requiredReferences.filter((reference) => !source.includes(reference));
if (missingReferences.length) fail("required references are missing", missingReferences);

const missingFiles = requiredReferences
  .filter((reference) => reference.includes("/") && !reference.startsWith("#"))
  .filter((reference) => !fs.existsSync(path.join(repoRoot, reference)));
if (missingFiles.length) fail("referenced files/directories are missing", missingFiles);

const missingArtifactTerms = requiredArtifactTerms.filter((term) => !source.includes(term));
if (missingArtifactTerms.length) fail("required artifact terms are missing", missingArtifactTerms);

const missingBoundaryPhrases = requiredBoundaryPhrases.filter((phrase) => !source.includes(phrase));
if (missingBoundaryPhrases.length) fail("required boundary phrases are missing", missingBoundaryPhrases);

const inputCommitMatch = source.match(/Input evidence commit: `([0-9a-f]{40})`/);
if (!inputCommitMatch) fail("input evidence commit SHA is missing or malformed");

const inputCommit = inputCommitMatch[1];
try {
  execFileSync("git", ["cat-file", "-e", `${inputCommit}^{commit}`], { cwd: repoRoot, stdio: "ignore" });
} catch {
  fail("input evidence commit does not exist in git", [inputCommit]);
}

const missingInputEvidence = inputEvidencePaths.filter((sourcePath) => {
  try {
    execFileSync("git", ["cat-file", "-e", `${inputCommit}:${sourcePath}`], { cwd: repoRoot, stdio: "ignore" });
    return false;
  } catch {
    return true;
  }
});
if (missingInputEvidence.length) {
  fail("input evidence commit does not contain required evidence files", missingInputEvidence);
}

const staleHandoffSha = source.match(/Handoff source commit: `([0-9a-f]{40})`/);
if (staleHandoffSha) {
  fail("handoff source commit must not be a pre-merge stale SHA", [staleHandoffSha[1]]);
}

if (/Current active escrow target for grant handoff: `experiments\/quasar-escrow-per`/.test(source)) {
  fail("handoff must not present quasar-escrow-per as the current active escrow target");
}

console.log(`[solana-audit-handoff] OK: ${requiredHeadings.length} headings, ${requiredReferences.length} references, ${requiredArtifactTerms.length} artifact terms, ${requiredBoundaryPhrases.length} boundary phrases, and input evidence commit ${inputCommit} verified`);
