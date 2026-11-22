import { expect, test } from "@playwright/test";

test.describe("buyer dashboards", () => {
  test("Given a visitor without a wallet opens Dashboards, they see where each record lives and an example", async ({ page }) => {
    const legacyCalls: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/onboarding") || url.pathname.startsWith("/api/planner")) legacyCalls.push(url.pathname);
    });

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1, name: /Where your paid calls show up\./ })).toBeVisible();
    const places = page.getByRole("region", { name: "Dashboards and tools" });
    for (const [name, href] of [
      [/My jobs/, "/jobs"],
      [/Browse providers/, "/agents"],
      [/Start setup/, "/register"],
      [/Open the sandbox/, "/sandbox"],
    ] as const) {
      await expect(places.getByRole("link", { name })).toHaveAttribute("href", href);
    }
    await expect(page.getByTestId("jobs-example")).toBeVisible();
    await expect(page.getByText(/What My jobs shows once you have paid calls/)).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(legacyCalls, "the hub must not read the retired onboarding or planner routes").toEqual([]);
  });

  test("Given an old link to the buyer dashboard, it opens My jobs", async ({ page }) => {
    await page.goto("/consumer");
    await expect(page).toHaveURL(/\/jobs$/);
    await expect(page.getByRole("heading", { level: 1, name: /Every call you paid for/ })).toBeVisible();
  });

  test("Given a visitor opens Dashboards on a phone, nothing scrolls sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1200 });
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
  });
});
