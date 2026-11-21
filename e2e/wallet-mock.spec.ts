import { expect, test } from "@playwright/test";
import { connectMockWallet, enableMockWallet } from "./helpers/wallet";

test.describe("playwright wallet simulation", () => {
  test("shows connected wallet state for wallet-gated routes", async ({ page }) => {
    await enableMockWallet(page);
    await page.goto("/planner");
    await connectMockWallet(page);

    await expect(page.getByText(/connect your wallet/i)).toHaveCount(0);
  });

  test("can capture wallet-gated onboarding screen without manual extension", async ({ page }) => {
    await enableMockWallet(page);
    await page.goto("/onboarding");
    await connectMockWallet(page);

    await expect(page.getByRole("heading", { name: /^Run a provider$/i, level: 1 })).toBeVisible();

    await page.screenshot({
      path: "artifacts/playwright-wallet/onboarding-wallet-mock.png",
      fullPage: true,
    });
  });
});
