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
  assert.match(errorsOf({ ...mainnet, sessions: { enabled: true } }, env).join("\n"), /sessions\.enabled: sessions are not offered on mainnet/);
  assert.ok(parseProviderConfig({ ...mainnet, sessions: { enabled: false } }, env).ok);
  assert.ok(parseProviderConfig(configFile({ sessions: { enabled: true } }), {}).ok, "devnet may still offer sessions");
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
  assert.ok(!JSON.stringify(parsed.config, (_key, value) => (typeof value === "bigint" ? value.toString() : value)).includes("in-file"));
});

test("the starting config parses once a wallet is filled in", () => {
  assert.ok(parseProviderConfig(exampleConfig(provider.publicKey.toBase58()), {}).ok);
  assert.ok(!parseProviderConfig(exampleConfig("YOUR_WALLET_ADDRESS"), {}).ok);
});

test("the pause list, the recovery account and the refund-account subsidy are checked", () => {
  const parsed = parseProviderConfig(configFile({ pausedCurrencies: ["pyusd"], payoutAccount: USDC.toBase58(), refundAccountSubsidy: { maxPerDay: 3 } }), { RAP_PROVIDER_PAUSED_CURRENCIES: "USDG,PYUSD" });
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.config.pausedCurrencies, ["PYUSD", "USDG"]);
  assert.equal(parsed.config.paused, false);
  assert.equal(parsed.config.refundAccountsPerDay, 3);
  assert.equal(parsed.config.terms.payoutAccount?.toBase58(), USDC.toBase58());

  const defaults = parseProviderConfig(configFile(), {});
  assert.ok(defaults.ok);
  assert.deepEqual([defaults.config.paused, defaults.config.pausedCurrencies, defaults.config.refundAccountsPerDay, defaults.config.terms.payoutAccount], [false, [], 0, undefined]);

  assert.match(errorsOf(configFile({ pausedCurrencies: ["SOL"] })).join(), /pausedCurrencies/);
  assert.match(errorsOf(configFile({ pausedCurrencies: [7 as unknown as string] })).join(), /pausedCurrencies/);
  assert.match(errorsOf(configFile(), { RAP_PROVIDER_PAUSED_CURRENCIES: "DOGE" }).join(), /pausedCurrencies/);
  assert.match(errorsOf(configFile({ payoutAccount: "nope" })).join(), /payoutAccount/);
  assert.match(errorsOf(configFile({ refundAccountSubsidy: { maxPerDay: -1 } })).join(), /refundAccountSubsidy/);
  assert.match(errorsOf(configFile({ refundAccountSubsidy: true as unknown as { maxPerDay: number } })).join(), /refundAccountSubsidy/);
});

test("pooled budgets are off by default, and their settings are read in the price token and checked", () => {
  const off = parseProviderConfig(configFile(), {});
  assert.ok(off.ok);
  assert.equal(off.config.budgets.enabled, false);
  assert.equal(off.config.budgets.minReservationBaseUnits, 100_000n, "0.10 USDC");
  assert.equal(off.config.budgets.reserveCalls, 10);
  assert.equal(off.config.budgets.minOpenSlots, 9_000n, "60 minutes");

  const judge = provider.publicKey.toBase58();
  const on = parseProviderConfig(configFile({ budgets: { enabled: true, minReservation: "2.5", reserveCalls: 20, acceptedJudges: [judge], minOpenMinutes: 30 } }), {});
  assert.ok(on.ok);
  assert.equal(on.config.budgets.enabled, true);
  assert.equal(on.config.budgets.minReservationBaseUnits, 2_500_000n);
  assert.equal(on.config.budgets.reserveCalls, 20);
  assert.deepEqual(on.config.budgets.acceptedJudges.map((j) => j.toBase58()), [judge]);
  assert.equal(on.config.budgets.minOpenSlots, 4_500n);

  assert.deepEqual(errorsOf(configFile({ budgets: { minReservation: "0" } })), ["budgets.minReservation: must be a positive decimal amount in the price currency"]);
  assert.deepEqual(errorsOf(configFile({ budgets: { minReservation: "0.1234567" } })), ["budgets.minReservation: USDC has 6 decimal places"]);
  assert.deepEqual(errorsOf(configFile({ budgets: { reserveCalls: 0 } })), ["budgets.reserveCalls: must be a whole number from 1 to 1000"]);
  assert.deepEqual(errorsOf(configFile({ budgets: { minOpenMinutes: 5 } })), ["budgets.minOpenMinutes: must be a whole number from 10 to 10080"]);
  assert.deepEqual(errorsOf(configFile({ budgets: { acceptedJudges: ["not-an-address"] } })), ["budgets.acceptedJudges: not-an-address is not an address"]);

  const mainnet = configFile({ network: "solana-mainnet-beta", publicUrl: "https://provider.example", upstream: { baseUrl: "https://model.example/v1" } });
  const env = { SOLANA_RPC_URL: "https://rpc.example" };
  assert.ok(parseProviderConfig({ ...mainnet, budgets: { enabled: false } }, env).ok);
  const onMainnet = parseProviderConfig({ ...mainnet, budgets: { enabled: true, acceptedJudges: [judge] } }, env);
  assert.ok(onMainnet.ok, "budgets are accepted on mainnet");
  assert.equal(onMainnet.config.budgets.enabled, true);

  // What a budget may cost the provider before it is paid.
  assert.equal(off.config.budgets.maxReservesPerHour, 6);
  assert.equal(off.config.budgets.maxPriorityFeeLamports, 600n);
  assert.equal(off.config.budgets.maxFrontedRentLamports, 50_000_000n, "0.05 SOL");
  assert.equal(off.config.budgets.maxPayerAccountsPerDay, 3);
  const limited = parseProviderConfig(configFile({ budgets: { maxReservesPerHour: 12, maxPriorityFeeLamports: 0, maxFrontedRent: "0.25", maxPayerAccountsPerDay: 0 } }), {});
  assert.ok(limited.ok);
  assert.deepEqual([limited.config.budgets.maxReservesPerHour, limited.config.budgets.maxPriorityFeeLamports, limited.config.budgets.maxFrontedRentLamports, limited.config.budgets.maxPayerAccountsPerDay], [12, 0n, 250_000_000n, 0]);
  assert.deepEqual(errorsOf(configFile({ budgets: { maxReservesPerHour: 0 } })), ["budgets.maxReservesPerHour: must be a whole number from 1 to 60"]);
  assert.deepEqual(errorsOf(configFile({ budgets: { maxPriorityFeeLamports: -1 } })), ["budgets.maxPriorityFeeLamports: must be a whole number from 0 to 100000"]);
  assert.deepEqual(errorsOf(configFile({ budgets: { maxFrontedRent: "0.001" } })), ["budgets.maxFrontedRent: must be an amount of SOL from 0.002 to 10"]);
  assert.deepEqual(errorsOf(configFile({ budgets: { maxFrontedRent: "lots" } })), ["budgets.maxFrontedRent: must be an amount of SOL from 0.002 to 10"]);
  assert.deepEqual(errorsOf(configFile({ budgets: { maxPayerAccountsPerDay: 1.5 } })), ["budgets.maxPayerAccountsPerDay: must be a whole number from 0 to 1000"]);
});
