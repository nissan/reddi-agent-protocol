import { expect, test } from "@playwright/test";

test.describe("ADL whitepaper and demo", () => {
  test("loads the ADL page with review and mock/live controls", async ({ page }) => {
    const response = await page.goto("/adl", {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: /agent definition language/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /read whitepaper/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /open review issue/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /mock mode/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /live endpoint/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /run mock flow/i })).toBeVisible();
  });

  test("runs the packaged mock flow without a user endpoint", async ({ page }) => {
    await page.goto("/adl");
    await page.getByRole("button", { name: /run mock flow/i }).click();

    await expect(page.getByRole("status")).toContainText(/accepted|complete|ready/i);
  });
});
