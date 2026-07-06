# #506 Discovery Actionability Matrix Evidence

Captured on 2026-07-06 for issue #506.

## Scope

This evidence covers the `/manager/discovery` candidate detail surface, which now renders the
discovery actionability state matrix derived by `lib/manager/discovery-actionability-matrix.ts`.
The matrix shows six separated lanes — source provenance, identity evidence, payment readiness,
reputation/evidence, policy fit, and actionability/hireability — with explicit per-lane states
(unavailable, self-asserted, claimed, verified, failed verification, blocked, needs human review,
dry-run ready, live-gated, production-disabled) so ARD discovery relevance is never blended into
or mistaken for RAP trust or authorization.

## Captures

- `mobile-375.png` — 375 px mobile viewport, full page.
- `tablet-768.png` — 768 px tablet viewport, full page.
- `desktop-1280.png` — 1280 px desktop viewport, full page.
- `actionability-matrix-interaction.webm` — desktop interaction video covering filter changes
  (Rejected → Suspended), per-candidate lane-state changes (failed verification / blocked /
  production-disabled), and the always-disabled placeholder action grid.

A Playwright trace was attempted (`--trace on`) but trace finalization hangs indefinitely in this
environment when running through the installed Chrome channel (`PLAYWRIGHT_BROWSER_CHANNEL=chrome`,
used because the managed Chromium headless-shell download is unavailable here — same limitation
documented in `docs/evidence/539-seller-wrapper-ui/README.md`). Issue #506 accepts "video or
Playwright trace"; the interaction video above is the committed artifact.

## Validation

Commands run:

```bash
npx jest lib/__tests__/manager-discovery-actionability-matrix.test.ts
PLAYWRIGHT_BROWSER_CHANNEL=chrome npx playwright test e2e/manager-discovery-actionability.spec.ts
PLAYWRIGHT_BROWSER_CHANNEL=chrome npx playwright test e2e/manager-discovery.spec.ts
npm run check:rap:naming
npm run build
git diff --check
```

## Boundaries

No publication, payment, endpoint invocation, wallet signing, RPC call, MCP contact, repository
fetch, hosted registry mutation, or trust/reputation mutation occurred during capture. All data is
fixture-backed; the rendered controls remain read-only placeholders.
