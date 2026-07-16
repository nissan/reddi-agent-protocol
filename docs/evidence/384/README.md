# #384 AI Onboarding Assistant — Guided Intake Flow Evidence

Captured on 2026-07-16 for issue #384.

## Scope

This evidence covers the guided intake entry point at `/onboarding/intake`
(`app/onboarding/intake/page.tsx`), a thin UI surface over the shipped backend
contracts:

- **#575** `packages/agent-protocol/src/onboarding-analyser-handoff.ts`
  (`reddi.onboarding-*.v1`) — every accept/reject decision in the UI comes from
  `validateOnboardingIntakeDescriptor` / `runOnboardingAnalyserHandoff`; the UI adds no
  validation rules of its own.
- **#576** `packages/agent-protocol/src/onboarding-state-machine.ts`
  (`reddi.onboarding-state-machine.v1`) — successful analysis creates a local draft read
  model (state `draft`, open blocking gates, allowed next states via
  `listOnboardingStateTransitions`).

The adapter between the two is `lib/onboarding/intake-flow.ts`
(`reddi.onboarding-intake-flow-view.v1`).

Intake accepts all six #384 inputs, mapped onto `OnboardingSourceKind`: endpoint URL
(→ `manual-descriptor`, endpoint recorded but never called), AI Catalog URL
(→ `ard-ai-catalog`), MCP card URL (→ `mcp-metadata`), OpenAPI URL (→ `openapi`), A2A
card URL (→ `a2a-card`), and manual profile seed (→ `manual-descriptor`).

## Boundary

Analysis is **static and fixture-backed** (per `docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md`):
zero live network calls, no publish, no pay, no paid endpoint invocation, no secret
storage, no hosted/registry write. Live endpoint inspection is labelled not-yet-enabled in
the UI — **#459 owns the future live source adapter**. Dry-run URL markers (`empty`,
`unreachable`) deterministically select static fixture variants so every UI state is
reachable offline; the consent screen renders the data-sharing boundary BEFORE any
analysis runs. The functional spec also asserts the page performs zero external
fetch/XHR/WebSocket requests during intake (the only external request on any route is the
global layout's pre-existing Google Fonts stylesheet).

## Captures

Screenshots (issue-required widths 375 / 768 / 1280, full page) for each state, captured by
`e2e/onboarding-intake-evidence-384.spec.ts`:

- `{mobile-375,tablet-768,desktop-1280}-intake.png` — source selection (six inputs).
- `…-consent.png` — consent + data-sharing boundary screen (blocks analysis until accepted).
- `…-loading.png` — fixture-backed static analysis in progress (labelled "no network request").
- `…-results.png` — analysed draft: capability inventory with provenance, readiness lanes,
  `draft` state + blocking gates + allowed next states, listing draft states, all-false
  analyser guardrail grid, links back to manual registration.
- `…-error.png` — retryable simulated analyser interruption (labelled dry-run fixture).
- `…-invalid-url.png` — invalid/private URL rejected fail-closed (`private_url_blocked`).
- `…-blocked-secret.png` — credential-shaped input rejected
  (`credential_leakage_rejected`); the UI states the value was discarded and never echoes it.
- `…-empty.png` — no-results state (no capabilities declared / bare endpoint without #459).
- `intake-flow.webm` — desktop flow: source → consent → loading → results (scroll-through)
  → blocked-secret.

A Playwright trace was not committed: trace finalization hangs under the installed Chrome
channel (`PLAYWRIGHT_BROWSER_CHANNEL=chrome`), per `docs/evidence/506/README.md` /
`docs/evidence/498/README.md`; the video above is the committed artifact, per that precedent.

Screenshots are captured into `test-results/evidence-384/` and copied here after the run —
writing into `docs/` mid-run races the webpack dev watcher (`docs/evidence/498/README.md`),
and any later `npx playwright test` invocation wipes `test-results/`, so the evidence spec
is the last Playwright run before copying (`docs/evidence/499/README.md`).

## Malformed / secret-shaped input blocked (evidence artifact)

`blocked-input-proof.json` — deterministic, offline proof that the exact validator the UI
calls rejects secret-shaped query keys, bearer-token material, URL userinfo credentials,
malformed URLs, private/localhost URLs, and structurally malformed descriptors, with
codes+paths only (no input material echoed). Regenerate with:

```bash
node docs/evidence/384/generate-blocked-input-proof.mjs > docs/evidence/384/blocked-input-proof.json
```

The DOM-level counterpart is asserted in `e2e/onboarding-intake.spec.ts` ("blocks
credential-shaped input and never echoes or keeps the secret"): the blocked-secret state
renders, the secret value appears nowhere in the page content, and the input field is
cleared after start-over.
