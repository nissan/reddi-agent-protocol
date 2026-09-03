import { expect, test, type Page } from "@playwright/test";

import {
  directoryFixtureProfileCount,
  receiptFixtureCaseCount,
  sourceTrustConformanceCaseCount,
} from "../lib/assurance/public-metrics";
import {
  CENTRAL_MESSAGE,
  CLAIM_SCOPE_ATTRIBUTE,
  EXTERNAL_CLAIM_SCOPE,
  EXTERNAL_CLAIM_SCOPE_SELECTOR,
  FORBIDDEN_PUBLIC_CLAIMS,
  PUBLIC_CLAIM_BOUNDARY_DOC_PATH,
  PUBLIC_CLAIM_DOM_ROUTES,
  type PublicClaimDomRoute,
  claimIsQualified,
} from "../lib/public-claims/public-claim-boundary-terms";

/**
 * DOM layer of the RAP Assurance public-claim boundary.
 *
 * App copy is a claim only once it renders, so the rendered text — not the
 * `.tsx` source — is what this asserts. The owned-text half of the same
 * contract (README/docs/package metadata) is enforced by
 * `scripts/check-public-claim-boundaries.mjs`, which shares this pattern list.
 */

// `/agents` waits on /api/registry, which can take >20s when the devnet RPC is
// slow; give the route readiness anchors headroom beyond the 30s repo default.
test.describe.configure({ timeout: 60_000 });

/**
 * The rendered copy this repository owns: the route's DOM with every
 * registry/user-supplied subtree removed. Specialist and candidate cards carry
 * strings a third-party devnet registrant wrote, so scanning them would let an
 * account nobody here controls turn this blocking lane red.
 */
async function firstPartyCopy(page: Page): Promise<string> {
  return page.evaluate((externalSelector) => {
    document.querySelectorAll(externalSelector).forEach((node) => node.remove());
    return document.body.innerText;
  }, EXTERNAL_CLAIM_SCOPE_SELECTOR);
}

function unqualifiedClaims(copy: string): string[] {
  const violations: string[] = [];
  for (const line of copy.split(/\r?\n/)) {
    for (const claim of FORBIDDEN_PUBLIC_CLAIMS) {
      if (!claim.pattern.test(line)) continue;
      if (claimIsQualified(line, claim)) continue;
      violations.push(`[${claim.id}] ${claim.reason} :: ${line.trim()}`);
    }
  }
  return violations;
}

function readyAnchor(page: Page, route: PublicClaimDomRoute) {
  return route.readyAsText
    ? page.getByText(route.readyCopy).first()
    : page.getByRole("heading", { name: route.readyCopy }).first();
}

test.describe("public-claim boundary (rendered copy)", () => {
  for (const route of PUBLIC_CLAIM_DOM_ROUTES) {
    test(`${route.path} renders no forbidden affirmative claim`, async ({ page }) => {
      await page.goto(route.path);
      // Readiness anchor first: without it a skeleton with nav/footer chrome
      // would report a clean scan of copy that never rendered.
      await expect(readyAnchor(page, route)).toBeVisible({ timeout: 30_000 });

      if (route.settledContent) {
        await expect
          .poll(async () => page.locator(route.settledContent!).count(), { timeout: 30_000 })
          .toBeGreaterThan(0);
      }

      const rendered = await firstPartyCopy(page);
      expect(rendered).toMatch(route.readyCopy);

      expect(
        unqualifiedClaims(rendered),
        `first-party copy at ${route.path} breaks ${PUBLIC_CLAIM_BOUNDARY_DOC_PATH}`,
      ).toEqual([]);
    });
  }

  test("the scan reads first-party copy and ignores registry-supplied text", async ({ page }) => {
    const injection = FORBIDDEN_PUBLIC_CLAIMS[0].injectionExample;
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: PUBLIC_CLAIM_DOM_ROUTES[0].readyCopy }).first(),
    ).toBeVisible({ timeout: 30_000 });

    await page.evaluate(
      ([attribute, scope, text]) => {
        const external = document.createElement("div");
        external.setAttribute(attribute, scope);
        external.textContent = text;
        document.body.appendChild(external);
      },
      [CLAIM_SCOPE_ATTRIBUTE, EXTERNAL_CLAIM_SCOPE, injection] as const,
    );

    expect(await page.locator("body").innerText()).toContain(injection);
    expect(
      unqualifiedClaims(await firstPartyCopy(page)),
      "registry-supplied text must not be scanned",
    ).toEqual([]);

    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: PUBLIC_CLAIM_DOM_ROUTES[0].readyCopy }).first(),
    ).toBeVisible({ timeout: 30_000 });
    await page.evaluate((text) => {
      const owned = document.createElement("div");
      owned.textContent = text;
      document.body.appendChild(owned);
    }, injection);

    expect(
      unqualifiedClaims(await firstPartyCopy(page)),
      "the same text in first-party copy must still be caught",
    ).not.toEqual([]);
  });

  /**
   * The exclusion above is asserted against injected nodes; this asserts the
   * real cards still carry the marker on registrant-supplied fields only, so
   * moving it would fail here rather than silently drop owned boundary copy
   * (render-state banners, trust/readiness badges, Resource labels) out of the
   * scan.
   */
  test("specialist and candidate cards exclude registrant text and keep owned copy", async ({ page }) => {
    const cards = '[data-testid="agent-card"], [data-testid="marketplace-candidate-card"]';
    await page.goto("/agents");
    await expect(
      page.getByRole("heading", { name: /specialist directory/i }).first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => page.locator(`${cards}, [data-testid="discovery-empty-state"]`).count(), {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);

    const cardCount = await page.locator(cards).count();
    test.skip(cardCount === 0, "no directory or candidate card rendered on this run");

    const card = page.locator(cards).first();
    const registrantText = (await card.locator(EXTERNAL_CLAIM_SCOPE_SELECTOR).allInnerTexts())
      .map((text) => text.trim())
      .filter((text) => text.length > 0);
    expect(registrantText.length, "cards must mark their registrant-supplied fields").toBeGreaterThan(0);

    await page.evaluate((selector) => {
      document.querySelectorAll(selector).forEach((node) => node.remove());
    }, EXTERNAL_CLAIM_SCOPE_SELECTOR);

    const scanned = await card.innerText();
    for (const text of registrantText) {
      expect(scanned, "registrant-supplied field text must leave the scan").not.toContain(text);
    }
    expect(scanned, "repository-owned card copy must stay in the scan").toContain("Resource");
  });

  test("every forbidden claim is still catchable by its own pattern", async () => {
    for (const claim of FORBIDDEN_PUBLIC_CLAIMS) {
      expect(
        claim.pattern.test(claim.injectionExample),
        `injection example for ${claim.id} must be caught by its own pattern`,
      ).toBe(true);
      expect(
        claimIsQualified(claim.injectionExample, claim),
        `injection example for ${claim.id} must not be suppressed as a qualified claim`,
      ).toBe(false);
    }
  });

  /**
   * The published constants are bound to the real corpora Node-side by
   * `lib/__tests__/public-metrics.test.ts`; this asserts the other half — that
   * the page actually renders them — so the corpora stay out of this lane.
   */
  test("landing stats render the published assurance counts", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: PUBLIC_CLAIM_DOM_ROUTES[0].readyCopy }).first(),
    ).toBeVisible({ timeout: 30_000 });

    const readStat = async (label: string) => {
      const tile = page.getByText(label, { exact: true }).first().locator("..");
      const [value] = (await tile.innerText()).trim().split(/\s*\n\s*/);
      return Number(value);
    };

    expect(await readStat("Directory fixtures")).toBe(directoryFixtureProfileCount);
    expect(await readStat("Receipt fixture cases")).toBe(receiptFixtureCaseCount);
    expect(await readStat("Source-trust conformance cases")).toBe(sourceTrustConformanceCaseCount);
  });

  test("landing copy and document metadata carry the central message", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByText(new RegExp(CENTRAL_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")).first(),
    ).toBeVisible();
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      new RegExp(CENTRAL_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
    );
  });
});
