import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import type { PgPool } from "@redditech/provider-kit";
import { authorised } from "../lib/cron.ts";
import { isProviderName, loadProvider, PROVIDERS, type ProviderName } from "../lib/providers.ts";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array): string {
  let n = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

function wallet() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return { address: base58(pub), keypair: JSON.stringify([...seed, ...pub]) };
}

const pool: PgPool = {
  query: async () => ({ rows: [] }),
  connect: async () => {
    throw new Error("not in this test");
  },
};

function env(name: ProviderName, overrides: Record<string, string | undefined> = {}) {
  const prefix = PROVIDERS[name].prefix;
  const w = wallet();
  return {
    PROVIDERS_PUBLIC_ORIGIN: "https://providers.example.com",
    OPENROUTER_API_KEY: "test",
    OPENAI_API_KEY: "test",
    ANTHROPIC_API_KEY: "test",
    SOLANA_RPC_URL: "https://rpc.example.com",
    [`${prefix}_WALLET`]: w.address,
    [`${prefix}_KEYPAIR`]: w.keypair,
    [`${prefix}_PROMPT`]: "Private instructions.",
    ...overrides,
  };
}

const refusal = (name: ProviderName, e: Record<string, string | undefined>, p: () => PgPool | undefined = () => pool) => {
  const loaded = loadProvider(name, e, p);
  assert.equal(loaded.ok, false);
  return (loaded as { message: string }).message;
};

test("only the three first-party names are providers", () => {
  assert.deepEqual(Object.keys(PROVIDERS), ["humaniser", "writing-style", "script-writer"]);
  assert.equal(isProviderName("humaniser"), true);
  assert.equal(isProviderName("api"), false);
  assert.equal(isProviderName("constructor"), false);
  assert.equal(isProviderName("__proto__"), false);
});

for (const name of Object.keys(PROVIDERS) as ProviderName[]) {
  test(`${name} starts on devnet by default, at its own path, and on mainnet only when asked`, () => {
    const devnet = loadProvider(name, env(name), () => pool);
    assert.ok(devnet.ok, devnet.ok ? "" : devnet.message);
    assert.equal(devnet.provider.config.network, "solana-devnet");
    assert.equal(devnet.provider.config.publicUrl, `https://providers.example.com/${name}`);
    const mainnet = loadProvider(name, env(name, { PROVIDERS_NETWORK: "mainnet" }), () => pool);
    assert.ok(mainnet.ok, mainnet.ok ? "" : mainnet.message);
    assert.equal(mainnet.provider.config.network, "solana-mainnet-beta");
  });
}

test("a provider that is not fully set up does not start, and says which setting is missing", () => {
  assert.match(refusal("humaniser", env("humaniser", { PROVIDERS_NETWORK: "testnet" })), /PROVIDERS_NETWORK/);
  for (const origin of [undefined, "http://providers.example.com", "https://providers.example.com/humaniser", "not a url"]) {
    assert.match(refusal("humaniser", env("humaniser", { PROVIDERS_PUBLIC_ORIGIN: origin })), /PROVIDERS_PUBLIC_ORIGIN/);
  }
  assert.match(refusal("humaniser", env("humaniser", { HUMANISER_WALLET: undefined })), /HUMANISER_WALLET/);
  assert.match(refusal("humaniser", env("humaniser"), () => undefined), /PROVIDER_KIT_DATABASE_URL/);
  assert.match(refusal("humaniser", env("humaniser", { HUMANISER_PROMPT: "" })), /HUMANISER_PROMPT/);
  assert.match(refusal("humaniser", env("humaniser", { HUMANISER_KEYPAIR: undefined })), /HUMANISER_KEYPAIR/);
  // A key for another wallet is refused, and its value is not repeated.
  const other = wallet().keypair;
  const message = refusal("humaniser", env("humaniser", { HUMANISER_KEYPAIR: other }));
  assert.ok(!message.includes(other));
  // The model key is checked too.
  assert.match(refusal("humaniser", env("humaniser", { OPENROUTER_API_KEY: undefined })), /OPENROUTER_API_KEY/);
});

test("the sweep accepts only Vercel Cron's bearer secret", () => {
  assert.equal(authorised("Bearer s3cret", "s3cret"), true);
  assert.equal(authorised("Bearer s3cre", "s3cret"), false);
  assert.equal(authorised("s3cret", "s3cret"), false);
  assert.equal(authorised(null, "s3cret"), false);
  assert.equal(authorised("Bearer ", ""), false);
  assert.equal(authorised("Bearer undefined", undefined), false);
});
