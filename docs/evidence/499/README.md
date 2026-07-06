# #499 Paid-Workflow Ledger + Execution Timeline Evidence

Captured on 2026-07-06 for issue #499 (extends the #498 route shell).

## Scope

This evidence covers the paid-workflow budget ledger and execution timeline added to
`/economic-demo/paid-workflow` (`app/economic-demo/paid-workflow/page.tsx`), rendered from the
extended `lib/economic-demo/buyer-paid-workflow-route-model.ts`
(`reddi.economic-demo.buyer-paid-workflow-route-model.v1`). The #498 execution/timeline
placeholder is replaced; no new proof shape is introduced.

Ledger rows (every row traced to a fixture/read-model ref or explicitly marked
unavailable/blocked; untraceable rows fail the whole model closed):

- Buyer budget, per-specialist reserved budgets, attestor/proof budget, orchestrator fee/margin,
  protocol rail fee (bps), and swap allowance — from the `economicDemoScenarios` webpage
  `budgetLedger` fixture, reconciled in integer micro-USDC to the quote total (mismatch fails
  closed with `ledger_allocation_mismatch`).
- Spent-to-date and remaining — authoritative zeros from the #582/#564 rehearsal's real metering.
- Refund state — `no_charge_on_failure` / `manual_review_fixture_only` from the AUDD payment-plan
  preflight.
- Real settlement cost — explicitly **unavailable** (`real_devnet_receipt_verifier:
  not_implemented` proof layer from `ledger-reconciliation.ts`).
- Blocked-cases spend — explicitly **blocked**, 0 USDC, referencing all six fail-closed
  rail-neutral cases.

Timeline milestones (request, quote, policy decision, execution, result, receipt, evidence,
attestation preview, reputation preview): the seven workflow milestones come from the recorded
#582/#564 dry-run rehearsal steps and carry `devnet_proof_metadata` labels referencing
`docs/DEVNET-REFERENCE-RUN-564.md`; execution is `planned_no_live_execution` with the
zero-downstream-calls metering ref; previews are `preview_only`, and the reputation preview is
explicitly marked `no_public_ref_preview_only`.

Boundary states: all six blocked cases (unsupported network, unsupported asset/network, malformed
receipt, policy denied, #588 probe-only cap, live-path overclaim) render a spend-state line
holding spend/refund/mutation at zero/false, and the hard-boundary grid now shows the full #497
16-flag set (12 fixture-pack flags + production AUDD rail, default USDC auto-pay, mainnet
settlement, Pay.sh production activation), all false.

## Captures

- `mobile-390.png` — 390 px mobile viewport, full page.
- `tablet-820.png` — 820 px tablet viewport, full page.
- `desktop-1440.png` — 1440 px desktop viewport, full page.
- `buyer-ledger-timeline-flow.webm` — desktop scroll-through covering copy modes → quote →
  budget → **ledger** → **timeline** → result → receipt → evidence → boundary states (including
  the probe-only cap card) → unsupported rail → recorded devnet → live gate → production
  disabled → 16-flag boundary grid → copy boundaries.

A Playwright trace was not committed: trace finalization hangs indefinitely in this environment
when running through the installed Chrome channel (`PLAYWRIGHT_BROWSER_CHANNEL=chrome`), as
documented in `docs/evidence/506/README.md` and `docs/evidence/498/README.md`. Issue #499 accepts
"video or Playwright trace"; the video above is the committed artifact, per that precedent.

Screenshots are captured by `e2e/economic-demo-paid-workflow.spec.ts` into
`test-results/evidence-499/` and copied here after the run — writing into `docs/` mid-run
triggers the webpack dev-watcher invalidation race documented in `docs/evidence/498/README.md`.
Note that any subsequent `npx playwright test` invocation wipes `test-results/`, so the evidence
capture run must be the last Playwright run before copying.

## Validation

Commands run:

```bash
npx jest lib/__tests__/economic-demo-buyer-paid-workflow-route-model.test.ts \
  lib/__tests__/economic-demo-paid-workflow-proof-ui-fixtures.test.ts \
  lib/__tests__/economic-demo-public-proof-page-data.test.ts \
  lib/__tests__/economic-demo-x402-reference-workflow-rehearsal.test.ts \
  lib/__tests__/economic-demo-ledger-reconciliation.test.ts
npx eslint app/economic-demo/paid-workflow/page.tsx lib/economic-demo/buyer-paid-workflow-route-model.ts <touched tests/specs>
npx tsc --noEmit   # no errors in touched files; pre-existing repo error count unchanged (40 lines)
PLAYWRIGHT_BROWSER_CHANNEL=chrome npx playwright test e2e/economic-demo-paid-workflow.spec.ts   # 7/7
PLAYWRIGHT_BROWSER_CHANNEL=chrome npx playwright test e2e/economic-demo-public-proof.spec.ts    # 4/4
PLAYWRIGHT_BROWSER_CHANNEL=chrome npx playwright test e2e/economic-demo.spec.ts                 # 1/1
npm run check:rap:naming
npm run build
git diff --check
```

## Boundaries

No wallet signing, RPC call, provider call, paid request, Pay.sh setup or activation, hosted
registry write, marketplace publication, or trust/reputation mutation occurred during capture or
is reachable from the route. The ledger reports zero spend, zero refunds, and an explicitly
unavailable settlement cost; the timeline reports no live execution; blocked, unsupported,
malformed, policy-denied, live-path-overclaim, and production-disabled states all keep spending
and mutation flags false. The route still exposes zero buttons.
