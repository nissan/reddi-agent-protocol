import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SOLANA_GENESIS_HASHES } from "@reddi/x402-solana";
import { runCli } from "../src/cli.js";
import { formatDoctor, runDoctor } from "../src/doctor.js";
import { startProvider } from "../src/server.js";
import { ESCROW_PROTOCOL_TREASURY } from "@reddi/x402-solana";
import { Keypair } from "@solana/web3.js";
import { ata, config, configFile, fakeChain, provider, tokenAccount } from "./helpers.js";

const key = { ok: true as const, key: { keypair: provider, signMessage: () => new Uint8Array(64) } };
const okFetch = async () => ({ ok: true, status: 200 });
const statusOf = (result: Awaited<ReturnType<typeof runDoctor>>, name: string) => result.checks.find((c) => c.name === name)?.status;

test("a correct setup passes every check that can fail", async () => {
  const result = await runDoctor({ config: config({ upstream: { baseUrl: "https://model.example/v1" }, publicUrl: "https://provider.example" }), chain: fakeChain(null), key, fetchImpl: okFetch, canWrite: () => true });
  assert.equal(result.ok, true);
  assert.deepEqual(result.checks.map((c) => c.status), Array(result.checks.length).fill("pass"), formatDoctor(result));
  assert.match(formatDoctor(result), /Ready\.$/);
});

test("a missing token account fails with the command that creates it", async () => {
  const chain = fakeChain(null);
  chain.accounts.delete(ata(provider.publicKey).toBase58());
  const result = await runDoctor({ config: config(), chain, key, fetchImpl: okFetch, canWrite: () => true });
  assert.equal(result.ok, false);
  const check = result.checks.find((c) => c.name === "USDC token account")!;
  assert.equal(check.status, "fail");
  assert.match(check.fix!, /^Create it: spl-token create-account 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU --owner .* --url devnet$/);
});

test("a frozen or missing treasury account fails, a frozen payout account fails unless a recovery account is ready, and a pause is shown", async () => {
  const run = (chain = fakeChain(null), file = {}) => runDoctor({ config: config(file), chain, key, fetchImpl: okFetch, canWrite: () => true });

  const frozenTreasury = fakeChain(null);
  frozenTreasury.accounts.set(ata(ESCROW_PROTOCOL_TREASURY).toBase58(), tokenAccount(ESCROW_PROTOCOL_TREASURY, 2));
  const treasury = await run(frozenTreasury);
  assert.equal(statusOf(treasury, "Protocol treasury"), "fail");
  assert.match(treasury.checks.find((c) => c.name === "Protocol treasury")!.detail, /frozen/);
  const missingTreasury = fakeChain(null);
  missingTreasury.accounts.delete(ata(ESCROW_PROTOCOL_TREASURY).toBase58());
  assert.equal(statusOf(await run(missingTreasury), "Protocol treasury"), "fail");

  const frozenPayout = fakeChain(null);
  frozenPayout.accounts.set(ata(provider.publicKey).toBase58(), tokenAccount(provider.publicKey, 2));
  assert.equal(statusOf(await run(frozenPayout), "USDC token account"), "fail");
  const recovery = Keypair.generate().publicKey;
  frozenPayout.accounts.set(recovery.toBase58(), tokenAccount(provider.publicKey));
  const recovered = await run(frozenPayout, { payoutAccount: recovery.toBase58() });
  assert.deepEqual([statusOf(recovered, "USDC token account"), statusOf(recovered, "Recovery payout account"), recovered.ok], ["warn", "pass", true]);
  // A recovery account someone else owns is a failure.
  frozenPayout.accounts.set(recovery.toBase58(), tokenAccount(Keypair.generate().publicKey));
  assert.equal(statusOf(await run(frozenPayout, { payoutAccount: recovery.toBase58() }), "Recovery payout account"), "fail");

  const paused = await run(fakeChain(null), { pausedCurrencies: ["USDC"] });
  assert.deepEqual([statusOf(paused, "Payments"), paused.ok], ["warn", true]);
});

test("the wrong cluster stops the run at the RPC line", async () => {
  const chain = fakeChain(null);
  chain.genesis = SOLANA_GENESIS_HASHES["solana-mainnet-beta"];
  const result = await runDoctor({ config: config(), chain, key, fetchImpl: okFetch, canWrite: () => true });
  assert.equal(result.ok, false);
  assert.deepEqual(result.checks.map((c) => c.name), ["Configuration", "RPC endpoint"]);
});

test("an unfunded wallet, a missing program, a bad key, a dead model and an unwritable disk each fail on their own line", async () => {
  const chain = fakeChain(null);
  chain.accounts.get(provider.publicKey.toBase58())!.lamports = 1_000n;
  chain.accounts.delete("DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu");
  const result = await runDoctor({
    config: config({ upstream: { baseUrl: "https://model.example/v1" } }),
    chain,
    key: { ok: false, message: "the key file could not be read" },
    fetchImpl: async () => ({ ok: false, status: 401 }),
    canWrite: () => false,
  });
  for (const name of ["Escrow program", "Wallet balance", "Signing key", "Model", "Payment memory"]) assert.equal(statusOf(result, name), "fail", name);
  assert.match(result.checks.find((c) => c.name === "Model")!.fix!, /UPSTREAM_API_KEY/);
});

test("mock answers and a localhost address are warnings on devnet", async () => {
  const devnet = await runDoctor({ config: config(), chain: fakeChain(null), key, fetchImpl: okFetch, canWrite: () => true });
  assert.equal(devnet.ok, true);
  assert.equal(statusOf(devnet, "Model"), "warn");
  assert.equal(statusOf(devnet, "Public address"), "warn");
  assert.match(formatDoctor(devnet), /Ready, with 2 to look at\./);
});

test("doctor output never holds key material", async () => {
  const result = await runDoctor({ config: config({ upstream: { baseUrl: "https://model.example/v1", apiKeyEnv: "K" } }, { K: "sk-secret-value" }), chain: fakeChain(null), key, fetchImpl: okFetch, canWrite: () => true });
  const text = formatDoctor(result) + JSON.stringify(result);
  assert.ok(!text.includes("sk-secret-value"));
  assert.ok(!text.includes(String([...provider.secretKey.subarray(0, 4)])));
});

function io(env: Record<string, string | undefined> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t), env } };
}

test("init writes a config that parses, and will not overwrite one", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "rap-cli-")), "provider.json");
  const a = io();
  assert.equal(await runCli(["init", "--config", path, "--wallet", provider.publicKey.toBase58()], a.io), 0);
  assert.equal(JSON.parse(readFileSync(path, "utf8")).wallet, provider.publicKey.toBase58());
  const b = io();
  assert.equal(await runCli(["init", "--config", path], b.io), 1);
  assert.match(b.err[0], /already exists/);
  const c = io();
  assert.equal(await runCli(["init", "--config", `${path}.2`, "--wallet", "nope"], c.io), 1);
});

test("help prints, an unknown command and a bad config exit non-zero", async () => {
  const a = io();
  assert.equal(await runCli(["--help"], a.io), 0);
  assert.match(a.out[0], /init/);
  assert.equal(await runCli(["frobnicate"], io().io), 1);
  const path = join(mkdtempSync(join(tmpdir(), "rap-cli-")), "provider.json");
  writeFileSync(path, JSON.stringify({ ...configFile(), wallet: "nope" }));
  const b = io();
  assert.equal(await runCli(["start", "--config", path], b.io), 1);
  assert.match(b.err[0], /wallet:/);
  assert.equal(await runCli(["doctor", "--config", join(path, "missing")], io().io), 1);
  writeFileSync(path, JSON.stringify({ ...configFile(), systemPromptFile: "no-such-prompt.txt" }));
  const c = io();
  assert.equal(await runCli(["start", "--config", path], c.io), 1);
  assert.match(c.err[0], /systemPromptFile/);
});

test("start refuses without the wallet's key, and refuses to sell mock answers on mainnet", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rap-cli-"));
  const path = join(dir, "provider.json");
  writeFileSync(path, JSON.stringify(configFile({ replayFile: join(dir, "accepted.log") })));
  const a = io();
  assert.equal(await runCli(["start", "--config", path], a.io), 1);
  assert.match(a.err[0], /cannot start: no key file is configured/);

  const keyPath = join(dir, "id.json");
  writeFileSync(keyPath, JSON.stringify([...provider.secretKey]));
  chmodSync(keyPath, 0o600);
  const mainnet = config({ network: "solana-mainnet-beta", publicUrl: "https://provider.example", keypairPath: keyPath, replayFile: join(dir, "accepted.log") }, { SOLANA_RPC_URL: "https://rpc.example" });
  const refused = await startProvider(mainnet);
  assert.deepEqual(refused, { ok: false, message: "mock answers cannot be sold on mainnet: set upstream.mock to false" });
});

test("start serves a paid call over HTTP end to end", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rap-cli-"));
  const keyPath = join(dir, "id.json");
  writeFileSync(keyPath, JSON.stringify([...provider.secretKey]));
  chmodSync(keyPath, 0o600);
  const chain = fakeChain();
  const started = await startProvider(config({ keypairPath: keyPath, replayFile: join(dir, "accepted.log"), sessions: { file: join(dir, "sessions.jsonl") }, port: 0 as unknown as number }, { PORT: "18787" }), { chain, host: "127.0.0.1" });
  assert.ok(started.ok);
  try {
    const { paymentHeader } = await import("./helpers.js");
    const body = JSON.stringify({ messages: [{ role: "user", content: "hello there" }], max_tokens: 50 });
    const unpaid = await fetch("http://127.0.0.1:18787/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body });
    assert.equal(unpaid.status, 402);
    const paid = await fetch("http://127.0.0.1:18787/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", "x402-payment": paymentHeader() }, body });
    assert.equal(paid.status, 200);
    assert.ok(paid.headers.get("x-reddi-provider-receipt"));
    assert.equal(chain.sent.length, 1);
  } finally {
    await started.close();
  }
});
