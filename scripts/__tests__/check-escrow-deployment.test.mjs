import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GENESIS, UPGRADEABLE_LOADER, base58Decode, base58Encode, checkDeployment, recordProblems, trimmedHash,
} from '../check-escrow-deployment.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VAULT = '5CsBuTBFKu12JSs4CUbmv5MR218RYtNmAoQmLf5x3Hxe';
const DEPLOYER = 'hbr2Fee3ewDbm33wTDrdEF3e7byNCzNgQ57CwJWaPtt';
const PROGRAM_ID = 'DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu';
const PROGRAM_DATA = '8cCmxnMPU8EQR7ECfff19Dr4gu1n7jyFCuEEyaYspRn2';
const SOME_MULTISIG = 'J7oTyhM8iNtizucYeSd9TxaLNhWL2i9mcbAqRJeDvmsv';

// A fake build: non-zero bytes with a trailing zero inside the build, so the
// trimmed hash and the file sha256 differ, as they can for a real .so.
const build = Uint8Array.from({ length: 1000 }, (_, i) => (i === 999 ? 0 : (i * 7 + 1) % 256 || 1));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

function record(overrides = {}) {
  return {
    network: 'mainnet',
    programId: PROGRAM_ID,
    size: build.length,
    sha256: sha(build),
    executableHash: trimmedHash(build),
    upgradeAuthority: VAULT,
    forbiddenAuthorities: [SOME_MULTISIG],
    ...overrides,
  };
}

function programAccount() {
  const data = new Uint8Array(36);
  data[0] = 2;
  data.set(base58Decode(PROGRAM_DATA), 4);
  return { owner: UPGRADEABLE_LOADER, executable: true, data };
}

function programDataAccount({ bytes = build, reserve = 1500, authority = VAULT, slot = 123n } = {}) {
  const data = new Uint8Array(45 + reserve);
  data[0] = 3;
  new DataView(data.buffer).setBigUint64(4, slot, true);
  if (authority) {
    data[12] = 1;
    data.set(base58Decode(authority), 13);
  }
  data.set(bytes, 45);
  return { owner: UPGRADEABLE_LOADER, executable: false, data };
}

const chain = (overrides = {}) => ({
  genesisHash: GENESIS.mainnet,
  program: programAccount(),
  programData: programDataAccount(),
  buffers: [],
  ...overrides,
});

const failed = (result) => result.items.filter((item) => !item.ok).map((item) => item.name);

test('base58 round-trips addresses', () => {
  for (const address of [VAULT, DEPLOYER, PROGRAM_ID, UPGRADEABLE_LOADER, '11111111111111111111111111111111']) {
    assert.equal(base58Encode(base58Decode(address)), address);
  }
});

test('the build of record under the vault passes', () => {
  const result = checkDeployment(record(), chain());
  assert.deepEqual(failed(result), []);
  assert.equal(result.ok, true);
  assert.match(result.items.find((i) => i.name === 'program data account').detail, /slot 123/);
});

test('wrong cluster fails and decides nothing else', () => {
  const result = checkDeployment(record(), chain({ genesisHash: GENESIS.devnet }));
  assert.equal(result.ok, false);
  assert.deepEqual(result.items.map((i) => i.name), ['cluster']);
});

test('a devnet record refuses a mainnet RPC', () => {
  const result = checkDeployment(record({ network: 'devnet' }), chain());
  assert.deepEqual(failed(result), ['cluster']);
});

test('one flipped byte fails both hashes', () => {
  const bytes = Uint8Array.from(build);
  bytes[500] ^= 1;
  const result = checkDeployment(record(), chain({ programData: programDataAccount({ bytes }) }));
  assert.deepEqual(failed(result), ['sha256', 'executable hash']);
});

test('bytes after the build fail the padding and executable hash checks', () => {
  const bytes = new Uint8Array(1200);
  bytes.set(build);
  bytes[1100] = 9;
  const result = checkDeployment(record(), chain({ programData: programDataAccount({ bytes }) }));
  assert.deepEqual(failed(result), ['padding', 'executable hash']);
});

test('a mismatched record (another build) fails', () => {
  const other = record({ sha256: sha(new Uint8Array([1, 2, 3])), executableHash: trimmedHash(new Uint8Array([1, 2, 3])) });
  assert.deepEqual(failed(checkDeployment(other, chain())), ['sha256', 'executable hash']);
});

test('a reserved area smaller than the build fails the length check', () => {
  const result = checkDeployment(record({ size: 2000 }), chain());
  assert.ok(failed(result).includes('length'));
});

test('the deployer still holding authority fails', () => {
  const result = checkDeployment(record(), chain({ programData: programDataAccount({ authority: DEPLOYER }) }));
  assert.deepEqual(failed(result), ['upgrade authority']);
});

test('a forbidden authority (the multisig account) fails even if recorded', () => {
  const result = checkDeployment(record({ upgradeAuthority: SOME_MULTISIG, forbiddenAuthorities: [] }),
    chain({ programData: programDataAccount({ authority: SOME_MULTISIG }) }));
  assert.equal(result.ok, true, 'recorded authority with no forbidden list passes');
  const forbidden = checkDeployment(record(), chain({ programData: programDataAccount({ authority: SOME_MULTISIG }) }));
  assert.deepEqual(failed(forbidden), ['upgrade authority']);
  assert.match(forbidden.items.find((i) => i.name === 'upgrade authority').detail, /forbidden/);
});

test('an immutable program fails the authority check', () => {
  const result = checkDeployment(record(), chain({ programData: programDataAccount({ authority: null }) }));
  assert.deepEqual(failed(result), ['upgrade authority']);
});

test('leftover deployer buffers fail; skipped when not asked', () => {
  assert.deepEqual(failed(checkDeployment(record(), chain({ buffers: [DEPLOYER] }))), ['deployer buffers']);
  const skipped = checkDeployment(record(), chain({ buffers: null }));
  assert.equal(skipped.items.some((i) => i.name === 'deployer buffers'), false);
  assert.equal(skipped.ok, true);
});

test('a missing or non-loader program fails early', () => {
  assert.deepEqual(failed(checkDeployment(record(), chain({ program: null }))), ['program account']);
  const wrongOwner = { ...programAccount(), owner: '11111111111111111111111111111111' };
  assert.deepEqual(failed(checkDeployment(record(), chain({ program: wrongOwner }))), ['program account']);
  const notExecutable = { ...programAccount(), executable: false };
  assert.deepEqual(failed(checkDeployment(record(), chain({ program: notExecutable }))), ['program account']);
  assert.deepEqual(failed(checkDeployment(record(), chain({ programData: null }))), ['program data account']);
});

test('record validation names each problem', () => {
  assert.deepEqual(recordProblems(record()), []);
  const bad = recordProblems({ network: 'testnet', programId: 'x', size: 0, sha256: 'ABC', executableHash: '', upgradeAuthority: 'nope' });
  assert.equal(bad.length, 6);
  assert.ok(recordProblems(record({ forbiddenAuthorities: [VAULT] })).some((p) => /forbidden/.test(p)));
});

test('committed release records are usable', () => {
  const devnet = JSON.parse(readFileSync(path.join(root, 'config/releases/v1-devnet-b71a91e.json'), 'utf8'));
  assert.deepEqual(recordProblems(devnet), []);
  assert.equal(devnet.network, 'devnet');
});

test('the CLI refuses an unusable record without touching the network', () => {
  const run = spawnSync(process.execPath, [path.join(root, 'scripts/check-escrow-deployment.mjs'), '--record', path.join(root, 'package.json'), '--url', 'http://127.0.0.1:9'], { encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /Nothing was checked/);
});

test('the CLI fails closed when the RPC cannot be reached and never prints the URL path', () => {
  const run = spawnSync(process.execPath, [
    path.join(root, 'scripts/check-escrow-deployment.mjs'),
    '--record', path.join(root, 'config/releases/v1-devnet-b71a91e.json'),
    '--url', 'http://127.0.0.1:9/secret-key-path',
  ], { encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.doesNotMatch(run.stdout + run.stderr, /secret-key-path/);
});
