import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../solana-baseline-toolchain.sh', import.meta.url));

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
  for (const key of ['node', 'npm', 'rust', 'rustfmt', 'clippy', 'agave', 'anchor', 'rustup-init', 'surfpool']) {
    assert.ok(pins[key], `expected a resolved ${key} pin`);
  }
});
