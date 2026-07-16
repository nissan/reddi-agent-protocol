# #385 Generated RAP Profile Review Editor — Evidence

Captured on 2026-07-16 for issue #385.

## Scope

This evidence covers the profile review/editor surface at `/onboarding/profile-editor`
(`app/onboarding/profile-editor/page.tsx`), a thin UI surface over the shipped backend
contracts:

- **#575** `packages/agent-protocol/src/onboarding-analyser-handoff.ts`
  (`reddi.onboarding-*.v1`) — the generated RAP profile draft
  (`reddi.onboarding-rap-profile-draft.v1`), the five-way field provenance
  (discovered / inferred / user_provided / verified / blocked), and the readiness result
  across all 11 lanes. Every accept/reject decision for operator edits comes from
  `runOnboardingAnalyserHandoff`; the UI adds no validation rules of its own.
- **#576** `packages/agent-protocol/src/onboarding-state-machine.ts`
  (`reddi.onboarding-state-machine.v1`) — save/continue records a local read-model
  transition with #576 blocking-gate semantics: resolved drafts move
  `draft → pending_operator_approval`; blocked drafts may continue only when the block is
  explicitly deferred with a reason, routing to `payment_setup_required` /
  `needs_provider_input` with the matching open gate and the reason recorded verbatim in
  the audit record.

The adapter between the two is `lib/onboarding/profile-review.ts`
(`reddi.onboarding-profile-review-view.v1`).

Because intake drafts (#384, `/onboarding/intake`) stay local to that page, the editor
reviews matching **fixture-backed** generated drafts (three scenarios: complete profile,
missing required fields, inferred-field warnings) until draft persistence lands. Sections
issue #385 asks for that the profile-draft contract does not carry (tools and skills as
distinct from capabilities, downstream calls, context requirements) render honestly as
**unavailable**, and `verified × 0` is rendered honestly with an explanation (verification
requires evidence refs — never assigned at generation time).

## Boundary

Per `docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md`: zero live network calls, no publish, no
pay, no endpoint invocation, no secret storage, no trust or reputation mutation. Operator
edits are re-run through the #575 fail-closed validator — credential-shaped input is
rejected (`credential_leakage_rejected`), discarded, and never echoed; private/localhost
endpoint URLs are rejected (`private_url_blocked`) with inline recovery actions. Continue
decisions are local read-model events only (`scope: local_read_model_only`) and the
rendered publication ledger stays hard-false — `published_candidate` and every other #576
state remain internal-only (live publication is #395's gated scope). The functional spec
also asserts the page performs zero external network requests.

## Captures

Screenshots (issue-required widths 375 / 768 / 1280, full page) for each state, captured by
`e2e/onboarding-profile-editor-evidence-385.spec.ts`:

- `{mobile-375,tablet-768,desktop-1280}-complete.png` — complete profile: capability tags,
  per-capability fields, invocation/auth, pricing + payment metadata, trust state, policy +
  evidence expectations, unavailable-sections panel, discovered-vs-generated diff, all 11
  readiness lanes, and save/continue enabled (readiness `needs_operator_review`, nothing
  blocked).
- `…-missing-required.png` — missing required fields: blocked provenance on display name /
  endpoint / all four payment fields, `missing_payment_metadata` status, blocked readiness,
  save/continue disabled with the resolve-or-defer hint and the deferral-reason textarea.
- `…-inferred-warnings.png` — inferred-field warnings: heuristically inferred side-effect
  risks (including an EXECUTE-class inference) flagged with review warnings and `inferred`
  provenance chips.
- `…-validation-errors.png` — validation errors: a private endpoint URL rejected
  fail-closed (`private_url_blocked`) with the role=alert error summary, inline per-field
  error, and recovery action; the draft itself is unchanged.
- `desktop-1280-continue-resolved.png` — decision recorded: `draft →
  pending_operator_approval` with audit reason, open gates, allowed next states, and the
  all-false publication ledger.
- `desktop-1280-continue-deferred.png` — explicit deferral: `draft →
  payment_setup_required` with the operator's deferral reason recorded verbatim on the
  audit record and the `payment_setup` gate carried open.

Keyboard/focus proof for editor controls and form errors:

- `desktop-1280-keyboard-scenario-focus.png` — scenario control reached via Tab
  (focus-visible ring; buttons expose `aria-pressed`).
- `desktop-1280-keyboard-input-focus.png` — labelled editor input focused (every editable
  input has a `<label for>` association).
- `desktop-1280-keyboard-error-focus.png` — after a failed apply, focus lands on the first
  invalid field, which carries `aria-invalid="true"` and `aria-describedby` pointing at the
  inline error rendered beneath it.
- The DOM-level assertions live in `e2e/onboarding-profile-editor.spec.ts`
  ("invalid endpoint edit fails closed…" and "editor controls are keyboard reachable…").

Video:

- `profile-review-flow.webm` — desktop flow: complete-profile scroll-through (provenance,
  capabilities, payment, unavailable sections, diff, readiness, gate) → missing-required
  scenario → inline recovery by supplying the four payment fields → readiness unblocks →
  continue records `draft → pending_operator_approval`.

A Playwright trace was not committed: trace finalization hangs under the installed Chrome
channel (`PLAYWRIGHT_BROWSER_CHANNEL=chrome`), per `docs/evidence/506/README.md` /
`docs/evidence/498/README.md`; the video above is the committed artifact, per that
precedent.

Screenshots are captured into `test-results/evidence-385/` and copied here after the run —
writing into `docs/` mid-run races the webpack dev watcher (`docs/evidence/498/README.md`),
and any later `npx playwright test` invocation wipes `test-results/`, so the evidence spec
is the last Playwright run before copying (`docs/evidence/499/README.md`).

The captures hide the Next.js dev-tools indicator overlay (`nextjs-portal`): the dev
server flags the pre-existing global font-preload warning (which fires on every route a
few seconds after load) as an "issue" badge. It is a dev-only overlay, not application UI;
a console sweep of the editor flow shows no errors or warnings from the page itself.
