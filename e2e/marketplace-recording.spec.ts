import { expect, test } from "@playwright/test";
import { connectMockWallet, enableMockWallet } from "./helpers/wallet";

const recordingPaceMs = Number(
  process.env.MARKETPLACE_RECORDING_PACE_MS ?? 900,
);
const liveProductMode = Boolean(process.env.PLAYWRIGHT_BASE_URL);

async function recordingBeat(page: {
  waitForTimeout: (ms: number) => Promise<void>;
}) {
  if (recordingPaceMs > 0) await page.waitForTimeout(recordingPaceMs);
}

test.describe("RAP Assurance demo recording journey", () => {
  test("records existing-agent to specialist to attestor onboarding flow", async ({
    page,
  }) => {
    if (!liveProductMode) await enableMockWallet(page);

    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        name: /payments prove transfer\. RAP Assurance proves paid work\./i,
      }),
    ).toBeVisible();
    await recordingBeat(page);

    await page
      .getByRole("link", { name: "Connect your agent system", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: /Reddi Agent Protocol MCP Bridge/i }),
    ).toBeVisible();
    await expect(page.getByText(/local-first evidence trail/i)).toBeVisible();
    await recordingBeat(page);

    await page.getByRole("link", { name: /try planner path/i }).click();
    if (liveProductMode) {
      await expect(
        page.getByRole("heading", { name: /connect your wallet/i }),
      ).toBeVisible();
      await expect(
        page.getByText(/use the planner or register as a specialist/i),
      ).toBeVisible();
    } else {
      await connectMockWallet(page);
      await expect(
        page.getByRole("heading", {
          name: /connect your agent system to RAP Assurance/i,
        }),
      ).toBeVisible();
      await expect(
        page.getByText(/policy before payment/i).first(),
      ).toBeVisible();
    }
    await recordingBeat(page);

    await page.goto("/register");
    if (liveProductMode) {
      await expect(
        page.getByRole("heading", { name: /connect your wallet/i }),
      ).toBeVisible();
      await expect(
        page.getByText(/need a Solana wallet to register a specialist/i),
      ).toBeVisible();
    } else {
      await connectMockWallet(page);
      await expect(
        page.getByRole("heading", {
          name: /describe your specialist for RAP Assurance/i,
        }),
      ).toBeVisible();
      await expect(page.getByText(/gate work with x402/i)).toBeVisible();
    }
    await recordingBeat(page);

    await page.route("**/api/onboarding/audit", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ attestations: [] }),
      });
    });
    await page.route("**/api/onboarding/planner/reveal", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, result: { entries: [] } }),
      });
    });
    await page.route("**/api/planner/tools/resolve-attestor", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          count: 1,
          candidate: {
            walletAddress: "RecordingAttestor1111111111111111111111111111",
            attestationAccuracy: 0.99,
            reasons: ["receipt verifier", "demo-ready"],
          },
        }),
      });
    });

    await page.goto("/attestation");
    if (liveProductMode) {
      await expect(
        page.getByRole("heading", { name: /become an attestor agent/i }),
      ).toBeVisible();
      await expect(page.getByText(/connect wallet/i)).toBeVisible();
    } else {
      await connectMockWallet(page);
      await expect(
        page.getByRole("heading", {
          name: /verify specialist work evidence/i,
        }),
      ).toBeVisible();
      await page.getByRole("button", { name: /resolve attestor/i }).click();
      await expect(page.getByText(/resolved attestor/i)).toBeVisible();
    }
    await recordingBeat(page);

    await page.goto("/economic-demo");
    await expect(
      page.getByRole("heading", { name: /watch an agent hire specialists/i }),
    ).toBeVisible();
    await expect(page.getByText(/payload \+ money graph|money \+ work graph/i).first()).toBeVisible();
    await expect(page.getByText(/boundary:/i).first()).toBeVisible();
    await recordingBeat(page);
  });
});
