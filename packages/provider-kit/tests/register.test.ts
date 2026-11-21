import assert from "node:assert/strict";
import { createHash, createPublicKey, verify } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { runCli } from "../src/cli.js";
import { listingBody, signInMessage, SIGN_IN_STATEMENT, type ListingFetch } from "../src/listing.js";
import { AGENT_FEE_BURN_ADDRESS, agentAddress, buildRegisterAgentInstruction, readAgentRecord, REGISTER_AGENT_DISCRIMINATOR } from "../src/registry.js";
import { config, configFile, fakeChain, PROGRAM, provider, USDC, type FakeChain } from "./helpers.js";

const APP = "https://app.example.org";
const AUTH = "https://auth.example.org";
const wallet = provider.publicKey.toBase58();
const agent = agentAddress(PROGRAM, provider.publicKey);
const publicFile = (overrides = {}) => configFile({ publicUrl: "https://provider.example.org", listing: { appUrl: APP, capabilities: { taskTypes: ["writing"] } }, ...overrides });

function agentRecord(owner: PublicKey, model: string): Uint8Array {
  const data = Buffer.alloc(8 + 32 + 1 + 4 + 64 + 40);
  owner.toBuffer().copy(data, 8);
  data.writeUInt32LE(Buffer.byteLength(model), 41);
  data.write(model, 45, "utf8");
  return data;
}

interface Call { url: string; method: string; headers: Record<string, string>; body?: unknown }
function fakeApp(options: { network?: string; listed?: boolean; refuseSignIn?: boolean; sessionWallet?: string } = {}) {
  const calls: Call[] = [];
  const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const fetchImpl: ListingFetch = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers ?? {}, ...(init.body ? { body: JSON.parse(init.body) } : {}) });
    if (url === `${APP}/api/listings` && init.method === "GET") return reply(200, { ok: true, network: options.network ?? "solana-devnet", listings: options.listed ? [{ wallet, displayName: "Test provider" }] : [] });
    if (url === `${APP}/api/auth/config`) return reply(200, { ok: true, authUrl: AUTH, publishableKey: "publishable-key" });
    if (url === `${AUTH}/auth/v1/token?grant_type=web3`) return options.refuseSignIn ? reply(400, { msg: "domain not allowed" }) : reply(200, { access_token: "session-token" });
    if (url === `${APP}/api/auth/session`) return reply(200, { ok: true, wallet: options.sessionWallet ?? wallet });
    if (url === `${APP}/api/listings` && init.method === "PUT") return reply(200, { ok: true, listing: { wallet, status: "listed" } });
    return reply(404, {});
  };
  return { calls, fetchImpl };
}

function setup(file = publicFile(), key: Keypair | null = provider) {
  const dir = mkdtempSync(join(tmpdir(), "rap-register-"));
  const path = join(dir, "provider.json");
  let keypairPath: string | undefined;
  if (key) {
    keypairPath = join(dir, "key.json");
    writeFileSync(keypairPath, JSON.stringify([...key.secretKey]), { mode: 0o600 });
  }
  writeFileSync(path, JSON.stringify({ ...file, ...(keypairPath ? { keypairPath } : {}) }));
  const out: string[] = [];
  const err: string[] = [];
  const chain: FakeChain = fakeChain(null);
  return { path, out, err, chain, run: (args: string[], app = fakeApp()) => runCli([...args, "--config", path], { out: (t) => out.push(t), err: (t) => err.push(t), env: {}, chain: () => chain, fetchImpl: app.fetchImpl }) };
}

test("the register instruction matches the program: discriminator, accounts and data", () => {
  assert.deepEqual([...REGISTER_AGENT_DISCRIMINATOR], [...createHash("sha256").update("global:register_agent").digest().subarray(0, 8)]);
  const ix = buildRegisterAgentInstruction(PROGRAM, provider.publicKey, "test/model-1");
  assert.deepEqual(ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]), [
    [agent.toBase58(), false, true],
    [wallet, true, true],
    [AGENT_FEE_BURN_ADDRESS.toBase58(), false, true],
    [SystemProgram.programId.toBase58(), false, false],
  ]);
  // agent_type 0, model as a length-prefixed string, rate 0, minimum reputation 0.
  assert.deepEqual([...ix.data.subarray(8)], [0, 12, 0, 0, 0, ...Buffer.from("test/model-1"), 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.throws(() => buildRegisterAgentInstruction(PROGRAM, provider.publicKey, "m".repeat(65)), /64 bytes/);
  assert.equal(readAgentRecord(agentRecord(provider.publicKey, "test/model-1"))?.model, "test/model-1");
  assert.equal(readAgentRecord(new Uint8Array(10)), undefined);
});

test("the listing carries the per-token price in base units, and a local address cannot be listed", () => {
  const body = listingBody(config(publicFile()));
  assert.ok(body.ok);
  assert.deepEqual(body.body, {
    displayName: "Test provider",
    endpointUrl: "https://provider.example.org",
    declaredModels: ["test/model-1"],
    capabilities: { taskTypes: ["writing"] },
    priceInputPerMillionBaseUnits: "3000000",
    priceOutputPerMillionBaseUnits: "15000000",
    priceMint: USDC.toBase58(),
    status: "listed",
  });
  const paused = listingBody(config(publicFile({ pausedCurrencies: ["USDC"] })));
  assert.ok(paused.ok && paused.body.status === "paused");
  assert.equal(listingBody(config()).ok, false);
});

test("a dry run prints the registry accounts and the listing, and sends nothing", async () => {
  const s = setup();
  const app = fakeApp();
  assert.equal(await s.run(["register", "--dry-run"], app), 0);
  const printed = JSON.parse(s.out[0]);
  assert.equal(printed.registry.instruction, "register_agent");
  assert.equal(printed.registry.accounts[0].address, agent.toBase58());
  assert.equal(printed.listing.body.priceInputPerMillionBaseUnits, "3000000");
  assert.match(s.out[1], /nothing was signed or sent/);
  assert.equal(s.chain.sent.length, 0);
  assert.equal(app.calls.length, 0);
});

test("register sends the registry instruction, signs in with the wallet and puts the listing", async () => {
  const s = setup();
  const app = fakeApp();
  assert.equal(await s.run(["register"], app), 0, s.err.join("\n"));
  assert.equal(s.chain.sent.length, 1);
  assert.ok(s.chain.sent[0][0].programId.equals(PROGRAM));

  const signIn = app.calls.find((c) => c.url.startsWith(AUTH))!;
  const sent = signIn.body as { chain: string; message: string; signature: string };
  assert.equal(sent.chain, "solana");
  assert.equal(signIn.headers.apikey, "publishable-key");
  assert.ok(sent.message.startsWith(`app.example.org wants you to sign in with your Solana account:\n${wallet}\n\n${SIGN_IN_STATEMENT}\n\nVersion: 1\nURI: https://app.example.org/\nIssued At: `));
  const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), provider.publicKey.toBuffer()]), format: "der", type: "spki" });
  assert.ok(verify(null, Buffer.from(sent.message, "utf8"), publicKey, Buffer.from(sent.signature, "base64url")), "the wallet signed exactly the message sent");

  const put = app.calls.find((c) => c.method === "PUT")!;
  assert.equal(put.headers.authorization, "Bearer session-token");
  assert.equal((put.body as { endpointUrl: string }).endpointUrl, "https://provider.example.org");
  // The key signed one message. No call carries the key or the token to a host the app did not name.
  assert.ok(app.calls.every((c) => c.url.startsWith(APP) || c.url.startsWith(AUTH)));
  assert.ok(!JSON.stringify(app.calls).includes(String([...provider.secretKey.subarray(0, 6)])));
});

test("register again updates the listing without registering twice", async () => {
  const s = setup(publicFile({ price: { currency: "USDC", inputPerMillion: "4", outputPerMillion: "20", maxOutputTokens: 500 } }));
  s.chain.accounts.set(agent.toBase58(), { owner: PROGRAM, data: agentRecord(provider.publicKey, "test/model-1"), lamports: 1n, executable: false });
  const app = fakeApp({ listed: true });
  assert.equal(await s.run(["register"], app), 0, s.err.join("\n"));
  assert.equal(s.chain.sent.length, 0);
  assert.match(s.out[0], /Already registered/);
  assert.equal((app.calls.find((c) => c.method === "PUT")!.body as { priceInputPerMillionBaseUnits: string }).priceInputPerMillionBaseUnits, "4000000");
});

test("register refuses before sending anything: a key for another wallet, no key, the wrong cluster, an app on another network, a record that is not this wallet's", async () => {
  const wrongKey = setup(publicFile(), Keypair.generate());
  const appA = fakeApp();
  assert.equal(await wrongKey.run(["register"], appA), 1);
  assert.match(wrongKey.err[0], /cannot register/);
  assert.deepEqual([wrongKey.chain.sent.length, appA.calls.length], [0, 0]);

  const noKey = setup(publicFile(), null);
  assert.equal(await noKey.run(["register"]), 1);
  assert.equal(noKey.chain.sent.length, 0);

  const wrongCluster = setup();
  wrongCluster.chain.genesis = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
  const appB = fakeApp();
  assert.equal(await wrongCluster.run(["register"], appB), 1);
  assert.deepEqual([wrongCluster.chain.sent.length, appB.calls.length], [0, 0]);

  const foreign = setup();
  foreign.chain.accounts.set(agent.toBase58(), { owner: PROGRAM, data: agentRecord(Keypair.generate().publicKey, "x"), lamports: 1n, executable: false });
  assert.equal(await foreign.run(["register"]), 1);
  assert.equal(foreign.chain.sent.length, 0);

  // The app serves mainnet listings and this provider is on devnet: registered on chain, but nothing is signed for the app.
  const otherNetwork = setup();
  const appC = fakeApp({ network: "solana-mainnet" });
  assert.equal(await otherNetwork.run(["register"], appC), 1);
  assert.match(otherNetwork.err[0], /Nothing was sent/);
  assert.ok(!appC.calls.some((c) => c.url.startsWith(AUTH)));
});

test("a refused sign-in, or a session for another wallet, lists nothing and says the registration stands", async () => {
  for (const options of [{ refuseSignIn: true }, { sessionWallet: Keypair.generate().publicKey.toBase58() }]) {
    const s = setup();
    const app = fakeApp(options);
    assert.equal(await s.run(["register"], app), 1);
    assert.match(s.err[0], /registration stands/);
    assert.ok(!app.calls.some((c) => c.method === "PUT"));
  }
});

test("status reads the registry record and the public listing", async () => {
  const s = setup();
  assert.equal(await s.run(["status"], fakeApp()), 1);
  assert.match(s.out[0], /not registered/);
  s.chain.accounts.set(agent.toBase58(), { owner: PROGRAM, data: agentRecord(provider.publicKey, "test/model-1"), lamports: 1n, executable: false });
  assert.equal(await s.run(["status"], fakeApp({ listed: true })), 0);
  assert.match(s.out.join("\n"), /registered at .*model test\/model-1/);
  assert.match(s.out.join("\n"), /Listing: shown in/);
});

test("the sign-in message has the form the auth service checks", () => {
  assert.equal(
    signInMessage("https://app.example.org", wallet, new Date("2026-12-05T00:00:00.000Z")),
    `app.example.org wants you to sign in with your Solana account:\n${wallet}\n\n${SIGN_IN_STATEMENT}\n\nVersion: 1\nURI: https://app.example.org/\nIssued At: 2026-12-05T00:00:00.000Z`,
  );
});
