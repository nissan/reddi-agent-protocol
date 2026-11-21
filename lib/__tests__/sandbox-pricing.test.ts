import { findSandboxProviderById, SANDBOX_PROVIDERS } from "@/lib/sandbox/catalog";
import { providerPriceView, triPriceLabel } from "@/lib/sandbox/client";
import {
  countTokens,
  formatUnits,
  lamportsToMicroUsd,
  maxChargeLamports,
  microUsdToAuddUnits,
  microUsdToLamports,
  requestInputTokens,
  settleSandboxCall,
  triPriceFromMicroUsd,
  usageCostMicroUsd,
} from "@/lib/sandbox/pricing";

const atlas = findSandboxProviderById("atlas-review")!;
const swift = findSandboxProviderById("swift-infer")!;
const bargain = findSandboxProviderById("bargain-models")!;
const n = (value: number) => BigInt(value);

describe("sandbox per-token pricing", () => {
  it("prices tokens exactly at the listed per-million rates, rounding up to the micro-dollar", () => {
    expect(usageCostMicroUsd(atlas, { inputTokens: 1_000_000, outputTokens: 0 })).toBe(n(5_000_000));
    expect(usageCostMicroUsd(atlas, { inputTokens: 0, outputTokens: 1_000_000 })).toBe(n(25_000_000));
    expect(usageCostMicroUsd(atlas, { inputTokens: 1_200, outputTokens: 800 })).toBe(n(26_000));
    // 1 input token at $0.20 per million is a fifth of a micro-dollar: the provider is paid the whole micro-dollar.
    expect(usageCostMicroUsd(swift, { inputTokens: 1, outputTokens: 0 })).toBe(n(1));
    expect(usageCostMicroUsd(swift, { inputTokens: 0, outputTokens: 0 })).toBe(n(0));
  });

  it("converts at the fixed demo rates, rounding the amount paid up and the amount shown down", () => {
    expect(microUsdToLamports(n(150_000_000))).toBe(n(1_000_000_000));
    expect(microUsdToLamports(n(1))).toBe(n(7)); // 6.67 lamports, rounded up
    expect(lamportsToMicroUsd(n(7))).toBe(n(1)); // 1.05 micro-dollars, rounded down
    expect(microUsdToAuddUnits(n(1_000_000))).toBe(n(1_550_000));
    expect(triPriceFromMicroUsd(n(3_000_000))).toEqual({ usdc: "3", audd: "4.65", sol: "0.02" });
    expect(formatUnits(n(5_354), 9)).toBe("0.000005354");
    expect(formatUnits(n(1_000_000_000), 9)).toBe("1");
  });

  it("counts request tokens at about four characters each", () => {
    expect(countTokens("")).toBe(0);
    expect(countTokens("abcd")).toBe(1);
    expect(countTokens("abcde")).toBe(2);
    expect(requestInputTokens([{ content: "abcd" }, { content: "abcdefgh" }])).toBe(3);
  });

  it("sets the maximum per call from the request plus the provider's full output limit", () => {
    expect(maxChargeLamports(swift, 12)).toBe(microUsdToLamports(usageCostMicroUsd(swift, { inputTokens: 12, outputTokens: 1_000 })));
    expect(maxChargeLamports(atlas, 0)).toBe(n(833_334)); // 5,000 output tokens at $25 per million = $0.125, about 0.000833 SOL, rounded up
    const view = providerPriceView(atlas, 0);
    expect(view.inputPerMillion).toEqual({ usdc: "5", audd: "7.75", sol: "0.033333334" });
    expect(view.outputPerMillion).toEqual({ usdc: "25", audd: "38.75", sol: "0.166666667" });
    expect(triPriceLabel(view.maxPerCall)).toBe("0.125 USDC · 0.19375 AUDD · 0.000833334 SOL");
    // A typical real review: 12,000 tokens in and 1,500 out at $5 / $25 per million = $0.0975.
    expect(view.typicalReview).toEqual({ usdc: "0.0975", audd: "0.151125", sol: "0.00065" });
  });

  it("settles the actual cost against the maximum: 2.5% fee rounded down, provider gets the rest, the remainder goes back", () => {
    const max = maxChargeLamports(atlas, 1_200);
    const settled = settleSandboxCall(atlas, { inputTokens: 1_200, outputTokens: 800 }, max);
    expect(settled.amount).toBe(n(173_334)); // $0.026 at $150 per SOL, rounded up
    expect(settled.fee).toBe(n(4_333));
    expect(settled.provider).toBe(n(169_001));
    expect(settled.refunded).toBe(max - n(173_334));
    expect(settled.fee + settled.provider + settled.refunded).toBe(max);
  });

  it("never charges more than the maximum, and takes no fee when 2.5% rounds down to nothing", () => {
    const capped = settleSandboxCall(atlas, { inputTokens: 1_000_000, outputTokens: 1_000_000 }, n(50_000));
    expect([capped.amount, capped.refunded, capped.fee]).toEqual([n(50_000), n(0), n(1_250)]);
    const tiny = settleSandboxCall(bargain, { inputTokens: 10, outputTokens: 2 }, maxChargeLamports(bargain, 10));
    expect(tiny.amount).toBe(n(7));
    expect(tiny.fee).toBe(n(0));
    expect(tiny.provider).toBe(n(7));
  });

  it("lists every provider with exact decimal prices and a positive output limit", () => {
    for (const provider of SANDBOX_PROVIDERS) {
      expect(provider.pricing.inputPerMillionUsd).toMatch(/^\d+(\.\d{1,6})?$/);
      expect(provider.pricing.outputPerMillionUsd).toMatch(/^\d+(\.\d{1,6})?$/);
      expect(Number.isSafeInteger(provider.pricing.maxOutputTokens) && provider.pricing.maxOutputTokens > 0).toBe(true);
      expect(maxChargeLamports(provider, 0) > n(0)).toBe(true);
    }
  });
});
