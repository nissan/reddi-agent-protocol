import { expect, test } from "@playwright/test";

import {
  COPY_BOUNDARY_AUTHORITY_DOC_PATH,
  EXPECTED_HARD_BOUNDARY_FLAG_KEYS,
  FORBIDDEN_COPY_CLAIMS,
  REQUIRED_COPY_LABELS,
} from "../lib/economic-demo/paid-workflow-copy-boundary-terms";

/**
 * DOM layer of the #501 copy-boundary regression gate.
 *
 * Same forbidden/required term list as the static gate
 * (`scripts/check-paid-workflow-copy-boundaries.mjs`, wired into the
 * rap-package-guard CI workflow), imported from the shared
 * `lib/economic-demo/paid-workflow-copy-boundary-terms.ts` module and asserted
 * against the rendered DOM of `/economic-demo/paid-workflow`. The list derives
 * from docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md — the fail-closed reading wins.
 */

function formatFlagLabel(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}

test.describe("/economic-demo/paid-workflow copy-boundary gate (#501)", () => {
  test("rendered DOM contains no forbidden live-claim upgrades", async ({ page }) => {
    await page.goto("/economic-demo/paid-workflow");
    await expect(
      page.getByRole("heading", { name: /buyer paid workflow — no-spend shell/i }),
    ).toBeVisible();

    const bodyText = await page.getByTestId("paid-workflow-route").innerText();
    expect(bodyText.length).toBeGreaterThan(0);

    for (const claim of FORBIDDEN_COPY_CLAIMS) {
      // Sanity: the negative-control phrase for this claim must be catchable
      // by its own patterns (mirrors the static gate's self-test).
      expect(
        claim.patterns.some((pattern) => pattern.test(claim.injectionExample)),
        `injection example for ${claim.id} must be caught by its own patterns`,
      ).toBe(true);

      for (const pattern of claim.patterns) {
        expect(
          pattern.test(bodyText),
          `forbidden claim "${claim.id}" (${claim.claim}) matched rendered DOM via ${pattern} — ` +
            `derived from ${COPY_BOUNDARY_AUTHORITY_DOC_PATH}`,
        ).toBe(false);
      }
    }
  });

  test("rendered DOM keeps every required boundary label", async ({ page }) => {
    await page.goto("/economic-demo/paid-workflow");

    const bodyText = await page.getByTestId("paid-workflow-route").innerText();
    for (const label of REQUIRED_COPY_LABELS) {
      expect(
        label.pattern.test(bodyText),
        `required label "${label.label}" (${label.pattern}) missing from rendered DOM`,
      ).toBe(true);
    }

    // The copy-mode legend states the authority relationship explicitly.
    await expect(page.getByTestId("paid-workflow-copy-modes")).toContainText(
      /Discover \/ Decide \/ Prove/,
    );

    // The #497 16-flag hard-boundary grid renders every flag, all false.
    const flags = page.getByTestId("paid-workflow-boundary-flags");
    await expect(flags).toContainText("All live flags false");
    for (const key of EXPECTED_HARD_BOUNDARY_FLAG_KEYS) {
      await expect(flags).toContainText(formatFlagLabel(key));
    }
    await expect(flags.getByText("false", { exact: true })).toHaveCount(
      EXPECTED_HARD_BOUNDARY_FLAG_KEYS.length,
    );

    // Never-claims copy stays negated, and the route still exposes no live affordance.
    const copyBoundaries = page.getByTestId("paid-workflow-copy-boundaries");
    await expect(copyBoundaries).toContainText(/no custody/i);
    await expect(copyBoundaries).toContainText(/no settlement finality/i);
    await expect(copyBoundaries).toContainText(/no mainnet settlement/i);
    await expect(page.getByTestId("paid-workflow-route").getByRole("button")).toHaveCount(0);
  });
});
