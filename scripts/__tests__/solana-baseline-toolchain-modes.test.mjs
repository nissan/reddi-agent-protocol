import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../solana-baseline-toolchain.sh', import.meta.url));
const assets = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../config/toolchain/solana-baseline-assets.json', import.meta.url)), 'utf8'),
);
const anchorToml = readFileSync(fileURLToPath(new URL('../../Anchor.toml', import.meta.url)), 'utf8');
const anchorTomlVersion = anchorToml.match(/^anchor_version\s*=\s*"([^"]+)"/m)?.[1];

function run(...args) {
  return spawnSync(script, args, { encoding: 'utf8' });
}

test('refuses to run without an explicit mode instead of installing', () => {
  const result = run();
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /no mode given/);
});

test('rejects an unknown mode', () => {
  const result = run('instal');
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
});

test('help exits successfully on stdout', () => {
  const result = run('--help');
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.notEqual(result.stdout, '');
});

test('print-pins is a read-only mode that resolves every pin', () => {
  const result = run('print-pins');
  assert.equal(result.status, 0);
  const pins = Object.fromEntries(
    result.stdout
      .trim()
      .split(/\r?\n/)
      .map((line) => line.match(/^([^=\s]+)=([^\s]+)/))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  );
  for (const key of ['node', 'npm', 'rust', 'rustfmt', 'clippy', 'agave', 'avm', 'anchor', 'rustup-init', 'surfpool']) {
    assert.ok(pins[key], `expected a resolved ${key} pin`);
  }
  assert.equal(pins.avm, assets.anchorAvm.managerVersion, 'AVM manager pin must come from the assets manifest');
  assert.equal(pins.anchor, anchorTomlVersion, 'Anchor CLI pin must come from Anchor.toml');
});
