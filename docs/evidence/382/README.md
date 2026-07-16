# #382 ARD/Open-Agent Candidate Detail UI Evidence

Captured on 2026-07-17 for issue #382.

## Scope

This evidence covers the deep-linkable discovery candidate detail route
`/agents/candidates/[id]` (`app/agents/candidates/[id]/page.tsx`,
`components/discovery/CandidateDetail.tsx`) reachable from the #381 marketplace candidate
cards via the new "View details" link (`components/discovery/MarketplaceCandidateCard.tsx`),
backed by the read-only `GET /api/discovery/candidates/[id]` route over the new
`reddi.discovery-candidate-detail.v1` read model (`lib/discovery/candidate-detail.ts`).

The detail embeds the exact #381 card model (drift-locked by reuse of the
`lib/discovery/marketplace-candidate-cards.ts` builders) and renders:

- a five-state lifecycle strip separating `discovered` / `RAP-wrapped` / `attested` /
  `payment-ready` / `hireable` — every candidate served by this route is discovery-stage
  only, so only `discovered` is ever marked reached;
- the **full six-lane #577 actionability matrix** (lane, state, summary, reason codes) via
  `deriveDiscoveryActionabilityMatrix` / `deriveHostedDiscoveryActionabilityMatrix`, or an
  honest "matrix unavailable" panel where no adapter exists (blocked hosted export records,
  Circle x402 / Pay.sh externally listed snapshots) — never an invented matrix;
- source provenance (origin, origin kind, snapshot ref, crawl/snapshot time, self-asserted
  flag), identity/publisher, endpoint & media, payment & auth metadata, and trust-manifest
  sections where **absent values render as "unavailable"**, never fabricated;
- capability groups/tags, full untruncated gating reason codes, validation findings,
  recovery actions for blocked/unsafe candidates, evidence + raw snapshot references,
  source guardrail notes, and the Discover≠Decide boundary copy citing
  `docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md`.

Trust words are the #593 vocabulary; readiness states are #577 lane states. No new trust
logic was introduced. RAP-native registry specialists keep their existing
`/agents/[wallet]` detail page (linked from `SpecialistCard`); the candidate detail route
rejects registry-native ids with an honest `unsupported_id` panel pointing there.

## Captures

All screenshots at the issue-required widths: mobile 375, tablet 768, desktop 1280.

- `{mobile-375,tablet-768,desktop-1280}-ard-imported-detail.png` — valid ARD-imported
  candidate detail (`?source=ard-catalog` deep link): imported-snapshot banner, lifecycle
  strip, full six-lane matrix, provenance/identity/endpoint/payment/trust-manifest sections,
  capability groups, findings, evidence refs.
- `…-hosted-untrusted-detail.png` — unverified hosted RAP catalog candidate: `live-gated`
  readiness, honest `unavailable` endpoint URL / trust manifest, payment activation
  `disabled`.
- `…-blocked-detail.png` — blocked/malformed ARD fixture: fail-closed banner, blocked matrix
  lanes, blocking validation findings, recovery actions.
- `…-blocked-hosted-export-detail.png` — blocked hosted export record: matrix honestly
  unavailable ("failed export gating"), recovery actions.
- `…-not-found.png` — unknown candidate id: honest not-found panel with recovery actions and
  back navigation (no broken page).
- `…-source-unavailable.png` — non-ingested Circle x402 source: honest source-unavailable
  panel naming the missing snapshot artifact.
- `…-rap-native-detail.png` — the existing RAP-native specialist detail (`/agents/[wallet]`)
  that registry-native specialist cards link to, for comparison with the candidate classes.
- `desktop-1280-focus-card-detail-link.png` — keyboard focus visible on a card's
  "View details" entry link on `/agents`.
- `desktop-1280-focus-detail-back.png` — keyboard focus visible on the detail back link.
- `desktop-1280-after-back-navigation.png` — Enter on the focused back link returns to
  `/agents?source=ard-catalog` with the facet state restored.
- `keyboard-focus-flow.webm` — recorded keyboard/focus proof run (focus card detail link →
  Enter opens detail → focus back link → Enter returns with filters preserved).

A Playwright trace was not committed: trace finalization hangs in this environment when
running through the installed Chrome channel (`PLAYWRIGHT_BROWSER_CHANNEL=chrome`), per
`docs/evidence/506/README.md`; the video is committed instead, per the #498/#499/#501
precedent.

Screenshots are captured by `e2e/agents-candidate-detail-evidence-382.spec.ts` into
`test-results/evidence-382/` and copied here after the run (writing into `docs/` mid-run
races the webpack dev watcher, and later Playwright invocations wipe `test-results/`, so
the evidence spec must be the LAST Playwright run — `docs/evidence/498/README.md`,
`docs/evidence/499/README.md`).

## No-live boundary

Per `docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md`: the detail view renders **zero buttons** and
only internal navigation links; no paid call, wallet action, endpoint invocation,
publication, or trust/reputation mutation is reachable from it. Endpoint/service URLs are
rendered as text metadata, never as links. `e2e/agents-candidate-detail.spec.ts` enforces
the no-affordance invariant, and the #381 card invariant was tightened rather than dropped:
candidate cards may contain only internal `/agents/candidates/…` anchors.

## Validation (2026-07-17)

- `npx jest lib/__tests__/discovery-candidate-detail.test.ts` — 18/18
- full `npx jest` — 119 suites, 526 tests, all green
- `PLAYWRIGHT_BROWSER_CHANNEL=chrome npx playwright test e2e/agents-candidate-detail.spec.ts` — 8/8
- regression `e2e/agents-source-facets.spec.ts` + `e2e/agents.spec.ts` + `e2e/navigation.spec.ts` — 15/15
- evidence spec `e2e/agents-candidate-detail-evidence-382.spec.ts` — 4/4 (last Playwright run)
- `npx eslint` clean on touched files; `npx tsc --noEmit` — no errors in touched files
- `npm run check:rap:naming` PASS; `npm run build` PASS (`/agents/candidates/[id]` and
  `/api/discovery/candidates/[id]` compile as dynamic routes)
