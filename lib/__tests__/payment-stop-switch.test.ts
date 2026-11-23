import { fetchPaymentStop, paymentStopped, readPaymentStop } from "@/lib/payments/stop-switch";
import { GET } from "@/app/api/payments/status/route";

describe("payment stop switch (incident runbook)", () => {
  it("is open when nothing is set", () => {
    const stop = readPaymentStop({});
    expect(stop).toEqual({ stopAll: false, pausedCurrencies: [] });
    for (const c of ["SOL", "USDC", "AUDD", "PYUSD", "USDG"]) expect(paymentStopped(stop, c)).toBe(false);
  });

  it("stops everything on RAP_STOP_NEW_PAYMENTS", () => {
    for (const value of ["true", "1", "TRUE", " yes "]) {
      const stop = readPaymentStop({ RAP_STOP_NEW_PAYMENTS: value });
      expect(stop.stopAll).toBe(true);
      expect(paymentStopped(stop, "SOL")).toBe(true);
      expect(paymentStopped(stop, "USDC")).toBe(true);
    }
    expect(readPaymentStop({ RAP_STOP_NEW_PAYMENTS: "false" }).stopAll).toBe(false);
    expect(readPaymentStop({ RAP_STOP_NEW_PAYMENTS: "0" }).stopAll).toBe(false);
  });

  it("stops one currency at a time", () => {
    const stop = readPaymentStop({ RAP_PAUSED_CURRENCIES: "pyusd, USDG,PYUSD" });
    expect(stop.stopAll).toBe(false);
    expect(stop.pausedCurrencies).toEqual(["PYUSD", "USDG"]);
    expect(paymentStopped(stop, "PYUSD")).toBe(true);
    expect(paymentStopped(stop, "usdg")).toBe(true);
    expect(paymentStopped(stop, "USDC")).toBe(false);
    expect(paymentStopped(stop, "SOL")).toBe(false);
    expect(stop.reason).toContain("PYUSD, USDG");
  });

  it("treats an unknown currency as a stop of everything (fail closed)", () => {
    const stop = readPaymentStop({ RAP_PAUSED_CURRENCIES: "PYUSD,USDX" });
    expect(stop.stopAll).toBe(true);
    expect(stop.reason).not.toContain("USDX");
  });

  it("serves the state from GET /api/payments/status without caching", async () => {
    const before = { ...process.env };
    try {
      process.env.RAP_PAUSED_CURRENCIES = "USDG";
      delete process.env.RAP_STOP_NEW_PAYMENTS;
      const response = await GET();
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toMatchObject({ stopAll: false, pausedCurrencies: ["USDG"] });
    } finally {
      process.env = before;
    }
  });

  it("fails closed when the status cannot be read, only when asked to", async () => {
    const broken = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect((await fetchPaymentStop(broken, true)).stopAll).toBe(true);
    expect((await fetchPaymentStop(broken, false)).stopAll).toBe(false);
    const garbage = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    expect((await fetchPaymentStop(garbage, true)).stopAll).toBe(true);
    const ok = (async () => Response.json({ stopAll: false, pausedCurrencies: ["SOL"] })) as unknown as typeof fetch;
    const stop = await fetchPaymentStop(ok, true);
    expect(paymentStopped(stop, "SOL")).toBe(true);
    expect(paymentStopped(stop, "USDC")).toBe(false);
  });
});
