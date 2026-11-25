import { test, expect, type Page } from "@playwright/test";

/**
 * /budget with its API answers stubbed, so the page's own behaviour is held without devnet:
 * form defaults, the four-provider limit, what happens without a wallet, and the dashboard
 * states (open, posted, finished). Nothing here signs or sends a transaction.
 */

const PAYER = "7mYx4g4zWQ6k2Jx7t9b8C5a2K9mL3pR8nV2sQ1dF6uH";
const BUDGET = "3bUtxGk3pfS68UMjNDBsXvxohcQEFJrhmV4KqfNuFEBp";

const provider = (n: number, token: "SOL" | "USDC") => ({
  id: `p${n}-${token.toLowerCase()}`,
  name: `Provider ${n} ${token}`,
  model: `model-${n}`,
  tagline: "A test provider.",
  payTo: PAYER,
  token,
  pricing: { inputPerMillionUsd: "0.50", outputPerMillionUsd: "1.50" },
});

const OFFER = {
  providers: [1, 2, 3, 4, 5].map((n) => provider(n, "SOL")).concat([provider(6, "USDC")]),
  tokens: {
    SOL: { decimals: 9, max: "1000000000", defaultTotal: "50000000", mint: null },
    USDC: { decimals: 6, max: "25000000", defaultTotal: "5000000", mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" },
  },
  judge: null,
};

function view(overrides: Record<string, unknown> = {}) {
  return {
    address: BUDGET,
    payer: PAYER,
    token: "SOL",
    decimals: 9,
    total: "50000000",
    unreserved: "30000000",
    perProviderCap: "25000000",
    judge: null,
    createdSlot: "1000",
    openEndsSlot: "217000",
    closedSlot: null,
    closed: false,
    reviewFromOpenEnd: false,
    slot: "2000",
    providers: [{ payee: PAYER, id: "p1-sol", name: "Provider 1 SOL" }],
    slices: [
      {
        payee: PAYER,
        provider: { id: "p1-sol", name: "Provider 1 SOL", model: "model-1" },
        reserved: "20000000",
        posted: "0",
        state: "open",
        approved: false,
        actions: [],
      },
    ],
    canClose: true,
    ...overrides,
  };
}

async function stubOffer(page: Page) {
  await page.route("**/api/budget/v1/prepare", (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: OFFER }) : route.fulfill({ status: 500, json: {} }),
  );
}

test.describe("/budget page", () => {
  test("new Budget form: defaults, token switch and the four-provider limit", async ({ page }) => {
    await stubOffer(page);
    await page.goto("/budget");

    await expect(page.getByTestId("budget-console")).toHaveAttribute("data-state", "new");
    await expect(page.getByTestId("budget-total")).toHaveValue("0.05");
    // The first two SOL providers start ticked; the USDC provider is not offered for a SOL Budget.
    await expect(page.getByTestId("budget-provider-p1-sol").getByRole("checkbox")).toBeChecked();
    await expect(page.getByTestId("budget-provider-p2-sol").getByRole("checkbox")).toBeChecked();
    await expect(page.getByTestId("budget-provider-p6-usdc")).toHaveCount(0);

    await page.getByTestId("budget-provider-p3-sol").getByRole("checkbox").check();
    await page.getByTestId("budget-provider-p4-sol").getByRole("checkbox").check();
    await expect(page.getByTestId("budget-provider-p5-sol").getByRole("checkbox")).toBeDisabled();

    await page.getByTestId("budget-token-USDC").click();
    await expect(page.getByTestId("budget-total")).toHaveValue("5");
    await expect(page.getByTestId("budget-provider-p6-usdc").getByRole("checkbox")).toBeChecked();
    await expect(page.getByTestId("budget-provider-p1-sol")).toHaveCount(0);

    await expect(page.getByTestId("budget-preview")).toHaveAttribute("href", "/sandbox?scenario=budget");
  });

  test("without a wallet, Open asks for one and sends nothing", async ({ page }) => {
    await stubOffer(page);
    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/api/budget/")) posts.push(request.url());
    });
    await page.goto("/budget");
    await page.getByTestId("budget-open").click();
    await expect(page.getByTestId("budget-message")).toContainText(/connect a wallet/i);
    await expect(page.getByTestId("budget-key")).toHaveCount(0);
    expect(posts).toEqual([]);
  });

  test("when Budgets are unavailable the page says so", async ({ page }) => {
    await page.route("**/api/budget/v1/prepare", (route) =>
      route.fulfill({ status: 503, json: { error: { code: "store_unavailable", message: "Budgets are not available right now." } } }),
    );
    await page.goto("/budget");
    await expect(page.getByTestId("budget-message")).toContainText("Budgets are not available right now.");
  });

  test("an open Budget shows its shares, and a visitor who is not the payer cannot act", async ({ page }) => {
    await stubOffer(page);
    await page.route("**/api/budget/v1/status**", (route) => route.fulfill({ json: { budget: view() } }));
    await page.goto(`/budget?b=${BUDGET}`);

    const dashboard = page.getByTestId("budget-view");
    await expect(dashboard).toBeVisible();
    await expect(dashboard.getByRole("heading", { name: /0\.05 SOL Budget/ })).toBeVisible();
    await expect(page.getByTestId("budget-unreserved")).toContainText("0.03 SOL");
    await expect(page.getByTestId("budget-owed")).toContainText("0 SOL");
    await expect(page.getByTestId("budget-slice-p1-sol")).toHaveAttribute("data-state", "open");
    await expect(page.getByTestId("budget-close")).toBeDisabled();
    await expect(page.getByTestId("budget-connect-note")).toBeVisible();
    await expect(page.getByTestId("budget-key")).toHaveCount(0);
  });

  test("a posted share shows what is owed, with approve and dispute held for the payer", async ({ page }) => {
    await stubOffer(page);
    const posted = view({
      closed: true,
      closedSlot: "3000",
      unreserved: "30000000",
      canClose: false,
      slices: [
        {
          payee: PAYER,
          provider: { id: "p1-sol", name: "Provider 1 SOL", model: "model-1" },
          reserved: "20000000",
          posted: "12000000",
          state: "posted",
          approved: false,
          disputeEndsSlot: "219000",
          actions: ["approve", "dispute"],
        },
      ],
    });
    await page.route("**/api/budget/v1/status**", (route) => route.fulfill({ json: { budget: posted } }));
    await page.goto(`/budget?b=${BUDGET}`);

    await expect(page.getByTestId("budget-slice-p1-sol")).toHaveAttribute("data-state", "posted");
    await expect(page.getByTestId("budget-owed")).toContainText("0.012 SOL");
    await expect(page.getByTestId("budget-approve")).toBeDisabled();
    await expect(page.getByTestId("budget-dispute")).toBeDisabled();
  });

  test("a finished Budget says so and offers a new one", async ({ page }) => {
    await stubOffer(page);
    await page.route("**/api/budget/v1/status**", (route) =>
      route.fulfill({ status: 404, json: { error: { code: "budget_not_found", message: "No such Budget." } } }),
    );
    await page.goto(`/budget?b=${BUDGET}`);
    await expect(page.getByTestId("budget-gone")).toBeVisible();
    await page.getByTestId("budget-gone").getByRole("button", { name: /set a new budget/i }).click();
    await expect(page.getByTestId("budget-new")).toBeVisible();
  });
});
