/**
 * Outbound guard for caller-influenced URLs (security audit round 1, S2-claude-02, condition C3).
 */
import { checkOutboundUrl, fetchOutbound, isBlockedAddress, OutboundRefusedError } from "@/lib/http/outbound";

const publicResolver = async () => ["93.184.215.14"];

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "127.0.0.2",
    "0.0.0.0",
    "10.1.2.3",
    "172.20.0.1",
    "192.168.1.10",
    "169.254.169.254",
    "100.100.100.200",
    "::1",
    "[::1]",
    "::",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:a9fe:a9fe",
    "fd00::1",
    "fe80::1",
    "fec0::1",
    "2002:7f00:1::1",
    "2001:0:4136:e378::1",
    "not-an-ip",
  ])("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(["93.184.215.14", "1.1.1.1", "2606:4700:4700::1111", "::ffff:5db8:d70e"])("allows public %s", (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});

describe("checkOutboundUrl", () => {
  it.each([
    "http://example.com/",
    "https://127.0.0.2/",
    "https://[::1]/",
    "https://[::ffff:7f00:1]/",
    "https://169.254.169.254/latest/meta-data/",
    "https://localhost./",
    "https://foo.localhost/",
    "https://metadata.google.internal/",
    "https://user:pw@example.com/",
    "ftp://example.com/",
    "not a url",
  ])("refuses %s", async (raw) => {
    expect((await checkOutboundUrl(raw, { resolve: publicResolver })).ok).toBe(false);
  });

  it("refuses a public-looking name that resolves to a private address", async () => {
    const result = await checkOutboundUrl("https://127.0.0.1.nip.io/", { resolve: async () => ["127.0.0.1"] });
    expect(result.ok).toBe(false);
  });

  it("refuses when any resolved address is private", async () => {
    const result = await checkOutboundUrl("https://mixed.example/", { resolve: async () => ["93.184.215.14", "10.0.0.5"] });
    expect(result.ok).toBe(false);
  });

  it("refuses a name that does not resolve", async () => {
    const result = await checkOutboundUrl("https://nothing.example/", { resolve: async () => { throw new Error("ENOTFOUND"); } });
    expect(result.ok).toBe(false);
  });

  it("allows a public https URL, and http only when asked", async () => {
    expect((await checkOutboundUrl("https://provider.example/v1", { resolve: publicResolver })).ok).toBe(true);
    expect((await checkOutboundUrl("http://provider.example/v1", { resolve: publicResolver, allowHttp: true })).ok).toBe(true);
  });
});

describe("fetchOutbound", () => {
  it("never follows a redirect: a listed endpoint that 303s to loopback comes back as the 303", async () => {
    const fetchImpl = jest.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.redirect).toBe("manual");
      return new Response(null, { status: 303, headers: { location: "http://127.0.0.1:8080/internal" } });
    }) as unknown as typeof fetch;
    const res = await fetchOutbound("https://attacker.example/v1/chat/completions", { method: "POST" }, { resolve: publicResolver, fetchImpl });
    expect(res.status).toBe(303);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws before any request for a refused URL", async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    await expect(fetchOutbound("https://10.0.0.5:8080/", {}, { resolve: publicResolver, fetchImpl })).rejects.toBeInstanceOf(OutboundRefusedError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
