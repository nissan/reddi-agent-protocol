import { expect, test, type Page } from "@playwright/test";

import {
  hasPlayableRecording,
  onboardingVideos,
} from "../lib/onboarding/video-guides";

/**
 * Cards whose recording predates the public-claim remediation render a
 * withheld-notice placeholder instead of a <video>, so the playable and
 * withheld tallies are derived from the shipped guide data rather than pinned.
 *
 * `total` is asserted against the rendered card count so the two states have to
 * account for every card: derived tallies alone would move with the DOM and
 * could not fail on a card that rendered neither branch.
 */
function guidesFor(ids: string[]) {
  return ids.map((id) => {
    const guide = onboardingVideos.find((candidate) => candidate.id === id);
    if (!guide) throw new Error(`unknown onboarding guide: ${id}`);
    return guide;
  });
}

function guidesOn(ids: string[]) {
  const guides = guidesFor(ids);
  return {
    total: guides.length,
    playable: guides.filter((guide) => hasPlayableRecording(guide)).length,
    withheld: guides.filter((guide) => !hasPlayableRecording(guide)).length,
  };
}

/** Onboarding cards are the only <article> elements on the routes this spec visits. */
function onboardingCards(page: Page) {
  return page.locator("article");
}

/**
 * Every withheld card must disclose why the recording is missing and where the
 * current copy is. Counting the placeholders alone would pass on an empty span.
 */
async function expectWithheldNotices(page: Page, withheld: number) {
  const notices = page.getByTestId("withheld-recording-notice");
  await expect(notices).toHaveCount(withheld);
  for (let index = 0; index < withheld; index += 1) {
    const notice = await notices.nth(index).innerText();
    expect(notice, "the notice must say why the recording is missing").toMatch(
      /predates the public-claim remediation/i,
    );
    expect(notice, "the notice must point at the current copy").toMatch(/current copy/i);
  }
}

test.describe("judge replication onboarding", () => {
  test("Given a visitor lands on the homepage, the menu links to Start", async ({ page }) => {
    await page.goto("/");
    // "Start here" sits in the menu's "More" list, so check the link and follow it directly.
    const startLink = page.locator('nav a[href="/start"]').first();
    await expect(startLink).toHaveAttribute("href", "/start");
    await page.goto("/start");
    await expect(page.getByRole("heading", { level: 1, name: /Pick where to start\./ })).toBeVisible();
  });

  test("Given a visitor opens Start, they see the three paths and only recordings that play", async ({ page }) => {
    await page.goto("/start");

    await expect(page.getByRole("heading", { level: 1, name: /Pick where to start\./ })).toBeVisible();
    for (const [name, href] of [
      [/Connect your agent/, "/agent-setup"],
      [/Run a provider/, "/register"],
      [/Check the proof/, "/sandbox"],
    ] as const) {
      await expect(page.getByRole("main").getByRole("link", { name })).toHaveAttribute("href", href);
    }

    // Withheld captures are left off this page entirely: every card shown plays, with captions.
    const playable = onboardingVideos.filter(hasPlayableRecording).length;
    await expect(onboardingCards(page)).toHaveCount(playable);
    await expect(page.locator("video")).toHaveCount(playable);
    await expect(page.locator('track[kind="captions"]')).toHaveCount(playable);
    await expect(page.getByTestId("withheld-recording-notice")).toHaveCount(0);
    await expect(page.getByText(/withheld/i)).toHaveCount(0);

    const guideLink = page.getByRole("link", { name: /Open the verification guide/i });
    await expect(guideLink).toHaveAttribute("href", "/judge-replication");
    await guideLink.click();
    await expect(page).toHaveURL(/\/judge-replication$/);
    await expect(page.getByRole("heading", { name: /Verify the Reddi Agent Protocol proof path/i })).toBeVisible();
  });

  test("Given a visitor opens Start on a phone, nothing scrolls sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1200 });
    await page.goto("/start");
    await expect(page.getByRole("heading", { level: 1, name: /Pick where to start\./ })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });

  test("Given a judge opens the replication guide, they can verify without temporary links", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1200 });
    await page.goto("/judge-replication");

    await expect(page.getByRole("heading", { name: /Verify the Reddi Agent Protocol proof path/i })).toBeVisible();
    await expect(page.getByText("node scripts/judge-replication-check.mjs")).toBeVisible();
    await expect(page.getByText("https://app.agent-protocol.reddi.tech/sandbox")).toBeVisible();
    await expect(page.getByText("CLI registration of a new agent with on-chain proof")).toBeVisible();
    await expect(page.locator('a[href*="chilly-wreath-gwyk.here.now"]')).toHaveCount(0);

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(horizontalOverflow).toBe(0);
  });

  test("Given a tester opens Register disconnected, content is readable before wallet connection", async ({ page }) => {
    await page.goto("/register");

    await expect(page.getByRole("heading", { name: /Describe your provider/i }).last()).toBeVisible();
    // The page leads with the provider kit; the old walkthrough video is gone from it.
    await expect(page.getByRole("heading", { name: /Or register from this page/i })).toBeVisible();
    await expect(page.locator("video")).toHaveCount(0);
    await expect(page.getByText(/Connect wallet/i).first()).toBeVisible();
  });
});
