import { expect, test } from "@playwright/test";

import {
  MARKETPLACE_CANDIDATE_IMPORTED_FIELDS,
  type MarketplaceCandidateSourceFacetId,
} from "../lib/discovery/source-facets";
import {
  EXTERNAL_CLAIM_SCOPE_SELECTOR,
  PUBLIC_CLAIM_BOUNDARY_DOC_PATH,
} from "../lib/public-claims/public-claim-boundary-terms";
import { firstPartyCopy, unqualifiedClaims } from "./helpers/public-claim-copy";

/**
 * Provenance control for the `/agents` candidate cards.
 *
 * `e2e/public-claim-boundary.spec.ts` proves the external-scope exclusion
 * against injected nodes; this proves the real cards obey the provenance their
 * source declares. Expectations come from MARKETPLACE_CANDIDATE_IMPORTED_FIELDS
 * rather than from whichever sources happen to render, so ingesting a Circle
 * x402 / Pay.sh snapshot makes this stricter instead of red.
 *
 * `/agents` cannot render either card list until /api/registry settles a devnet
 * `getProgramAccounts` read that carries no `AbortSignal`, so this lives here
 * rather than in the blocking funnel spec: the same reason `/agents` is not a
 * DOM-gated route. See docs/PUBLIC-CLAIM-BOUNDARY.md.
 */
test.describe.configure({ timeout: 60_000 });

test.describe("public-claim boundary (/agents candidate provenance)", () => {
  test("candidate cards mark imported fields and only imported fields", async ({ page }) => {
    const candidateCard = '[data-testid="marketplace-candidate-card"]';
    await page.goto("/agents");
    await expect(
      page.getByRole("heading", { name: /specialist directory/i }).first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => page.locator(candidateCard).count(), { timeout: 30_000 })
      .toBeGreaterThan(0);

    const cards = page.locator(candidateCard);
    const cardCount = await cards.count();
    const mustSurvive: string[] = [];
    let ownedCards = 0;
    for (let index = 0; index < cardCount; index += 1) {
      const card = cards.nth(index);
      const facet = (await card.getAttribute("data-source-facet")) ?? "";
      expect(
        Object.keys(MARKETPLACE_CANDIDATE_IMPORTED_FIELDS),
        `card ${index} renders an undeclared source facet`,
      ).toContain(facet);

      const declared =
        MARKETPLACE_CANDIDATE_IMPORTED_FIELDS[facet as MarketplaceCandidateSourceFacetId];
      const marked = await card.locator(EXTERNAL_CLAIM_SCOPE_SELECTOR).count();
      if (declared.length === 0) {
        expect(marked, `${facet} declares no imported field, so it must mark none`).toBe(0);
        ownedCards += 1;
        mustSurvive.push(await card.innerText());
      } else {
        expect(marked, `${facet} declares imported fields, so it must mark them`).toBeGreaterThan(0);
      }

      // Undeclared fields are repository-owned whatever the facet, so the
      // resource/media block has to reach the scan on every card.
      expect(declared).not.toContain("resourceType");
      expect(declared).not.toContain("mediaType");
      mustSurvive.push(await card.locator('[data-testid="candidate-resource-type"]').innerText());
    }
    expect(ownedCards, "no repository-authored candidate card rendered").toBeGreaterThan(0);

    const scanned = await firstPartyCopy(page);
    for (const text of mustSurvive) {
      for (const line of text.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)) {
        expect(scanned, "repository-authored card copy must survive the scan").toContain(line);
      }
    }
    expect(
      unqualifiedClaims(scanned),
      `candidate card copy breaks ${PUBLIC_CLAIM_BOUNDARY_DOC_PATH}`,
    ).toEqual([]);
  });
});
