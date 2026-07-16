# Evidence — #386 AUDD/Solana payment and readiness gate UI

Captured 2026-07-17 from the fixture-backed route `/onboarding/readiness-gate`
(worktree branch `feat/386-payment-readiness-gate-ui`).

## Scope

Read-only readiness-gate surface for a generated listing. Every gate verdict
comes verbatim from a shipped contract validator via the thin adapter
`lib/onboarding/readiness-gate.ts` (`reddi.onboarding-readiness-gate-view.v1`):

- profile draft + 11 readiness lanes — `runProfileReview` (#385 adapter over
  the #575 `reddi.onboarding-*.v1` analyser handoff);
- seller-wrapper rails and the committed AUDD payment plan —
  `reddi.seller-wrapper-rail-fixture.v1` (#529) and
  `reddi.seller-wrapper-config.v1` (#535/#536, validated by the #535 validator
  on every render);
- AUDD dry-run preflight — `evaluateAuddPaymentPlanPreflight`
  (`reddi.audd-payment-plan.v1`, #391);
- buyer budget-policy compatibility — `evaluateBuyerAuthorityPolicy`
  (`reddi.buyer-authority-policy.v1`, #548/#549);
- receipt/evidence binding — `deriveReceiptEvidenceBinding`
  (`reddi.receipt-evidence-binding.v1`, #393);
- attestation/reputation backing — `deriveAttestationReputationBridge`
  (`reddi.attestation-reputation-bridge.v1`, #394/PR #606 `listingProjection`).

Sixteen gates per scenario (payment rail, AUDD asset/network, settlement/payee,
quote mode + expiry, refund/failure policy, buyer budget-policy compatibility,
x402 payment config, endpoint, auth safety, receipt requirement, evidence
requirement, dry-run receipt, #393 binding, attestation state, reputation
starting state, source trust posture), each with verbatim contract reason
codes, durable readback refs, and — whenever a gate is not ready — a concrete
next action.

## Boundary

- Zero network requests (Playwright-asserted). No wallet signing, RPC call,
  provider call, paid request, hosted write, publication, or trust/reputation
  mutation is reachable from the surface.
- Live payment controls render permanently disabled with honest copy: these
  fixtures never carry backend readiness or operator live-payment approval.
- AUDD copy holds the #392 line everywhere: proof-metadata / payment-plan
  readiness for v0.1 — not Quasar AUDD custody, no settled AUDD escrow.
- The #497/#501 hard-boundary flag grid renders all 16 live flags `false`, and
  the jest suite scans every view-model string against the #501
  `FORBIDDEN_COPY_CLAIMS` patterns (with the self-test parity check).

## Captures

Screenshots at mobile (375×812), tablet (768×1024), desktop (1280×900),
full-page, one per evidence state:

- `{mobile-375,tablet-768,desktop-1280}-ready.png`
- `{mobile-375,tablet-768,desktop-1280}-blocked-payment.png`
- `{mobile-375,tablet-768,desktop-1280}-blocked-evidence.png`
- `{mobile-375,tablet-768,desktop-1280}-blocked-trust.png`
- `{mobile-375,tablet-768,desktop-1280}-dry-run-receipt.png`

Video: `profile-review-to-readiness-gate.webm` — profile review editor
(continue decision recorded) → readiness-gate entry link → ready state →
blocked-payment (next actions + disabled live controls) → back to ready.
Video committed instead of a Playwright trace per the #506 chrome-channel
precedent.

Capture mechanics: screenshots are written to `test-results/evidence-386/` by
`e2e/onboarding-readiness-gate-evidence-386.spec.ts` and copied here after the
LAST Playwright run (copying into `docs/` mid-run races the webpack watcher —
see docs/evidence/{498,499}/README.md). The dev-only `nextjs-portal` badge is
hidden during capture (pre-existing global font-preload warning; page console
is otherwise clean).

## Validation (offline / no-spend)

- Jest: `lib/__tests__/onboarding-readiness-gate.test.ts` — 28 tests
  (scenario gate matrices, verbatim reason codes, next-action invariant,
  disabled live controls, boundary-flag grid, #501 forbidden-copy scan with
  self-test parity, determinism, JSON-serializability, credential-leak scan,
  adapter source guard).
- Playwright: `e2e/onboarding-readiness-gate.spec.ts` (11 tests) +
  `e2e/onboarding-readiness-gate-evidence-386.spec.ts` (4 tests, last run).
- `npm run check:rap:naming` PASS; `npm run check:copy:paid-workflow` PASS
  (paid-workflow model untouched); `npm run build` PASS; eslint/tsc clean on
  touched files.
