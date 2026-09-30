import { expect, test } from "@playwright/test";
import { connectMockWallet, enableMockWallet } from "./helpers/wallet";

/**
 * BDD: Prosumer RAP Assurance conversion paths
 *
 * Goal: prove the four onboarding journeys stay understandable before we run
 * local Surfpool rehearsal, bounded devnet proof, and recorded demo capture.
 */
test.describe("prosumer RAP Assurance conversion journeys", () => {
  test("specialist builder can understand the /register monetization path", async ({
    page,
  }) => {
    await enableMockWallet(page);
    await page.goto("/register");
    await connectMockWallet(page);

    await expect(
      page.getByRole("heading", {
        name: /describe your specialist for RAP Assurance/i,
      }),
    ).toBeVisible();
    await expect(page.getByText("Publish capability", { exact: true })).toBeVisible();
    await expect(page.getByText(/gate work with x402/i)).toBeVisible();
    await expect(page.getByText(/attach evidence/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /set up my first specialist/i }),
    ).toBeVisible();
  });

  test("consumer agent operator can inspect /planner policy before payment", async ({
    page,
  }) => {
    await enableMockWallet(page);
    await page.goto("/planner");
    await connectMockWallet(page);

    await expect(
      page.getByRole("heading", {
        name: /connect your agent system to RAP Assurance/i,
      }),
    ).toBeVisible();
    const main = page.getByRole("main");
    await expect(
      main.getByText(/works with existing agents/i).first(),
    ).toBeVisible();
    await expect(
      main.getByText(/policy before payment/i).first(),
    ).toBeVisible();
    await expect(main.getByText(/receipts after work/i).first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: /discover specialists/i }),
    ).toBeDisabled();
  });

  test("MCP adopter can follow /mcp-bridge-demo from bridge to planner and proof", async ({
    page,
  }) => {
    await page.goto("/mcp-bridge-demo");

    await expect(
      page.getByRole("heading", { name: /Reddi Agent Protocol MCP Bridge/i }),
    ).toBeVisible();
    await expect(page.getByText(/for existing agent systems/i)).toBeVisible();
    await expect(page.getByText(/permission boundary/i)).toBeVisible();
    await expect(page.getByText(/local-first evidence trail/i)).toBeVisible();
    await expect(
      page.getByRole("link", { name: /try planner path/i }),
    ).toHaveAttribute("href", "/planner");
    await expect(
      page.getByRole("link", { name: /watch economic demo/i }),
    ).toHaveAttribute("href", "/economic-demo");
  });

  test("attestor can inspect verification role path and resolve readiness", async ({
    page,
  }) => {
    await enableMockWallet(page);
    await page.route("**/api/onboarding/audit", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          attestations: [
            {
              timestamp: "2026-05-08T00:00:00.000Z",
              job_id: "bdd-attestation-001",
              tx_signature: "BddAttestation111111111111111111111111111111111",
              local_only: false,
              wallet_address: "BddAttestor1111111111111111111111111111111111",
              endpoint_url:
                "https://attestor.example/.well-known/reddi-agent.json",
            },
          ],
        }),
      });
    });
    await page.route("**/api/onboarding/planner/reveal", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          result: {
            entries: [
              {
                runId: "bdd-reveal-001",
                revealedAt: "2026-05-08T00:01:00.000Z",
                revealTxSignature:
                  "BddReveal1111111111111111111111111111111111",
                specialistWallet: "BddSpecialist111111111111111111111111111111",
              },
            ],
          },
        }),
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
            walletAddress: "BddAttestor1111111111111111111111111111111111",
            attestationAccuracy: 0.98,
            reasons: ["receipt verifier", "high accuracy"],
          },
        }),
      });
    });

    await page.goto("/attestation");
    await connectMockWallet(page);

    await expect(
      page.getByRole("heading", {
        name: /verify specialist work evidence/i,
      }),
    ).toBeVisible();
    await expect(page.getByText(/validate outputs/i)).toBeVisible();
    await expect(page.getByText(/inspect receipts/i)).toBeVisible();
    await expect(page.getByText(/bound reputation inputs/i)).toBeVisible();

    await page.getByRole("button", { name: /resolve attestor/i }).click();
    await expect(page.getByText(/resolved attestor/i)).toBeVisible();
    await expect(page.getByText(/receipt verifier/i)).toBeVisible();
  });
});
