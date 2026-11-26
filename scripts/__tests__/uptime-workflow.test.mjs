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

// A local stand-in for the app: pages and the RPC proxy answer well, the watcher's health varies.
const appStub = (health) => `
import http from 'node:http';
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const json = (status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (req.url === '/api/rpc') {
      if (req.headers.origin !== 'http://127.0.0.1:' + server.address().port) return json(403, {});
      return json(200, { result: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG' });
    }
    if (req.url === '/api/cron/budget-watch/health') return json(${health.status}, ${JSON.stringify(health.body)});
    res.writeHead(200); res.end('ok');
  });
});
server.listen(0, '127.0.0.1', async () => {
  process.env.APP_ORIGIN = 'http://127.0.0.1:' + server.address().port;
  process.env.APP_EXPECTED_NETWORK = 'devnet';
  process.on('exit', () => server.close());
  await import(${JSON.stringify(path.join(root, 'scripts/app-live-check.mjs'))});
  server.close();
});
`;
const runWithStub = (health) => spawnSync(process.execPath, ['--input-type=module', '-e', appStub(health)], { encoding: 'utf8', timeout: 30_000 });

test('the app check passes when the Budget watcher is current', () => {
  const run = runWithStub({ status: 200, body: { ok: true, lastCompletePassAgeSeconds: 14 } });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /Budget watcher current/);
});

test('the app check fails when the Budget watcher is stale or not set up', () => {
  const stale = runWithStub({ status: 503, body: { ok: false, lastCompletePassAgeSeconds: 4000 } });
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /budget-watch\/health: status 503 \(last complete pass 4000 s ago\)/);
  const unset = runWithStub({ status: 503, body: { ok: false, error: 'budget_custody_not_configured' } });
  assert.equal(unset.status, 1);
  assert.match(unset.stderr, /budget_custody_not_configured/);
});
