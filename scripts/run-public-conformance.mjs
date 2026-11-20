#!/usr/bin/env node
/**
 * Public RAP conformance suite (#353), rebuilt on reddi.receipt.v2 (#776).
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
    proves: 'reddi.receipt.v2 validation, canonical signing bytes, offline ed25519 verification against what the buyer knows, removed versions rejected',
    files: ['receipt-v2.test.js'],
  },
  {
    id: 'payment-records',
    proves: 'job, agreement, intent, observation and refund records, environment and eligibility labels, AUDD rail identity, model-drafted intents are never authority',
    files: ['payment-records.test.js', 'audd-rail-config.test.js'],
  },
  {
    id: 'source-metadata',
    proves: 'AI catalog ingestion, discovery-source candidates and policy preflight, provider trust, source diagnostics, source/trust conformance matrix',
    files: [
      'ai-catalog.test.js',
      'discovery-source.test.js',
      'provider-trust.test.js',
      'source-diagnostics.test.js',
      'source-trust-conformance-matrix.test.js',
    ],
  },
  {
    id: 'challenge-shapes',
    proves: 'MPP/Tempo challenge and receipt shapes fail closed on unbound or unsupported input',
    files: ['mpp-tempo-receipt-shapes.test.js'],
  },
  {
    id: 'evidence-and-attestation',
    proves: 'EvidenceArchive records never replace a stored record, attestation records and reputation projection',
    files: ['evidence-archive.test.js', 'attestation-reputation.test.js'],
  },
  {
    id: 'secret-leakage-rejection',
    proves: 'a receipt with any field its version does not define is rejected, and credential-shaped evidence metadata is rejected (credential_leakage_rejected)',
    files: ['receipt-v2.test.js', 'evidence-archive.test.js'],
  },
  {
    id: 'quickstart-no-spend-workflow',
    proves: 'ARD no-spend demo end-to-end: discover -> decide -> provider-signed reddi.receipt.v2 -> offline verification -> evidence -> attestation/reputation, with each failure state refusing',
    files: ['ard-no-spend-demo.test.js', 'interpretation-guide-scenarios.test.js'],
  },
  {
    id: 'interop-conformance-modules',
    proves: 'OKF adapter, OKF conformance and instruction safety, Quasar registry compatibility, agent-stack fixture corpora',
    files: [
      'okf-adapter.test.js',
      'okf-conformance.test.js',
      'okf-instruction-safety.test.js',
      'quasar-registry-compatibility.test.js',
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

process.stdout.write('\n== Public RAP conformance summary\n');
for (const area of AREAS) {
  process.stdout.write(`   ${failures.includes(area.id) ? 'FAIL' : 'PASS'}  ${area.id} — ${area.proves}\n`);
}
process.stdout.write(`   ${failures.includes('packed-artifact-guard') ? 'FAIL' : 'PASS'}  packed-artifact-guard — npm pack dry-run contains no secrets or forbidden paths\n`);

if (failures.length > 0) {
  console.error(`\nFAIL: ${failures.length} conformance area(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
process.stdout.write('\nOK: all public conformance areas passed (offline, deterministic, no-spend).\n');
