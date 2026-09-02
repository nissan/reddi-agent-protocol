import { expect, test } from "@playwright/test";

import { reddiReceiptFixtureCases } from "@reddi/agent-protocol/fixtures";
import { buildSourceTrustConformanceMatrix } from "@reddi/agent-protocol/source-trust-conformance-matrix";

import { specialistProfiles } from "../packages/openrouter-specialists/src/profiles/index";
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

// /api/registry can take >20s when the devnet RPC is slow; give the route
// readiness anchors headroom beyond the 30s repo default.
test.describe.configure({ timeout: 60_000 });

test.describe("public-claim boundary (rendered copy)", () => {
  for (const route of PUBLIC_CLAIM_DOM_ROUTES) {
    test(`${route.path} renders no forbidden affirmative claim`, async ({ page }) => {
      await page.goto(route.path);
      // Readiness anchor first: without it a skeleton with nav/footer chrome
      // would report a clean scan of copy that never rendered.
      await expect(
        page.getByRole("heading", { name: route.readyHeading }).first(),
      ).toBeVisible({ timeout: 30_000 });

      const rendered = await page.locator("body").innerText();
      expect(rendered).toMatch(route.readyHeading);

      const violations: string[] = [];
      for (const line of rendered.split(/\r?\n/)) {
        for (const claim of FORBIDDEN_PUBLIC_CLAIMS) {
          if (!claim.pattern.test(line)) continue;
          if (claimIsQualified(line, claim)) continue;
          violations.push(`[${claim.id}] ${claim.reason} :: ${line.trim()}`);
        }
      }

      expect(
        violations,
        `rendered copy at ${route.path} breaks ${PUBLIC_CLAIM_BOUNDARY_DOC_PATH}`,
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
        claimIsQualified(claim.injectionExample, claim),
        `injection example for ${claim.id} must not be suppressed as a qualified claim`,
      ).toBe(false);
    }
  });

  test("landing stats render the counts the shipped corpora actually contain", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: PUBLIC_CLAIM_DOM_ROUTES[0].readyHeading }).first(),
    ).toBeVisible({ timeout: 30_000 });

    const readStat = async (label: string) => {
      const tile = page.getByText(label, { exact: true }).first().locator("..");
      const [value] = (await tile.innerText()).trim().split(/\s*\n\s*/);
      return Number(value);
    };

    expect(await readStat("Directory fixtures")).toBe(specialistProfiles.length);
    expect(await readStat("Receipt fixture cases")).toBe(
      Object.keys(reddiReceiptFixtureCases).length,
    );
    expect(await readStat("Source-trust conformance cases")).toBe(
      Object.keys(buildSourceTrustConformanceMatrix().coverage.requiredCases).length,
    );
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
