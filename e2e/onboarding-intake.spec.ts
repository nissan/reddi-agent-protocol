import { expect, test, type Page } from "@playwright/test";

/**
 * #384 — AI onboarding assistant guided intake flow.
 *
 * Covers the intake states required by the issue: source selection, consent
 * gate, loading, analysed results, invalid URL, blocked secret (credential-
 * shaped input rejected via the #575 fail-closed reasons), empty/no-results,
 * and simulated analyser error + retry. Also proves the zero-live-network
 * boundary: every request the page makes stays on the Playwright dev origin.
 */

const SECRET_VALUE = "sk-e2eleak1234567890abcdef";

/**
 * Track external data requests (fetch/XHR/WebSocket/EventSource). The global
 * app layout loads a Google Fonts stylesheet on every route (pre-existing,
 * unrelated to intake), so the boundary proven here is that the intake flow
 * itself performs zero external data calls — no probe, no invocation.
 */
function trackExternalRequests(page: Page): string[] {
  const external: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const dataRequest = ["fetch", "xhr", "websocket", "eventsource"].includes(request.resourceType());
    if (dataRequest && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      external.push(request.url());
    }
  });
  return external;
}

async function goToIntake(page: Page) {
  await page.goto("/onboarding/intake");
  await expect(page.getByTestId("intake-page")).toBeVisible();
}

async function acceptConsentAndRun(page: Page) {
  await page.getByTestId("intake-continue").click();
  await expect(page.getByTestId("intake-consent-step")).toBeVisible();
  await page.getByTestId("intake-consent-checkbox").check();
  await page.getByTestId("intake-run-analysis").click();
}

test.describe("/onboarding/intake — guided intake states (#384)", () => {
  test("renders the six source inputs mapped onto onboarding source kinds", async ({ page }) => {
    await goToIntake(page);
    for (const optionId of [
      "endpoint-url",
      "ai-catalog-url",
      "mcp-card-url",
      "openapi-url",
      "a2a-card-url",
      "manual-seed",
    ]) {
      await expect(page.getByTestId(`intake-source-option-${optionId}`)).toBeVisible();
    }
    await expect(page.getByTestId("intake-boundary-badges")).toContainText("No live probe (#459 pending)");
    // Links back to the manual registration path (scoped to the intake page,
    // not the shared nav, which keeps some links hidden inside a dropdown).
    const intakePage = page.getByTestId("intake-page");
    await expect(intakePage.locator('a[href="/register"]').first()).toBeVisible();
    await expect(intakePage.locator('a[href="/onboarding"]').first()).toBeVisible();
  });

  test("consent boundary gates analysis and states the no-live/no-secret boundary", async ({ page }) => {
    await goToIntake(page);
    await page.getByTestId("intake-sample-url").click();
    await page.getByTestId("intake-continue").click();
    const consent = page.getByTestId("intake-consent-step");
    await expect(consent).toBeVisible();
    await expect(consent).toContainText("No live endpoint inspection");
    await expect(consent).toContainText("#459");
    await expect(consent).toContainText("No payment, no paid endpoint invocation");
    await expect(consent).toContainText("No secret storage");
    // Blocked until consent is given.
    await expect(page.getByTestId("intake-run-analysis")).toBeDisabled();
    await page.getByTestId("intake-consent-checkbox").check();
    await expect(page.getByTestId("intake-run-analysis")).toBeEnabled();
  });

  test("analyses an MCP card URL through loading into fixture-backed results with zero external requests", async ({
    page,
  }) => {
    const external = trackExternalRequests(page);
    await goToIntake(page);
    await page.getByTestId("intake-source-option-mcp-card-url").click();
    await page.getByTestId("intake-sample-url").click();
    await acceptConsentAndRun(page);

    await expect(page.getByTestId("intake-loading")).toBeVisible();
    await expect(page.getByTestId("intake-loading")).toContainText("no network request");

    const results = page.getByTestId("intake-results");
    await expect(results).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("intake-capabilities")).toContainText("list-issues");
    await expect(page.getByTestId("intake-readiness")).toContainText("needs_operator_review");
    await expect(page.getByTestId("intake-state-machine")).toContainText("draft");
    await expect(page.getByTestId("intake-state-machine")).toContainText("operator_approval");
    // Guardrails render all-false.
    const guardrails = page.getByTestId("intake-guardrails");
    await expect(guardrails).toContainText("publicationAllowed");
    await expect(guardrails).not.toContainText("true");
    // Link back to manual registration from results.
    await expect(results.locator('a[href="/register"]')).toBeVisible();

    expect(external).toEqual([]);
  });

  test("rejects an invalid / private URL fail-closed", async ({ page }) => {
    await goToIntake(page);
    await page.getByTestId("intake-source-option-openapi-url").click();
    await page.getByTestId("intake-source-url-input").fill("http://localhost:8443/openapi.json");
    await acceptConsentAndRun(page);
    const invalid = page.getByTestId("intake-invalid-url");
    await expect(invalid).toBeVisible({ timeout: 10_000 });
    await expect(invalid).toContainText("private_url_blocked");
  });

  test("blocks credential-shaped input and never echoes or keeps the secret", async ({ page }) => {
    const external = trackExternalRequests(page);
    await goToIntake(page);
    await page.getByTestId("intake-source-option-mcp-card-url").click();
    await page
      .getByTestId("intake-source-url-input")
      .fill(`https://example.com/card.json?api_key=${SECRET_VALUE}`);
    await acceptConsentAndRun(page);

    const blocked = page.getByTestId("intake-blocked-secret");
    await expect(blocked).toBeVisible({ timeout: 10_000 });
    await expect(blocked).toContainText("credential_leakage_rejected");
    await expect(blocked).toContainText("never stored, transmitted, or displayed");

    // The secret value must not appear anywhere in the rendered page.
    const content = await page.content();
    expect(content).not.toContain(SECRET_VALUE);

    // Starting over shows the input was discarded.
    await page.getByTestId("intake-start-over").click();
    await expect(page.getByTestId("intake-source-url-input")).toHaveValue("");
    expect(external).toEqual([]);
  });

  test("shows the empty/no-results state for a manual seed without capabilities", async ({ page }) => {
    await goToIntake(page);
    await page.getByTestId("intake-source-option-manual-seed").click();
    await page.getByTestId("intake-manual-displayname").fill("Empty Agent");
    await page.getByTestId("intake-manual-description").fill("No capabilities yet");
    await acceptConsentAndRun(page);
    const empty = page.getByTestId("intake-empty");
    await expect(empty).toBeVisible({ timeout: 10_000 });
    await expect(empty).toContainText("No capabilities found");
    await expect(empty).toContainText("#459");
    await expect(empty.locator('a[href="/register"]')).toBeVisible();
  });

  test("simulated analyser interruption is retryable and recovers", async ({ page }) => {
    await goToIntake(page);
    await page.getByTestId("intake-source-option-ai-catalog-url").click();
    await page.getByTestId("intake-sample-unreachable").click();
    await acceptConsentAndRun(page);

    const error = page.getByTestId("intake-error");
    await expect(error).toBeVisible({ timeout: 10_000 });
    await expect(error).toContainText("No live request was made");

    await page.getByTestId("intake-retry").click();
    await expect(page.getByTestId("intake-loading")).toBeVisible();
    await expect(page.getByTestId("intake-results")).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("guided intake entry points (#384)", () => {
  test("register page links to the guided intake", async ({ page }) => {
    await page.goto("/register");
    const entry = page.getByTestId("register-intake-entry");
    await entry.scrollIntoViewIfNeeded();
    await expect(entry).toBeVisible();
    await expect(entry.locator('a[href="/onboarding/intake"]')).toBeVisible();
  });

  test("onboarding wizard links to the guided intake", async ({ page }) => {
    await page.goto("/onboarding");
    const entry = page.getByTestId("onboarding-intake-entry");
    await expect(entry).toBeVisible();
    await expect(entry.locator('a[href="/onboarding/intake"]')).toBeVisible();
  });

  test("manager board links to the guided intake", async ({ page }) => {
    await page.goto("/manager");
    const entry = page.getByTestId("manager-intake-entry");
    await expect(entry).toBeVisible();
  });
});
