import { expect, test, type Page } from "@playwright/test";

import { connectMockWallet, enableMockWallet } from "./helpers/wallet";
import { FORBIDDEN_PUBLIC_CLAIMS, claimIsQualified } from "../lib/public-claims/public-claim-boundary-terms";

/**
 * The devnet sandbox, walked through its simulated-payment lane. Nothing here
 * touches a wallet, a Solana RPC, or any network beyond this app's own routes.
 */
test.describe.configure({ timeout: 90_000 });

function unqualifiedClaims(copy: string): string[] {
  const violations: string[] = [];
  for (const line of copy.split(/\r?\n/)) {
    for (const claim of FORBIDDEN_PUBLIC_CLAIMS) {
      if (claim.pattern.test(line) && !claimIsQualified(line, claim)) violations.push(`${claim.id}: ${line.trim()}`);
    }
  }
  return violations;
}

async function expectCopyInsideClaimBoundary(page: Page) {
  expect(unqualifiedClaims(await page.locator("body").innerText())).toEqual([]);
}

async function open(page: Page, scenario?: string) {
  await page.goto(scenario ? `/sandbox?scenario=${scenario}` : "/sandbox");
  await expect(page.getByRole("heading", { name: /Pay for an answer\. Check the receipt yourself\./ })).toBeVisible({ timeout: 60_000 });
  // The send button is rendered by the server before React attaches to it, so a
  // click can land on a page that is not listening yet. The console marks itself
  // ready only after it has hydrated and loaded the provider key listing.
  await expect(page.getByTestId("sandbox-console")).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  await expect(page.getByTestId("sandbox-send")).toBeEnabled();
}

async function sendAndPay(page: Page) {
  await page.getByTestId("sandbox-send").click();
  await expect(page.getByTestId("sandbox-challenge")).toBeVisible();
  await page.getByTestId("sandbox-pay").click();
  await expect(page.getByTestId("sandbox-verification")).toHaveAttribute("data-ok", "true");
}

test.describe("/sandbox", () => {
  // The dev server compiles each route on first use. Doing that here keeps the
  // first compile of the page and its two endpoints out of the timed steps.
  test.beforeAll(async ({ request }) => {
    await request.get("/sandbox", { timeout: 60_000 });
    await request.get("/api/sandbox/v1/models", { timeout: 60_000 });
    await request.post("/api/sandbox/v1/chat/completions", { data: { model: "sandbox/swift-coder-small", messages: [{ role: "user", content: "warm up" }] }, timeout: 60_000 });
  });

  // If a step fails, say what the page did: a reload or a script error explains
  // a missing element better than the missing element does.
  test.beforeEach(async ({ page }, testInfo) => {
    const events: string[] = [];
    page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) events.push(`navigated ${frame.url()}`); });
    page.on("pageerror", (error) => events.push(`pageerror ${error.message}`));
    page.on("console", (message) => { if (message.type() === "error" || /reload|refresh/i.test(message.text())) events.push(`console.${message.type()} ${message.text().slice(0, 300)}`); });
    (testInfo as unknown as { sandboxEvents: string[] }).sandboxEvents = events;
  });
  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      console.log(`[sandbox.spec] page events for "${testInfo.title}":\n${(testInfo as unknown as { sandboxEvents: string[] }).sandboxEvents.join("\n")}`);
    }
  });

  test("states its limits before anything is run", async ({ page }) => {
    await open(page);
    const boundary = page.getByTestId("sandbox-boundary");
    await expect(boundary).toContainText("Solana devnet only.");
    await expect(boundary).toContainText("Answers come from a script, not a running model");
    await expect(boundary).toContainText("It does not prove which model ran.");
    await expectCopyInsideClaimBoundary(page);
  });

  test("buy a review: challenge, simulated payment, verified receipt, reputation", async ({ page }) => {
    await open(page);
    await page.getByTestId("sandbox-send").click();
    const challenge = page.getByTestId("sandbox-challenge");
    // Atlas Review: 31 input tokens plus up to 5,000 output tokens at $5 / $25 per million, paid in devnet SOL at the demo rate.
    await expect(challenge).toContainText("0.000834367 SOL");
    await expect(challenge).toContainText("0.125155 USDC · 0.193991 AUDD");
    await expect(page.getByTestId("sandbox-price-atlas-review")).toContainText("$5.00 in, $25.00 out");
    await expect(page.getByTestId("sandbox-max-atlas-review")).toContainText("0.125155 USDC · 0.193991 AUDD · 0.000834367 SOL");
    await expect(page.getByTestId("sandbox-typical-atlas-review")).toContainText("0.0975 USDC");
    await expect(challenge).toContainText("solana-devnet");
    await expect(page.getByTestId("sandbox-receipt-count")).toHaveText("0");

    await page.getByTestId("sandbox-pay").click();
    await expect(page.getByTestId("sandbox-verification")).toHaveAttribute("data-ok", "true");
    for (const check of ["shape", "request-hash", "response-hash", "provider-key", "signature"]) {
      await expect(page.getByTestId(`sandbox-check-${check}`)).toHaveAttribute("data-passed", "true");
    }
    const receipt = page.getByTestId("sandbox-receipt");
    await expect(receipt).toContainText("Atlas Review (");
    await expect(receipt).toContainText("sandbox test key");
    await expect(receipt).toContainText("Sandbox simulated receipt. Not a reddi.receipt.v2 receipt");
    await expect(receipt).toContainText("sandbox/atlas-coder-large");
    await expect(receipt).toContainText("simulated, no transaction");
    // Settled at the tokens used: 31 in, 92 out = 16,367 lamports; 2.5% fee rounded down = 409; the rest of the maximum comes back.
    await expect(receipt).toContainText("31 in, 92 out");
    await expect(receipt).toContainText("(16367 lamports)");
    await expect(receipt).toContainText("Protocol fee 2.5%");
    await expect(receipt).toContainText("(409 lamports), to the protocol treasury");
    await expect(receipt).toContainText("(15958 lamports)");
    await expect(receipt).toContainText("(818000 lamports)");
    await expect(page.getByTestId("sandbox-answer")).toHaveValue(/Three issues before this ships\./);
    await expect(page.getByTestId("sandbox-receipt-count")).toHaveText("1");
    await expect(page.getByTestId("sandbox-reputation-change")).toContainText("★ 4.80 → ★ 4.80");
    await expect(page.getByTestId("sandbox-wire")).toContainText("x402-payment");
    await expectCopyInsideClaimBoundary(page);
  });

  test("an edited answer fails the receipt check, and the original passes again", async ({ page }) => {
    await open(page);
    await sendAndPay(page);
    await page.getByTestId("sandbox-tamper").click();
    await expect(page.getByTestId("sandbox-verification")).toHaveAttribute("data-ok", "false");
    await expect(page.getByTestId("sandbox-check-response-hash")).toHaveAttribute("data-passed", "false");
    await expect(page.getByTestId("sandbox-check-signature")).toHaveAttribute("data-passed", "true");
    await page.getByTestId("sandbox-restore").click();
    await expect(page.getByTestId("sandbox-verification")).toHaveAttribute("data-ok", "true");

    await page.getByTestId("sandbox-answer").fill("Looks good to me.");
    await expect(page.getByTestId("sandbox-verification")).toHaveAttribute("data-ok", "false");
  });

  test("try to cheat: underpaying, paying the wrong wallet and reusing a payment are each refused", async ({ page }) => {
    await open(page, "try-to-cheat");
    await expect(page.getByTestId("sandbox-scenario-try-to-cheat")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("sandbox-send").click();
    await expect(page.getByTestId("sandbox-challenge")).toBeVisible();

    await page.getByTestId("sandbox-underpay").click();
    await expect(page.getByTestId("sandbox-notice")).toContainText("wrong_amount");
    await page.getByTestId("sandbox-wrong-payee").click();
    await expect(page.getByTestId("sandbox-notice")).toContainText("wrong_payee");
    await expect(page.getByTestId("sandbox-receipt-count")).toHaveText("0");

    // The refused attempts did not use up the challenge: an honest payment still settles it.
    await page.getByTestId("sandbox-pay").click();
    await expect(page.getByTestId("sandbox-verification")).toHaveAttribute("data-ok", "true");

    await page.getByTestId("sandbox-reuse").click();
    const notice = page.getByTestId("sandbox-notice");
    await expect(notice).toHaveAttribute("data-tone", "good");
    await expect(notice).toContainText("Refused with 409");
    await expect(page.getByTestId("sandbox-receipt-count")).toHaveText("1");
    // Per-token costs are a few thousand lamports: the total must not round to zero.
    await expect(page.getByTestId("sandbox-spent")).toHaveText(/^[1-9][\d,]*lamports/);
    await expect(page.getByTestId("sandbox-spent-tri")).toContainText("USDC");
    await expectCopyInsideClaimBoundary(page);
  });

  test("shop around: the provider that fails the spot check loses reputation", async ({ page }) => {
    await open(page, "shop-around");
    await page.getByTestId("sandbox-provider-bargain-models").click();
    await expect(page.getByTestId("sandbox-reputation-bargain-models")).toContainText("3.20 from 18 receipts");
    await sendAndPay(page);
    await expect(page.getByTestId("sandbox-receipt")).toContainText("sandbox/bargain-general-small");
    const change = page.getByTestId("sandbox-reputation-change");
    await expect(change).toContainText("★ 3.20 → ★ 3.08");
    await expect(change).toContainText("fell");
    await expect(page.getByTestId("sandbox-reputation-bargain-models")).toContainText("3.08 from 19 receipts");

    await page.getByTestId("sandbox-provider-swift-infer").click();
    await sendAndPay(page);
    await expect(page.getByTestId("sandbox-reputation-change")).toContainText("★ 4.10 → ★ 4.12");
    await expect(page.getByTestId("sandbox-receipt-count")).toHaveText("2");
  });

  test("set a budget: one $5 USDC Budget, three providers, receipts, close, 24 h window, the rest back", async ({ page }) => {
    await page.goto("/sandbox?scenario=budget");
    await expect(page.getByTestId("sandbox-console")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
    await expect(page.getByTestId("sandbox-scenario-budget")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("sandbox-budget-lock").click();
    await expect(page.getByTestId("sandbox-budget-total")).toHaveText("5 USDC");
    await expect(page.getByTestId("sandbox-budget-key")).toContainText("rap_pass_");
    await expect(page.getByTestId("sandbox-budget-work")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("sandbox-budget-work").click();
    await expect(page.getByTestId("sandbox-budget-close")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("sandbox-budget-events")).toContainText("Booth Match takes SOL only, so it can't join a USDC Budget.");
    await expect(page.getByTestId("sandbox-budget-featured")).toContainText("Splice by film.fun");
    await expect(page.getByTestId("sandbox-budget-receipts").locator("tbody tr")).toHaveCount(6);
    await page.getByTestId("sandbox-budget-close").click();
    await expect(page.getByTestId("sandbox-budget-window")).toContainText("Dispute window", { timeout: 15_000 });
    await page.getByTestId("sandbox-budget-skip").click();
    await expect(page.getByTestId("sandbox-budget-settled")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("sandbox-budget-payouts").locator("tbody tr")).toHaveCount(4);
    await expect(page.getByTestId("sandbox-budget-spent")).toContainText("2.210409 USDC across 6 calls to 3 providers");
    await expect(page.getByTestId("sandbox-budget-fee")).toContainText("2.5%");
    await expect(page.getByTestId("sandbox-budget-returned")).toContainText("2.789591 USDC of 5 USDC");
    await expect(page.getByTestId("sandbox-budget-invariant")).toContainText("✓");
    const download = page.waitForEvent("download");
    await page.getByTestId("sandbox-budget-download").click();
    expect((await download).suggestedFilename()).toBe("rap-sandbox-budget-receipts.json");
    await expectCopyInsideClaimBoundary(page);
  });

  test("set a budget, verify a Solana program: two Aristotle runs billed by credits", async ({ page }) => {
    await page.goto("/sandbox?scenario=budget");
    await expect(page.getByTestId("sandbox-console")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
    await page.getByTestId("sandbox-budget-job-verify").click();
    await expect(page.getByTestId("sandbox-budget-featured-aristotle")).toContainText("Aristotle by Harmonic");
    await expect(page.getByTestId("sandbox-budget-featured")).toContainText("illustrative");
    await page.getByTestId("sandbox-budget-lock").click();
    await expect(page.getByTestId("sandbox-budget-total")).toHaveText("200 USDC");
    await expect(page.getByTestId("sandbox-budget-work")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("sandbox-budget-work").click();
    await expect(page.getByTestId("sandbox-budget-close")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("sandbox-budget-receipts").locator("tbody tr")).toHaveCount(2);
    await expect(page.getByTestId("sandbox-budget-receipts")).toContainText("1 run, 40 credits");
    await page.getByTestId("sandbox-budget-close").click();
    await expect(page.getByTestId("sandbox-budget-skip")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("sandbox-budget-skip").click();
    await expect(page.getByTestId("sandbox-budget-settled")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("sandbox-budget-spent")).toContainText("65 USDC across 2 calls to 1 provider");
    await expect(page.getByTestId("sandbox-budget-returned")).toContainText("135 USDC of 200 USDC");
    await expect(page.getByTestId("sandbox-budget-invariant")).toContainText("✓");
    await expectCopyInsideClaimBoundary(page);
  });

  test("run a session: ten calls on one lock, each receipt checked, one settle", async ({ page }) => {
    await page.goto("/sandbox?scenario=run-a-session");
    await expect(page.getByTestId("sandbox-console")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
    await page.getByTestId("sandbox-session-run").click();
    await expect(page.getByTestId("sandbox-session-settled")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-testid^=sandbox-session-call-]")).toHaveCount(10);
    await expect(page.getByTestId("sandbox-session-call-10")).toContainText("matches your count");
    await expect(page.getByTestId("sandbox-session-network")).toContainText("2 (one lock, one settle) instead of 20");
    await expect(page.getByTestId("sandbox-session-fee-share")).toContainText("about 11.2%");
    await expect(page.getByTestId("sandbox-session-error")).toHaveCount(0);
    // The sidebar counts the session: ten call receipts plus the closing one, and the settled total as spent.
    const settled = await page.getByTestId("sandbox-session-settled").textContent();
    const total = Number(/Settled once: ([\d,]+) lamports/.exec(settled ?? "")?.[1]?.replace(/,/g, ""));
    expect(total).toBeGreaterThan(0);
    await expect(page.getByTestId("sandbox-receipt-count")).toHaveText("11");
    await expect(page.getByTestId("sandbox-spent")).toHaveText(new RegExp(`^${total.toLocaleString("en-AU")}lamports`));
    await expectCopyInsideClaimBoundary(page);
  });

  test("make a video: five independent studios, each paid and receipted, then rated", async ({ page }) => {
    await page.goto("/sandbox?scenario=make-a-video");
    await expect(page.getByTestId("sandbox-console")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
    await expect(page.locator("[data-testid^=sandbox-studio-max-]")).toHaveCount(5);
    await expect(page.getByTestId("sandbox-studio-frame-foundry")).toContainText("Stays private");
    await expect(page.getByTestId("sandbox-studio-max-frame-foundry")).toContainText(/USDC · .* AUDD · .* SOL/);
    await page.getByTestId("sandbox-pipeline-run").click();
    await expect(page.getByTestId("sandbox-pipeline-done")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-testid^=sandbox-pipeline-step-]")).toHaveCount(5);
    await expect(page.getByTestId("sandbox-pipeline-step-5")).toContainText("fee checks");
    await expect(page.getByTestId("sandbox-pipeline-fee")).toContainText("2.5%");
    await expect(page.getByTestId("sandbox-pipeline-error")).toHaveCount(0);
    await expect(page.getByTestId("sandbox-receipt-count")).toHaveText("5");
    await page.getByTestId("sandbox-pipeline-star-tidepool-audio-3").click();
    await page.getByTestId("sandbox-pipeline-rate").click();
    await expect(page.getByTestId("sandbox-pipeline-rated-frame-foundry")).toContainText("★ 4.70 → ★ 4.70");
    await expect(page.getByTestId("sandbox-pipeline-rated-tidepool-audio")).toContainText("★ 4.60 → ★ 4.56");
    await expectCopyInsideClaimBoundary(page);
  });

  test("help us write better: two paid calls build a writing skill, then hand it to your agent", async ({ page }) => {
    await page.goto("/sandbox?scenario=write-better");
    await expect(page.getByTestId("sandbox-console")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
    await expect(page.locator("[data-testid^=sandbox-writing-max-]")).toHaveCount(2);
    await expect(page.getByTestId("sandbox-writing-price-reddi-writing-style")).toContainText("per million tokens");
    await page.getByTestId("sandbox-writing-style-academic").click();
    await page.getByTestId("sandbox-writing-jargon-eli5").click();
    await page.getByTestId("sandbox-writing-words-40").click();
    await page.getByTestId("sandbox-writing-run").click();
    await expect(page.getByTestId("sandbox-writing-done")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-testid^=sandbox-writing-step-]")).toHaveCount(2);
    await expect(page.getByTestId("sandbox-writing-step-2")).toContainText("fee check");
    await expect(page.getByTestId("sandbox-writing-error")).toHaveCount(0);
    await expect(page.getByTestId("sandbox-writing-skill")).toContainText("name: write-like-me-academic-eli5-40");
    await expect(page.getByTestId("sandbox-writing-skill")).toContainText("Sound like a person");
    await expect(page.getByTestId("sandbox-writing-rewrite")).toContainText("This weekend");
    const words = Number((await page.getByTestId("sandbox-writing-after-count").textContent())!.match(/(\d+) words/)![1]);
    expect(words).toBeLessThanOrEqual(40);
    await expect(page.getByTestId("sandbox-writing-fee")).toContainText("2.5%");
    await expect(page.getByTestId("sandbox-receipt-count")).toHaveText("2");
    const download = page.waitForEvent("download");
    await page.getByTestId("sandbox-writing-download").click();
    expect((await download).suggestedFilename()).toBe("write-like-me-academic-eli5-40.md");
    await expect(page.getByTestId("sandbox-writing-agent-setup")).toHaveAttribute("href", "/agent-setup");
    await expectCopyInsideClaimBoundary(page);
  });

  test("provider goes dark: no challenge, no payment, no receipt", async ({ page }) => {
    await open(page, "provider-offline");
    await page.getByTestId("sandbox-send").click();
    const notice = page.getByTestId("sandbox-notice");
    await expect(notice).toContainText("You paid nothing.");
    await expect(page.getByTestId("sandbox-challenge")).toHaveCount(0);
    await expect(page.getByTestId("sandbox-pay")).toHaveCount(0);
    await expect(page.getByTestId("sandbox-receipt-count")).toHaveText("0");

    await page.getByTestId("sandbox-provider-swift-infer").click();
    await sendAndPay(page);
    await expect(page.getByTestId("sandbox-receipt-count")).toHaveText("1");
    await expectCopyInsideClaimBoundary(page);
  });

  test.describe("wallet lane guards (mock wallet, stubbed devnet RPC)", () => {
    const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
    const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

    /** Answers the browser's devnet JSON-RPC calls locally and records which methods were asked. */
    async function stubDevnetRpc(page: Page, answers: { genesis: string; lamports: number }) {
      const methods: string[] = [];
      await page.route("https://api.devnet.solana.com/**", async (route) => {
        const call = route.request().postDataJSON() as { id: unknown; method: string };
        methods.push(call.method);
        const result =
          call.method === "getGenesisHash" ? answers.genesis
          : call.method === "getBalance" ? { context: { slot: 1 }, value: answers.lamports }
          : null;
        await route.fulfill({ status: result === null ? 500 : 200, contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: call.id, result }) });
      });
      return methods;
    }

    async function reachWalletPayment(page: Page) {
      await enableMockWallet(page);
      await open(page);
      await connectMockWallet(page);
      await page.getByTestId("sandbox-send").click();
      await expect(page.getByTestId("sandbox-challenge")).toBeVisible();
      await page.getByTestId("sandbox-mode-wallet").click();
      await expect(page.getByTestId("sandbox-pay-wallet")).toBeEnabled();
    }

    test("refuses to build a transfer when the RPC endpoint is not devnet", async ({ page }) => {
      const methods = await stubDevnetRpc(page, { genesis: MAINNET_GENESIS, lamports: 5_000_000_000 });
      await reachWalletPayment(page);
      await page.getByTestId("sandbox-pay-wallet").click();
      await expect(page.getByTestId("sandbox-notice")).toContainText("Not connected to devnet");
      expect(methods).toEqual(["getGenesisHash"]);
      await expect(page.getByTestId("sandbox-receipt-count")).toHaveText("0");
    });

    test("points a wallet without test SOL at the faucet instead of asking it to sign", async ({ page }) => {
      const methods = await stubDevnetRpc(page, { genesis: DEVNET_GENESIS, lamports: 1_000 });
      await reachWalletPayment(page);
      await page.getByTestId("sandbox-pay-wallet").click();
      const notice = page.getByTestId("sandbox-notice");
      await expect(notice).toContainText("This wallet needs devnet SOL");
      await expect(notice).toContainText("faucet.solana.com");
      expect(methods).toEqual(["getGenesisHash", "getBalance"]);
      await expect(page.getByTestId("sandbox-receipt-count")).toHaveText("0");
      await expectCopyInsideClaimBoundary(page);
    });
  });
});
