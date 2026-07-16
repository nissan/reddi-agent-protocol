import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * #382 — ARD/open-agent candidate detail UI.
 *
 * Covers: deep-linkable detail route reachable from the #381 candidate cards,
 * full six-lane #577 actionability matrix rendering, lifecycle separation
 * (discovered / RAP-wrapped / attested / payment-ready / hireable), honest
 * "unavailable" rendering for absent fields, fail-closed blocked/malformed/
 * unknown/unavailable states with recovery actions, back-link composition
 * with the #381 facet state, keyboard/focus operability, and the
 * discovery-not-trust boundary (no live-action affordance on the detail view).
 */

test.describe.configure({ timeout: 60_000 });

type CandidateIds = {
  ard: string;
  ardBlocked: string;
  hosted: string;
  hostedBlocked: string;
};

async function fetchCandidateIds(request: APIRequestContext): Promise<CandidateIds> {
  const res = await request.get("/api/discovery/candidates");
  expect(res.ok()).toBe(true);
  const data = await res.json();
  const cards: Array<{ id: string; sourceFacet: string; renderState: string }> = data.result.cards;
  const find = (predicate: (card: (typeof cards)[number]) => boolean) => {
    const card = cards.find(predicate);
    expect(card, "expected fixture-backed candidate to exist").toBeDefined();
    return card!.id;
  };
  return {
    ard: find((card) => card.sourceFacet === "ard-catalog" && card.renderState === "ard-imported"),
    ardBlocked: find((card) => card.sourceFacet === "ard-catalog" && card.renderState === "blocked"),
    hosted: find((card) => card.sourceFacet === "hosted-rap" && card.renderState === "untrusted"),
    hostedBlocked: find((card) => card.id.startsWith("hosted-rap:blocked:")),
  };
}

function detailUrl(id: string, query = "") {
  return `/agents/candidates/${encodeURIComponent(id)}${query}`;
}

async function gotoDetail(page: Page, id: string, query = "") {
  await page.goto(detailUrl(id, query));
  // Same dev-only Suspense hydration quirk as /agents: poll until the tree
  // settles to exactly one detail container (agents-source-facets.spec.ts).
  await expect
    .poll(
      async () =>
        page
          .locator('[data-testid="candidate-detail"], [data-testid="candidate-detail-unavailable"], [data-testid="candidate-detail-error"]')
          .count(),
      { timeout: 30_000 },
    )
    .toBe(1);
}

test.describe("/agents/candidates/[id] (#382)", () => {
  test("candidate cards link to the deep-linkable detail route with facet state preserved", async ({ page }) => {
    await page.goto("/agents?source=ard-catalog");
    await expect
      .poll(async () => page.getByTestId("source-facet-filter").count(), { timeout: 30_000 })
      .toBe(1);
    const link = page.getByTestId("candidate-detail-link").first();
    await expect(link).toBeVisible({ timeout: 20_000 });
    await expect(link).toHaveAttribute("href", /^\/agents\/candidates\/.+\?source=ard-catalog$/);
    await link.click();
    await expect(page).toHaveURL(/\/agents\/candidates\/.+\?source=ard-catalog/);
    await expect(page.getByTestId("candidate-detail")).toBeVisible({ timeout: 30_000 });
  });

  test("renders the full six-lane actionability matrix and lifecycle for an ARD-imported candidate", async ({ page, request }) => {
    const ids = await fetchCandidateIds(request);
    await gotoDetail(page, ids.ard);

    const detail = page.getByTestId("candidate-detail");
    await expect(detail).toHaveAttribute("data-render-state", "ard-imported");
    await expect(page.getByTestId("candidate-detail-banner")).toContainText(/imported snapshot/i);

    // Full six-lane matrix — every #577 lane rendered as a row, not a badge.
    await expect(page.getByTestId("candidate-detail-matrix")).toBeVisible();
    for (const lane of [
      "source_provenance",
      "identity_evidence",
      "payment_readiness",
      "reputation_evidence",
      "policy_fit",
      "actionability",
    ]) {
      await expect(page.getByTestId(`matrix-lane-${lane}`)).toBeVisible();
    }

    // Lifecycle stages are separated and never blended: only "discovered" is reached.
    await expect(page.getByTestId("lifecycle-stage-discovered")).toHaveAttribute("data-reached", "true");
    for (const stage of ["rap_wrapped", "attested", "payment_ready", "hireable"]) {
      await expect(page.getByTestId(`lifecycle-stage-${stage}`)).toHaveAttribute("data-reached", "false");
    }

    // Provenance, capability, evidence, and boundary blocks are all present.
    await expect(page.getByTestId("candidate-detail-section-provenance")).toBeVisible();
    await expect(page.getByTestId("candidate-detail-capabilities")).toBeVisible();
    await expect(page.getByTestId("candidate-detail-evidence")).toBeVisible();
    await expect(page.getByTestId("candidate-detail-boundary-note")).toContainText(/DISCOVER-DECIDE-PROVE-BOUNDARIES\.md/);
  });

  test("hosted catalog detail renders untrusted state with honest unavailable fields", async ({ page, request }) => {
    const ids = await fetchCandidateIds(request);
    await gotoDetail(page, ids.hosted);

    const detail = page.getByTestId("candidate-detail");
    await expect(detail).toHaveAttribute("data-render-state", "untrusted");
    await expect(page.getByTestId("candidate-detail-trust-badge")).toBeVisible();
    await expect(page.getByTestId("candidate-detail-readiness-badge")).toHaveText(/live-gated/i);

    // Hosted listings expose no endpoint URL or trust manifest — the fields
    // render "unavailable" instead of being invented.
    await expect(page.getByTestId("detail-field-endpoint-url")).toContainText(/unavailable/i);
    await expect(page.getByTestId("detail-field-manifest")).toContainText(/unavailable/i);
    await expect(page.getByTestId("detail-field-payment-activation")).toContainText(/disabled/i);
    await expect(page.getByTestId("candidate-detail-matrix")).toBeVisible();
  });

  test("blocked/malformed candidates render fail-closed with recovery actions", async ({ page, request }) => {
    const ids = await fetchCandidateIds(request);

    // ARD malformed/rejected fixture: matrix still derivable, lanes blocked.
    await gotoDetail(page, ids.ardBlocked);
    await expect(page.getByTestId("candidate-detail")).toHaveAttribute("data-render-state", "blocked");
    await expect(page.getByTestId("candidate-detail-banner")).toContainText(/blocked/i);
    await expect(page.getByTestId("candidate-detail-findings")).toBeVisible();
    await expect(page.getByTestId("candidate-detail-recovery")).toBeVisible();
    await expect(page.getByTestId("candidate-detail-matrix")).toBeVisible();

    // Hosted blocked export record: no matrix is derivable — say so honestly.
    await gotoDetail(page, ids.hostedBlocked);
    await expect(page.getByTestId("candidate-detail")).toHaveAttribute("data-render-state", "blocked");
    await expect(page.getByTestId("candidate-detail-matrix-unavailable")).toContainText(/export gating/i);
    await expect(page.getByTestId("candidate-detail-recovery")).toBeVisible();
  });

  test("back link composes with the #381 facet state from the deep link", async ({ page, request }) => {
    const ids = await fetchCandidateIds(request);
    await gotoDetail(page, ids.ard, "?source=ard-catalog,hosted-rap&task=code");

    const back = page.getByTestId("candidate-detail-back");
    await expect(back).toHaveAttribute("href", "/agents?source=ard-catalog%2Chosted-rap&task=code");
    await back.click();
    await expect(page).toHaveURL(/\/agents\?source=ard-catalog(,|%2C)hosted-rap&task=code/);
    await expect(page.getByTestId("source-facet-ard-catalog")).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
    await expect(page.getByTestId("source-facet-hosted-rap")).toHaveAttribute("aria-pressed", "true");
  });

  test("unknown, unsupported, and unavailable-source ids render honest fail-closed pages", async ({ page }) => {
    // Unknown candidate in an available source.
    await gotoDetail(page, "hosted-rap:does-not-exist");
    await expect(page.getByTestId("candidate-detail-unavailable")).toHaveAttribute("data-availability", "not_found");
    await expect(page.getByTestId("candidate-detail-recovery")).toBeVisible();
    await expect(page.getByTestId("candidate-detail-back-bottom")).toBeVisible();

    // Registry-native / malformed ids are not candidate detail ids.
    await gotoDetail(page, "rap-registry:SomeWallet");
    await expect(page.getByTestId("candidate-detail-unavailable")).toHaveAttribute("data-availability", "unsupported_id");

    // Source snapshot not ingested in this environment.
    await gotoDetail(page, "circle-x402:anything");
    await expect(page.getByTestId("candidate-detail-unavailable")).toHaveAttribute("data-availability", "source_unavailable");
    await expect(page.getByTestId("candidate-detail-unavailable")).toContainText(/not found|not ingested/i);
  });

  test("detail navigation is keyboard operable with visible focus", async ({ page, request }) => {
    const ids = await fetchCandidateIds(request);
    await gotoDetail(page, ids.ard, "?source=ard-catalog");

    const back = page.getByTestId("candidate-detail-back");
    await back.focus();
    await expect(back).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/agents\?source=ard-catalog/);
    await expect
      .poll(async () => page.getByTestId("source-facet-filter").count(), { timeout: 30_000 })
      .toBe(1);

    // And the card's detail link (the entry point) is keyboard reachable too.
    const link = page.getByTestId("candidate-detail-link").first();
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/agents\/candidates\//);
  });

  test("detail view exposes no paid call, wallet, or invocation affordance", async ({ page, request }) => {
    const ids = await fetchCandidateIds(request);
    for (const id of [ids.ard, ids.hosted, ids.ardBlocked, ids.hostedBlocked]) {
      await gotoDetail(page, id);
      const detail = page.getByTestId("candidate-detail");

      // Zero buttons — the detail view is read-only; its only interactive
      // elements are internal navigation links.
      expect(await detail.locator("button").count()).toBe(0);
      const anchors = detail.locator("a");
      const anchorCount = await anchors.count();
      for (let a = 0; a < anchorCount; a += 1) {
        expect(await anchors.nth(a).getAttribute("href")).toMatch(/^\/agents/);
      }
      // "\bpublish\b" (not bare "publish") so the "Identity & publisher"
      // section heading doesn't false-positive.
      await expect(detail).not.toContainText(/hire now|pay now|invoke\b|call endpoint|connect wallet|\bpublish\b/i);
    }
  });
});
