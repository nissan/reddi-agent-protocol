/**
 * #1203: providers run apart from the Budget relay. A mainnet build of the app holds no provider
 * payee key, no provider slice ledger and no payout job, and lists only kit providers.
 */
import { Keypair } from "@solana/web3.js";
import {
  assertNoProviderSecretsOnMainnet,
  devnetAppOrigin,
  isDevnetOnlyApi,
  isDevnetOnlyPage,
  providerSecretsPresent,
} from "@/lib/config/mainnet-provider-guard";
import { budgetProviderDirectory } from "@/lib/budget/providers";
import { SANDBOX_PROVIDERS } from "@/lib/sandbox/catalog";
import { loadSandboxPayeeKeys, SANDBOX_PAYEE_KEYS_ENV } from "@/lib/sandbox/settle-signer";

const MAINNET = { NEXT_PUBLIC_BUILD_NETWORK_PROFILE: "mainnet" };
const KIT_PROVIDER = JSON.stringify([
  {
    id: "rap-swift",
    name: "RAP Swift",
    url: "https://providers.example/v1/chat/completions",
    payee: Keypair.generate().publicKey.toBase58(),
    inputPerMillionUsd: "0.2",
    outputPerMillionUsd: "0.8",
  },
]);

describe("mainnet build refuses provider secrets (RAP-MB1-S2)", () => {
  it("refuses a mainnet build or start with either sandbox payee key variable, naming it but not its value", () => {
    for (const key of ["SANDBOX_DEVNET_PAYEE_KEYS", "SANDBOX_PAYEE_KEYS"]) {
      const env = { ...MAINNET, [key]: '{"secret":[1,2,3]}' };
      expect(() => assertNoProviderSecretsOnMainnet(env)).toThrow(/mainnet build of the app/);
      expect(() => assertNoProviderSecretsOnMainnet(env)).toThrow(new RegExp(`Found: ${key}\\.`));
      try {
        assertNoProviderSecretsOnMainnet(env);
      } catch (error) {
        expect(String(error)).not.toContain("secret");
      }
    }
    expect(() => assertNoProviderSecretsOnMainnet({ NETWORK_PROFILE: "mainnet-beta", SANDBOX_DEVNET_PAYEE_KEYS: "x" })).toThrow();
  });

  it("starts a mainnet build with the variables unset or blank", () => {
    expect(() => assertNoProviderSecretsOnMainnet(MAINNET)).not.toThrow();
    expect(() => assertNoProviderSecretsOnMainnet({ ...MAINNET, SANDBOX_DEVNET_PAYEE_KEYS: "  " })).not.toThrow();
    expect(providerSecretsPresent({ ...MAINNET, SANDBOX_DEVNET_PAYEE_KEYS: "" })).toEqual([]);
  });

  it("leaves devnet and local builds as they are", () => {
    expect(() => assertNoProviderSecretsOnMainnet({ SANDBOX_DEVNET_PAYEE_KEYS: "x" })).not.toThrow();
    expect(() => assertNoProviderSecretsOnMainnet({ NETWORK_PROFILE: "devnet", SANDBOX_DEVNET_PAYEE_KEYS: "x" })).not.toThrow();
    expect(() => assertNoProviderSecretsOnMainnet({ NETWORK_PROFILE: "surfpool", SANDBOX_DEVNET_PAYEE_KEYS: "x" })).not.toThrow();
  });
});

describe("a mainnet app reads no provider key and lists no sandbox provider (RAP-MB1-S1, S3)", () => {
  const provider = SANDBOX_PROVIDERS.find((p) => !p.simulatedOnly && p.behaviour !== "offline")!;
  const devnetKey = () => {
    // A key that matches no catalog payTo is ignored, so build the map from a fresh key and
    // check only that mainnet never parses: an unmatched key gives an empty map on devnet too.
    return JSON.stringify({ [provider.id]: Array.from(Keypair.generate().secretKey) });
  };

  it("never parses the keys on a mainnet build", () => {
    const parse = jest.spyOn(JSON, "parse");
    const keys = loadSandboxPayeeKeys({ ...MAINNET, [SANDBOX_PAYEE_KEYS_ENV]: devnetKey() });
    expect(keys.size).toBe(0);
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
  });

  it("still parses them on devnet", () => {
    const parse = jest.spyOn(JSON, "parse");
    loadSandboxPayeeKeys({ [SANDBOX_PAYEE_KEYS_ENV]: devnetKey() });
    expect(parse).toHaveBeenCalled();
    parse.mockRestore();
  });

  it("lists only the kit providers for a mainnet Budget", () => {
    const mainnet = budgetProviderDirectory({ ...MAINNET, BUDGET_USDC_PROVIDERS: KIT_PROVIDER });
    expect(mainnet.map((p) => p.id)).toEqual(["rap-swift"]);
    expect(mainnet.every((p) => p.endpoint.kind === "url")).toBe(true);
    expect(budgetProviderDirectory(MAINNET)).toEqual([]);
  });

  it("keeps the sandbox providers on devnet", () => {
    const devnet = budgetProviderDirectory({ BUDGET_USDC_PROVIDERS: KIT_PROVIDER });
    expect(devnet.some((p) => p.endpoint.kind === "sandbox")).toBe(true);
    expect(devnet.some((p) => p.id === "rap-swift")).toBe(true);
  });
});

describe("devnet-only routes", () => {
  it("names the sandbox pages and every sandbox payout, settle and ledger route", () => {
    for (const path of ["/try", "/pass", "/planner", "/sandbox", "/sandbox/budget"]) expect(isDevnetOnlyPage(path)).toBe(true);
    for (const path of ["/budget", "/jobs", "/agents", "/register", "/", "/trying"]) expect(isDevnetOnlyPage(path)).toBe(false);
    for (const path of [
      "/api/cron/sandbox-budgets",
      "/api/cron/seller-ratings",
      "/api/sandbox/v1/chat/completions",
      "/api/try/v1/status",
      "/api/pass/v1/pay",
    ]) expect(isDevnetOnlyApi(path)).toBe(true);
    for (const path of ["/api/budget/v1/chat/completions", "/api/cron/budget-watch", "/api/jobs", "/api/rpc"]) expect(isDevnetOnlyApi(path)).toBe(false);
  });

  it("takes only a plain https origin for the devnet app", () => {
    expect(devnetAppOrigin({ DEVNET_APP_ORIGIN: "https://devnet.agent-protocol.reddi.tech" })).toBe("https://devnet.agent-protocol.reddi.tech");
    expect(devnetAppOrigin({ DEVNET_APP_ORIGIN: "https://devnet.agent-protocol.reddi.tech/" })).toBe("https://devnet.agent-protocol.reddi.tech");
    for (const bad of ["http://devnet.example", "https://u:p@devnet.example", "https://devnet.example:8443", "https://devnet.example/x", "https://devnet.example/?a=1", "not a url", "", undefined]) {
      expect(devnetAppOrigin({ DEVNET_APP_ORIGIN: bad })).toBeUndefined();
    }
  });
});

describe("proxy on a mainnet build (#1203)", () => {
  const originalEnv = process.env;
  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
  });

  async function run(path: string, env: Record<string, string>) {
    jest.resetModules();
    process.env = { ...originalEnv, ...env };
    delete process.env.V1_ROUTES_ONLY;
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("../../proxy");
    return proxy(new NextRequest(`https://app.agent-protocol.reddi.tech${path}`));
  }

  it("answers 404 for every sandbox payout, settle and ledger API route", async () => {
    for (const path of ["/api/cron/sandbox-budgets", "/api/cron/seller-ratings", "/api/try/v1/start", "/api/pass/v1/pay", "/api/sandbox/v1/models"]) {
      const res = await run(path, { NEXT_PUBLIC_BUILD_NETWORK_PROFILE: "mainnet", DEVNET_APP_ORIGIN: "https://devnet.agent-protocol.reddi.tech" });
      expect([path, res.status]).toEqual([path, 404]);
    }
  });

  it("sends devnet-only pages to the devnet app, keeping the path and query", async () => {
    const res = await run("/try?task=1", { NEXT_PUBLIC_BUILD_NETWORK_PROFILE: "mainnet", DEVNET_APP_ORIGIN: "https://devnet.agent-protocol.reddi.tech" });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://devnet.agent-protocol.reddi.tech/try?task=1");
  });

  it("answers 404 for devnet-only pages when no devnet app is set", async () => {
    const res = await run("/pass", { NEXT_PUBLIC_BUILD_NETWORK_PROFILE: "mainnet" });
    expect(res.status).toBe(404);
  });

  it("serves the Budget and its relay on mainnet", async () => {
    for (const path of ["/budget", "/api/budget/v1/chat/completions"]) {
      const res = await run(path, { NEXT_PUBLIC_BUILD_NETWORK_PROFILE: "mainnet" });
      expect([path, res.headers.get("x-middleware-next")]).toEqual([path, "1"]);
    }
  });

  it("leaves the devnet app's sandbox routes alone", async () => {
    for (const path of ["/try", "/api/cron/sandbox-budgets"]) {
      const res = await run(path, { NEXT_PUBLIC_BUILD_NETWORK_PROFILE: "devnet" });
      expect([path, res.headers.get("x-middleware-next")]).toEqual([path, "1"]);
    }
  });
});
