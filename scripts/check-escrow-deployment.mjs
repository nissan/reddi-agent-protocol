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
//      rather than being skipped.
//
// A mainnet record must name the Squads vault as the authority and list the
// multisig account and the deployer as forbidden. Genesis and accounts come from
// one RPC, so on launch day run it against two independent providers.
//
// It only reads accounts; it signs and sends nothing, and it prints only the RPC
// host, never the URL, so a keyed URL stays out of logs.
//
//   node scripts/check-escrow-deployment.mjs --record config/releases/<record>.json \
//     [--url <rpc>] [--deployer <address>] [--json]
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
  for (const address of record.forbiddenAuthorities ?? []) {
    if (!isAddress(address)) problems.push(`forbiddenAuthorities entry ${address} is not an address`);
  }
  if ((record.forbiddenAuthorities ?? []).includes(record.upgradeAuthority)) {
    problems.push('upgradeAuthority is also listed as forbidden');
  }
  if (record.deployer !== undefined && record.deployer !== null) {
    if (!isAddress(record.deployer)) problems.push('deployer is not an address');
    else if (!(record.forbiddenAuthorities ?? []).includes(record.deployer)) problems.push('deployer must also be listed under forbiddenAuthorities');
  }
  if (record.network === 'mainnet') {
    if (record.programId !== MAINNET_PROGRAM_ID) problems.push(`a mainnet record's programId must be the V1 escrow program ${MAINNET_PROGRAM_ID}`);
    if (record.upgradeAuthority !== MAINNET_VAULT) problems.push(`a mainnet record's upgradeAuthority must be the Squads vault ${MAINNET_VAULT}`);
    if (!Array.isArray(record.forbiddenAuthorities) || record.forbiddenAuthorities.length < 2) {
      problems.push('a mainnet record must list the multisig account and the deployer under forbiddenAuthorities');
    }
  }
  return problems;
}

// Pure check over account data already read from chain. `program` and
// `programData` are { owner, executable, data: Uint8Array } or null.
export function checkDeployment(record, { genesisHash, program, programData, buffers = [] }) {
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
  return finish(items);
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

async function rpc(url, method, params) {
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

async function readAccount(url, address) {
  const result = await rpc(url, 'getAccountInfo', [address, { encoding: 'base64', commitment: 'finalized' }]);
  if (!result.value) return null;
  const { owner, executable, data } = result.value;
  return { owner, executable, data: new Uint8Array(Buffer.from(data[0], 'base64')) };
}

// Loader buffers (tag 1) whose authority (Option<Pubkey> at offset 4) is the deployer.
async function readDeployerBuffers(url, deployer) {
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
    console.error('Usage: node scripts/check-escrow-deployment.mjs --record <release record JSON> [--url <rpc>] [--deployer <address>] [--json]');
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
    // Read nothing more from a wrong cluster.
    if (genesisHash === GENESIS[record.network]) {
      program = await readAccount(url, record.programId);
      if (program && program.data.length === 36) {
        programData = await readAccount(url, base58Encode(program.data.subarray(4, 36)));
      }
      if (deployer) buffers = await readDeployerBuffers(url, deployer);
    }
    result = checkDeployment(record, { genesisHash, program, programData, buffers });
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
