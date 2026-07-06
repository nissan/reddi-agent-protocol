# #501 Paid-Workflow UI Evidence Pack + Copy-Boundary Regression Gate

Captured on 2026-07-06 for issue #501 (final link of the #498 -> #499 -> #501 chain).

## Scope

This evidence covers two deliverables for the buyer paid-workflow route at
`/economic-demo/paid-workflow` (route selectors stable since #498/#499):

1. **UI evidence pack** — per-state screenshots (quote, ledger, timeline, result,
   receipt/evidence, blocked states) at mobile/tablet/desktop viewports plus a recorded video of
   the quote -> ledger -> timeline -> result -> receipt/evidence -> blocked flow.
2. **Copy-boundary regression gate** — a two-layer gate that prevents future changes from
   silently upgrading dry-run/devnet proof claims into live payment, custody, settlement, hosted
   publication, or reputation-mutation claims:
   - `scripts/check-paid-workflow-copy-boundaries.mjs` (npm: `check:copy:paid-workflow`) —
     deterministic, offline static scan of the rendered route-model fixtures (no browser). Wired
     into `.github/workflows/rap-package-guard.yml` as the `paid-workflow-copy-boundary-gate` job
     (gate run + negative-control run that must exit 1), alongside the #353 public-conformance
     runner and the #449 artifact guard. Registered in
     `docs/RAP-V0.1-RELEASE-CHECKLIST.md` §2.
   - `e2e/economic-demo-paid-workflow-copy-gate.spec.ts` — the same forbidden/required
     assertions against the rendered DOM.

Both layers import one shared term list,
`lib/economic-demo/paid-workflow-copy-boundary-terms.ts`, whose forbidden claims each cite an
exact anchor in `docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md` (#452, the fail-closed copy
authority). The gate script verifies every anchor still exists in that doc, so gate and doc
cannot drift apart silently.

Forbidden claim families (affirmative-overclaim patterns only — the route legitimately renders
these concepts negated, e.g. "no custody", "No mainnet settlement", the all-false 16-flag grid):
custody, settlement finality, production AUDD rail, default USDC auto-pay, Pay.sh production
activation, mainnet settlement, hosted registry writes, live trust/reputation mutation, plus the
Airwallex settlement and AP2 mandate-authority overclaim cases from the 2026-07-06 audit
refresh. Required labels asserted present: dry-run, no-spend, recorded-devnet, optional
fresh-devnet, live-gated, production-disabled. Structural checks: the full #497 16-flag
hard-boundary grid all-false, zero spend/refunds, all six blocked cases holding spend and
mutation at zero/false.

**Negative control:** every run self-tests all ten injection examples against a cloned model
(a scanner that stops catching its own injections fails the gate), and
`node scripts/check-paid-workflow-copy-boundaries.mjs --negative-control` injects a forbidden
phrase into the live model and exits 1 — CI runs both the clean gate and the negative control
(asserting failure) on every PR touching the paid-workflow surfaces.

## Captures

Per-state element screenshots at each viewport (`<viewport>-<width>-<state>.png`):

- States: `quote`, `ledger`, `timeline`, `result`, `receipt`, `evidence`, `blocked`
  (the receipt/evidence acceptance state is covered by the `receipt` + `evidence` pair;
  `blocked` is the boundary-states section containing all six fail-closed cases).
- Viewports: `mobile-390`, `tablet-820`, `desktop-1440`, plus a `-full.png` full-page capture
  per viewport for context.
- `buyer-workflow-copy-gate-flow.webm` — desktop scroll-through covering copy modes -> quote ->
  budget -> ledger -> timeline -> result -> receipt -> evidence -> boundary/blocked states
  (including the live-path-overclaim card) -> unsupported rail -> recorded devnet -> live gate ->
  production disabled -> 16-flag boundary grid -> copy boundaries.

A Playwright trace was not committed: trace finalization hangs indefinitely in this environment
under `PLAYWRIGHT_BROWSER_CHANNEL=chrome`, as documented in `docs/evidence/506/README.md` and
`docs/evidence/498/README.md`. Issue #501 accepts "trace or video"; the video above is the
committed artifact, per that precedent.

**Deterministic artifact path:** screenshots and video are captured by
`e2e/economic-demo-paid-workflow-evidence-501.spec.ts` into `test-results/evidence-501/` (and
Playwright's per-test video dirs) and copied to `docs/evidence/501/` after the run. Writing into
`docs/` mid-run races the webpack dev watcher (see `docs/evidence/498/README.md`), and any
subsequent `npx playwright test` invocation wipes `test-results/`, so the evidence capture run
must be the LAST Playwright invocation before copying (see `docs/evidence/499/README.md`).

## Validation

Commands run:

```bash
node scripts/check-paid-workflow-copy-boundaries.mjs                     # PASS (exit 0)
node scripts/check-paid-workflow-copy-boundaries.mjs --negative-control  # FAIL as required (exit 1)
npx jest lib/__tests__/economic-demo-buyer-paid-workflow-route-model.test.ts  # 16/16
npx eslint lib/economic-demo/paid-workflow-copy-boundary-terms.ts \
  e2e/economic-demo-paid-workflow-copy-gate.spec.ts \
  e2e/economic-demo-paid-workflow-evidence-501.spec.ts \
  scripts/check-paid-workflow-copy-boundaries.mjs
npx tsc --noEmit   # no errors in touched files; pre-existing repo error count unchanged (40 lines)
PLAYWRIGHT_BROWSER_CHANNEL=chrome npx playwright test \
  e2e/economic-demo-paid-workflow-copy-gate.spec.ts e2e/economic-demo-paid-workflow.spec.ts  # 9/9
PLAYWRIGHT_BROWSER_CHANNEL=chrome npx playwright test \
  e2e/economic-demo-public-proof.spec.ts e2e/economic-demo.spec.ts                           # 5/5
npm run check:rap:naming
npm run build
PLAYWRIGHT_BROWSER_CHANNEL=chrome npx playwright test \
  e2e/economic-demo-paid-workflow-evidence-501.spec.ts   # 4/4, evidence capture (last run)
git diff --check
```

## Boundaries

No wallet signing, RPC call, provider call, paid request, Pay.sh setup or activation, hosted
registry write, marketplace publication, or trust/reputation mutation occurred during capture or
gate execution, and none is reachable from the gate script (it reads local fixtures and one
local doc file). The gate exists precisely to keep it that way: any future copy upgrade toward a
live/custody/settlement/publication/mutation claim on this route fails CI closed.
