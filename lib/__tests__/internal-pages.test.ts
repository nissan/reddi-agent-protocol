import { internalPagesEnabled, isInternalPath, withoutInternalLinks } from "../internal-pages";

describe("internal pages", () => {
  it("is off unless the flag is exactly true", () => {
    expect(internalPagesEnabled(undefined)).toBe(false);
    expect(internalPagesEnabled("1")).toBe(false);
    expect(internalPagesEnabled("TRUE")).toBe(false);
    expect(internalPagesEnabled("true")).toBe(true);
  });

  it("matches the internal routes and their children only", () => {
    for (const href of ["/manager", "/manager/listings", "/manager/discovery?x=1", "/dogfood", "/testers#guides"]) {
      expect(isInternalPath(href)).toBe(true);
    }
    for (const href of ["/", "/managers", "/onboarding", "/judge-replication", "/sandbox", "/testersx"]) {
      expect(isInternalPath(href)).toBe(false);
    }
  });

  it("drops internal links when off and keeps them when on", () => {
    const links = [{ href: "/faq" }, { href: "/testers" }, { href: "/manager/discovery" }];
    expect(withoutInternalLinks(links, false)).toEqual([{ href: "/faq" }]);
    expect(withoutInternalLinks(links, true)).toEqual(links);
  });
});
