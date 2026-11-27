/** #1148 / #1203: the launch Providers page shows real providers only. */
import { isTestListing, publicProviderListings } from "@/lib/registry/public-listings";

type L = Parameters<typeof publicProviderListings>[0][number];
const listing = (pda: string | null, model: string | undefined, health: "pass" | "fail" | "unknown"): L =>
  ({ pda, onchain: model === undefined ? null : { model }, health: { status: health, freshnessState: "fresh", endpointUrl: null, lastCheckedAt: null } }) as unknown as L;

describe("public provider listings", () => {
  const kitPass = listing("Pda111", "openai/gpt-4o-mini", "pass");
  const kitUnknown = listing("Pda222", "qwen", "unknown");
  const kitFail = listing("Pda333", "qwen", "fail");
  const e2e = ["rap-devnet-e2e-judge", "rap-devnet-e2e-payee", "RAP-DEVNET-E2E-payer"].map((m) => listing("PdaE2E", m, "pass"));
  const indexOnly = listing(null, "some-model", "pass");

  it("treats our devnet e2e wallets and index-only records as test listings (RAP-1148-S2)", () => {
    for (const l of [...e2e, indexOnly]) expect(isTestListing(l)).toBe(true);
    for (const l of [kitPass, kitUnknown, kitFail]) expect(isTestListing(l)).toBe(false);
  });

  it("on devnet lists every registered provider that is not a test listing (RAP-1148-S3)", () => {
    expect(publicProviderListings([kitPass, kitUnknown, kitFail, ...e2e, indexOnly], {})).toEqual([kitPass, kitUnknown, kitFail]);
  });

  it("on mainnet lists only registered providers whose health check passed (RAP-MB1-S3)", () => {
    expect(publicProviderListings([kitPass, kitUnknown, kitFail, ...e2e, indexOnly], { NEXT_PUBLIC_BUILD_NETWORK_PROFILE: "mainnet" })).toEqual([kitPass]);
  });
});
