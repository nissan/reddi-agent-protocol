import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GENESIS, MAINNET_PROGRAM_ID, PAUSE_ADDRESS, UPGRADEABLE_LOADER, base58Decode, base58Encode, checkDeployment, pauseStateDiscriminator,
  recordProblems, trimmedHash,
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
    variant: 'mainnet',
    commit: '45e9547846037b9faedb077970afd9f27db828aa',
    buildRun: 'https://github.com/nissan/reddi-agent-protocol/actions/runs/45124021410',
    image: 'solanafoundation/solana-verifiable-build:4.2.2',
    imageDigest: 'sha256:16053d845922e798ab1852d3fe222faf5a23eeb1db3a13d30b70d6b6e82184ae',
    programId: PROGRAM_ID,
    size: build.length,
    sha256: sha(build),
    executableHash: trimmedHash(build),
    upgradeAuthority: VAULT,
    forbiddenAuthorities: [SOME_MULTISIG, DEPLOYER],
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

test('leftover deployer buffers fail, and an unchecked buffer line fails too', () => {
  assert.deepEqual(failed(checkDeployment(record(), chain({ buffers: [DEPLOYER] }))), ['deployer buffers']);
  const unchecked = checkDeployment(record(), chain({ buffers: null }));
  assert.deepEqual(failed(unchecked), ['deployer buffers']);
  assert.match(unchecked.items.find((i) => i.name === 'deployer buffers').detail, /not checked/);
  assert.equal(unchecked.ok, false);
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
  assert.equal(bad.length, 10);
  assert.ok(recordProblems(record({ forbiddenAuthorities: [VAULT, DEPLOYER] })).some((p) => /forbidden/.test(p)));
});

test('S1-R2-01: a mainnet record that keeps the devnet variant is refused', () => {
  assert.deepEqual(recordProblems(record({ variant: 'devnet' })), ['variant must equal network (the build matrix entry for that cluster)']);
  assert.ok(recordProblems(record({ variant: undefined })).some((p) => /variant must equal network/.test(p)));
});

test('S1-R2-01: a mainnet record naming another valid program id is refused', () => {
  assert.deepEqual(recordProblems(record({ programId: PROGRAM_DATA })),
    [`a mainnet record's programId must be the V1 escrow program ${PROGRAM_ID}`]);
});

test('S1-R2-01: a record without its provenance is refused', () => {
  const bare = record({ commit: undefined, variant: undefined, image: undefined, imageDigest: undefined, buildRun: undefined });
  const problems = recordProblems(bare);
  for (const field of [/variant/, /commit/, /buildRun/, /^image must/, /imageDigest/]) {
    assert.ok(problems.some((p) => field.test(p)), `missing ${field} is named`);
  }
  assert.ok(recordProblems(record({ commit: '45e9547' })).some((p) => /40-character/.test(p)), 'a short commit is refused');
  assert.ok(recordProblems(record({ buildRun: 'https://github.com/someone-else/fork/actions/runs/1' })).some((p) => /buildRun/.test(p)));
  assert.ok(recordProblems(record({ imageDigest: null })).some((p) => /imageDigest/.test(p)));
  // Size and both hashes were already required.
  assert.ok(recordProblems(record({ size: undefined, sha256: undefined, executableHash: undefined })).length >= 3);
  // A devnet record may lack the digest (the b71a91e record predates it) but not the rest.
  assert.deepEqual(recordProblems(record({ network: 'devnet', variant: 'devnet', imageDigest: null, upgradeAuthority: DEPLOYER, forbiddenAuthorities: [] })), []);
  assert.ok(recordProblems(record({ network: 'devnet', variant: 'devnet', commit: undefined, upgradeAuthority: DEPLOYER, forbiddenAuthorities: [] })).some((p) => /commit/.test(p)));
});

test('a mainnet record must name the vault and list forbidden authorities', () => {
  assert.ok(recordProblems(record({ upgradeAuthority: SOME_MULTISIG, forbiddenAuthorities: [DEPLOYER, PROGRAM_ID] }))
    .some((p) => /Squads vault/.test(p)));
  assert.ok(recordProblems(record({ forbiddenAuthorities: [] })).some((p) => /multisig account and the deployer/.test(p)));
  assert.ok(recordProblems(record({ forbiddenAuthorities: undefined })).some((p) => /multisig account and the deployer/.test(p)));
  assert.ok(recordProblems(record({ forbiddenAuthorities: [SOME_MULTISIG] })).some((p) => /multisig account and the deployer/.test(p)));
  // Devnet keeps the deployer as its authority, so neither rule applies there.
  assert.deepEqual(recordProblems(record({ network: 'devnet', variant: 'devnet', upgradeAuthority: DEPLOYER, forbiddenAuthorities: [] })), []);
});

test('a mainnet record must name the V1 escrow program, so another program cannot pass as it', () => {
  assert.equal(MAINNET_PROGRAM_ID, PROGRAM_ID);
  assert.deepEqual(recordProblems(record({ programId: SOME_MULTISIG })),
    [`a mainnet record's programId must be the V1 escrow program ${PROGRAM_ID}`]);
  // A devnet record may name another program (a test deployment).
  assert.deepEqual(recordProblems(record({ network: 'devnet', variant: 'devnet', programId: SOME_MULTISIG, upgradeAuthority: DEPLOYER, forbiddenAuthorities: [] })), []);
});

test('the CLI refuses a mainnet --deployer that the record does not forbid', () => {
  const S = path.join(root, '.tmp');
  mkdirSync(S, { recursive: true });
  const file = path.join(S, 'check-escrow-deployment-record.json');
  writeFileSync(file, JSON.stringify(record()));
  const run = spawnSync(process.execPath, [path.join(root, 'scripts/check-escrow-deployment.mjs'), '--record', file,
    '--deployer', PROGRAM_ID, '--url', 'http://127.0.0.1:9'], { encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /must be listed under forbiddenAuthorities/);
});

test('a record may name its deployer, which must be forbidden, and the CLI then checks its buffers', () => {
  assert.deepEqual(recordProblems(record({ deployer: DEPLOYER })), []);
  assert.deepEqual(recordProblems(record({ deployer: 'not-an-address' })), ['deployer is not an address']);
  assert.deepEqual(recordProblems(record({ deployer: VAULT, forbiddenAuthorities: [SOME_MULTISIG, DEPLOYER] })),
    ['deployer must also be listed under forbiddenAuthorities']);
  // With the deployer in the record and no --deployer, the CLI gets as far as the RPC (exit 2 here, nothing decided).
  const S = path.join(root, '.tmp');
  mkdirSync(S, { recursive: true });
  const file = path.join(S, 'check-escrow-deployment-record-deployer.json');
  writeFileSync(file, JSON.stringify(record({ deployer: DEPLOYER })));
  const run = spawnSync(process.execPath, [path.join(root, 'scripts/check-escrow-deployment.mjs'), '--record', file,
    '--url', 'http://127.0.0.1:9'], { encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.doesNotMatch(run.stderr, /Record problem/);
  assert.match(run.stderr, /Could not read from 127\.0\.0\.1:9/);
});

test('the weekly watch points at a committed mainnet record of the V1 program', () => {
  const workflow = readFileSync(path.join(root, '.github/workflows/escrow-deployment-watch.yml'), 'utf8');
  const match = workflow.match(/^\s*MAINNET_RECORD:\s*(\S+)\s*$/m);
  assert.ok(match, 'MAINNET_RECORD is set in the workflow');
  const watched = JSON.parse(readFileSync(path.join(root, match[1]), 'utf8'));
  assert.equal(watched.network, 'mainnet');
  assert.equal(watched.programId, MAINNET_PROGRAM_ID);
  assert.match(workflow, /cron: "\d+ \d+ \* \* \d"/, 'it runs weekly');
  assert.match(workflow, /--assignee "\$OWNER"/, 'a failure is assigned to the owner');
  // It reads a secret and can write issues: actions pinned by commit, and the public issue gets verdict lines only.
  for (const line of workflow.match(/uses: \S+/g)) assert.match(line, /@[0-9a-f]{40}$/, `${line} is pinned to a commit`);
  assert.doesNotMatch(workflow, /tail -n/, 'the raw log never goes into the issue');
  assert.match(workflow, /MAINNET_RPC_URL"\/<rpc>/, 'the RPC URL is scrubbed from the issue body');
});

test('committed release records are usable', () => {
  const devnet = JSON.parse(readFileSync(path.join(root, 'config/releases/v1-devnet-b71a91e.json'), 'utf8'));
  assert.deepEqual(recordProblems(devnet), []);
  assert.equal(devnet.network, 'devnet');
});

test('the 45e9547 devnet record is the deployed freeze build, and its mainnet record is withdrawn', () => {
  const read = (name) => JSON.parse(readFileSync(path.join(root, 'config/releases', name), 'utf8'));
  const devnet = read('v1-devnet-45e9547.json');
  assert.deepEqual(recordProblems(devnet), []);
  assert.equal(devnet.commit, '45e9547846037b9faedb077970afd9f27db828aa');
  assert.equal(devnet.deployedSlot, 525663342);
  // The program was reopened for the delivery check: nothing may be deployed to mainnet from 45e9547.
  assert.equal(existsSync(path.join(root, 'config/releases/v1-mainnet-45e9547.json')), false);
});

test('the 9c34fac devnet record is the deployed delivery-check build, and its mainnet record is withdrawn', () => {
  const read = (name) => JSON.parse(readFileSync(path.join(root, 'config/releases', name), 'utf8'));
  const devnet = read('v1-devnet-9c34fac.json');
  assert.deepEqual(recordProblems(devnet), []);
  assert.equal(devnet.commit, '9c34fac879bcde4519824eabaaea3ddf886e51f1');
  // Devnet was upgraded to this build in slot 525720300 (24 November 2026).
  assert.equal(devnet.deployedSlot, 525720300);
  // The first delivery-check cut (63d4719) was replaced unused by the refund-timing fix.
  for (const name of ['v1-devnet-63d4719.json', 'v1-mainnet-63d4719.json']) assert.equal(existsSync(path.join(root, 'config/releases', name)), false);
  // The pooled Budget reopened the program: nothing may be deployed to mainnet from 9c34fac.
  assert.equal(existsSync(path.join(root, 'config/releases/v1-mainnet-9c34fac.json')), false);
});

test('the pooled-Budget devnet record at 339ac70 is deployed and its mainnet record was retired unused', () => {
  const devnet = JSON.parse(readFileSync(path.join(root, 'config/releases/v1-devnet-339ac70.json'), 'utf8'));
  assert.deepEqual(recordProblems(devnet), []);
  assert.equal(devnet.commit, '339ac70a5821cd9b69d2fb8639474971b0fca5b9');
  assert.equal(devnet.buildRun, 'https://github.com/nissan/reddi-agent-protocol/actions/runs/45392652948');
  // Devnet was upgraded to this build in slot 525941760 (24 November 2026).
  assert.equal(devnet.deployedSlot, 525941760);
  assert.equal(devnet.size, 195704);
  // The emergency pause reopened the program: nothing may be deployed to mainnet from 339ac70.
  assert.equal(existsSync(path.join(root, 'config/releases/v1-mainnet-339ac70.json')), false);
  // The first pooled-Budget cut (64543ff) was replaced unused by the P-256 spender change.
  for (const name of ['v1-devnet-64543ff.json', 'v1-mainnet-64543ff.json']) assert.equal(existsSync(path.join(root, 'config/releases', name)), false);
});

test('the emergency-pause records at 83045ee agree with each other and the mainnet one fails closed until deploy', () => {
  const read = (name) => JSON.parse(readFileSync(path.join(root, 'config/releases', name), 'utf8'));
  const devnet = read('v1-devnet-83045ee.json');
  const mainnet = read('v1-mainnet-83045ee.json');
  assert.deepEqual(recordProblems(devnet), []);
  for (const record of [devnet, mainnet]) {
    assert.equal(record.commit, '83045ee747827aed4c822f94323f7070562584e8');
    assert.equal(record.buildRun, 'https://github.com/nissan/reddi-agent-protocol/actions/runs/45950055341');
    assert.equal(record.network, record.variant);
    assert.equal(record.imageDigest, 'sha256:16053d845922e798ab1852d3fe222faf5a23eeb1db3a13d30b70d6b6e82184ae');
  }
  // Devnet was upgraded to this build in slot 527037337 (28 November 2026, Sydney) and init_pause
  // named the devnet guardian straight after; mainnet is not deployed yet.
  assert.equal(devnet.deployedSlot, 527037337);
  assert.equal(devnet.pauseGuardian, 'ENNsNkPGh2tBmjpNsE8iq5JoLeW72E2nprQL7rYVrMRb');
  assert.equal(mainnet.deployedSlot, null);
  assert.equal(devnet.size, 206184);
  assert.equal(mainnet.size, 206120);
  // The mainnet build is the one the pause round reviewed.
  assert.equal(mainnet.sha256, 'd6d8b91eb3d7b88b4c6776eb581e9f90759f6d694ae67b3262ac3a8ef3d9753c');
  assert.equal(mainnet.executableHash, '7a7f8144cf3873d641e6091df1394b9f410a0df121ec7200624213cb838d00c4');
  // Gated instructions take the pause account: sellers need the clients that append it.
  const minimum = { '@redditech/x402-solana': '0.2.2', '@redditech/provider-kit': '0.4.2' };
  const atLeast = (have, want) => { const [a, b] = [have, want].map((v) => v.split('.').map(Number)); for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]; return true; };
  for (const record of [devnet, mainnet]) {
    assert.deepEqual(record.minimumPackages, minimum);
    for (const [name, version] of Object.entries(record.minimumPackages)) {
      const pkg = JSON.parse(readFileSync(path.join(root, 'packages', name.split('/')[1], 'package.json'), 'utf8'));
      assert.ok(atLeast(pkg.version, version), `${name} in this repository (${pkg.version}) is older than the record's minimum ${version}`);
    }
  }
  assert.notEqual(devnet.executableHash, mainnet.executableHash);
  assert.equal(mainnet.upgradeAuthority, VAULT);
  assert.ok(mainnet.forbiddenAuthorities.includes(DEPLOYER), 'the devnet deployer must never control mainnet');
  assert.deepEqual(recordProblems(mainnet), ['a mainnet record must list the multisig account and the deployer under forbiddenAuthorities']);
});

test('minimumPackages, when present, names @redditech packages and x.y.z versions', () => {
  assert.deepEqual(recordProblems(record({ minimumPackages: { '@redditech/x402-solana': '0.1.3' } })), []);
  assert.ok(recordProblems(record({ minimumPackages: {} })).some((p) => /minimumPackages/.test(p)));
  assert.ok(recordProblems(record({ minimumPackages: { 'left-pad': '1.0.0' } })).some((p) => /minimumPackages/.test(p)));
  assert.ok(recordProblems(record({ minimumPackages: { '@redditech/x402-solana': '^0.1.3' } })).some((p) => /minimumPackages/.test(p)));
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

// The emergency pause (runbook §3a): a record with pauseGuardian also checks the pause account.
const GUARDIAN = 'US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx';

function pauseAccount({ guardian = GUARDIAN, until = 0n, owner = PROGRAM_ID, len = 89, disc = pauseStateDiscriminator() } = {}) {
  const data = new Uint8Array(len);
  data.set(disc.subarray(0, Math.min(8, len)), 0);
  if (len >= 48) {
    data.set(base58Decode(guardian), 8);
    new DataView(data.buffer).setBigUint64(40, until, true);
  }
  return { owner, executable: false, data };
}

function withPause(rec, pause, extra = {}) {
  return checkDeployment(rec, { genesisHash: GENESIS.mainnet, program: programAccount(), programData: programDataAccount(), buffers: [], pause, slot: 1_000n, ...extra });
}

const line = (result, name) => result.items.find((item) => item.name === name);

test('pause: an initialised, unpaused pause account naming the recorded guardian passes', () => {
  const result = withPause(record({ pauseGuardian: GUARDIAN }), pauseAccount());
  assert.equal(result.ok, true, JSON.stringify(result.items));
  assert.match(line(result, 'pause account').detail, new RegExp(GUARDIAN));
  assert.equal(line(result, 'pause state').detail, 'not paused');
  assert.equal(PAUSE_ADDRESS, 'Fxx73r7JeSoCg28GhSGhksrwdpzRWWKXas5a2BQtkbEi');
});

test('pause: a missing pause account fails, unless --pause-optional (before §3a)', () => {
  assert.equal(withPause(record({ pauseGuardian: null }), null).ok, false);
  const optional = withPause(record({ pauseGuardian: null }), null, { pauseOptional: true });
  assert.equal(optional.ok, true);
  assert.match(line(optional, 'pause account').detail, /not created yet/);
});

test('pause: a running pause, a wrong guardian, the admin or zero as guardian, and a look-alike account fail', () => {
  const rec = record({ pauseGuardian: GUARDIAN });
  const paused = withPause(rec, pauseAccount({ until: 5_000n }));
  assert.equal(paused.ok, false);
  assert.match(line(paused, 'pause state').detail, /PAUSED until slot 5000/);
  assert.equal(withPause(rec, pauseAccount({ until: 1_000n })).ok, true, 'a pause that ends this slot is over');
  assert.equal(withPause(rec, pauseAccount({ guardian: SOME_MULTISIG })).ok, false);
  assert.equal(withPause(record({ pauseGuardian: null }), pauseAccount({ guardian: VAULT })).ok, false);
  assert.equal(withPause(record({ pauseGuardian: null }), pauseAccount({ guardian: '11111111111111111111111111111111' })).ok, false);
  assert.equal(withPause(rec, pauseAccount({ owner: UPGRADEABLE_LOADER })).ok, false);
  assert.equal(withPause(rec, pauseAccount({ len: 90 })).ok, false);
  assert.equal(withPause(rec, pauseAccount({ disc: Buffer.alloc(8) })).ok, false);
  assert.equal(withPause(rec, pauseAccount(), { slot: undefined }).ok, false, 'an unread slot is not a pass');
});

test('pause: a record without pauseGuardian (a build from before the pause) does not check it', () => {
  const result = withPause(record(), null);
  assert.equal(result.ok, true);
  assert.equal(line(result, 'pause account'), undefined);
});

test('pause: pauseGuardian must be an address or null, and only for the V1 program', () => {
  assert.ok(recordProblems(record({ pauseGuardian: 'nope' })).some((p) => /pauseGuardian/.test(p)));
  assert.deepEqual(recordProblems(record({ pauseGuardian: null })), []);
});
