// The Squads vault proposals the pause tool prints must stay the instructions the program was
// tested with: programs/pinocchio-escrow/interface/pause-vault-ix.json is run as the vault against the
// mainnet build in equivalence/tests/pause.rs. Offline: vault-ix reads no RPC and signs nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixture = JSON.parse(readFileSync(path.join(root, 'programs/pinocchio-escrow/interface/pause-vault-ix.json'), 'utf8'));

for (const [name, expected] of Object.entries(fixture.instructions)) {
  test(`vault-ix ${name} prints the instruction the program was tested with`, () => {
    const guardian = name === 'set-guardian' ? fixture.newGuardian : fixture.guardian;
    const out = JSON.parse(execFileSync(process.execPath, [path.join(root, 'scripts/emergency-pause.mjs'), 'vault-ix', name, '--guardian', guardian, '--network', 'mainnet'], { cwd: root, env: { ...process.env, SOLANA_RPC_URL: 'http://127.0.0.1:1' }, encoding: 'utf8' }));
    assert.deepEqual({ programId: out.programId, accounts: out.accounts, dataHex: out.dataHex }, expected);
  });
}
