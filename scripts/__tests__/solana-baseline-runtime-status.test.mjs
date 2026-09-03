// The Agave CLI/SBF pin says nothing about which SVM the program-test lanes actually execute on.
// `scripts/check-solana-baseline-pins.mjs` therefore recomputes the permitted value of
// `programRuntime.agaveRuntimeCompatibility` from the root Cargo.lock resolution against the CI
// Agave pin. The current LiteSVM/Mollusk lane is major-aligned, but the whole point of
// the three-valued vocabulary is that dependency alignment alone must never be able to
// produce the attestation-grade 'verified' label — and neither may unverifiable free text,
// which is why 'verified' is refused until a machine-checkable evidence contract exists.
//
// These tests exercise the real checker against a throwaway repository fixture: only the files
// whose recorded runtime state is under test (the root Cargo.lock and the assets file) are rewritten, and
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
  // The checker resolves each execution profile's pinnedBy against the repository root, so
  // the tests those profiles cite have to exist in the fixture too.
  'programs/escrow/tests/litesvm_runtime_profile.rs',
  'programs/escrow/tests/mollusk_runtime.rs',
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

test('the Agave 4 in-process runtime under an Agave 4 CLI pin is accepted only as major-aligned', (t) => {
  const dir = makeFixture(t);

  const asRecorded = runChecker(dir);
  assert.equal(asRecorded.status, 0, asRecorded.stderr);
  assert.match(asRecorded.stdout, /ok: in-process runtime vs Agave CLI pin is recorded as major-aligned/);

  patchProgramRuntime(dir, { agaveRuntimeCompatibility: 'unresolved' });
  const staleUnresolved = runChecker(dir);
  assert.equal(staleUnresolved.status, 1);
  assertOnlyRuntimeStatusFailed(staleUnresolved);
  assert.match(staleUnresolved.stderr, /recorded as major-aligned/);
});

test('a runtime major mismatch records unresolved, not major-aligned', (t) => {
  const dir = makeFixture(t);
  setLockedProgramRuntime(dir, '3.1.12');
  patchProgramRuntime(dir, {
    embeddedProgramRuntimeVersion: '3.1.12',
    agaveRuntimeCompatibility: 'major-aligned',
  });

  const claimedAligned = runChecker(dir);
  assert.equal(claimedAligned.status, 1);
  assertOnlyRuntimeStatusFailed(claimedAligned);
  assert.match(claimedAligned.stderr, /recorded as unresolved/);

  patchProgramRuntime(dir, { agaveRuntimeCompatibility: 'unresolved' });
  const unresolved = runChecker(dir);
  assert.equal(unresolved.status, 0, unresolved.stderr);
  assert.match(unresolved.stdout, /ok: in-process runtime vs Agave CLI pin is recorded as unresolved/);
});

// The alignment majors now match permanently, so nothing but the evidence key stands between the
// recorded status and an attestation-grade label — and the checker does not read that key at all.
// This pins the refusal as unconditional: no evidence string of any shape, including the fixture's
// own alignment-only prose, may buy 'verified' while the majors align.
test('a verified label is refused unconditionally, whatever evidence is recorded', (t) => {
  const dir = makeFixture(t);
  const assets = JSON.parse(readFileSync(join(dir, ASSETS_REL), 'utf8'));
  const alignmentProse = assets.programRuntime.runtimeAlignmentEvidence;
  assert.equal(typeof alignmentProse, 'string', 'fixture should record alignment-only evidence prose');

  const evidenceStates = [
    ['no evidence key at all', undefined],
    ['a plausible qualification sentence', 'dedicated Agave 4.2 runtime qualification run, artifact XYZ'],
    ['the alignment-only prose recorded beside it', alignmentProse],
  ];

  for (const [label, evidence] of evidenceStates) {
    patchProgramRuntime(dir, {
      agaveRuntimeCompatibility: 'verified',
      runtimeVerificationEvidence: evidence,
    });
    const result = runChecker(dir);
    assert.equal(result.status, 1, `verified must be refused with ${label}`);
    assertOnlyRuntimeStatusFailed(result);
    assert.match(result.stderr, /recorded as major-aligned/);
  }
});

test('evidence cannot buy a verified label while the in-process runtime major still differs', (t) => {
  const dir = makeFixture(t);
  setLockedProgramRuntime(dir, '3.1.12');
  patchProgramRuntime(dir, {
    embeddedProgramRuntimeVersion: '3.1.12',
    agaveRuntimeCompatibility: 'verified',
    runtimeVerificationEvidence: 'dedicated Agave 4.2 runtime qualification run, artifact XYZ',
  });

  const result = runChecker(dir);
  assert.equal(result.status, 1);
  assertOnlyRuntimeStatusFailed(result);
});

test('the recorded in-process runtime versions must match the lockfile they claim to describe', (t) => {
  const dir = makeFixture(t);
  setLockedProgramRuntime(dir, '3.1.12');
  patchProgramRuntime(dir, { agaveRuntimeCompatibility: 'unresolved' });

  // embeddedProgramRuntimeVersion still says 4.2.2 while the lockfile now says 3.1.12.
  const result = runChecker(dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /failed: recorded in-process runtime versions match Cargo\.lock/);
});

// The two halves of the escrow lane execute under different feature profiles, observed with
// different strength: LiteSVM's active set is asserted exactly, Mollusk's is read from its
// source with only two named gates asserted. These cases pin that a stronger evidence label
// cannot be recorded for a profile the tests merely sample.
function patchExecutionProfile(dir, half, patch) {
  const assetsPath = join(dir, ASSETS_REL);
  const assets = JSON.parse(readFileSync(assetsPath, 'utf8'));
  const profiles = assets.programRuntime.executionProfiles;
  profiles[half] = { ...profiles[half], ...patch };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete profiles[half][key];
  }
  writeFileSync(assetsPath, `${JSON.stringify(assets, null, 2)}\n`);
}

function assertOnlyExecutionProfilesFailed(result) {
  const failures = result.stderr
    .split(/\r?\n/)
    .filter((line) => line.startsWith('solana-baseline-pins: failed:'));
  assert.equal(failures.length, 1, `expected exactly one failing check, got:\n${result.stderr}`);
  assert.match(failures[0], /each execution profile records evidence strength/);
}

test('the recorded execution profiles are accepted as checked in', (t) => {
  const dir = makeFixture(t);
  const result = runChecker(dir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ok: each execution profile records evidence strength/);
});

test('a sampled profile cannot be relabelled as an exact feature-set pin', (t) => {
  const dir = makeFixture(t);
  const assets = JSON.parse(readFileSync(join(dir, ASSETS_REL), 'utf8'));
  const mollusk = assets.programRuntime.executionProfiles.mollusk;
  assert.equal(mollusk.profileEvidence, 'asserted-representative-gates');
  assert.ok(Array.isArray(mollusk.assertedGates) && mollusk.assertedGates.length > 0);

  // Mollusk's gate list samples ~2 of SVMFeatureSet's dozens of fields, so the exact-set
  // label would claim a drift guarantee no test backs.
  patchExecutionProfile(dir, 'mollusk', { profileEvidence: 'asserted-complete-feature-set' });
  const overclaimed = runChecker(dir);
  assert.equal(overclaimed.status, 1, 'an enumerated gate list must not back the exact-set claim');
  assertOnlyExecutionProfilesFailed(overclaimed);

  // Dropping the list to keep the stronger label is refused too: representative evidence
  // must name the gates it samples.
  patchExecutionProfile(dir, 'mollusk', { profileEvidence: 'asserted-representative-gates', assertedGates: undefined });
  const unnamedGates = runChecker(dir);
  assert.equal(unnamedGates.status, 1, 'representative evidence must name its sampled gates');
  assertOnlyExecutionProfilesFailed(unnamedGates);

  // The mutation that matters: deleting the gate list AND relabelling. The exact-set label
  // is granted on positive evidence, so removing the list cannot buy it.
  patchExecutionProfile(dir, 'mollusk', {
    profileEvidence: 'asserted-complete-feature-set',
    assertedGates: undefined,
  });
  const relabelledWithoutGates = runChecker(dir);
  assert.equal(
    relabelledWithoutGates.status,
    1,
    'deleting the sampled gate list must not promote the profile to an exact-set pin',
  );
  assertOnlyExecutionProfilesFailed(relabelledWithoutGates);

  // Naming a complete-comparison source the checker does not recognise is refused as well,
  // so the label cannot be bought with prose either.
  patchExecutionProfile(dir, 'mollusk', {
    profileEvidence: 'asserted-complete-feature-set',
    assertedGates: undefined,
    completeSetSource: 'mollusk_svm::SVMFeatureSet::all_enabled()',
  });
  const unknownSource = runChecker(dir);
  assert.equal(unknownSource.status, 1, 'an unrecognised complete-comparison source must not back the claim');
  assertOnlyExecutionProfilesFailed(unknownSource);
});

test('the exact-set label requires a recognised complete-comparison source', (t) => {
  const dir = makeFixture(t);
  const assets = JSON.parse(readFileSync(join(dir, ASSETS_REL), 'utf8'));
  const litesvm = assets.programRuntime.executionProfiles.litesvm;
  assert.equal(litesvm.profileEvidence, 'asserted-complete-feature-set');
  assert.equal(typeof litesvm.completeSetSource, 'string');

  // Stripping the source leaves the label with nothing positive behind it.
  patchExecutionProfile(dir, 'litesvm', { completeSetSource: undefined });
  const sourceless = runChecker(dir);
  assert.equal(sourceless.status, 1, 'the exact-set label must name its comparison source');
  assertOnlyExecutionProfilesFailed(sourceless);

  // And a comparison source may not be recorded for a profile that does not claim the label.
  patchExecutionProfile(dir, 'litesvm', {
    profileEvidence: 'source-observed',
    completeSetSource: litesvm.completeSetSource,
    pinnedBy: undefined,
  });
  const danglingSource = runChecker(dir);
  assert.equal(danglingSource.status, 1, 'a comparison source without the exact-set label is refused');
  assertOnlyExecutionProfilesFailed(danglingSource);
});

test('a drift guarantee cannot cite a pinning test that is not in the tree', (t) => {
  const dir = makeFixture(t);
  const assets = JSON.parse(readFileSync(join(dir, ASSETS_REL), 'utf8'));
  const pinnedBy = assets.programRuntime.executionProfiles.litesvm.pinnedBy;

  patchExecutionProfile(dir, 'litesvm', { pinnedBy: `${pinnedBy}.renamed` });
  const missingTest = runChecker(dir);
  assert.equal(missingTest.status, 1, 'a profile must not cite a pinning test that does not exist');
  assertOnlyExecutionProfilesFailed(missingTest);

  // Deleting the cited test reaches the same failure the other way round.
  patchExecutionProfile(dir, 'litesvm', { pinnedBy });
  rmSync(join(dir, pinnedBy), { force: true });
  const deletedTest = runChecker(dir);
  assert.equal(deletedTest.status, 1, 'deleting the pinning test must fail the recorded guarantee');
  assertOnlyExecutionProfilesFailed(deletedTest);
});

test('an unrecognised evidence strength, or a claim without the test backing it, is refused', (t) => {
  const dir = makeFixture(t);

  patchExecutionProfile(dir, 'litesvm', { profileEvidence: 'verified' });
  const outsideVocabulary = runChecker(dir);
  assert.equal(outsideVocabulary.status, 1, 'evidence strength must come from the closed vocabulary');
  assertOnlyExecutionProfilesFailed(outsideVocabulary);

  // An asserted profile has to say which test asserts it.
  patchExecutionProfile(dir, 'litesvm', {
    profileEvidence: 'asserted-complete-feature-set',
    pinnedBy: undefined,
  });
  const unpinned = runChecker(dir);
  assert.equal(unpinned.status, 1, 'an asserted profile must name the test that asserts it');
  assertOnlyExecutionProfilesFailed(unpinned);

  // And a source-observed profile must not pretend a test pins it.
  patchExecutionProfile(dir, 'litesvm', {
    profileEvidence: 'source-observed',
    pinnedBy: 'programs/escrow/tests/litesvm_runtime_profile.rs',
  });
  const mislabelled = runChecker(dir);
  assert.equal(mislabelled.status, 1, 'source-observed evidence must not name a pinning test');
  assertOnlyExecutionProfilesFailed(mislabelled);
});

test('both halves of the escrow lane must record a profile', (t) => {
  const dir = makeFixture(t);
  const assetsPath = join(dir, ASSETS_REL);
  const assets = JSON.parse(readFileSync(assetsPath, 'utf8'));
  delete assets.programRuntime.executionProfiles.mollusk;
  writeFileSync(assetsPath, `${JSON.stringify(assets, null, 2)}\n`);

  const result = runChecker(dir);
  assert.equal(result.status, 1, 'dropping a half must not silently narrow what is recorded');
  assertOnlyExecutionProfilesFailed(result);
});
