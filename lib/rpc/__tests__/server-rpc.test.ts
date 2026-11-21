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
