import { checkRpcBody, forwardRpc, isAllowedOrigin, MAX_RPC_BATCH, MAX_RPC_BODY_BYTES, parseAllowedOrigins } from "../proxy";

const PROGRAM = "DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu";
const programs = new Set([PROGRAM]);
const call = (method: string, params: unknown[] = [], id: unknown = 1) => ({ jsonrpc: "2.0", id, method, params });

describe("checkRpcBody", () => {
  it("accepts an allowed single call and batch", () => {
    expect(checkRpcBody(JSON.stringify(call("getLatestBlockhash")), programs).ok).toBe(true);
    expect(checkRpcBody(JSON.stringify([call("getBalance", ["x"]), call("sendTransaction", ["tx"], 2)]), programs).ok).toBe(true);
  });

  it("refuses a method outside the allowlist, with the caller's id", () => {
    const result = checkRpcBody(JSON.stringify(call("requestAirdrop", [], 7)), programs);
    expect(result).toMatchObject({ ok: false, status: 403, code: "rpc_method_not_allowed", id: 7 });
  });

  it("refuses one bad call inside a batch", () => {
    const result = checkRpcBody(JSON.stringify([call("getSlot"), call("getLargestAccounts")]), programs);
    expect(result).toMatchObject({ ok: false, code: "rpc_method_not_allowed" });
  });

  it("limits getProgramAccounts to the app's programs", () => {
    expect(checkRpcBody(JSON.stringify(call("getProgramAccounts", [PROGRAM, { filters: [{ dataSize: 200 }] }])), programs).ok).toBe(true);
    const other = checkRpcBody(JSON.stringify(call("getProgramAccounts", ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"])), programs);
    expect(other).toMatchObject({ ok: false, status: 403 });
    expect(checkRpcBody(JSON.stringify(call("getProgramAccounts")), programs).ok).toBe(false);
  });

  it("refuses malformed, empty, oversized and over-long batches", () => {
    expect(checkRpcBody("not json", programs)).toMatchObject({ ok: false, status: 400, code: "rpc_parse_error" });
    expect(checkRpcBody("[]", programs)).toMatchObject({ ok: false, status: 400 });
    expect(checkRpcBody(JSON.stringify({ id: 1, method: "getSlot" }), programs)).toMatchObject({ ok: false, code: "rpc_invalid_request" });
    expect(checkRpcBody(JSON.stringify(["getSlot"]), programs)).toMatchObject({ ok: false, code: "rpc_invalid_request" });
    const batch = Array.from({ length: MAX_RPC_BATCH + 1 }, (_, i) => call("getSlot", [], i));
    expect(checkRpcBody(JSON.stringify(batch), programs)).toMatchObject({ ok: false, code: "rpc_batch_too_large" });
    const big = JSON.stringify(call("sendTransaction", ["a".repeat(MAX_RPC_BODY_BYTES)]));
    expect(checkRpcBody(big, programs)).toMatchObject({ ok: false, status: 413 });
  });
});

describe("isAllowedOrigin", () => {
  const url = "https://app.agent-protocol.reddi.tech/api/rpc";
  it("allows the app's own origin and listed extras only", () => {
    expect(isAllowedOrigin("https://app.agent-protocol.reddi.tech", url, [])).toBe(true);
    expect(isAllowedOrigin("https://evil.example", url, [])).toBe(false);
    expect(isAllowedOrigin("https://preview.vercel.app", url, ["https://preview.vercel.app"])).toBe(true);
  });
  it("refuses a call with no Origin", () => {
    expect(isAllowedOrigin(null, url, [])).toBe(false);
  });
  it("keeps only exact https origins from the env list", () => {
    expect(parseAllowedOrigins(" https://a.example ,http://b.example,https://c.example/path,junk")).toEqual(["https://a.example"]);
    expect(parseAllowedOrigins(undefined)).toEqual([]);
  });
});

describe("forwardRpc", () => {
  const upstream = "https://mainnet.helius-rpc.com/?api-key=SECRET";
  const body = JSON.stringify(call("getSlot"));

  it("passes a JSON answer through", async () => {
    const fake = jest.fn(async () => new Response('{"jsonrpc":"2.0","id":1,"result":5}', { headers: { "content-type": "application/json" } }));
    const res = await forwardRpc(body, upstream, fake as unknown as typeof fetch);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jsonrpc: "2.0", id: 1, result: 5 });
    expect(fake).toHaveBeenCalledWith(upstream, expect.objectContaining({ method: "POST", body }));
  });

  it("never leaks the upstream URL or its error text", async () => {
    const cases: Array<typeof fetch> = [
      (async () => { throw new Error(`connect failed ${upstream}`); }) as unknown as typeof fetch,
      (async () => new Response(`bad key ${upstream}`, { status: 401, headers: { "content-type": "text/plain" } })) as unknown as typeof fetch,
      (async () => new Response("slow down", { status: 429 })) as unknown as typeof fetch,
    ];
    for (const fake of cases) {
      const res = await forwardRpc(body, upstream, fake);
      expect(res.status).toBeGreaterThanOrEqual(429);
      const text = await res.text();
      expect(text).not.toContain("SECRET");
      expect(text).not.toContain("helius");
    }
  });
});
