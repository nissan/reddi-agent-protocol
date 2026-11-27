// S7 delta 6413dda, finding S7-delta-01 (failing test). Local only: a fake JSON-RPC on 127.0.0.1.
// `emergency-pause.mjs --network mainnet` must refuse an RPC whose genesis hash is not mainnet's:
// the program id is the same on both clusters, so a devnet URL (or a devnet SOLANA_RPC_URL left in the
// shell) would read or pause devnet while the operator believes mainnet is paused.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const PROGRAM = 'DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu';

function pauseData(pausedUntil) {
  const data = Buffer.alloc(89);
  data.writeBigUInt64LE(pausedUntil, 40);
  return data.toString('base64');
}

test('status --network mainnet refuses an RPC on another cluster', async () => {
  const methods = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const calls = [].concat(JSON.parse(body));
      const answer = calls.map(({ id, method }) => {
        methods.push(method);
        const result =
          method === 'getGenesisHash' ? DEVNET_GENESIS
          : method === 'getSlot' ? 100
          : method === 'getAccountInfo' ? { context: { slot: 100 }, value: { data: [pauseData(1_512_100n), 'base64'], executable: false, lamports: 1_500_000, owner: PROGRAM, rentEpoch: 0, space: 89 } }
          : null;
        return { jsonrpc: '2.0', id, result };
      });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(Array.isArray(JSON.parse(body)) ? answer : answer[0]));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const env = { ...process.env };
  delete env.SOLANA_RPC_URL;
  const child = spawn(process.execPath, [path.join(root, 'scripts/emergency-pause.mjs'), 'status', '--network', 'mainnet', '--url', `http://127.0.0.1:${port}`, '--json'], { env });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const code = await new Promise((r) => child.on('close', r));
  server.close();
  assert.notEqual(code, 0, `the script answered for devnet as if it were mainnet:\n${out}\nRPC methods: ${methods.join(', ')}`);
  assert.match(out, /genesis|cluster/i);
});

test('a key file that is not a keypair is refused without echoing what it holds', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(path.join(tmpdir(), 'pause-key-'));
  const file = path.join(dir, 'key.json');
  writeFileSync(file, 'abandon ability able about above absent');
  const child = spawn(process.execPath, [path.join(root, 'scripts/emergency-pause.mjs'), 'pause', '--keypair', file, '--network', 'devnet', '--url', 'http://127.0.0.1:9'], { env: { ...process.env } });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const code = await new Promise((r) => child.on('close', r));
  assert.notEqual(code, 0);
  assert.match(out, /not a Solana keypair file/);
  assert.doesNotMatch(out, /abandon|ability/);
});
