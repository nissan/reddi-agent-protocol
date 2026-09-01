import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const lib = fileURLToPath(new URL('../lib/solana-baseline-version-match.sh', import.meta.url));

function matches(output, expected) {
  const result = spawnSync(
    'bash',
    ['-c', '. "$1"; version_token_match "$2" "$3"', 'bash', lib, output, expected],
    { encoding: 'utf8' },
  );
  assert.equal(result.status === 0 || result.status === 1, true, result.stderr);
  return result.status === 0;
}

test('accepts a pinned version followed by build metadata', () => {
  assert.equal(matches('rustc 1.89.0 (29483883e 2025-08-04)', 'rustc 1.89.0'), true);
  assert.equal(matches('solana-cli 3.1.13 (src:devbuild; feat:1, client:Agave)', 'solana-cli 3.1.13'), true);
  assert.equal(matches('rustfmt 1.8.0-stable (29483883 2025-08-04)', 'rustfmt 1.8.0-stable'), true);
  assert.equal(matches('v24.20.0', 'v24.20.0'), true);
  assert.equal(matches('11.19.0\n', '11.19.0'), true);
});

test('rejects a prerelease or suffixed build of the pinned version', () => {
  assert.equal(matches('anchor-cli 1.1.2-rc.1', 'anchor-cli 1.1.2'), false);
  assert.equal(matches('surfpool 1.5.01', 'surfpool 1.5.0'), false);
  assert.equal(matches('avm 1.1.2.1', 'avm 1.1.2'), false);
  assert.equal(matches('v24.20.0-nightly', 'v24.20.0'), false);
});

test('rejects an unrelated version', () => {
  assert.equal(matches('surfpool 1.6.0', 'surfpool 1.5.0'), false);
  assert.equal(matches('', 'surfpool 1.5.0'), false);
});
