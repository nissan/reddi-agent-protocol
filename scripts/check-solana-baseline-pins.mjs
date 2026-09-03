#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');

function fail(message) {
  console.error(`solana-baseline-pins: ${message}`);
  process.exitCode = 1;
}

function parseSimpleToml(file) {
  const result = {};
  let section = '';
  for (const rawLine of readFileSync(join(root, file), 'utf8').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      result[section] ??= {};
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!kv || !section) continue;
    let value = kv[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    else if (value.startsWith('[')) {
      value = [...value.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    }
    result[section][kv[1]] = value;
  }
  return result;
}

const mise = parseSimpleToml('.mise.toml');
const rust = parseSimpleToml('rust-toolchain.toml');
const anchor = parseSimpleToml('Anchor.toml');
const escrowCargo = parseSimpleToml('programs/escrow/Cargo.toml');
const escrowAnchorLangReq = escrowCargo.dependencies?.['anchor-lang']?.match(/version\s*=\s*"([^"]+)"/)?.[1];
const escrowLiteSvmReq = escrowCargo['dev-dependencies']?.litesvm;
const escrowMolluskSvmReq = escrowCargo['dev-dependencies']?.['mollusk-svm'];
const cargoLock = readFileSync(join(root, 'Cargo.lock'), 'utf8');
const lockedAnchorLang = cargoLock.match(/^name = "anchor-lang"\nversion = "([^"]+)"/m)?.[1];
const lockedLiteSvm = cargoLock.match(/^name = "litesvm"\nversion = "([^"]+)"/m)?.[1];
const lockedMolluskSvm = cargoLock.match(/^name = "mollusk-svm"\nversion = "([^"]+)"/m)?.[1];
const lockedProgramRuntime = cargoLock.match(/^name = "solana-program-runtime"\nversion = "([^"]+)"/m)?.[1];
const lockedSolanaSbpf = cargoLock.match(/^name = "solana-sbpf"\nversion = "([^"]+)"/m)?.[1];
const rootPackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const assets = JSON.parse(readFileSync(join(root, 'config/toolchain/solana-baseline-assets.json'), 'utf8'));

const workflowVersions = new Set();
for (const file of [
  '.github/workflows/anchor-program-tests.yml',
  '.github/workflows/quasar-program-tests.yml',
  '.github/workflows/surfpool-acceptance-manual.yml',
  '.github/workflows/surfpool-quasar-critical-sdk.yml',
]) {
  const text = readFileSync(join(root, file), 'utf8');
  for (const match of text.matchAll(/https:\/\/release\.anza\.xyz\/(v\d+\.\d+\.\d+)\/install/g)) {
    workflowVersions.add(match[1]);
  }
}

const setupPinsText = execFileSync(join(root, 'scripts/solana-baseline-toolchain.sh'), ['print-pins'], {
  cwd: root,
  encoding: 'utf8',
});
const setupPins = Object.fromEntries(
  setupPinsText
    .trim()
    .split(/\r?\n/)
    .map((line) => line.match(/^([^=]+)=([^\s]+)/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);

const BASELINE_RUST_VERSION = '1.98.0';
const BASELINE_AGAVE_VERSION = 'v4.2.2';
const BASELINE_RUSTFMT_VERSION = '1.9.0-stable';
const BASELINE_CLIPPY_VERSION = '0.1.98';
const STABLE_ANCHOR_VERSION = '1.1.2';
const AVM_MANAGER_VERSION = '1.0.0';
const BASELINE_CARGO_BUILD_SBF_VERSION = '4.1.0';
const BASELINE_PLATFORM_TOOLS_VERSION = 'v1.54';

const majorOf = (version) => String(version ?? '').replace(/^v/, '').split('.')[0];
// The program-test lanes build against the CI Agave pin but execute in-process on whatever SVM
// the deterministic LiteSVM/Mollusk root lockfile pulls in. Version equality between the two is
// dependency alignment, never a runtime compatibility claim, so aligning them can only ever reach
// 'major-aligned' here. The attestation-grade 'verified' label needs dedicated Agave runtime
// qualification, and no machine-checkable contract for recording that qualification exists yet:
// a free-text evidence string is unverifiable prose that this checker cannot tell apart from the
// alignment notes sitting beside it, so 'verified' is refused outright rather than granted on a
// non-empty key. Introducing 'verified' means first defining an evidence contract this checker can
// actually validate.
const inProcessRuntimeMatchesAgavePin =
  Boolean(lockedProgramRuntime) && majorOf(lockedProgramRuntime) === majorOf(BASELINE_AGAVE_VERSION);
const alignmentStatus = inProcessRuntimeMatchesAgavePin ? 'major-aligned' : 'unresolved';
const recordedRuntimeCompatibility = assets.programRuntime?.agaveRuntimeCompatibility;
const runtimeCompatibilityOk = recordedRuntimeCompatibility === alignmentStatus;

// The LiteSVM and Mollusk halves of the escrow lane execute under different feature profiles,
// and the strength of the evidence behind each differs too: LiteSVM's active set is observed
// exactly, while Mollusk's is read from its source with only named gates asserted. Recording
// that strength as a closed vocabulary rather than prose keeps a stronger claim from being
// written for a profile the tests only sample.
const PROFILE_EVIDENCE_KINDS = new Set([
  'asserted-complete-feature-set',
  'asserted-representative-gates',
  'source-observed',
]);
const executionProfiles = assets.programRuntime?.executionProfiles;
const profileEntries = Object.entries(executionProfiles ?? {}).filter(
  ([, value]) => value !== null && typeof value === 'object' && !Array.isArray(value),
);
const executionProfilesOk =
  profileEntries.length > 0 &&
  ['litesvm', 'mollusk'].every((half) => profileEntries.some(([name]) => name === half)) &&
  profileEntries.every(([, profile]) => {
    if (!PROFILE_EVIDENCE_KINDS.has(profile.profileEvidence)) return false;
    const gates = profile.assertedGates;
    if (gates !== undefined && (!Array.isArray(gates) || gates.length === 0)) return false;
    // An enumerated gate list samples the profile, so it can never back the exact-set claim.
    if (gates !== undefined && profile.profileEvidence === 'asserted-complete-feature-set') {
      return false;
    }
    if (profile.profileEvidence === 'asserted-representative-gates' && gates === undefined) {
      return false;
    }
    const asserted = profile.profileEvidence !== 'source-observed';
    return asserted === (typeof profile.pinnedBy === 'string' && profile.pinnedBy.length > 0);
  });

const checks = [
  ['.mise.toml pins Node 24.20.0', mise.tools?.node === '24.20.0'],
  [`rust-toolchain.toml pins Rust ${BASELINE_RUST_VERSION}`, rust.toolchain?.channel === BASELINE_RUST_VERSION],
  ['rust-toolchain.toml includes rustfmt', rust.toolchain?.components?.includes('rustfmt')],
  ['rust-toolchain.toml includes clippy', rust.toolchain?.components?.includes('clippy')],
  [`Anchor.toml pins stable Anchor ${STABLE_ANCHOR_VERSION}`, anchor.toolchain?.anchor_version === STABLE_ANCHOR_VERSION],
  ['programs/escrow anchor-lang requirement matches the Anchor.toml pin', escrowAnchorLangReq === anchor.toolchain?.anchor_version],
  ['Cargo.lock resolves anchor-lang to the Anchor.toml pin', lockedAnchorLang === anchor.toolchain?.anchor_version],
  ['CI workflows share one Agave pin', workflowVersions.size === 1],
  [`CI Agave pin is ${BASELINE_AGAVE_VERSION}`, workflowVersions.has(BASELINE_AGAVE_VERSION)],
  ['Agave asset checksum exists for CI pin', typeof assets.agave?.sha256ByVersion?.[BASELINE_AGAVE_VERSION] === 'string'],
  [
    `SBF build toolchain is recorded for Agave ${BASELINE_AGAVE_VERSION} as cargo-build-sbf ${BASELINE_CARGO_BUILD_SBF_VERSION}`,
    assets.sbf?.cargoBuildSbfVersionByAgaveVersion?.[BASELINE_AGAVE_VERSION] === BASELINE_CARGO_BUILD_SBF_VERSION,
  ],
  [
    `platform-tools ${BASELINE_PLATFORM_TOOLS_VERSION} is recorded for cargo-build-sbf ${BASELINE_CARGO_BUILD_SBF_VERSION}`,
    assets.sbf?.platformToolsVersionByCargoBuildSbfVersion?.[BASELINE_CARGO_BUILD_SBF_VERSION] === BASELINE_PLATFORM_TOOLS_VERSION,
  ],
  [
    'recorded LiteSVM pin matches the programs/escrow dev-dependency and lockfile',
    typeof escrowLiteSvmReq === 'string' &&
      assets.programRuntime?.liteSvmVersion === escrowLiteSvmReq &&
      lockedLiteSvm === escrowLiteSvmReq,
  ],
  [
    'recorded Mollusk pin matches the programs/escrow dev-dependency and lockfile',
    typeof escrowMolluskSvmReq === 'string' &&
      assets.programRuntime?.molluskSvmVersion === escrowMolluskSvmReq &&
      lockedMolluskSvm === escrowMolluskSvmReq,
  ],
  [
    'recorded in-process runtime versions match Cargo.lock',
    assets.programRuntime?.embeddedProgramRuntimeVersion === lockedProgramRuntime &&
      assets.programRuntime?.embeddedSolanaSbpfVersion === lockedSolanaSbpf,
  ],
  [
    `in-process runtime vs Agave CLI pin is recorded as ${alignmentStatus} ('verified' is refused until a machine-checkable qualification contract exists)`,
    runtimeCompatibilityOk,
  ],
  [
    "each execution profile records evidence strength from the closed vocabulary, and a profile that enumerates assertedGates cannot claim 'asserted-complete-feature-set'",
    executionProfilesOk,
  ],
  ['npm exact probe pin is recorded for Node 24.20.0', assets.node?.npmBundledVersion === '11.19.0'],
  [
    `rustfmt exact probe pin is recorded for Rust ${BASELINE_RUST_VERSION}`,
    assets.rust?.rustfmtVersionByChannel?.[BASELINE_RUST_VERSION] === BASELINE_RUSTFMT_VERSION,
  ],
  [
    `clippy exact probe pin is recorded for Rust ${BASELINE_RUST_VERSION}`,
    assets.rust?.clippyVersionByChannel?.[BASELINE_RUST_VERSION] === BASELINE_CLIPPY_VERSION,
  ],
  ['rustup-init asset is exact official archive 1.29.0', assets.rustup?.version === '1.29.0' && assets.rustup?.url?.includes('/archive/1.29.0/')],
  ['Surfpool asset pins v1.5.0', assets.surfpool?.version === 'v1.5.0' && assets.surfpool?.url?.includes('/download/v1.5.0/')],
  ['@solana/surfpool SDK package is pinned to the Surfpool asset version', rootPackage.devDependencies?.['@solana/surfpool'] === '1.5.0' && packageLock.packages?.['node_modules/@solana/surfpool']?.version === '1.5.0'],
  [`AVM manager is pinned independently at ${AVM_MANAGER_VERSION}`, assets.anchorAvm?.managerVersion === AVM_MANAGER_VERSION],
  [`AVM manager tag object and commit are recorded for ${AVM_MANAGER_VERSION}`, typeof assets.anchorAvm?.tagObjectShaByVersion?.[AVM_MANAGER_VERSION] === 'string' && typeof assets.anchorAvm?.tagCommitShaByVersion?.[AVM_MANAGER_VERSION] === 'string'],
  [`Anchor CLI tag object and commit are recorded for ${STABLE_ANCHOR_VERSION}`, typeof assets.anchorAvm?.tagObjectShaByVersion?.[STABLE_ANCHOR_VERSION] === 'string' && typeof assets.anchorAvm?.tagCommitShaByVersion?.[STABLE_ANCHOR_VERSION] === 'string'],
  [`Anchor CLI Linux release checksum is recorded for ${STABLE_ANCHOR_VERSION}`, typeof assets.anchorCli?.sha256ByVersion?.[STABLE_ANCHOR_VERSION] === 'string' && assets.anchorCli?.urlTemplate?.includes('/releases/download/v{version}/')],
  [`Anchor source is the current official repository for ${STABLE_ANCHOR_VERSION}`, assets.anchorAvm?.gitUrl === 'https://github.com/solana-foundation/anchor'],
  ['setup script resolves Node pin from .mise.toml', setupPins.node === mise.tools?.node],
  ['setup script resolves npm pin from assets', setupPins.npm === assets.node?.npmBundledVersion],
  ['setup script resolves Rust pin from rust-toolchain.toml', setupPins.rust === rust.toolchain?.channel],
  ['setup script resolves AVM manager pin from assets', setupPins.avm === assets.anchorAvm?.managerVersion],
  ['setup script resolves Anchor pin from Anchor.toml', setupPins.anchor === anchor.toolchain?.anchor_version],
  ['setup script resolves Agave pin from CI workflows', setupPins.agave === BASELINE_AGAVE_VERSION],
  ['setup script resolves Surfpool pin from assets', setupPins.surfpool === assets.surfpool?.version],
  [
    'setup script resolves cargo-build-sbf pin from assets for the CI Agave pin',
    setupPins['cargo-build-sbf'] === assets.sbf?.cargoBuildSbfVersionByAgaveVersion?.[BASELINE_AGAVE_VERSION],
  ],
  [
    'setup script resolves platform-tools pin from assets for the pinned cargo-build-sbf',
    setupPins['platform-tools'] ===
      assets.sbf?.platformToolsVersionByCargoBuildSbfVersion?.[BASELINE_CARGO_BUILD_SBF_VERSION],
  ],
  [
    'setup script resolves rustfmt pin from assets for the pinned channel',
    setupPins.rustfmt === assets.rust?.rustfmtVersionByChannel?.[rust.toolchain?.channel],
  ],
  [
    'setup script resolves clippy pin from assets for the pinned channel',
    setupPins.clippy === assets.rust?.clippyVersionByChannel?.[rust.toolchain?.channel],
  ],
];

for (const [label, ok] of checks) {
  if (ok) console.log(`ok: ${label}`);
  else fail(`failed: ${label}`);
}
