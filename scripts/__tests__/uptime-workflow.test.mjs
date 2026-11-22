import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflow = readFileSync(path.join(root, '.github/workflows/marketing-uptime.yml'), 'utf8');

// The check pipes through tee; without pipefail its failure never reaches the step (S6-claude-05).
test('the live check step runs under bash with pipefail', () => {
  const step = workflow.slice(workflow.indexOf('- name: Check the live site'), workflow.indexOf('- name: Open or update the issue'));
  assert.match(step, /\n\s+shell: bash\n/);
  assert.match(step, /live-check\.mjs/);
  assert.match(step, /app-live-check\.mjs/);
});

test('a failing command piped through tee fails under the step shell', () => {
  // GitHub runs `shell: bash` as `bash --noprofile --norc -eo pipefail {0}`.
  const run = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', 'false | tee /dev/null'], { encoding: 'utf8' });
  assert.notEqual(run.status, 0);
});

test('the alert issue is assigned to the owner and the app network is set', () => {
  assert.match(workflow, /--assignee "\$GITHUB_REPOSITORY_OWNER"/);
  assert.match(workflow, /APP_EXPECTED_NETWORK: (devnet|mainnet)\n/);
});

test('the app check refuses an unknown network without touching the network', () => {
  const run = spawnSync(process.execPath, [path.join(root, 'scripts/app-live-check.mjs')], {
    encoding: 'utf8', env: { ...process.env, APP_EXPECTED_NETWORK: 'testnet', APP_ORIGIN: 'http://127.0.0.1:9' },
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /must be devnet or mainnet/);
});
