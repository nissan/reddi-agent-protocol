import { listingBodyFromOnboarding, publishListing, usdToUsdcBaseUnits, usdcMintForProfile } from "@/lib/listings/listing-client";

const WALLET = "7Y6oUj3vCz7xqGmJmT7Q7m4mGkq3rq9t7u7Hq3iJ1dQp";
const OTHER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const TOKEN = "b".repeat(40);

const INPUT = {
  walletAddress: WALLET, endpointUrl: " https://provider.example/v1 ", perCallUsd: "0.0025",
  taskTypes: ["summarize"], inputModes: ["text"], outputModes: ["text"], privacyModes: ["public"], tags: [], profile: "devnet" as const,
};

describe("publishing a listing from onboarding (#740)", () => {
  it("converts a typed dollar price to base units exactly", () => {
    expect(usdToUsdcBaseUnits("0.0025")).toBe("2500");
    expect(usdToUsdcBaseUnits("1")).toBe("1000000");
    expect(usdToUsdcBaseUnits("0.1")).toBe("100000");
    expect(usdToUsdcBaseUnits("0.000001")).toBe("1");
    expect(usdToUsdcBaseUnits("0")).toBe("0");
    for (const bad of ["", "abc", "-1", "1e3", "0.0000001", ".5", "1.", "1,5", "12345678901"]) {
      expect(usdToUsdcBaseUnits(bad)).toBeUndefined();
    }
  });

  it("prices in the USDC mint of the profile and has none for a local profile", () => {
    expect(usdcMintForProfile("devnet")).toBe("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
    expect(usdcMintForProfile("mainnet")).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(usdcMintForProfile("local-surfpool")).toBeUndefined();
  });

  it("builds a body with no wallet, owner, network or health in it", () => {
    const built = listingBodyFromOnboarding(INPUT);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(Object.keys(built.body).sort()).toEqual(["capabilities", "declaredModels", "displayName", "endpointUrl", "priceMint", "pricePerCallBaseUnits", "status"]);
    expect(built.body.endpointUrl).toBe("https://provider.example/v1");
    expect(built.body.pricePerCallBaseUnits).toBe("2500");
    expect(JSON.stringify(built.body.capabilities)).not.toContain("health");
  });

  it("explains what is missing instead of publishing a listing without a price or endpoint", () => {
    expect(listingBodyFromOnboarding({ ...INPUT, perCallUsd: "" })).toMatchObject({ ok: false });
    expect(listingBodyFromOnboarding({ ...INPUT, endpointUrl: "  " })).toMatchObject({ ok: false });
    expect(listingBodyFromOnboarding({ ...INPUT, profile: "local-surfpool" })).toMatchObject({ ok: false });
  });

  it("sends nothing when signed out", async () => {
    const fetchImpl = jest.fn();
    const outcome = await publishListing(INPUT, undefined, fetchImpl);
    expect(outcome.published).toBe(false);
    expect(outcome.message).toMatch(/Sign in/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends the session as a bearer token and reports success", async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, listing: { wallet: WALLET } }) }));
    const outcome = await publishListing(INPUT, TOKEN, fetchImpl);
    expect(outcome.published).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { method: string; headers: Record<string, string>; body: string }];
    expect(url).toBe("/api/listings");
    expect(init.method).toBe("PUT");
    expect(init.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.body).not.toContain(WALLET);
  });

  it("says so when the listing was saved under a different signed-in wallet", async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, listing: { wallet: OTHER } }) }));
    const outcome = await publishListing(INPUT, TOKEN, fetchImpl);
    expect(outcome.message).toMatch(/not the wallet on this page/);
  });

  it("reports a refusal or an outage as not published", async () => {
    const refused = jest.fn(async () => ({ ok: false, status: 400, json: async () => ({ ok: false, error: { message: "The endpoint must be an https address." } }) }));
    expect(await publishListing(INPUT, TOKEN, refused)).toEqual({ published: false, message: "The endpoint must be an https address." });
    const down = jest.fn(async () => { throw new Error("network"); });
    expect((await publishListing(INPUT, TOKEN, down)).published).toBe(false);
    const garbage = jest.fn(async () => ({ ok: true, status: 200, json: async () => { throw new Error("not json"); } }));
    expect((await publishListing(INPUT, TOKEN, garbage)).published).toBe(false);
  });
});
