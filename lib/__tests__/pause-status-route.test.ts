// The pause banner on every page reads /api/pause-status, and a production build serves only the V1
// surface (proxy.ts, lib/v1-routes.ts): the route must be on it, or the banner stays silent in a real
// pause (security review S7-delta-03, 27 November 2026).
import { NextRequest } from "next/server";
import { isV1Path } from "@/lib/v1-routes";
import { proxy } from "@/proxy";

describe("emergency pause status route in a production build", () => {
  it("is part of the V1 surface", () => {
    expect(isV1Path("/api/pause-status")).toBe(true);
  });

  it("is not answered 404 by the production proxy", () => {
    const previous = process.env.V1_ROUTES_ONLY;
    process.env.V1_ROUTES_ONLY = "1";
    try {
      const response = proxy(new NextRequest("https://app.example/api/pause-status"));
      expect(response.status).not.toBe(404);
    } finally {
      if (previous === undefined) delete process.env.V1_ROUTES_ONLY;
      else process.env.V1_ROUTES_ONLY = previous;
    }
  });
});

describe("emergency pause status route answers", () => {
  const calls: string[] = [];
  let genesis = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
  let failing = false;

  beforeEach(() => {
    jest.resetModules();
    calls.length = 0;
    failing = false;
    jest.doMock("@solana/web3.js", () => {
      const actual = jest.requireActual("@solana/web3.js");
      class FakeConnection {
        async getGenesisHash() {
          calls.push("getGenesisHash");
          return genesis;
        }
        async getSlot() {
          calls.push("getSlot");
          if (failing) throw new Error("rpc down");
          return 100;
        }
        async getAccountInfo() {
          calls.push("getAccountInfo");
          if (failing) throw new Error("rpc down");
          return null;
        }
      }
      return { ...actual, Connection: FakeConnection };
    });
  });

  afterEach(() => jest.dontMock("@solana/web3.js"));

  it("refuses a server RPC on another cluster than the profile's", async () => {
    genesis = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
    const { GET } = await import("@/app/api/pause-status/route");
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: "rpc_wrong_cluster" });
    expect(calls).not.toContain("getAccountInfo");
  });

  it("reads once, and reuses a failed read instead of asking the RPC on every page view", async () => {
    genesis = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
    failing = true;
    const { GET } = await import("@/app/api/pause-status/route");
    const [a, b] = await Promise.all([GET(), GET()]);
    expect([a.status, b.status]).toEqual([503, 503]);
    expect((await GET()).status).toBe(503);
    expect(calls.filter((c) => c === "getSlot")).toHaveLength(1);
  });

  it("answers the status when the RPC is on the profile's cluster", async () => {
    genesis = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
    const { GET } = await import("@/app/api/pause-status/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, paused: true, missing: true, pausedUntilSlot: "0", slot: "100" });
  });
});
