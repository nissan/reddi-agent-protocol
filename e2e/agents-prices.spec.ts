import { expect, test, type Page } from "@playwright/test";

// Two made-up registry listings: one priced per token, one priced per call.
// The registry and candidate routes are stubbed so the spec needs no devnet read.
function listing(wallet: string, displayName: string, pricing: { inputPerMillionUsd?: number; outputPerMillionUsd?: number }, rateLamports: string) {
  return {
    pda: `pda-${wallet}`,
    walletAddress: wallet,
    onchain: { model: displayName, reputationScore: 0, jobsCompleted: "0", jobsFailed: "0", rateLamports },
    capabilities: {
      taskTypes: [],
      inputModes: [],
      outputModes: [],
      privacyModes: [],
      tags: [],
      baseUsd: 0,
      perCallUsd: 0,
      ...pricing,
      context_requirements: [],
      runtime_capabilities: [],
      manifest: { displayName },
    },
    attestation: { attested: false },
    health: { status: "pass", freshnessState: "fresh" },
  };
}

async function stubDirectory(page: Page) {
  await page.route("**/api/registry", (route) =>
    route.fulfill({
      json: {
        listings: [
          listing("PerTokenWallet1111111111111111111111111111", "Atlas Review", { inputPerMillionUsd: 5, outputPerMillionUsd: 25 }, "0"),
          listing("PerCallWallet22222222222222222222222222222", "Legacy Endpoint", {}, "1000000"),
        ],
      },
    }),
  );
  await page.route("**/api/discovery/candidates", (route) => route.fulfill({ json: { result: { cards: [], sources: [] } } }));
}

test.describe("/agents prices (#908)", () => {
  test("Given a provider priced per token, its card shows the token prices, a typical call and the max per call in USDC, AUDD and SOL", async ({ page }) => {
    await stubDirectory(page);
    await page.goto("/agents");

    const cards = page.getByTestId("agent-card");
    await expect(cards).toHaveCount(2, { timeout: 30_000 });

    const priced = cards.filter({ hasText: "Atlas Review" }).getByTestId("specialist-card-price");
    await expect(priced).toContainText("in $5 · out $25");
    await expect(priced).toContainText("Typical call (12,000 in / 1,500 out)");
    for (const amount of ["0.0975 USDC", "0.151125 AUDD", "0.00065 SOL"]) await expect(priced).toContainText(amount);
    await expect(priced).toContainText("Max per call");
    for (const amount of ["0.195 USDC", "0.30225 AUDD", "0.0013 SOL"]) await expect(priced).toContainText(amount);

    await expect(page.getByTestId("agents-price-note")).toContainText(/Demo rates: 1 SOL = \d+ USD, 1 USD = [\d.]+ AUDD\. Not market prices\./);
  });

  test("Given a provider without per-token prices, its card keeps the per-call rate", async ({ page }) => {
    await stubDirectory(page);
    await page.goto("/agents");

    const legacy = page.getByTestId("agent-card").filter({ hasText: "Legacy Endpoint" });
    await expect(legacy).toBeVisible({ timeout: 30_000 });
    await expect(legacy.getByTestId("specialist-card-price")).toHaveCount(0);
    await expect(legacy).toContainText("0.0010 SOL/call");
  });
});
