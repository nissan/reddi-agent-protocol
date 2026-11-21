import { expect, test, type Page } from "@playwright/test";
import { Keypair, PublicKey } from "@solana/web3.js";

import { connectMockWallet, enableMockWallet } from "./helpers/wallet";
import { encodeAttestationAccount, encodeRatingAccount, type RatingFixture } from "../lib/rating/testing/fixtures";

/**
 * The app rating flow (#842) against mocked data: the pay-flow option, the job
 * rating panel read from a stubbed rating account, and a provider's on-chain
 * reputation from a stubbed registry listing. Nothing here signs or reaches a
 * cluster: every JSON-RPC call is answered locally.
 *
 * With RATING_SCREENSHOT_DIR set, each test also saves a screenshot there.
 */
test.describe.configure({ timeout: 90_000 });
test.use({ deviceScaleFactor: 2 });

const SCREENSHOT_DIR = process.env.RATING_SCREENSHOT_DIR;
// The mock wallet's default address (lib/wallet/playwright-wallet-adapter.ts).
const WALLET = new PublicKey("11111111111111111111111111111111");
const PROGRAM = new PublicKey("DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu");
const ESCROW = new PublicKey("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin");
const PROVIDER = new PublicKey("4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T");
const JUDGE = new PublicKey("HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH");
const CURRENT_SLOT = 400_000_000;
const OPENED = BigInt(CURRENT_SLOT - 20_000);
const SETTLED = OPENED + 10n;

async function shot(page: Page, name: string) {
  if (!SCREENSHOT_DIR) return;
  await page.screenshot({ path: `${SCREENSHOT_DIR.replace(/\/?$/, "/")}${name}.png`, fullPage: true });
}

function ratingPda(escrow: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("rating"), escrow.toBuffer()], PROGRAM)[0];
}
function attestationPda(escrow: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("attestation"), escrow.toBuffer()], PROGRAM)[0];
}

/** Answers the app's devnet JSON-RPC calls from the given accounts. */
async function stubRpc(page: Page, accounts: Map<string, Uint8Array>) {
  await page.route("https://api.devnet.solana.com/**", async (route) => {
    const body = route.request().postDataJSON() as { id: unknown; method: string; params?: unknown[] } | { id: unknown; method: string; params?: unknown[] }[];
    const answer = (call: { id: unknown; method: string; params?: unknown[] }) => {
      if (call.method === "getSlot") return { jsonrpc: "2.0", id: call.id, result: CURRENT_SLOT };
      if (call.method === "getAccountInfo") {
        const data = accounts.get(String(call.params?.[0]));
        const value = data ? { data: [Buffer.from(data).toString("base64"), "base64"], executable: false, lamports: 2_770_080, owner: PROGRAM.toBase58(), rentEpoch: 0, space: data.length } : null;
        return { jsonrpc: "2.0", id: call.id, result: { context: { slot: CURRENT_SLOT }, value } };
      }
      return { jsonrpc: "2.0", id: call.id, error: { code: -32601, message: "not stubbed" } };
    };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(Array.isArray(body) ? body.map(answer) : answer(body)) });
  });
}

async function seedRatedJob(page: Page) {
  await page.addInitScript(
    ({ wallet, escrow, programId, counterparty }) => {
      window.localStorage.setItem(`reddi.rated-jobs.v2.${wallet}`, JSON.stringify([{ version: 2, wallet, escrow, programId, counterparty, label: "Swift Infer: code review", openedAt: "2026-11-21T08:00:00.000Z" }]));
    },
    { wallet: WALLET.toBase58(), escrow: ESCROW.toBase58(), programId: PROGRAM.toBase58(), counterparty: PROVIDER.toBase58() },
  );
}

function ratingAccount(fixture: Partial<RatingFixture> & Pick<RatingFixture, "state">) {
  return encodeRatingAccount({ escrow: ESCROW, consumer: WALLET, specialist: PROVIDER, judge: JUDGE, openedSlot: OPENED, settledSlot: SETTLED, paid: 1_200_000n, ...fixture });
}

async function openRuns(page: Page) {
  await enableMockWallet(page);
  await seedRatedJob(page);
  await page.goto("/runs");
  await connectMockWallet(page);
  await expect(page.getByTestId("job-rating-panel")).toBeVisible({ timeout: 30_000 });
}

test.describe("app rating flow (#842)", () => {
  test("job panel, commit phase: hidden score, deadline, and the judge's pending attestation", async ({ page }) => {
    const accounts = new Map<string, Uint8Array>([
      [ratingPda(ESCROW).toBase58(), ratingAccount({ state: "open", attested: true, specialistCommitment: new Uint8Array(32).fill(4) })],
      [attestationPda(ESCROW).toBase58(), encodeAttestationAccount({ escrow: ESCROW, judge: JUDGE, consumer: WALLET, scores: [8, 7, 9, 6, 10], createdSlot: SETTLED + 5n, openedSlot: OPENED })],
    ]);
    await stubRpc(page, accounts);
    await openRuns(page);
    const panel = page.getByTestId("job-rating-panel");
    await expect(panel).toHaveAttribute("data-phase", "commit");
    await expect(page.getByTestId("rating-commit")).toBeVisible();
    await expect(page.getByTestId("rating-commit-button")).toBeVisible();
    await expect(page.getByTestId("rating-deadline")).toBeVisible();
    await expect(page.getByTestId("rating-attestation")).toBeVisible();
    await expect(page.getByTestId("attestation-confirm-button")).toBeVisible();
    await expect(page.getByTestId("attestation-dispute-button")).toBeVisible();
    await shot(page, "job-rating-panel-commit");
  });

  test("job panel, an attestation left from an earlier job at the address is not offered", async ({ page }) => {
    const accounts = new Map<string, Uint8Array>([
      [ratingPda(ESCROW).toBase58(), ratingAccount({ state: "open", attested: true })],
      [attestationPda(ESCROW).toBase58(), encodeAttestationAccount({ escrow: ESCROW, judge: JUDGE, consumer: WALLET, scores: [8, 7, 9, 6, 10], createdSlot: OPENED - 1n, openedSlot: OPENED - 10n })],
    ]);
    await stubRpc(page, accounts);
    await openRuns(page);
    await expect(page.getByTestId("job-rating-panel")).toHaveAttribute("data-phase", "commit");
    await expect(page.getByTestId("attestation-confirm-button")).toHaveCount(0);
  });

  test("job panel, before payment: the provider has not accepted, so a release would close the job unrated", async ({ page }) => {
    await stubRpc(page, new Map([[ratingPda(ESCROW).toBase58(), ratingAccount({ state: "awaiting_settlement", settledSlot: 0n, paid: 0n })]]));
    await openRuns(page);
    await expect(page.getByTestId("job-rating-panel")).toHaveAttribute("data-phase", "awaiting_payment");
    await expect(page.getByTestId("rating-accepted")).toBeVisible();
    await expect(page.getByTestId("rating-release-warning")).toBeVisible();
    await expect(page.getByTestId("rating-commit-button")).toHaveCount(0);
    await shot(page, "job-rating-panel-awaiting-payment");
  });

  test("job panel, revealed: final scores and the rent can be reclaimed", async ({ page }) => {
    await stubRpc(page, new Map([[ratingPda(ESCROW).toBase58(), ratingAccount({ state: "revealed", committedSlot: SETTLED + 50n, consumerCommitment: new Uint8Array(32).fill(3), specialistCommitment: new Uint8Array(32).fill(4), consumerScore: 9, specialistScore: 10 })]]));
    await openRuns(page);
    await expect(page.getByTestId("job-rating-panel")).toHaveAttribute("data-phase", "revealed");
    await expect(page.getByTestId("rating-final")).toBeVisible();
    await expect(page.getByTestId("rating-close-button")).toBeVisible();
    await shot(page, "job-rating-panel-revealed");
  });

  test("provider page: reputation from ratings on paid jobs, with what it means and does not mean", async ({ page }) => {
    const wallet = PROVIDER.toBase58();
    await page.route("**/api/registry", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          listings: [
            {
              pda: Keypair.generate().publicKey.toBase58(),
              walletAddress: wallet,
              onchain: { owner: wallet, agentType: "primary", model: "swift-coder-small", rateLamports: 0, minReputation: 0, reputationScore: 7_250, jobsCompleted: 14, jobsFailed: 1, attestationAccuracy: 0, createdAt: 0, active: true },
              capabilities: { taskTypes: ["code"], inputModes: ["text"], outputModes: ["text"], privacyModes: ["public"], tags: [], baseUsd: 0, perCallUsd: 0, context_requirements: [], runtime_capabilities: [] },
              health: { status: "pass", lastCheckedAt: "2026-11-21T08:00:00.000Z" },
              attestation: { attested: false },
              capabilityHash: null,
            },
          ],
        }),
      });
    });
    await page.goto(`/agents/${wallet}`);
    const summary = page.getByTestId("reputation-summary");
    await expect(summary).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("reputation-score")).toContainText("72.50");
    await expect(page.getByTestId("reputation-completed")).toHaveText("14");
    await expect(page.getByTestId("reputation-failed")).toHaveText("1");
    await expect(summary).toContainText("From ratings on paid jobs");
    await expect(page.getByTestId("reputation-meaning").getByRole("link", { name: "Ratings and attestations" })).toHaveAttribute("href", /docs\/RATINGS-AND-ATTESTATIONS\.md$/);
    await shot(page, "provider-reputation");
  });

  test("sandbox pay flow: the rate-this-job option, off by default, with its refundable rent", async ({ page }) => {
    await page.route("**/api/sandbox/v1/models", async (route) => {
      const response = await route.fetch();
      const listing = (await response.json()) as { data: { rap: { meteredEscrow?: Record<string, unknown> } }[] };
      for (const row of listing.data) row.rap.meteredEscrow = { ...row.rap.meteredEscrow, available: true, acceptsRatedEscrows: true };
      await route.fulfill({ response, json: listing });
    });
    await enableMockWallet(page);
    await page.goto("/sandbox");
    await expect(page.getByTestId("sandbox-console")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
    await connectMockWallet(page);
    await page.getByTestId("sandbox-send").click();
    await expect(page.getByTestId("sandbox-challenge")).toBeVisible();
    await page.getByTestId("sandbox-mode-wallet").click();
    const option = page.getByRole("checkbox", { name: /Rate this job/i });
    await expect(option).toBeVisible();
    await expect(option).not.toBeChecked();
    await option.check();
    await expect(page.getByText(/0\.00277/).first()).toBeVisible();
    await shot(page, "pay-flow-rate-this-job");
  });
});
