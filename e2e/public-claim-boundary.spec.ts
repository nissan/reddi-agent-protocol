import { expect, test } from "@playwright/test";

import {
  CENTRAL_MESSAGE,
  FORBIDDEN_PUBLIC_CLAIMS,
  PUBLIC_CLAIM_BOUNDARY_DOC_PATH,
  PUBLIC_CLAIM_DOM_ROUTES,
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

test.describe("public-claim boundary (rendered copy)", () => {
  for (const route of PUBLIC_CLAIM_DOM_ROUTES) {
    test(`${route} renders no forbidden affirmative claim`, async ({ page }) => {
      await page.goto(route);
      const rendered = await page.locator("body").innerText();
      expect(rendered.length).toBeGreaterThan(0);

      const violations: string[] = [];
      for (const line of rendered.split(/\r?\n/)) {
        if (claimIsQualified(line)) continue;
        for (const claim of FORBIDDEN_PUBLIC_CLAIMS) {
          if (claim.pattern.test(line)) {
            violations.push(`[${claim.id}] ${claim.reason} :: ${line.trim()}`);
          }
        }
      }

      expect(
        violations,
        `rendered copy at ${route} breaks ${PUBLIC_CLAIM_BOUNDARY_DOC_PATH}`,
      ).toEqual([]);
    });
  }

  test("every forbidden claim is still catchable by its own pattern", async () => {
    for (const claim of FORBIDDEN_PUBLIC_CLAIMS) {
      expect(
        claim.pattern.test(claim.injectionExample),
        `injection example for ${claim.id} must be caught by its own pattern`,
      ).toBe(true);
      expect(
        claimIsQualified(claim.injectionExample),
        `injection example for ${claim.id} must not be suppressed as a qualified claim`,
      ).toBe(false);
    }
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
