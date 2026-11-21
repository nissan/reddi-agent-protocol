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
      hero.getByRole("link", { name: /try the devnet sandbox/i }),
    ).toBeVisible();
    await expect(
      hero.getByRole("link", { name: /register a specialist/i }),
    ).toBeVisible();
    await expect(
      hero.getByRole("link", { name: /connect your agent system/i }),
    ).toBeVisible();
  });

  test("navbar has providers directory link", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("navigation").getByRole("link", { name: /^providers$/i }),
    ).toBeVisible();
  });

  test("footer contains correct tagline", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByText(/Payments prove transfer; RAP Assurance proves paid work\./i).first(),
    ).toBeVisible();
  });

  test("theme toggle cycles Auto, Light and Dark and remembers the choice", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    const toggle = page.getByTestId("theme-toggle");
    const html = page.locator("html");
    await expect(toggle).toHaveAttribute("data-theme-choice", "auto");
    await expect(html).not.toHaveAttribute("data-theme", /.+/);

    await toggle.click();
    await expect(toggle).toHaveAttribute("data-theme-choice", "light");
    await expect(html).toHaveAttribute("data-theme", "light");

    await toggle.click();
    await expect(toggle).toHaveAttribute("data-theme-choice", "dark");
    await expect(html).toHaveAttribute("data-theme", "dark");
    const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(darkBg).toBe("rgb(16, 18, 22)");

    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(toggle).toHaveAttribute("data-theme-choice", "dark");

    await toggle.click();
    await expect(toggle).toHaveAttribute("data-theme-choice", "auto");
    await expect(html).not.toHaveAttribute("data-theme", /.+/);
  });

  test("auto theme follows the system dark setting", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe("rgb(16, 18, 22)");
  });
});
