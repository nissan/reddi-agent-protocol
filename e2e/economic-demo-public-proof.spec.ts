import { expect, test } from "@playwright/test";

const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "desktop", width: 1440, height: 960 },
] as const;

test.describe("/economic-demo/public-proof", () => {
  for (const viewport of viewports) {
    test(`renders public proof ledger at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/economic-demo/public-proof");

      await expect(
        page.getByRole("heading", {
          name: /public proof rendering for the paid workflow ledger/i,
        }),
      ).toBeVisible();
      await expect(page.getByTestId("public-proof-state-labels")).toContainText(
        "fixture zero spend",
      );
      await expect(page.getByTestId("public-proof-state-labels")).toContainText(
        "production live disabled",
      );

      const happyPath = page.getByTestId(
        "proof-case-pay_sh_sandbox_single_charge_binding_ready",
      );
      await expect(happyPath).toBeVisible();
      await expect(happyPath).toContainText("No-network no-spend happy path");
      await expect(happyPath).toContainText("Receipt binding ready");
      await expect(happyPath).toContainText("Evidence refs ready");
      await expect(happyPath).toContainText("Attestation preview");
      await expect(happyPath).toContainText("Reputation preview");

      await expect(page.getByTestId("public-proof-cases")).toContainText(
        "Blocked fail-closed",
      );
      await expect(page.getByTestId("public-proof-cases")).toContainText(
        "unsupported",
      );
      await expect(page.getByText(/All live flags false/i)).toBeVisible();

      await page.screenshot({
        path: `artifacts/playwright-economic-demo/public-proof-${viewport.name}.png`,
        fullPage: true,
      });
    });
  }

  test("captures quote to ledger to receipt evidence and blocked state trace", async ({
    context,
    page,
  }) => {
    await context.tracing.start({
      screenshots: true,
      snapshots: true,
      sources: true,
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/economic-demo/public-proof");

    await expect(page.getByTestId("proof-section-quote").first()).toContainText(
      "USDC",
    );
    await expect(
      page.getByTestId("proof-section-budget_ledger").first(),
    ).toContainText("Planned dry-run ledger");
    await expect(page.getByTestId("proof-section-receipt").first()).toContainText(
      "Receipt binding ready",
    );
    await expect(page.getByTestId("proof-section-evidence").first()).toContainText(
      "Evidence refs ready",
    );

    const firstBlocked = page.getByTestId(/^blocked-reason-/).first();
    await firstBlocked.scrollIntoViewIfNeeded();
    await expect(firstBlocked).toContainText("Blocked before payment proof is accepted");

    await context.tracing.stop({
      path: "artifacts/playwright-economic-demo/public-proof-flow-trace.zip",
    });
  });
});
