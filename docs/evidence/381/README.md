# #381 Discovery Source Facets Evidence

Captured on 2026-07-16 for issue #381.

## Scope

This evidence covers the discovery source facets added to `/agents` (`app/agents/page.tsx`):
a URL-addressable, multi-select source filter (`?source=` CSV, composable with the task-type
filter `?task=`) over all seven source classes — RAP registry, ARD AI Catalog, Circle x402,
Pay.sh, OpenRouter, local/demo, and the future hosted RAP registry — plus marketplace candidate
cards (`components/discovery/MarketplaceCandidateCard.tsx`) and source badges on the existing
specialist cards (`components/SpecialistCard.tsx`).

Cards show source badge, media/resource type, trust boundary, and readiness state, driven by
thin adapters (`lib/discovery/source-facets.ts`, `lib/discovery/marketplace-candidate-cards.ts`)
over the existing #577 discovery actionability matrix
(`lib/manager/discovery-actionability-matrix.ts`) and the #593 source-trust vocabulary
(`@reddi/agent-protocol/source-trust-conformance-matrix`). The legacy
`externally_listed_unattested` adapter literal is mapped to `listed_untrusted`, never
propagated. No new trust logic was introduced.

## Captures

All screenshots at the issue-required widths: mobile 375, tablet 768, desktop 1280.

- `{mobile-375,tablet-768,desktop-1280}-agents.png` — `/agents` with all sources.
- `…-rap-native.png` — RAP-native rendering (`?source=rap-registry,openrouter,local-demo`).
- `…-ard-imported.png` — ARD-imported candidates (`?source=ard-catalog`), including the
  imported-snapshot banner and untrusted trust badges.
- `…-blocked.png` / `…-blocked-card.png` — blocked/malformed states
  (`?source=ard-catalog,hosted-rap`): ARD malformed-connector fixtures
  (`failed verification`) and hosted export-gating blocks, full page + card close-up.
- `…-empty-no-candidates.png` — empty state explaining that **no candidates exist** from the
  selected source (`?source=circle-x402`, catalog snapshot not ingested).
- `…-empty-filters-too-narrow.png` — empty state explaining that candidates exist but the
  composed filters are **too narrow** (`?source=hosted-rap&task=transcribe`), with the
  clear-filters action.
- `desktop-1280-focus-source-pill.png` — keyboard focus visible on a source filter pill.
- `desktop-1280-focus-card-action.png` — keyboard focus visible on a card's only action
  (the read-only "Why is this gated?" disclosure).
- `desktop-1280-card-action-expanded.png` — the disclosure opened via Enter.
- `keyboard-focus-flow.webm` — recorded keyboard/focus proof run (focus pill → focus card
  action → Enter opens gating reasons).

A Playwright trace was not committed: trace finalization hangs in this environment when running
through the installed Chrome channel (`PLAYWRIGHT_BROWSER_CHANNEL=chrome`), per
`docs/evidence/506/README.md`; the video is committed instead, per the #498/#499/#501 precedent.

Screenshots are captured by `e2e/agents-source-facets-evidence-381.spec.ts` into
`test-results/evidence-381/` and copied here after the run (writing into `docs/` mid-run races
the webpack dev watcher, and any later `npx playwright test` invocation wipes `test-results/` —
see `docs/evidence/498/README.md` and `docs/evidence/499/README.md`).

## Validation

Commands run:

```bash
npx jest lib/__tests__/discovery-source-facets.test.ts \
  lib/__tests__/discovery-marketplace-candidate-cards.test.ts
npx jest                                    # full suite
npx eslint <touched app/components/lib/e2e files>
npx tsc --noEmit                            # no errors in touched files; pre-existing count unchanged
PLAYWRIGHT_BROWSER_CHANNEL=chrome npx playwright test e2e/agents-source-facets.spec.ts e2e/agents.spec.ts
PLAYWRIGHT_BROWSER_CHANNEL=chrome npx playwright test e2e/navigation.spec.ts \
  e2e/manager-discovery.spec.ts e2e/manager-discovery-actionability.spec.ts
PLAYWRIGHT_BROWSER_CHANNEL=chrome npx playwright test e2e/agents-source-facets-evidence-381.spec.ts
npm run check:rap:naming
npm run build
git diff --check
```

## Boundaries

Discovery ≠ trust (`docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md`): no paid call, wallet action,
endpoint invocation, publication, or trust/reputation mutation happens from the filter or the
discovery cards, and none is reachable — candidate cards render no links and no buttons other
than the read-only gating-reasons disclosure, and the page carries the trust-boundary copy.
The Playwright suite asserts this (`discovery cards expose no paid call, wallet, or invocation
affordance`). All candidate data is fixture-backed/read-only; absent Circle x402 / Pay.sh
catalog snapshots degrade to explicit "no candidates exist" availability notes.
