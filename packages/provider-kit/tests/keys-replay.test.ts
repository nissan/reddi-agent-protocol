import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import { loadProviderKey } from "../src/keys.js";
import { FileReplayStore } from "../src/replay.js";

const keypair = Keypair.generate();
const wallet = keypair.publicKey.toBase58();
const file = JSON.stringify([...keypair.secretKey]);
const load = (overrides: Partial<Parameters<typeof loadProviderKey>[0]> = {}) => loadProviderKey({ keypairPath: "/keys/id.json", wallet, readFile: () => file, fileMode: () => 0o100600, ...overrides });

test("a key file for the configured wallet loads and signs", () => {
  const result = load();
  assert.ok(result.ok);
  assert.equal(result.key.keypair.publicKey.toBase58(), wallet);
  assert.equal(result.key.signMessage(new Uint8Array([1, 2, 3])).length, 64);
});

test("a missing path, an open file, a wrong wallet and a malformed file are refused without echoing contents", () => {
  const cases = [
    load({ keypairPath: undefined }),
    load({ fileMode: () => 0o100644 }),
    load({ wallet: Keypair.generate().publicKey.toBase58() }),
    load({ readFile: () => "[1,2,3]" }),
    load({ readFile: () => { throw new Error(`ENOENT ${file}`); } }),
    load({ readFile: () => JSON.stringify([...keypair.secretKey.subarray(0, 32), ...Keypair.generate().publicKey.toBytes()]) }),
  ];
  for (const result of cases) {
    assert.equal(result.ok, false);
    assert.ok(!JSON.stringify(result).includes(String(keypair.secretKey[0]) + "," + String(keypair.secretKey[1]) + ","), "no key bytes in the message");
  }
});

test("accepted escrows are remembered across a restart", () => {
  const path = join(mkdtempSync(join(tmpdir(), "rap-replay-")), "nested", "accepted.log");
  const first = new FileReplayStore(path);
  assert.equal(first.checkAndStore("metered-escrow:abc"), true);
  assert.equal(first.checkAndStore("metered-escrow:abc"), false);
  assert.equal(readFileSync(path, "utf8"), "metered-escrow:abc\n");
  first.close();
  const second = new FileReplayStore(path);
  assert.equal(second.size, 1);
  assert.equal(second.checkAndStore("metered-escrow:abc"), false);
  assert.equal(second.checkAndStore("metered-escrow:def"), true);
  assert.throws(() => second.checkAndStore("has space"));
  second.close();
  assert.throws(() => second.checkAndStore("metered-escrow:ghi"), /closed/);
});

test("a second process cannot share the file, and a dead owner's lock is taken over", () => {
  const path = join(mkdtempSync(join(tmpdir(), "rap-replay-")), "accepted.log");
  // pid 1 is alive on any Unix system and is never this process.
  writeFileSync(`${path}.lock`, "1");
  assert.throws(() => new FileReplayStore(path), /another provider process/);
  writeFileSync(`${path}.lock`, "2147483646");
  const store = new FileReplayStore(path);
  assert.equal(store.checkAndStore("k"), true);
  store.close();
});
