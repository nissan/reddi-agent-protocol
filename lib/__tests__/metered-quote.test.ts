import { DEFAULT_OUTPUT_TOKENS, estimateTokens, METERED_BUYER_NOTICE, perTokenPriceFor, quoteMeteredBuy } from "@/lib/payments/metered-quote";

const PRICES = { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 };
const PROMPT = "x".repeat(400); // 100 input tokens

describe("metered buy quote (#794)", () => {
  it("estimates input at four characters a token and output at the request's limit", () => {
    expect(estimateTokens(PROMPT, 250)).toEqual({ inputTokens: 100, outputTokens: 250 });
    expect(estimateTokens("abcde")).toEqual({ inputTokens: 2, outputTokens: DEFAULT_OUTPUT_TOKENS });
    expect(estimateTokens("abc", 0).outputTokens).toBe(DEFAULT_OUTPUT_TOKENS);
    expect(estimateTokens("abc", 1.5).outputTokens).toBe(DEFAULT_OUTPUT_TOKENS);
  });

  it("prices only US dollar stablecoins, and only listings with a per-token price", () => {
    expect(perTokenPriceFor(PRICES, "USDC")).toEqual({ currency: "USDC", inputPerMillion: "0.150000", outputPerMillion: "0.600000" });
    expect(perTokenPriceFor({ outputPerMillionUsd: 2 }, "PYUSD")).toEqual({ currency: "PYUSD", inputPerMillion: "0", outputPerMillion: "2.000000" });
    expect(perTokenPriceFor(PRICES, "SOL")).toBeUndefined();
    expect(perTokenPriceFor(PRICES, "AUDD")).toBeUndefined();
    expect(perTokenPriceFor({}, "USDC")).toBeUndefined();
    expect(perTokenPriceFor({ inputPerMillionUsd: -1 }, "USDC")).toBeUndefined();
    expect(perTokenPriceFor({ inputPerMillionUsd: Number.NaN }, "USDC")).toBeUndefined();
  });

  it("defaults the maximum to twice the estimate and shows the fee on the estimate", () => {
    const quote = quoteMeteredBuy({ prices: PRICES, currency: "USDC", prompt: PROMPT });
    // 100 × 0.15 + 1,000 × 0.6 per million = 615 base units.
    expect(quote).toMatchObject({ ok: true, estimatedCost: "0.000615", defaultMax: "0.00123", maxCharge: "0.00123", estimatedFee: "0.000015", notice: METERED_BUYER_NOTICE });
    if (quote.ok) expect(quote.maxChargeBaseUnits).toBe(BigInt(1230));
  });

  it("takes a maximum the buyer typed, at or above the estimate", () => {
    const exact = quoteMeteredBuy({ prices: PRICES, currency: "USDC", prompt: PROMPT, maxCharge: "0.000615" });
    expect(exact).toMatchObject({ ok: true, maxCharge: "0.000615" });
    const higher = quoteMeteredBuy({ prices: PRICES, currency: "USDC", prompt: PROMPT, maxCharge: " 5 " });
    expect(higher).toMatchObject({ ok: true, maxCharge: "5" });
    if (higher.ok) expect(higher.maxChargeBaseUnits).toBe(BigInt(5_000_000));
    expect(quoteMeteredBuy({ prices: PRICES, currency: "USDC", prompt: PROMPT, maxCharge: "" })).toMatchObject({ ok: true, maxCharge: "0.00123" });
  });

  it("refuses a maximum below the estimate, a malformed one, an empty request and a listing without token prices", () => {
    expect(quoteMeteredBuy({ prices: PRICES, currency: "USDC", prompt: PROMPT, maxCharge: "0.000614" })).toMatchObject({ ok: false, reason: "max_below_estimate" });
    for (const bad of ["abc", "-1", "0", "0.0000001", "1e3"]) {
      expect(quoteMeteredBuy({ prices: PRICES, currency: "USDC", prompt: PROMPT, maxCharge: bad })).toMatchObject({ ok: false, reason: "invalid_max" });
    }
    expect(quoteMeteredBuy({ prices: { inputPerMillionUsd: 0.15 }, currency: "USDC", prompt: "", maxOutputTokens: 1 })).toMatchObject({ ok: false, reason: "estimate_zero" });
    expect(quoteMeteredBuy({ prices: {}, currency: "USDC", prompt: PROMPT })).toMatchObject({ ok: false, reason: "not_per_token" });
  });
});
