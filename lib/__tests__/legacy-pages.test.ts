import { isLegacyPath, legacyPageRedirects, legacyPagesEnabled, liveHref, withoutLegacyLinks } from "../legacy-pages";

describe("legacy pages", () => {
  it("are on in development on devnet and off in production or on mainnet", () => {
    expect(legacyPagesEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(legacyPagesEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(legacyPagesEnabled({ NODE_ENV: "development", NETWORK_PROFILE: "mainnet" })).toBe(false);
    expect(legacyPagesEnabled({ NODE_ENV: "test", NEXT_PUBLIC_BUILD_NETWORK_PROFILE: "mainnet" })).toBe(false);
  });

  it("match exact paths only, so onboarding intake stays", () => {
    expect(isLegacyPath("/onboarding")).toBe(true);
    expect(isLegacyPath("/onboarding/")).toBe(true);
    expect(isLegacyPath("/runs?x=1")).toBe(true);
    expect(isLegacyPath("/onboarding/intake")).toBe(false);
    expect(isLegacyPath("/onboarding/profile-editor")).toBe(false);
    expect(isLegacyPath("/jobs")).toBe(false);
  });

  it("drop links and point hrefs at replacements when off", () => {
    const links = [{ href: "/planner" }, { href: "/runs" }, { href: "/audit" }, { href: "/faq" }];
    expect(withoutLegacyLinks(links, true)).toEqual(links);
    expect(withoutLegacyLinks(links, false).map((l) => l.href)).toEqual(["/planner", "/faq"]);
    expect(liveHref("/onboarding", false)).toBe("/register");
    expect(liveHref("/onboarding", true)).toBe("/onboarding");
    expect(liveHref("/faq", false)).toBe("/faq");
  });

  it("redirect every legacy page in production and none in development", () => {
    expect(legacyPageRedirects({ NODE_ENV: "development" })).toEqual([]);
    const redirects = legacyPageRedirects({ NODE_ENV: "production" });
    expect(redirects).toContainEqual({ source: "/runs", destination: "/jobs", permanent: false });
    expect(redirects).toContainEqual({ source: "/onboarding", destination: "/register", permanent: false });
    expect(redirects.every((r) => !isLegacyPath(r.destination))).toBe(true);
  });
});
