import { pinLaunchRateClock } from "@/lib/test-support/launch-clock";
import { parseUsdPerMillion, previewEarnings } from "@/lib/onboarding/price-preview";

describe("onboarding price preview", () => {
  it("prices a typical call and takes the planned 2.5% fee from the provider's share", () => {
    // 12,000 in at $0.50/M = $0.006; 1,500 out at $1.50/M = $0.00225; total $0.00825.
    const preview = previewEarnings("0.50", "1.50");
    expect(preview).not.toBeNull();
    expect(preview!.usage).toEqual({ inputTokens: 12_000, outputTokens: 1_500 });
    expect(preview!.buyerPays.usdc).toBe("0.00825");
    // 8,250 micro-dollars * 250 / 10,000 = 206.25, rounded down to 206.
    expect(preview!.feeUsdc).toBe("0.000206");
    expect(preview!.providerReceivesUsdc).toBe("0.008044");
    // Demo rates: 1 USD = 1.55 AUDD, 1 SOL = 150 USD.
    expect(preview!.buyerPays.audd).toBe("0.012788");
    expect(preview!.buyerPays.sol).toBe("0.000055");
  });

  it("rounds the cost up to a whole micro-dollar", () => {
    const preview = previewEarnings("0.000001", "0", { inputTokens: 1, outputTokens: 0 });
    expect(preview!.buyerPays.usdc).toBe("0.000001");
    expect(preview!.feeUsdc).toBe("0");
  });

  it("returns nothing until both prices are valid and one is above zero", () => {
    expect(previewEarnings("", "1.50")).toBeNull();
    expect(previewEarnings("abc", "1")).toBeNull();
    expect(previewEarnings("-1", "1")).toBeNull();
    expect(previewEarnings("0", "0")).toBeNull();
    expect(previewEarnings("0.1234567", "1")).toBeNull();
  });

  it("parses dollar amounts with up to six decimals", () => {
    expect(parseUsdPerMillion("2")).toBe(BigInt(2_000_000));
    expect(parseUsdPerMillion(" 0.5 ")).toBe(BigInt(500_000));
    expect(parseUsdPerMillion("1.")).toBe(BigInt(1_000_000));
    expect(parseUsdPerMillion("1e3")).toBeNull();
  });
});

// Fee terms built from the current time stay at the launch rate after 1 April 2027.
pinLaunchRateClock();
