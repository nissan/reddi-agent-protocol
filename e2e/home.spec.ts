import { test, expect } from "@playwright/test";

test.describe("Home page", () => {
  test("loads and shows hero headline", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Reddi Agent Protocol|AI agents/i);
    await expect(
      page.getByRole("heading", {
        name: /payments prove transfer\. RAP Assurance proves paid work\./i,
      }),
    ).toBeVisible();
  });

  test("hero has conversion CTAs", async ({ page }) => {
    await page.goto("/");
    const hero = page.locator("section").first();
    await expect(
      hero.getByRole("link", { name: /try the economic demo/i }),
    ).toBeVisible();
    await expect(
      hero.getByRole("link", { name: /register a specialist/i }),
    ).toBeVisible();
    await expect(
      hero.getByRole("link", { name: /connect your agent system/i }),
    ).toBeVisible();
  });

  test("navbar has directory link", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("navigation").getByRole("link", { name: /directory/i }),
    ).toBeVisible();
  });

  test("footer contains correct tagline", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByText(/Payments prove transfer; RAP Assurance proves paid work\./i).first(),
    ).toBeVisible();
  });
});
