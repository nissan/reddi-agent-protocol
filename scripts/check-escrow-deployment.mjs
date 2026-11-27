#!/usr/bin/env node
// Read-only launch check: is the deployed V1 escrow program the build of record,
// and does the right key control it?
//
// It takes a release record (the freeze manifest, see
// config/releases/README.md) and checks, in one run:
//   1. the RPC is the cluster the record names (genesis hash);
//   2. the program account is executable, owned by the upgradeable loader, and
//      points at its ProgramData account;
//   3. the ProgramData bytes after the 45-byte header equal the build of record:
//      the first `size` bytes have the recorded sha256, everything after them is
//      zero, and the trimmed hash (what `solana-verify get-executable-hash` and
//      `get-program-hash` print) equals the recorded executable hash;
//   4. the upgrade authority is the recorded one (on mainnet, the Squads vault),
//      and not any address listed under `forbiddenAuthorities`;
//   5. no loader buffer is left with the deployer (--deployer <address>, else the
//      record's `deployer`) as its authority; without either, this line fails
//      rather than being skipped;
//   6. for a build with the emergency pause (a record with `pauseGuardian`), the
//      pause account `["pause"]` exists, belongs to the program, holds a
//      PauseState naming a real guardian that is not the admin (and is the
//      record's `pauseGuardian` once that is set), and the protocol is not
//      paused now. Right after a deploy, before runbook §3a, pass
//      --pause-optional: a missing pause account is then reported, not failed.
//
// A mainnet record must name the Squads vault as the authority and list the
// multisig account and the deployer as forbidden. Genesis and accounts come from
// one RPC, so on launch day run it against two independent providers.
//
// It only reads accounts; it signs and sends nothing, and it prints only the RPC
// host, never the URL, so a keyed URL stays out of logs.
//
//   node scripts/check-escrow-deployment.mjs --record config/releases/<record>.json \
//     [--url <rpc>] [--deployer <address>] [--pause-optional] [--json]
//
// RPC: --url, else SOLANA_RPC_URL, else the record network's public RPC.
// Exit code 0 means every check passed, 1 means a check failed, 2 means the
// record or the RPC could not be used, so nothing was decided.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const UPGRADEABLE_LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
export const GENESIS = {
  mainnet: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
};
// The mainnet upgrade authority is always the Squads vault (never the multisig account).
export const MAINNET_VAULT = '5CsBuTBFKu12JSs4CUbmv5MR218RYtNmAoQmLf5x3Hxe';
// The V1 escrow program address (program keypair made 21 November 2026; same id on devnet).
export const MAINNET_PROGRAM_ID = 'DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu';
// `["pause"]` under the V1 program id (the same on both clusters), and who administers it.
export const PAUSE_ADDRESS = 'Fxx73r7JeSoCg28GhSGhksrwdpzRWWKXas5a2BQtkbEi';
export const PAUSE_ADMIN = {
  mainnet: MAINNET_VAULT,
  devnet: 'hbr2Fee3ewDbm33wTDrdEF3e7byNCzNgQ57CwJWaPtt',
};
const PAUSE_STATE_LEN = 89;
const ZERO_ADDRESS = '11111111111111111111111111111111';
const PUBLIC_RPC = {
  mainnet: 'https://api.mainnet-beta.solana.com',
  devnet: 'https://api.devnet.solana.com',
};
// UpgradeableLoaderState: Buffer = 1, Program = 2, ProgramData = 3 (u32 LE tag).
const PROGRAM_DATA_HEADER = 45; // tag 4 + slot 8 + Option<Pubkey> 1 + 32

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Encode(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  return '1'.repeat(zeros) + digits.reverse().map((d) => B58[d]).join('');
}

export function base58Decode(text) {
  const bytes = [];
  for (const ch of text) {
    const value = B58.indexOf(ch);
    if (value < 0) throw new Error('not base58');
    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const ch of text) {
    if (ch !== '1') break;
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

export function isAddress(text) {
  try {
    return typeof text === 'string' && base58Decode(text).length === 32;
  } catch {
    return false;
  }
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// solana-verify's executable hash: sha256 of the bytes with trailing zeros removed.
export function trimmedHash(bytes) {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return sha256(bytes.subarray(0, end));
}

const HEX64 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/;
const BUILD_RUN = /^https:\/\/github\.com\/nissan\/reddi-agent-protocol\/actions\/runs\/[0-9]+$/;

// Validates a release record and returns the problems found (empty when usable).
export function recordProblems(record) {
  const problems = [];
  if (!record || typeof record !== 'object') return ['record is not a JSON object'];
  if (!(record.network in GENESIS)) problems.push('network must be mainnet or devnet');
  if (!isAddress(record.programId)) problems.push('programId is not an address');
  if (!Number.isInteger(record.size) || record.size <= 0) problems.push('size must be a positive whole number of bytes');
  if (!HEX64.test(record.sha256 ?? '')) problems.push('sha256 must be 64 lowercase hex characters (sha256 of the .so file)');
  if (!HEX64.test(record.executableHash ?? '')) problems.push('executableHash must be 64 lowercase hex characters (solana-verify get-executable-hash)');
  if (!isAddress(record.upgradeAuthority)) problems.push('upgradeAuthority is not an address');
  // Provenance: which build this is, so a record cannot pass for a build it does not name.
  if (record.variant !== record.network) problems.push('variant must equal network (the build matrix entry for that cluster)');
  if (!COMMIT.test(record.commit ?? '')) problems.push('commit must be a full 40-character commit hash');
  if (!BUILD_RUN.test(record.buildRun ?? '')) problems.push('buildRun must be an escrow-verifiable-build.yml run URL in this repository');
  if (typeof record.image !== 'string' || !record.image.startsWith('solanafoundation/solana-verifiable-build:')) {
    problems.push('image must be the solanafoundation/solana-verifiable-build image the run used');
  }
  for (const address of record.forbiddenAuthorities ?? []) {
    if (!isAddress(address)) problems.push(`forbiddenAuthorities entry ${address} is not an address`);
  }
  if ((record.forbiddenAuthorities ?? []).includes(record.upgradeAuthority)) {
    problems.push('upgradeAuthority is also listed as forbidden');
  }
  // The oldest SDK and provider kit that handle this build safely (for example, that refuse an escrow
  // flag they cannot serve). Sellers on older versions must upgrade before the build is deployed.
  if (record.minimumPackages !== undefined) {
    const entries = record.minimumPackages && typeof record.minimumPackages === 'object' ? Object.entries(record.minimumPackages) : null;
    if (!entries || entries.length === 0) problems.push('minimumPackages must map package names to versions');
    else for (const [name, version] of entries) {
      if (!/^@redditech\/[a-z0-9-]+$/.test(name) || !/^\d+\.\d+\.\d+$/.test(String(version))) problems.push(`minimumPackages entry ${name} must be an @redditech package and an x.y.z version`);
    }
  }
  if (record.pauseGuardian !== undefined) {
    if (record.programId !== MAINNET_PROGRAM_ID) problems.push(`pauseGuardian is only checked for the V1 escrow program ${MAINNET_PROGRAM_ID}`);
    if (record.pauseGuardian !== null && !isAddress(record.pauseGuardian)) problems.push('pauseGuardian must be an address, or null until runbook §3a names one');
  }
  if (record.deployer !== undefined && record.deployer !== null) {
    if (!isAddress(record.deployer)) problems.push('deployer is not an address');
    else if (!(record.forbiddenAuthorities ?? []).includes(record.deployer)) problems.push('deployer must also be listed under forbiddenAuthorities');
  }
  if (record.network === 'mainnet') {
    if (record.programId !== MAINNET_PROGRAM_ID) problems.push(`a mainnet record's programId must be the V1 escrow program ${MAINNET_PROGRAM_ID}`);
    if (!IMAGE_DIGEST.test(record.imageDigest ?? '')) problems.push('a mainnet record must give imageDigest as sha256:<64 hex>');
    if (record.upgradeAuthority !== MAINNET_VAULT) problems.push(`a mainnet record's upgradeAuthority must be the Squads vault ${MAINNET_VAULT}`);
    if (!Array.isArray(record.forbiddenAuthorities) || record.forbiddenAuthorities.length < 2) {
      problems.push('a mainnet record must list the multisig account and the deployer under forbiddenAuthorities');
    }
  }
  return problems;
}

// Pure check over account data already read from chain. `program` and
// `programData` are { owner, executable, data: Uint8Array } or null.
//
// `pause` is the pause account ({ owner, data }) or null, and `slot` the current slot; both are
// only read for a record with `pauseGuardian`. `pauseOptional` reports a missing pause account
// instead of failing on it (right after a deploy, before runbook §3a).
export function checkDeployment(record, { genesisHash, program, programData, buffers = [], pause, slot, pauseOptional = false }) {
  const items = [];
  const add = (name, ok, detail) => items.push({ name, ok, detail });

  add('cluster', genesisHash === GENESIS[record.network],
    genesisHash === GENESIS[record.network] ? `${record.network} genesis` : `RPC genesis ${genesisHash} is not ${record.network}`);
  // Nothing else on a wrong cluster means anything.
  if (genesisHash !== GENESIS[record.network]) return finish(items);

  if (!program) {
    add('program account', false, `${record.programId} does not exist`);
    return finish(items);
  }
  const programOk = program.owner === UPGRADEABLE_LOADER && program.executable === true
    && program.data.length === 36 && readU32(program.data, 0) === 2;
  add('program account', programOk, programOk
    ? 'executable, owned by the upgradeable loader'
    : `owner ${program.owner}, executable ${program.executable}, ${program.data.length} data bytes`);
  if (!programOk) return finish(items);
  const programDataAddress = base58Encode(program.data.subarray(4, 36));

  if (!programData) {
    add('program data account', false, `${programDataAddress} does not exist`);
    return finish(items);
  }
  const dataOk = programData.owner === UPGRADEABLE_LOADER && programData.data.length >= PROGRAM_DATA_HEADER
    && readU32(programData.data, 0) === 3;
  add('program data account', dataOk, dataOk
    ? `${programDataAddress}, last deployed in slot ${readU64(programData.data, 4)}`
    : `${programDataAddress}: owner ${programData.owner}, not a ProgramData account`);
  if (!dataOk) return finish(items);

  const bytes = programData.data.subarray(PROGRAM_DATA_HEADER);
  const fits = bytes.length >= record.size;
  add('length', fits, fits
    ? `${bytes.length} bytes reserved, build is ${record.size}`
    : `${bytes.length} bytes reserved, smaller than the ${record.size}-byte build`);
  if (fits) {
    const head = sha256(bytes.subarray(0, record.size));
    add('sha256', head === record.sha256, head === record.sha256
      ? `first ${record.size} bytes match ${record.sha256}`
      : `first ${record.size} bytes hash to ${head}, record says ${record.sha256}`);
    const tail = bytes.subarray(record.size);
    const firstNonZero = tail.findIndex((b) => b !== 0);
    add('padding', firstNonZero === -1, firstNonZero === -1
      ? `${tail.length} bytes after the build are zero`
      : `non-zero byte ${firstNonZero} bytes after the end of the build`);
  }
  const trimmed = trimmedHash(bytes);
  add('executable hash', trimmed === record.executableHash, trimmed === record.executableHash
    ? `matches ${record.executableHash}`
    : `on chain ${trimmed}, record says ${record.executableHash}`);

  const hasAuthority = programData.data[12] === 1;
  const authority = hasAuthority ? base58Encode(programData.data.subarray(13, 45)) : null;
  const forbidden = authority !== null && (record.forbiddenAuthorities ?? []).includes(authority);
  const authorityOk = authority === record.upgradeAuthority && !forbidden;
  add('upgrade authority', authorityOk, authority === null
    ? 'none (the program is immutable)'
    : forbidden ? `${authority} is a forbidden authority`
      : authorityOk ? `${authority}` : `${authority}, record says ${record.upgradeAuthority}`);

  if (buffers === null) {
    // Not checked is not passed: a launch run must name the deployer.
    add('deployer buffers', false, 'not checked: pass --deployer <address>');
  } else {
    add('deployer buffers', buffers.length === 0, buffers.length === 0
      ? 'no buffer left with the deployer as authority'
      : `${buffers.length} buffer(s) left: ${buffers.join(', ')} (close them and reclaim the rent)`);
  }

  if (record.pauseGuardian !== undefined) checkPause(record, { pause, slot, pauseOptional }, add);
  return finish(items);
}

export function pauseStateDiscriminator() {
  return createHash('sha256').update('account:PauseState').digest().subarray(0, 8);
}

function checkPause(record, { pause, slot, pauseOptional }, add) {
  if (!pause) {
    add('pause account', pauseOptional, pauseOptional
      ? `${PAUSE_ADDRESS} not created yet (--pause-optional): do runbook §3a, then run this again without it`
      : `${PAUSE_ADDRESS} does not exist: every lock, Budget open, reserve and payout is refused until init_pause (runbook §3a)`);
    return;
  }
  const shapeOk = pause.owner === record.programId && pause.data.length === PAUSE_STATE_LEN
    && Buffer.from(pause.data.subarray(0, 8)).equals(pauseStateDiscriminator());
  if (!shapeOk) {
    add('pause account', false, `${PAUSE_ADDRESS}: owner ${pause.owner}, ${pause.data.length} data bytes, not the program's PauseState`);
    return;
  }
  const guardian = base58Encode(pause.data.subarray(8, 40));
  const admin = PAUSE_ADMIN[record.network];
  const guardianOk = guardian !== ZERO_ADDRESS && guardian !== admin
    && (record.pauseGuardian === null || guardian === record.pauseGuardian);
  add('pause account', guardianOk, guardianOk
    ? `${PAUSE_ADDRESS}, guardian ${guardian}${record.pauseGuardian === null ? ' (record has no pauseGuardian yet: set it)' : ''}`
    : guardian === ZERO_ADDRESS || guardian === admin ? `guardian ${guardian} is not a usable guardian`
      : `guardian ${guardian}, record says ${record.pauseGuardian}`);
  const until = new DataView(pause.data.buffer, pause.data.byteOffset + 40, 8).getBigUint64(0, true);
  const now = slot === undefined || slot === null ? null : BigInt(slot);
  if (now === null) {
    add('pause state', false, 'not checked: the current slot was not read');
    return;
  }
  add('pause state', until <= now, until <= now
    ? 'not paused'
    : `PAUSED until slot ${until} (now ${now}, about ${((until - now) * 400n) / 3_600_000n} h left): see EMERGENCY-PAUSE-RUNBOOK.md`);
}

function finish(items) {
  return { ok: items.every((item) => item.ok), items };
}

function readU32(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

function readU64(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigUint64(0, true).toString();
}

export async function rpc(url, method, params) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`${method} returned HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message ?? 'RPC error'}`);
  return body.result;
}

export async function readAccount(url, address) {
  const result = await rpc(url, 'getAccountInfo', [address, { encoding: 'base64', commitment: 'finalized' }]);
  if (!result.value) return null;
  const { owner, executable, data } = result.value;
  return { owner, executable, data: new Uint8Array(Buffer.from(data[0], 'base64')) };
}

// Loader buffers (tag 1) whose authority (Option<Pubkey> at offset 4) is the deployer.
export async function readDeployerBuffers(url, deployer) {
  const result = await rpc(url, 'getProgramAccounts', [UPGRADEABLE_LOADER, {
    encoding: 'base64',
    commitment: 'finalized',
    dataSlice: { offset: 0, length: 0 },
    filters: [
      { memcmp: { offset: 0, bytes: base58Encode(Uint8Array.from([1, 0, 0, 0, 1])) } },
      { memcmp: { offset: 5, bytes: deployer } },
    ],
  }]);
  return result.map((entry) => entry.pubkey);
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const recordPath = arg('record');
  if (!recordPath) {
    console.error('Usage: node scripts/check-escrow-deployment.mjs --record <release record JSON> [--url <rpc>] [--deployer <address>] [--pause-optional] [--json]');
    return 2;
  }
  let record;
  try {
    record = JSON.parse(readFileSync(recordPath, 'utf8'));
  } catch (error) {
    console.error(`Could not read the record: ${error instanceof Error ? error.message.split('\n')[0] : 'unknown error'}`);
    return 2;
  }
  const problems = recordProblems(record);
  // --deployer wins; otherwise the record's own deployer, so a scheduled run checks buffers too.
  const deployer = arg('deployer') ?? record.deployer ?? undefined;
  if (deployer !== undefined && !isAddress(deployer)) problems.push('--deployer is not an address');
  if (deployer !== undefined && record.network === 'mainnet' && !(record.forbiddenAuthorities ?? []).includes(deployer)) {
    problems.push('the --deployer address must be listed under forbiddenAuthorities');
  }
  if (problems.length) {
    for (const problem of problems) console.error(`Record problem: ${problem}`);
    console.error('Nothing was checked.');
    return 2;
  }
  const url = arg('url') ?? process.env.SOLANA_RPC_URL ?? PUBLIC_RPC[record.network];
  const host = (() => { try { return new URL(url).host; } catch { return 'invalid url'; } })();

  let result;
  try {
    const genesisHash = await rpc(url, 'getGenesisHash', []);
    let program = null;
    let programData = null;
    let buffers = null;
    let pause;
    let slot;
    // Read nothing more from a wrong cluster.
    if (genesisHash === GENESIS[record.network]) {
      if (record.pauseGuardian !== undefined) {
        pause = await readAccount(url, PAUSE_ADDRESS);
        slot = await rpc(url, 'getSlot', [{ commitment: 'finalized' }]);
      }
      program = await readAccount(url, record.programId);
      if (program && program.data.length === 36) {
        programData = await readAccount(url, base58Encode(program.data.subarray(4, 36)));
      }
      if (deployer) buffers = await readDeployerBuffers(url, deployer);
    }
    result = checkDeployment(record, { genesisHash, program, programData, buffers, pause, slot, pauseOptional: process.argv.includes('--pause-optional') });
  } catch (error) {
    console.error(`Could not read from ${host}: ${error instanceof Error ? error.message.split('\n')[0] : 'unknown error'}. Nothing was decided.`);
    return 2;
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ network: record.network, programId: record.programId, rpcHost: host, ...result }, null, 2));
  } else {
    console.log(`Escrow program deployment on ${record.network} (RPC ${host}): ${record.programId}`);
    for (const item of result.items) console.log(`${item.ok ? 'ok  ' : 'FAIL'} ${item.name}: ${item.detail}`);
    console.log(result.ok ? 'The deployed program is the build of record under the recorded authority.' : 'Not verified: fix the FAIL lines before going on.');
  }
  return result.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main());
}
