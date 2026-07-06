# #498 Buyer Paid-Workflow Route Shell Evidence

Captured on 2026-07-06 for issue #498.

## Scope

This evidence covers the new no-spend buyer paid-workflow route shell at
`/economic-demo/paid-workflow` (`app/economic-demo/paid-workflow/page.tsx`), rendered from
`lib/economic-demo/buyer-paid-workflow-route-model.ts` — a thin adapter that maps the #497 route
state contract (`docs/PAID-WORKFLOW-ROUTE-STATE-CONTRACT.md`) onto the existing surfaces:
the #457 paid-workflow proof UI fixture pack, the #417 public proof page data contract, the
#564/#582 x402 reference workflow rehearsal (recorded-devnet metadata + live gate), and the #587
Airwallex hosted-checkout rail support-state matrix. No new proof shape is introduced.

The route renders quote, budget summary, an execution/timeline placeholder (deferred to #499),
result summary, receipt/proof summary (refs/hashes only), evidence refs, attestation/reputation
previews, and the fail-closed boundary states: empty contract, blocked rail-neutral cases
(unsupported network, unsupported asset/network, malformed receipt, policy denied, the #588
Airwallex webhook probe-only cap, live-path overclaim), unsupported second-rail support states,
live-gated-only, and production-disabled. All sixteen #497 boundary flags render as `false`.

## Captures

- `mobile-390.png` — 390 px mobile viewport, full page.
- `tablet-820.png` — 820 px tablet viewport, full page.
- `desktop-1440.png` — 1440 px desktop viewport, full page.
- `buyer-workflow-flow.webm` — desktop scroll-through covering copy modes → quote → budget →
  timeline placeholder → result → receipt → evidence → boundary states (including the probe-only
  cap card) → unsupported rail → recorded devnet → live gate → production disabled → boundary
  flags → copy boundaries.

A Playwright trace was not committed: trace finalization hangs indefinitely in this environment
when running through the installed Chrome channel (`PLAYWRIGHT_BROWSER_CHANNEL=chrome`), as
documented in `docs/evidence/506/README.md`. Issue #498 accepts "video or Playwright trace"; the
video above is the committed artifact, per the #506 precedent.

Screenshots are captured by `e2e/economic-demo-paid-workflow.spec.ts` into
`test-results/evidence-498/` and copied here after the run. Writing them into `docs/` mid-run
triggers the webpack dev watcher and the next navigation races the invalidation
("Unexpected end of JSON input" dev overlay), which is also why the pre-existing
`e2e/economic-demo-public-proof.spec.ts` (which writes into `artifacts/` mid-run) can fail a
subsequent spec's first navigation when specs are chained in one dev-server session.

## Validation

Commands run:

```bash
npx jest lib/__tests__/economic-demo-buyer-paid-workflow-route-model.test.ts \
  lib/__tests__/economic-demo-paid-workflow-proof-ui-fixtures.test.ts \
  lib/__tests__/economic-demo-public-proof-page-data.test.ts \
  lib/__tests__/economic-demo-x402-reference-workflow-rehearsal.test.ts
npx eslint app/economic-demo/paid-workflow/page.tsx lib/economic-demo/buyer-paid-workflow-route-model.ts <touched tests>
npx tsc --noEmit   # no errors in touched files; pre-existing repo error count unchanged
PLAYWRIGHT_BROWSER_CHANNEL=chrome npx playwright test e2e/economic-demo-paid-workflow.spec.ts
PLAYWRIGHT_BROWSER_CHANNEL=chrome npx playwright test e2e/economic-demo-public-proof.spec.ts
PLAYWRIGHT_BROWSER_CHANNEL=chrome npx playwright test e2e/economic-demo.spec.ts
npm run check:rap:naming
npm run build
git diff --check
```

## Boundaries

No wallet signing, RPC call, provider call, paid request, Pay.sh setup or activation, hosted
registry write, marketplace publication, or trust/reputation mutation occurred during capture or
is reachable from the route. All data is deterministic fixture/dry-run/recorded-rehearsal
metadata; the route exposes no run button, no auto-pay path, and no mutation affordance, and it
fails closed on empty, malformed, drifted, or unsupported input.
