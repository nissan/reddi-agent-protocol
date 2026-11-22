import { describeRpcEndpoint, serverRpcEndpoint } from "../server-rpc";

describe("serverRpcEndpoint", () => {
  it("falls back to the profile RPC when SOLANA_RPC_URL is unset", () => {
    const result = serverRpcEndpoint({});
    expect(result).toMatchObject({ ok: true, source: "profile", keyed: false });
  });

  it("uses a keyed https URL", () => {
    const result = serverRpcEndpoint({ SOLANA_RPC_URL: " https://mainnet.helius-rpc.com/?api-key=abc " });
    expect(result).toEqual({ ok: true, url: "https://mainnet.helius-rpc.com/?api-key=abc", keyed: true, source: "SOLANA_RPC_URL" });
  });

  it("refuses http, user info and junk without echoing the value", () => {
    for (const value of ["http://mainnet.helius-rpc.com/?api-key=abc", "https://u:p@rpc.example", "not a url abc"]) {
      const result = serverRpcEndpoint({ SOLANA_RPC_URL: value });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).not.toContain("abc");
    }
  });
});

describe("describeRpcEndpoint", () => {
  it("returns the host only", () => {
    expect(describeRpcEndpoint("https://mainnet.helius-rpc.com/?api-key=abc")).toBe("mainnet.helius-rpc.com");
    expect(describeRpcEndpoint("nope")).toBe("unparseable RPC endpoint");
  });
});

describe("server-side RPC never resolves to the browser proxy (audit round 1, review of #910)", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    jest.resetModules();
  });

  it("uses the registered mainnet RPC when the browser endpoint is the /api/rpc proxy", async () => {
    process.env = { ...saved, NETWORK_PROFILE: "mainnet", NEXT_PUBLIC_RPC_ENDPOINT: "https://app.agent-protocol.reddi.tech/api/rpc" };
    delete process.env.SOLANA_RPC_URL;
    const { serverRpcUrl, isAppRpcProxyPath } = await import("../server-rpc");
    const { getNetworkProfile, registeredRpcHttp } = await import("@/lib/config/network");
    expect(isAppRpcProxyPath(getNetworkProfile().solana.rpcHttp)).toBe(true);
    const url = serverRpcUrl();
    expect(url).toBe(registeredRpcHttp("mainnet"));
    expect(isAppRpcProxyPath(url!)).toBe(false);
  });

  it("prefers SOLANA_RPC_URL on the server", async () => {
    process.env = { ...saved, NETWORK_PROFILE: "mainnet", NEXT_PUBLIC_RPC_ENDPOINT: "https://app.agent-protocol.reddi.tech/api/rpc", SOLANA_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=k" };
    const { serverRpcUrl } = await import("../server-rpc");
    expect(serverRpcUrl()).toBe("https://mainnet.helius-rpc.com/?api-key=k");
  });

  it("server modules that verify or read chain state do not use the browser endpoint", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as typeof import("fs");
    for (const file of ["lib/onboarding/planner-execution.ts", "lib/registry/bridge.ts", "lib/torque/client.ts"]) {
      const source = fs.readFileSync(file, "utf8");
      expect(source).not.toMatch(/getNetworkProfile\(\)\.solana\.rpcHttp/);
      expect(source).not.toMatch(/new Connection\(DEVNET_RPC/);
      expect(source).toContain("serverRpcUrl()");
    }
  });
});
