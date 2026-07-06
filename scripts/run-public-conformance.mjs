#!/usr/bin/env node
/**
 * Public RAP v0.1 conformance suite (#353).
 *
 * Consolidated, deterministic, offline runner that COMPOSES the existing
 * per-module conformance test suites in `packages/agent-protocol` — it does
 * not define any new checks. Each conformance area below maps the #353
 * acceptance criteria to the compiled test files that already prove them,
 * and the run finishes with the packed-artifact secret/content guard.
 *
 * Usage:
 *   node scripts/run-public-conformance.mjs [--skip-build]
 *
 *   --skip-build   Reuse existing dist/ and dist-tests/ output (CI runs this
 *                  after the build + test steps have already compiled both).
 *
 * No network, wallet, RPC, secrets, or hosted services are touched.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PKG_DIR = join(ROOT, 'packages', 'agent-protocol');
const DIST_TESTS = join(PKG_DIR, 'dist-tests');
const skipBuild = process.argv.includes('--skip-build');

/**
 * Conformance areas: #353 acceptance criteria -> existing compiled suites.
 * File names are relative to packages/agent-protocol/dist-tests/.
 */
const AREAS = [
  {
    id: 'receipt-shape',
    proves: 'reddi.receipt.v1 validation, receipt fixture cases, rail-neutral receipt normalization',
    files: ['receipts.test.js', 'rail-neutral-payment-receipts.test.js'],
  },
  {
    id: 'policy-decision-shape',
    proves: 'reddi.policy-decision.v1, buyer-authority policy corpus, AUDD payment-plan preflight fail-closed',
    files: ['buyer-authority-policy.test.js', 'audd-payment-plan.test.js'],
  },
  {
    id: 'source-metadata',
    proves: 'AI catalog ingestion, discovery-source candidates, provider trust, source diagnostics, source/trust conformance matrix',
    files: [
      'ai-catalog.test.js',
      'discovery-source.test.js',
      'provider-trust.test.js',
      'source-diagnostics.test.js',
      'source-trust-conformance-matrix.test.js',
    ],
  },
  {
    id: 'challenge-handling',
    proves: '402 challenge issue/accept, malformed-challenge and unsupported-rail fail-closed, MPP/Tempo challenge shapes',
    files: ['buyer-seller.test.js', 'mpp-tempo-receipt-shapes.test.js'],
  },
  {
    id: 'evidence-binding',
    proves: 'EvidenceArchive records, receipt-evidence binding, rail-neutral proof-chain fixture states',
    files: [
      'evidence-archive.test.js',
      'receipt-evidence-binding.test.js',
      'rail-neutral-proof-chain-fixture.test.js',
    ],
  },
  {
    id: 'secret-leakage-rejection',
    proves: 'credential-shaped receipt metadata and unsafe evidence metadata are rejected (credential_leakage_rejected / unsafe metadata fixtures)',
    files: ['receipts.test.js', 'evidence-archive.test.js'],
  },
  {
    id: 'quickstart-no-spend-workflow',
    proves: 'ARD no-spend demo end-to-end: challenge -> policy -> receipt -> evidence -> attestation/reputation, failure states, AUDD proof-metadata + no-custody boundary labels',
    files: ['ard-no-spend-demo.test.js'],
  },
  {
    id: 'interop-conformance-modules',
    proves: 'framework-template, OKF, OKF instruction safety, ERC-8004 export, AP2 mandate, agent-stack fixture corpora',
    files: [
      'framework-template-contract.test.js',
      'framework-template-conformance.test.js',
      'framework-template-conformance-fixtures.test.js',
      'okf-conformance.test.js',
      'okf-instruction-safety.test.js',
      'erc8004-export-conformance.test.js',
      'ap2-mandate-conformance.test.js',
      'agent-stack-fixtures.test.js',
    ],
  },
];

function run(label, command, args, cwd) {
  process.stdout.write(`\n== ${label}\n   $ ${command} ${args.join(' ')}\n`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) {
    process.stdout.write(`   spawn error: ${result.error.message}\n`);
    return false;
  }
  return result.status === 0;
}

const failures = [];

if (!skipBuild) {
  if (!run('build package', 'npm', ['run', 'build'], PKG_DIR)) {
    console.error('\nFAIL: package build failed; aborting conformance run.');
    process.exit(1);
  }
  if (!run('compile test suites', 'npx', ['--no-install', 'tsc', '-p', 'tsconfig.test.json'], PKG_DIR)) {
    console.error('\nFAIL: test compilation failed; aborting conformance run.');
    process.exit(1);
  }
}

// Drift guard: every composed suite must exist before anything runs.
const missing = AREAS.flatMap((area) =>
  area.files.filter((file) => !existsSync(join(DIST_TESTS, file))).map((file) => `${area.id}: ${file}`),
);
if (missing.length > 0) {
  console.error('\nFAIL: composed conformance suites are missing from dist-tests/ (renamed or removed?):');
  for (const item of missing) console.error(`  - ${item}`);
  console.error('Update scripts/run-public-conformance.mjs to match, or run without --skip-build.');
  process.exit(1);
}

for (const area of AREAS) {
  const files = area.files.map((file) => join('dist-tests', file));
  const ok = run(`conformance area: ${area.id}`, 'node', ['--test', ...files], PKG_DIR);
  if (!ok) failures.push(area.id);
}

// Packed-artifact guard: no secrets / forbidden contents in the publishable tarball.
const artifactGuard = join(ROOT, 'scripts', 'check-package-artifact-contents.mjs');
if (!run('packed-artifact secret/content guard', 'node', [artifactGuard, '--dir', relative(ROOT, PKG_DIR)], ROOT)) {
  failures.push('packed-artifact-guard');
}

process.stdout.write('\n== Public RAP v0.1 conformance summary\n');
for (const area of AREAS) {
  process.stdout.write(`   ${failures.includes(area.id) ? 'FAIL' : 'PASS'}  ${area.id} — ${area.proves}\n`);
}
process.stdout.write(`   ${failures.includes('packed-artifact-guard') ? 'FAIL' : 'PASS'}  packed-artifact-guard — npm pack dry-run contains no secrets or forbidden paths\n`);

if (failures.length > 0) {
  console.error(`\nFAIL: ${failures.length} conformance area(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
process.stdout.write('\nOK: all public conformance areas passed (offline, deterministic, no-spend).\n');
