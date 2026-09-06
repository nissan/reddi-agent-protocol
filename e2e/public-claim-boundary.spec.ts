import { expect, test, type Page } from "@playwright/test";

import {
  MARKETPLACE_CANDIDATE_IMPORTED_FIELDS,
  type MarketplaceCandidateSourceFacetId,
} from "../lib/discovery/source-facets";
import { hasPlayableRecording, onboardingVideos } from "../lib/onboarding/video-guides";
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

/**
 * The recordings a gated route may play, and the caption track each must carry.
 * `firstPartyCopy()` cannot read narration; a caption track is the only part of
 * a recording that becomes scannable text, and `check:claims:public` derives
 * the files it scans from these same `captionsSrc` declarations. So a player is
 * only reviewed narration when it is one of these guides, playing under the
 * track whose text the static gate reads. The `/tour` explainer is the one
 * qualified recording and is kept out of the default DOM behind the disclosure
 * the test below asserts.
 */
const scannedRecordings = onboardingVideos.filter(hasPlayableRecording).map((guide) => ({
  videoSrc: guide.videoSrc,
  captionsSrc: guide.captionsSrc ?? null,
}));

async function unscannedRecordings(page: Page): Promise<string[]> {
  return page.evaluate((scanned) => {
    const sourceOf = (video: HTMLVideoElement) =>
      video.querySelector("source")?.getAttribute("src") ??
      video.getAttribute("src") ??
      video.currentSrc;

    return [...document.querySelectorAll("video")]
      .filter((video) => {
        const source = sourceOf(video);
        const guide = source
          ? scanned.find((entry) => entry.videoSrc === new URL(source, location.href).pathname)
          : undefined;
        if (!guide) return true;
        return ![...video.querySelectorAll("track")].some(
          (track) =>
            track.kind === "captions" &&
            new URL(track.src, location.href).pathname === guide.captionsSrc,
        );
      })
      .map((video) => sourceOf(video) || "(no source)");
  }, scannedRecordings);
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

      // Before `firstPartyCopy()`, which strips subtrees out of the live DOM.
      expect(
        await unscannedRecordings(page),
        `${route.path} plays a recording that is not a shipped onboarding guide under the caption track the static gate scans, so nothing reviews its narration; see ${PUBLIC_CLAIM_BOUNDARY_DOC_PATH}`,
      ).toEqual([]);

      const rendered = await firstPartyCopy(page);
      expect(rendered).toMatch(route.readyCopy);

      expect(
        unqualifiedClaims(rendered),
        `first-party copy at ${route.path} breaks ${PUBLIC_CLAIM_BOUNDARY_DOC_PATH}`,
      ).toEqual([]);

      if (!route.stepControls) return;

      const steps = page.locator(route.stepControls);
      const stepCount = await steps.count();
      expect(stepCount, `${route.path} declares step controls but renders none`).toBeGreaterThan(1);

      for (let index = 0; index < stepCount; index += 1) {
        await steps.nth(index).click();
        const step = await firstPartyCopy(page);
        expect(
          unqualifiedClaims(step),
          `step ${index + 1} of ${route.path} breaks ${PUBLIC_CLAIM_BOUNDARY_DOC_PATH}`,
        ).toEqual([]);
      }

      if (route.stepProgress) {
        await expect(
          page.locator(route.stepProgress.selector),
          "the traversal must end on the last step, so every step was scanned",
        ).toHaveText(route.stepProgress.lastStep(stepCount));
      }
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
   * real cards obey the provenance their source declares. Expectations come
   * from MARKETPLACE_CANDIDATE_IMPORTED_FIELDS rather than from whichever
   * sources happen to render, so ingesting a Circle x402 / Pay.sh snapshot
   * makes this stricter instead of red.
   */
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

  /**
   * The /tour explainer is a pre-remediation recording kept playable behind a
   * disclosure rather than withheld, so the disclosure is the whole boundary.
   * The route scan snapshots the page with the modal closed; this opens it, so
   * the modal's own copy is scanned too and the qualification cannot silently
   * revert to an unannounced autoplay.
   */
  test("the /tour explainer discloses what it predates before it can play", async ({ page }) => {
    await page.goto("/tour");
    await expect(page.getByText(CENTRAL_MESSAGE).first()).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: /watch video/i }).click();

    const notice = page.getByTestId("tour-video-boundary-notice");
    await expect(notice, "the recording must say what it predates").toBeVisible();
    await expect(notice).toHaveText(/predates[\s\S]*public-claim remediation/i);

    const video = page.locator("video");
    await expect(video).toHaveCount(1);
    expect(
      await video.evaluate((element: HTMLVideoElement) => element.autoplay),
      "a pre-remediation recording must not start before the notice is read",
    ).toBe(false);
    expect(
      await video.evaluate((element: HTMLVideoElement) => element.preload),
      "a pre-remediation recording must not be fetched before the notice is read",
    ).toBe("none");
    expect(
      await video.evaluate((element: HTMLVideoElement) => element.currentTime === 0 && element.paused),
      "the recording must be paused at the start",
    ).toBe(true);

    expect(
      unqualifiedClaims(await firstPartyCopy(page)),
      `the /tour explainer modal breaks ${PUBLIC_CLAIM_BOUNDARY_DOC_PATH}`,
    ).toEqual([]);
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
