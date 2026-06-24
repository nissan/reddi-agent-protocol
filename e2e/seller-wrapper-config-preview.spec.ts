import { expect, test } from "@playwright/test";

test.describe("seller-wrapper config onboarding preview", () => {
  test("renders SOL, USDC, and AUDD rails from the onboarding API", async ({ page }) => {
    await page.goto("/onboarding");

    await expect(page.getByRole("heading", { name: "Seller-wrapper config preview" })).toBeVisible();
    await expect(page.getByText("SOL", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("USDC", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("AUDD", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("MCP", { exact: true })).toBeVisible();
    await expect(page.getByText("HTTP/OpenAPI", { exact: true })).toBeVisible();
    await expect(page.getByText(/payment-plan\/proof metadata for v0\.1/i)).toBeVisible();
    await expect(page.getByText("wallet signing disabled")).toBeVisible();
    await expect(page.getByText("settlement finality claim disabled")).toBeVisible();
  });

  test("shows a retryable error state when config loading fails", async ({ page }) => {
    await page.route("**/api/onboarding/seller-wrapper-config", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "mock config failure" }),
      });
    });

    await page.goto("/onboarding");

    await expect(page.getByText("Seller-wrapper config unavailable")).toBeVisible();
    await expect(page.getByText("mock config failure")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  test("shows an empty state when the API returns no wrapper endpoints", async ({ page }) => {
    await page.route("**/api/onboarding/seller-wrapper-config", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          result: {
            schemaVersion: "reddi.onboarding-seller-wrapper-config.v1",
            mode: "no-spend-config-preview",
            config: {
              schemaVersion: "reddi.seller-wrapper-config.v1",
              generatedMode: "no-spend-config-examples",
              endpoints: [],
              guardrails: {},
            },
            validation: {
              valid: true,
              reasonCodes: ["seller_wrapper_config_valid"],
              auditNotes: [],
            },
            boundaries: {
              networkCalls: false,
              livePayment: false,
              walletSigning: false,
              rpcCalls: false,
              providerInvocation: false,
              hostedWrites: false,
              custodyExpansion: false,
              settlementFinalityClaim: false,
            },
          },
        }),
      });
    });

    await page.goto("/onboarding");

    await expect(page.getByText("No wrapper endpoints returned")).toBeVisible();
    await expect(page.getByText(/no seller-wrapper endpoint configs were available/i)).toBeVisible();
  });
});
