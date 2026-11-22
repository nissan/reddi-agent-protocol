import { listingPrice } from "@/lib/directory/listing-price";

describe("listingPrice", () => {
  it("prices a typical call and the default maximum in USDC, AUDD and SOL", () => {
    // 12,000 in at $5/M + 1,500 out at $25/M = $0.0975; max is twice that.
    const price = listingPrice(5, 25);
    expect(price).not.toBeNull();
    expect(price!.inputPerMillionUsd).toBe("5");
    expect(price!.outputPerMillionUsd).toBe("25");
    expect(price!.usage).toEqual({ inputTokens: 12_000, outputTokens: 1_500 });
    expect(price!.typicalCall).toEqual({ usdc: "0.0975", audd: "0.151125", sol: "0.00065" });
    expect(price!.maxPerCall).toEqual({ usdc: "0.195", audd: "0.30225", sol: "0.0013" });
  });

  it("rounds a fraction of a micro-dollar up, as the sandbox does", () => {
    // 12,000 × $0.05/M + 1,500 × $0.2/M = $0.0009 exactly; 1 in at $0.000001/M rounds up to 1 micro-dollar.
    expect(listingPrice(0.05, 0.2)!.typicalCall.usdc).toBe("0.0009");
    expect(listingPrice(0.000001, 0, { inputTokens: 1, outputTokens: 0 })!.typicalCall.usdc).toBe("0.000001");
  });

  it("accepts a listing priced on one side only", () => {
    expect(listingPrice(undefined, 10)!.inputPerMillionUsd).toBe("0");
    expect(listingPrice(undefined, 10)!.typicalCall.usdc).toBe("0.015");
  });

  it("returns null without a usable per-token price, so the card keeps its per-call rate", () => {
    expect(listingPrice(undefined, undefined)).toBeNull();
    expect(listingPrice(0, 0)).toBeNull();
    expect(listingPrice(-1, 5)).toBeNull();
    expect(listingPrice(Number.NaN, 5)).toBeNull();
  });
});
