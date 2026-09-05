import { expect, test, type Page } from "@playwright/test";

import {
  hasPlayableRecording,
  onboardingVideos,
  onboardingWalkthroughHeading,
} from "../lib/onboarding/video-guides";

const proofVideos = [
  "Claude Code pays a RAP specialist",
  "Run the paid economic demo",
  "Register an agent on-chain",
];

/**
 * Cards whose recording predates the public-claim remediation render a
 * withheld-notice placeholder instead of a <video>, so the playable and
 * withheld tallies are derived from the shipped guide data rather than pinned.
 *
 * `total` is asserted against the rendered card count so the two states have to
 * account for every card: derived tallies alone would move with the DOM and
 * could not fail on a card that rendered neither branch.
 */
function guidesOn(ids: string[]) {
  const guides = ids.map((id) => {
    const guide = onboardingVideos.find((candidate) => candidate.id === id);
    if (!guide) throw new Error(`unknown onboarding guide: ${id}`);
    return guide;
  });
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

const PROOF_CARD_IDS = ["mcp-x402", "economic-proof", "register-agent"];

test.describe("judge replication onboarding", () => {
  test("Given a judge lands on the homepage, they can find proof videos and verifier guidance", async ({ page }) => {
    await test.step("Given the public homepage is open", async () => {
      await page.goto("/");
      const nav = page.getByRole("navigation");
      await expect(nav.getByRole("link", { name: "Start", exact: true })).toBeVisible();
      await expect(nav.getByRole("link", { name: "Verify", exact: true })).toBeVisible();
    });

    await test.step("Then the three proof cards render, playable or explicitly withheld", async () => {
      await expect(page.getByText("Start with the proof walkthroughs")).toBeVisible();
      const { total, playable, withheld } = guidesOn(PROOF_CARD_IDS);
      expect(playable, "the heading promises proof videos, so at least one must still play").toBeGreaterThan(0);
      await expect(onboardingCards(page)).toHaveCount(total);
      await expect(page.locator("video")).toHaveCount(playable);
      await expectWithheldNotices(page, withheld);
      for (const title of proofVideos) {
        await expect(page.getByText(title).first()).toBeVisible();
      }
    });

    await test.step("And the verifier rail is reachable without guessing", async () => {
      await page.getByRole("navigation").getByRole("link", { name: "Verify", exact: true }).click();
      await expect(page).toHaveURL(/#verify-demo$/);
      await page.locator("#verify-demo").scrollIntoViewIfNeeded();
      await expect(page.getByText(/Judge-ready replication guide/i)).toBeVisible();
      await expect(page.getByText(/node scripts\/judge-replication-check\.mjs/i)).toBeVisible();
    });
  });

  test("Given a tester opens Start, every card is either playable with captions or explicitly withheld", async ({ page }) => {
    await page.goto("/start");

    await expect(
      page.getByRole("heading", { name: onboardingWalkthroughHeading(onboardingVideos) }),
    ).toBeVisible();
    const { total, playable, withheld } = guidesOn(["overview", ...PROOF_CARD_IDS]);
    expect(playable, "the heading promises proof videos, so at least one must still play").toBeGreaterThan(0);
    await expect(onboardingCards(page)).toHaveCount(total);
    await expect(page.locator("video")).toHaveCount(playable);
    await expect(page.locator('track[kind="captions"]')).toHaveCount(playable);
    await expectWithheldNotices(page, withheld);

    // The hero tally interpolates the count and its pluralization, and JSX drops the
    // newline that follows an expression, so each seam needs an explicit space. Read
    // the rendered sentence back rather than the card count so "recordings arewithheld"
    // fails here instead of shipping.
    const heroTally = await page.getByText(/Replicate the flows yourself/).first().innerText();
    expect(heroTally).toContain(
      `${withheld} ${withheld === 1 ? "recording is" : "recordings are"} withheld because the captures predate`,
    );

    await expect(page.getByText("Choose your protocol path")).toBeVisible();
    for (const title of proofVideos) {
      await expect(page.getByText(title).first()).toBeVisible();
    }

    const guideLink = page.getByRole("link", { name: /Open replication guide|Open verification guide/i }).filter({ hasNotText: /txs/i }).first();
    await expect(guideLink).toHaveAttribute("href", "/judge-replication");
    await guideLink.click();
    await expect(page).toHaveURL(/\/judge-replication$/);
    await expect(page.getByRole("heading", { name: /Verify the Reddi Agent Protocol proof path/i })).toBeVisible();
  });

  test("Given a judge opens the replication guide, they can verify without temporary links", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1200 });
    await page.goto("/judge-replication");

    await expect(page.getByRole("heading", { name: /Verify the Reddi Agent Protocol proof path/i })).toBeVisible();
    await expect(page.getByText("node scripts/judge-replication-check.mjs")).toBeVisible();
    await expect(page.getByText("https://agent-protocol.reddi.tech/economic-demo")).toBeVisible();
    await expect(page.getByText("CLI registration of a new agent with on-chain proof")).toBeVisible();
    await expect(page.locator('a[href*="chilly-wreath-gwyk.here.now"]')).toHaveCount(0);

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(horizontalOverflow).toBe(0);
  });

  test("Given a tester opens Register disconnected, content is readable before wallet connection", async ({ page }) => {
    await page.goto("/register");

    await expect(page.getByRole("heading", { name: /Describe your specialist for RAP Assurance/i }).last()).toBeVisible();
    await expect(page.getByText("Register an agent on-chain")).toBeVisible();
    const { total, playable, withheld } = guidesOn(["register-agent"]);
    await expect(onboardingCards(page)).toHaveCount(total);
    await expect(page.locator("video")).toHaveCount(playable);
    await expectWithheldNotices(page, withheld);
    await expect(page.getByText(/Connect wallet/i).first()).toBeVisible();
  });

  test("Given a judge opens Economic Demo, safe recorded-proof verification is primary", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1200 });
    await page.goto("/economic-demo");

    await expect(page.getByRole("link", { name: "Verify recorded proof" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open replication guide" })).toBeVisible();
    await expect(page.getByText("Advanced: run fresh devnet actions")).toBeVisible();
    await expect(page.getByRole("button", { name: "Run live paid devnet demo" })).toHaveCount(0);

    await page.getByText("Advanced: run fresh devnet actions").click();
    await expect(page.getByText(/Fresh runs may call hosted endpoints/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Run live paid devnet demo" })).toBeVisible();

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(horizontalOverflow).toBe(0);
  });
});
