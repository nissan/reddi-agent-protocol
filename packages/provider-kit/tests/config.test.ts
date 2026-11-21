import assert from "node:assert/strict";
import test from "node:test";
import { exampleConfig, parseProviderConfig } from "../src/config.js";
import { configFile, provider, USDC } from "./helpers.js";

const errorsOf = (file: unknown, env: Record<string, string | undefined> = {}) => {
  const parsed = parseProviderConfig(file, env);
  return parsed.ok ? [] : parsed.errors;
};

test("a devnet USDC config resolves the program, the mint and the public devnet RPC", () => {
  const parsed = parseProviderConfig(configFile(), {});
  assert.ok(parsed.ok);
  assert.equal(parsed.config.terms.mint.toBase58(), USDC.toBase58());
  assert.equal(parsed.config.terms.programId.toBase58(), "DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu");
  assert.equal(parsed.config.rpcUrl, "https://api.devnet.solana.com");
  assert.equal(parsed.config.upstream.model, "test/model-1");
  assert.equal(parsed.config.port, 8787);
});

test("mainnet fixes the mint and the program, and needs an RPC endpoint", () => {
  const mainnet = configFile({ network: "solana-mainnet-beta", publicUrl: "https://provider.example", upstream: { baseUrl: "https://openrouter.ai/api/v1" } });
  assert.match(errorsOf(mainnet).join("\n"), /rpcUrl: on mainnet/);
  const ok = parseProviderConfig(mainnet, { SOLANA_RPC_URL: "https://rpc.example/key" });
  assert.ok(ok.ok);
  assert.equal(ok.config.terms.mint.toBase58(), "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  const env = { SOLANA_RPC_URL: "https://rpc.example" };
  assert.match(errorsOf({ ...mainnet, mint: USDC.toBase58() }, env).join("\n"), /cannot be changed/);
  assert.match(errorsOf({ ...mainnet, programId: provider.publicKey.toBase58() }, env).join("\n"), /programId: cannot be changed on mainnet/);
  assert.match(errorsOf({ ...mainnet, genesisHash: "abc" }, env).join("\n"), /genesisHash/);
  const audd = parseProviderConfig({ ...mainnet, price: { currency: "AUDD", inputPerMillion: "1", outputPerMillion: "2" } }, env);
  assert.ok(audd.ok);
  assert.equal(audd.config.terms.mint.toBase58(), "AUDDttiEpCydTm7joUMbYddm72jAWXZnCpPZtDoxqBSw");
});

test("every bad field is named, and nothing starts on a bad config", () => {
  const errors = errorsOf({ name: "", network: "solana-testnet", wallet: "nope", publicUrl: "http://example.com", model: "", upstream: {}, price: { currency: "SOL" } });
  for (const field of ["name:", "network:", "wallet:", "publicUrl:", "model:", "upstream.baseUrl:"]) assert.ok(errors.some((e) => e.startsWith(field)), `${field} ${errors.join(" | ")}`);
  assert.match(errorsOf(configFile({ price: { currency: "SOL", inputPerMillion: "1", outputPerMillion: "1" } })).join("\n"), /not a token currency/);
  assert.match(errorsOf(configFile({ price: { currency: "USDC", inputPerMillion: "0", outputPerMillion: "0" } })).join("\n"), /above zero/);
  assert.match(errorsOf(configFile({ price: { currency: "USDC", inputPerMillion: "abc", outputPerMillion: "1" } })).join("\n"), /price:/);
  assert.match(errorsOf(configFile({ price: { currency: "AUDD", inputPerMillion: "1", outputPerMillion: "1" } })).join("\n"), /mint: on devnet/);
  assert.match(errorsOf(configFile({ publicUrl: "https://user:pass@example.com" })).join("\n"), /publicUrl/);
  assert.match(errorsOf(configFile(), { PORT: "99999" }).join("\n"), /port/);
  assert.deepEqual(errorsOf([]), ["the config must be a JSON object"]);
});

test("the API key comes only from the environment, and the environment overrides the key path and RPC", () => {
  const file = { ...configFile({ upstream: { baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "MY_KEY" }, keypairPath: "/file/path.json" }), apiKey: "in-file" };
  const parsed = parseProviderConfig(file, { MY_KEY: "from-env", RAP_PROVIDER_KEYPAIR_PATH: "/env/path.json", SOLANA_RPC_URL: "http://127.0.0.1:8899" });
  assert.ok(parsed.ok);
  assert.equal(parsed.config.upstream.apiKey, "from-env");
  assert.equal(parsed.config.keypairPath, "/env/path.json");
  assert.equal(parsed.config.rpcUrl, "http://127.0.0.1:8899");
  assert.ok(!JSON.stringify(parsed.config).includes("in-file"));
});

test("the starting config parses once a wallet is filled in", () => {
  assert.ok(parseProviderConfig(exampleConfig(provider.publicKey.toBase58()), {}).ok);
  assert.ok(!parseProviderConfig(exampleConfig("YOUR_WALLET_ADDRESS"), {}).ok);
});
