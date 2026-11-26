/**
 * @jest-environment node
 */
import { Keypair } from "@solana/web3.js";
import { budgetOpenProblem, checkBudgetCluster, type ClusterGateState } from "@/lib/budget/cluster-gate";
import { BUDGET_NETWORK_TOKENS, BUDGET_USDC_MINT, budgetNetwork, budgetProgramIdFor, MAINNET_BUDGET_CAPS } from "@/lib/budget/network";
import { openBudgetLimits, openBudgetRoom } from "@/lib/budget/open-limits";
import { budgetTokens, prepareBudget } from "@/lib/budget/page";
import { BUDGET_RATE_RULES, budgetRateLimited, supabaseCounter, type DurableCounter } from "@/lib/budget/rate-limit";
import { GENESIS_HASH, type BudgetCustodyStore, type SpenderRecord } from "@/lib/budget/store";
import devnetProfile from "@/config/networks/devnet.json";
import mainnetProfile from "@/config/networks/mainnet.json";

const MAINNET = { NETWORK_PROFILE: "mainnet" };
const PROGRAM = Keypair.generate().publicKey;
const JUDGE = Keypair.generate().publicKey.toBase58();
const usdc = [1, 2].map((n) => ({ id: `rap-usdc-${n}`, name: `RAP ${n}`, url: `https://providers.example/${n}`, payee: Keypair.generate().publicKey.toBase58(), inputPerMillionUsd: "1", outputPerMillionUsd: "2" }));
const MAINNET_ENV = { ...MAINNET, BUDGET_DEFAULT_JUDGE: JUDGE, BUDGET_USDC_PROVIDERS: JSON.stringify(usdc) };
const payer = Keypair.generate().publicKey.toBase58();

describe("Budget network: one cluster per build", () => {
  it("picks the network from the build's profile, devnet by default and for local profiles", () => {
    expect(budgetNetwork({})).toBe("solana-devnet");
    expect(budgetNetwork({ NETWORK_PROFILE: "local-surfpool" })).toBe("solana-devnet");
    expect(budgetNetwork(MAINNET)).toBe("solana-mainnet-beta");
  });

  it("takes each network's program from its committed profile and Circle's USDC mint", () => {
    expect(budgetProgramIdFor("solana-devnet").toBase58()).toBe(devnetProfile.programs.escrowProgramId);
    expect(budgetProgramIdFor("solana-mainnet-beta").toBase58()).toBe(mainnetProfile.programs.escrowProgramId);
    expect(BUDGET_USDC_MINT["solana-mainnet-beta"].toBase58()).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(budgetTokens("solana-mainnet-beta").USDC.mint?.toBase58()).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  });

  it("offers USDC only on mainnet, between 1 and 100 USDC", () => {
    expect(BUDGET_NETWORK_TOKENS["solana-mainnet-beta"]).toEqual(["USDC"]);
    const tokens = budgetTokens("solana-mainnet-beta");
    expect(tokens.SOL.offered).toBe(false);
    expect(tokens.USDC).toMatchObject({ offered: true, min: MAINNET_BUDGET_CAPS.USDC.min, max: BigInt(100_000_000) });
    expect(budgetTokens("solana-devnet").SOL.offered).toBe(true);
  });
});

describe("Budget terms on mainnet", () => {
  const terms = (token: string, total: string) => ({ payer, token, total, providerIds: usdc.map((p) => p.id), email: "me@example.com" });

  it("refuses SOL, too little and too much, and takes a USDC Budget inside the caps", () => {
    expect(prepareBudget(terms("SOL", "100000000"), PROGRAM, Date.now(), MAINNET_ENV)).toMatchObject({ ok: false, code: "token_not_offered" });
    expect(prepareBudget(terms("USDC", "999999"), PROGRAM, Date.now(), MAINNET_ENV)).toMatchObject({ ok: false, code: "amount_too_small" });
    expect(prepareBudget(terms("USDC", "100000001"), PROGRAM, Date.now(), MAINNET_ENV)).toMatchObject({ ok: false, code: "amount_too_large" });
    const prepared = prepareBudget(terms("USDC", "5000000"), PROGRAM, Date.now(), MAINNET_ENV);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const message = Buffer.from(prepared.message, "base64").toString("utf8");
    expect(message).toContain("solana-mainnet-beta");
    expect(message).toContain("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  });

  it("refuses a mainnet Budget without the RAP judge", () => {
    const env = { ...MAINNET_ENV, BUDGET_DEFAULT_JUDGE: "" };
    expect(prepareBudget(terms("USDC", "5000000"), PROGRAM, Date.now(), env)).toMatchObject({ ok: false, code: "judge_not_configured" });
  });
});

describe("Budget cluster gate", () => {
  const fresh = (): ClusterGateState => ({ confirmed: new Set(), alerted: new Set() });

  it("passes the right genesis hash and reads it once per instance", async () => {
    const state = fresh();
    const genesisHash = jest.fn(async () => GENESIS_HASH["solana-mainnet-beta"]);
    expect(await checkBudgetCluster({ network: "solana-mainnet-beta", genesisHash }, state)).toEqual({ ok: true });
    expect(await checkBudgetCluster({ network: "solana-mainnet-beta", genesisHash }, state)).toEqual({ ok: true });
    expect(genesisHash).toHaveBeenCalledTimes(1);
  });

  it("refuses a mainnet build whose RPC is devnet, tells the operator once, and keeps asking", async () => {
    const state = fresh();
    const alertOperator = jest.fn(async () => true);
    const genesisHash = jest.fn(async () => GENESIS_HASH["solana-devnet"]);
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
    for (let i = 0; i < 3; i++) {
      expect(await checkBudgetCluster({ network: "solana-mainnet-beta", genesisHash, alertOperator }, state)).toMatchObject({ ok: false, code: "wrong_cluster" });
    }
    errors.mockRestore();
    expect(genesisHash).toHaveBeenCalledTimes(3);
    expect(alertOperator).toHaveBeenCalledTimes(1);
    expect(state.confirmed.size).toBe(0);
  });

  it("refuses when the chain cannot be read, and passes once it can", async () => {
    const state = fresh();
    expect(await checkBudgetCluster({ network: "solana-devnet", genesisHash: async () => Promise.reject(new Error("down")) }, state)).toMatchObject({ ok: false, code: "chain_unavailable" });
    expect(await checkBudgetCluster({ network: "solana-devnet", genesisHash: async () => GENESIS_HASH["solana-devnet"] }, state)).toEqual({ ok: true });
  });

  it("a failing alert does not break the refusal", async () => {
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await checkBudgetCluster({ network: "solana-devnet", genesisHash: async () => "other", alertOperator: async () => Promise.reject(new Error("no channel")) }, fresh());
    errors.mockRestore();
    expect(result).toMatchObject({ ok: false, code: "wrong_cluster" });
  });
});

describe("Mainnet Budgets are refused by config", () => {
  const OPEN = { BUDGETS_MAINNET: "open", SOLANA_RPC_URL: "https://rpc.example", BUDGET_MAX_OPEN_RELAY: "50" };
  const recorded = () => true;

  it("always opens on devnet", () => {
    expect(budgetOpenProblem("solana-devnet", {}, () => false)).toBeUndefined();
  });

  it("needs the switch, a recorded deployment, the server RPC and the ceiling", () => {
    expect(budgetOpenProblem("solana-mainnet-beta", OPEN, recorded)).toBeUndefined();
    expect(budgetOpenProblem("solana-mainnet-beta", { ...OPEN, BUDGETS_MAINNET: "yes" }, recorded)).toMatch(/BUDGETS_MAINNET/);
    expect(budgetOpenProblem("solana-mainnet-beta", OPEN, () => false)).toMatch(/deployment/);
    expect(budgetOpenProblem("solana-mainnet-beta", { ...OPEN, SOLANA_RPC_URL: " " }, recorded)).toMatch(/SOLANA_RPC_URL/);
    expect(budgetOpenProblem("solana-mainnet-beta", { ...OPEN, BUDGET_MAX_OPEN_RELAY: "lots" }, recorded)).toMatch(/BUDGET_MAX_OPEN_RELAY/);
  });

  it("is closed with the committed profile today", () => {
    expect(budgetOpenProblem("solana-mainnet-beta", {})).toBeDefined();
  });
});

describe("Open Budget ceilings", () => {
  const record = (who: string, network: SpenderRecord["network"] = "solana-mainnet-beta") => ({ payer: who, network }) as SpenderRecord;
  const store = (records: SpenderRecord[] | Error) =>
    ({
      withStatus: async () => {
        if (records instanceof Error) throw records;
        return records;
      },
    }) as unknown as BudgetCustodyStore;
  const env = { BUDGET_MAX_OPEN_RELAY: "3" };

  it("has no mainnet total until it is set, and three per payer", () => {
    expect(openBudgetLimits("solana-mainnet-beta", {})).toEqual({ total: 0, perPayer: 3 });
    expect(openBudgetLimits("solana-devnet", {})).toEqual({ total: 500, perPayer: 10 });
    expect(openBudgetLimits("solana-mainnet-beta", { BUDGET_MAX_OPEN_RELAY: "40", BUDGET_MAX_OPEN_PER_PAYER: "2" })).toEqual({ total: 40, perPayer: 2 });
    expect(openBudgetLimits("solana-mainnet-beta", { BUDGET_MAX_OPEN_RELAY: "-1" })).toEqual({ total: 0, perPayer: 3 });
  });

  it("refuses when unset, full, or the payer holds its share, and counts this network only", async () => {
    expect(await openBudgetRoom({ store: store([]), network: "solana-mainnet-beta", payer, env: {} })).toMatchObject({ code: "budgets_not_open" });
    const other = Keypair.generate().publicKey.toBase58();
    expect(await openBudgetRoom({ store: store([record(other), record(other), record(other)]), network: "solana-mainnet-beta", payer, env })).toMatchObject({ status: 503, code: "budgets_full" });
    expect(await openBudgetRoom({ store: store([record(other), record(other), record(other, "solana-devnet")]), network: "solana-mainnet-beta", payer, env })).toBeUndefined();
    const mine = [record(payer), record(payer)];
    expect(await openBudgetRoom({ store: store(mine), network: "solana-mainnet-beta", payer, env: { BUDGET_MAX_OPEN_RELAY: "10", BUDGET_MAX_OPEN_PER_PAYER: "2" } })).toMatchObject({ status: 429, code: "payer_budgets_full" });
    expect(await openBudgetRoom({ store: store(new Error("down")), network: "solana-mainnet-beta", payer, env })).toMatchObject({ code: "store_unavailable" });
  });
});

describe("Durable Budget rate limits", () => {
  const request = (ip = "203.0.113.9") => new Request("https://app.example/api/budget/v1/start", { method: "POST", headers: { "x-forwarded-for": ip } });

  it("counts per client, payer and overall, with hashed buckets", async () => {
    const buckets: string[] = [];
    const counter: DurableCounter = async (bucket) => {
      buckets.push(bucket);
      return 0;
    };
    expect(await budgetRateLimited(request(), "start", { network: "solana-mainnet-beta", counter, payer })).toBeUndefined();
    expect(buckets.map((b) => b.split(":").slice(0, 3).join(":"))).toEqual(BUDGET_RATE_RULES.start.map((r) => `solana-mainnet-beta:start:${r.scope}`));
    expect(buckets.join(" ")).not.toContain("203.0.113.9");
    expect(buckets.join(" ")).not.toContain(payer);
  });

  it("answers 429 with retry-after and names who is over", async () => {
    const counter: DurableCounter = async (bucket) => (bucket.includes(":payer:") ? 42 : 0);
    const refused = await budgetRateLimited(request(), "start", { network: "solana-devnet", counter, payer });
    expect(refused?.status).toBe(429);
    expect(refused?.headers.get("retry-after")).toBe("42");
    expect((await refused!.json()).error.message).toMatch(/This wallet/);
  });

  it("fails closed for mainnet opens only when the counters cannot be reached", async () => {
    const down: DurableCounter = async () => "unavailable";
    for (const route of ["prepare", "start"] as const) {
      expect((await budgetRateLimited(request(), route, { network: "solana-mainnet-beta", counter: down }))?.status).toBe(503);
      expect((await budgetRateLimited(request(), route, { network: "solana-mainnet-beta", counter: undefined }))?.status).toBe(503);
      expect(await budgetRateLimited(request(), route, { network: "solana-devnet", counter: down })).toBeUndefined();
    }
    for (const route of ["read", "chat"] as const) {
      expect(await budgetRateLimited(request(), route, { network: "solana-mainnet-beta", counter: down, key: "k" })).toBeUndefined();
      expect(await budgetRateLimited(request(), route, { network: "solana-mainnet-beta", counter: undefined })).toBeUndefined();
    }
  });

  it("reaches mainnet counters with the app role in the mainnet schema, never the service key", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string> });
      return new Response("7", { status: 200 });
    }) as unknown as typeof fetch;
    const base = { NEXT_PUBLIC_SUPABASE_URL: "https://db.example/", SUPABASE_SERVICE_ROLE_KEY: "service" };
    expect(supabaseCounter("solana-mainnet-beta", base, fetchImpl)).toBeUndefined();
    const counter = supabaseCounter("solana-mainnet-beta", { ...base, NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", BUDGET_CUSTODY_ROLE_TOKEN: "role", BUDGET_CUSTODY_SCHEMA: "budget_mainnet" }, fetchImpl);
    expect(await counter!("b", 60, 1)).toBe(7);
    expect(calls[0].url).toBe("https://db.example/rest/v1/rpc/budget_rate_hit");
    expect(calls[0].headers).toMatchObject({ apikey: "anon", authorization: "Bearer role", "content-profile": "budget_mainnet" });
    expect(JSON.stringify(calls[0].headers)).not.toContain("service");
    const devnet = supabaseCounter("solana-devnet", base, fetchImpl);
    expect(await devnet!("b", 60, 1)).toBe(7);
    expect(calls[1].headers).toMatchObject({ apikey: "service", authorization: "Bearer service" });
  });

  it("treats a bad answer or a failed call as unavailable", async () => {
    const env = { NEXT_PUBLIC_SUPABASE_URL: "https://db.example", SUPABASE_SERVICE_ROLE_KEY: "service" };
    const answer = (body: string, status = 200) => (async () => new Response(body, { status })) as unknown as typeof fetch;
    expect(await supabaseCounter("solana-devnet", env, answer("-1"))!("b", 60, 1)).toBe("unavailable");
    expect(await supabaseCounter("solana-devnet", env, answer("1", 500))!("b", 60, 1)).toBe("unavailable");
    expect(await supabaseCounter("solana-devnet", env, (async () => Promise.reject(new Error("x"))) as unknown as typeof fetch)!("b", 60, 1)).toBe("unavailable");
  });
});
