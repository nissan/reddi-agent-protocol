import { expect, test } from "@playwright/test";

/**
 * The /try page's "Preview without a wallet" lane: price, answer and a signed
 * simulated receipt from the sandbox gateway. Nothing here touches a wallet, a
 * Solana RPC, or any network beyond this app's own routes.
 */
test.describe.configure({ timeout: 120_000 });

test("/try previews the whole call without a wallet", async ({ page }) => {
  await page.goto("/try");
  await expect(page.getByRole("heading", { name: /Pay for one answer/ })).toBeVisible({ timeout: 60_000 });

  // The page is rendered by the server before React attaches, so repeat the first click until it takes.
  await expect(async () => {
    await page.getByTestId("try-mode-preview").click();
    await expect(page.getByTestId("try-console")).toHaveAttribute("data-mode", "preview", { timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByTestId("try-preview-intro")).toBeVisible();

  await page.getByTestId("try-task-pr-review").click();
  await page.getByTestId("try-start").click();
  await expect(page.getByTestId("try-preview-pay")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("try-preview-max")).toHaveText(/^0\.\d+ SOL$/);
  // No wallet controls in a preview.
  await expect(page.getByTestId("try-qr")).toHaveCount(0);
  await expect(page.getByTestId("try-pay-wallet")).toHaveCount(0);

  await page.getByTestId("try-preview-pay-button").click();
  await expect(page.getByTestId("try-answer")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("try-charged")).toHaveText(/SOL/);
  await expect(page.getByTestId("try-network-fee")).toHaveText(/^0\.00000508 SOL/);
  const checks = page.getByTestId("try-checks").locator("li");
  await expect(checks.first()).toBeVisible();
  await expect(checks.filter({ hasText: "✗" })).toHaveCount(0);
  await expect(page.getByTestId("try-preview-note")).toBeVisible();

  // From the preview straight to the devnet lane.
  await page.getByTestId("try-switch-devnet").click();
  await expect(page.getByTestId("try-console")).toHaveAttribute("data-mode", "devnet");
  await expect(page.getByTestId("try-console")).toHaveAttribute("data-phase", "pick");
});
