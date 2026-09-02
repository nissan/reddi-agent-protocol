// The Agave CLI/SBF pin says nothing about which SVM the program-test lanes actually execute on.
// `scripts/check-solana-baseline-pins.mjs` therefore recomputes the permitted value of
// `programRuntime.agaveRuntimeCompatibility` from the root Cargo.lock resolution against the CI
// Agave pin, and the whole point of the three-valued vocabulary is that dependency alignment alone
// must never be able to produce the attestation-grade 'verified' label.
//
// These tests exercise the real checker against a throwaway repository fixture: only the two files
// whose recorded state is under test (the root Cargo.lock and the assets file) are rewritten, and
// everything the checker reads is the repository's own content. Nothing here inspects the checker's
// source; each case asserts its exit status and the label it printed.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');

// Everything scripts/check-solana-baseline-pins.mjs reads, plus the setup script it shells out to
// for the resolved pins. The checker derives its repository root from its own module path, so these
// are copied rather than symlinked: Node resolves a symlinked module to its real path.
const FIXTURE_PATHS = [
  '.mise.toml',
  'rust-toolchain.toml',
  'Anchor.toml',
  'package.json',
  'package-lock.json',
  'Cargo.lock',
  'programs/escrow/Cargo.toml',
  'config/toolchain/solana-baseline-assets.json',
  '.github/workflows/anchor-program-tests.yml',
  '.github/workflows/quasar-program-tests.yml',
  '.github/workflows/surfpool-acceptance-manual.yml',
  '.github/workflows/surfpool-quasar-critical-sdk.yml',
  'scripts/check-solana-baseline-pins.mjs',
  'scripts/solana-baseline-toolchain.sh',
  'scripts/lib/solana-baseline-version-match.sh',
];

const ASSETS_REL = 'config/toolchain/solana-baseline-assets.json';

function makeFixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'rap-runtime-status-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const rel of FIXTURE_PATHS) {
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    cpSync(join(repoRoot, rel), join(dir, rel));
  }
  return dir;
}

/** Rewrite the root Cargo.lock's solana-program-runtime resolution, as a LiteSVM bump would. */
function setLockedProgramRuntime(dir, version) {
  const lockPath = join(dir, 'Cargo.lock');
  const lock = readFileSync(lockPath, 'utf8');
  const next = lock.replace(
    /^name = "solana-program-runtime"\nversion = "[^"]+"/m,
    `name = "solana-program-runtime"\nversion = "${version}"`,
  );
  assert.notEqual(next, lock, 'expected the fixture Cargo.lock to resolve solana-program-runtime');
  writeFileSync(lockPath, next);
}

function patchProgramRuntime(dir, patch) {
  const assetsPath = join(dir, ASSETS_REL);
  const assets = JSON.parse(readFileSync(assetsPath, 'utf8'));
  assets.programRuntime = { ...assets.programRuntime, ...patch };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete assets.programRuntime[key];
  }
  writeFileSync(assetsPath, `${JSON.stringify(assets, null, 2)}\n`);
}

function runChecker(dir) {
  const result = spawnSync(process.execPath, [join(dir, 'scripts/check-solana-baseline-pins.mjs')], {
    cwd: dir,
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Only the runtime-status check may differ between cases; everything else must stay green. */
function assertOnlyRuntimeStatusFailed(result) {
  const failures = result.stderr
    .split(/\r?\n/)
    .filter((line) => line.startsWith('solana-baseline-pins: failed:'));
  assert.equal(failures.length, 1, `expected exactly one failing check, got:\n${result.stderr}`);
  assert.match(failures[0], /in-process runtime vs Agave CLI pin/);
}

test('today’s Agave 3.1 in-process runtime under an Agave 4 CLI pin is accepted only as unresolved', (t) => {
  const dir = makeFixture(t);

  const asRecorded = runChecker(dir);
  assert.equal(asRecorded.status, 0, asRecorded.stderr);
  assert.match(asRecorded.stdout, /ok: in-process runtime vs Agave CLI pin is recorded as unresolved/);

  patchProgramRuntime(dir, { agaveRuntimeCompatibility: 'major-aligned' });
  const claimedAligned = runChecker(dir);
  assert.equal(claimedAligned.status, 1);
  assertOnlyRuntimeStatusFailed(claimedAligned);
});

test('aligning LiteSVM with the Agave pin records major-aligned, never verified', (t) => {
  const dir = makeFixture(t);
  setLockedProgramRuntime(dir, '4.2.2');
  patchProgramRuntime(dir, { embeddedProgramRuntimeVersion: '4.2.2' });

  // The recorded 'unresolved' no longer describes the lockfile, so the guard must notice.
  const stale = runChecker(dir);
  assert.equal(stale.status, 1);
  assertOnlyRuntimeStatusFailed(stale);
  assert.match(stale.stderr, /recorded as major-aligned/);

  patchProgramRuntime(dir, { agaveRuntimeCompatibility: 'major-aligned' });
  const aligned = runChecker(dir);
  assert.equal(aligned.status, 0, aligned.stderr);
  assert.match(aligned.stdout, /ok: in-process runtime vs Agave CLI pin is recorded as major-aligned/);
});

test('an unearned verified label is refused even when the majors align', (t) => {
  const dir = makeFixture(t);
  setLockedProgramRuntime(dir, '4.2.2');
  patchProgramRuntime(dir, {
    embeddedProgramRuntimeVersion: '4.2.2',
    agaveRuntimeCompatibility: 'verified',
  });

  const noEvidence = runChecker(dir);
  assert.equal(noEvidence.status, 1, 'version alignment alone must not satisfy a verified claim');
  assertOnlyRuntimeStatusFailed(noEvidence);

  patchProgramRuntime(dir, { runtimeVerificationEvidence: '   ' });
  const blankEvidence = runChecker(dir);
  assert.equal(blankEvidence.status, 1, 'a whitespace-only evidence key must not satisfy a verified claim');
  assertOnlyRuntimeStatusFailed(blankEvidence);

  patchProgramRuntime(dir, {
    runtimeVerificationEvidence: 'dedicated Agave 4.2 runtime qualification run, artifact XYZ',
  });
  const withEvidence = runChecker(dir);
  assert.equal(withEvidence.status, 0, withEvidence.stderr);
  assert.match(withEvidence.stdout, /ok: in-process runtime vs Agave CLI pin is recorded as/);
});

test('evidence cannot buy a verified label while the in-process runtime major still differs', (t) => {
  const dir = makeFixture(t);
  patchProgramRuntime(dir, {
    agaveRuntimeCompatibility: 'verified',
    runtimeVerificationEvidence: 'dedicated Agave 4.2 runtime qualification run, artifact XYZ',
  });

  const result = runChecker(dir);
  assert.equal(result.status, 1);
  assertOnlyRuntimeStatusFailed(result);
});

test('the recorded in-process runtime versions must match the lockfile they claim to describe', (t) => {
  const dir = makeFixture(t);
  setLockedProgramRuntime(dir, '4.2.2');
  patchProgramRuntime(dir, { agaveRuntimeCompatibility: 'major-aligned' });

  // embeddedProgramRuntimeVersion still says 3.1.12 while the lockfile now says 4.2.2.
  const result = runChecker(dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /failed: recorded in-process runtime versions match Cargo\.lock/);
});
