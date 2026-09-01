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
const assets = JSON.parse(readFileSync(join(root, 'config/toolchain/solana-baseline-assets.json'), 'utf8'));

const workflowVersions = new Set();
for (const file of ['.github/workflows/anchor-program-tests.yml', '.github/workflows/quasar-program-tests.yml']) {
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

const checks = [
  ['.mise.toml pins Node 24.20.0', mise.tools?.node === '24.20.0'],
  ['rust-toolchain.toml pins Rust 1.89.0', rust.toolchain?.channel === '1.89.0'],
  ['rust-toolchain.toml includes rustfmt', rust.toolchain?.components?.includes('rustfmt')],
  ['rust-toolchain.toml includes clippy', rust.toolchain?.components?.includes('clippy')],
  ['Anchor.toml pins Anchor 1.0.0', anchor.toolchain?.anchor_version === '1.0.0'],
  ['CI workflows share one Agave pin', workflowVersions.size === 1],
  ['CI Agave pin is v3.1.13', workflowVersions.has('v3.1.13')],
  ['Agave asset checksum exists for CI pin', typeof assets.agave?.sha256ByVersion?.['v3.1.13'] === 'string'],
  ['npm exact probe pin is recorded for Node 24.20.0', assets.node?.npmBundledVersion === '11.19.0'],
  ['rustfmt exact probe pin is recorded for Rust 1.89.0', assets.rust?.rustfmtVersionByChannel?.['1.89.0'] === '1.8.0-stable'],
  ['clippy exact probe pin is recorded for Rust 1.89.0', assets.rust?.clippyVersionByChannel?.['1.89.0'] === '0.1.89'],
  ['rustup-init asset is exact official archive 1.29.0', assets.rustup?.version === '1.29.0' && assets.rustup?.url?.includes('/archive/1.29.0/')],
  ['Surfpool asset pins v1.5.0', assets.surfpool?.version === 'v1.5.0' && assets.surfpool?.url?.includes('/download/v1.5.0/')],
  ['Anchor AVM tag object and commit are recorded', typeof assets.anchorAvm?.tagObjectShaByVersion?.['1.0.0'] === 'string' && typeof assets.anchorAvm?.tagCommitShaByVersion?.['1.0.0'] === 'string'],
  ['setup script resolves Node pin from .mise.toml', setupPins.node === mise.tools?.node],
  ['setup script resolves npm pin from assets', setupPins.npm === assets.node?.npmBundledVersion],
  ['setup script resolves Rust pin from rust-toolchain.toml', setupPins.rust === rust.toolchain?.channel],
  ['setup script resolves Anchor pin from Anchor.toml', setupPins.anchor === anchor.toolchain?.anchor_version],
  ['setup script resolves Agave pin from CI workflows', setupPins.agave === 'v3.1.13'],
  ['setup script resolves Surfpool pin from assets', setupPins.surfpool === assets.surfpool?.version],
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
