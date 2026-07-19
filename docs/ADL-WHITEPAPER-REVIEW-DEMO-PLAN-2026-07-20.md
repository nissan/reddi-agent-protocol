# ADL Whitepaper, Review Intake, And Payment Demo Plan

_Issue: #611. Requested: 2026-07-20 02:50 AEST._

## Intent

Publish ADL as a first-class public concept on the Reddi Agent Protocol site: a whitepaper, an open review path, and a demo surface that shows how ADL describes autonomous agent-to-agent payment flows.

## User Story

As a builder evaluating Reddi Agent Protocol, I want to read the ADL whitepaper, comment on the specification, and run realistic mock payment-flow examples so I can understand how ADL defines buyer agents, seller agents, receipts, policy, attestation, and reputation before I connect my own agent endpoint.

## Scope

- Add a public `/adl` route.
- Add a durable ADL whitepaper markdown document.
- Link ADL from navigation and the existing `/whitepaper` route.
- Provide at least three ADL-backed autonomous payment use cases.
- Default to mock mode with packaged responses.
- Offer live endpoint mode where users can provide their own agent API address.
- Generate a structured GitHub review issue link from on-page review fields.

## Acceptance Criteria

- `/adl` renders the ADL positioning, whitepaper links, review path, and demo controls.
- The demo includes three use cases:
  - research agent buys a specialist brief;
  - builder agent hires a code review specialist;
  - commerce agent pays an attestor/evidence specialist for dispute evidence.
- Every use case displays buyer, seller, attestor, ADL field references, price, payment rail, and the flow from discovery/scope to quote, policy, receipt, verification/attestation, and reputation/release outcome.
- Mock mode runs without an API address.
- Live endpoint mode requires a user-supplied URL and sends the structured request from the browser.
- The site does not store API addresses, credentials, private keys, or review text.
- Copy distinguishes mock/static demo behavior from live user-supplied endpoint behavior.
- Focused data tests cover the use case contract and live payload guardrails.

## Guardrails

- No direct push to `main`; feature branch and PR only.
- No mainnet, paid calls, wallet private keys, credentials, or server-side endpoint storage.
- No live user endpoint calls during automated validation.
- Production publish remains gated by Nissan's merge/deploy path.

## Validation Plan

- `npx jest lib/__tests__/adl-demo-use-cases.test.ts --runInBand`
- `npx eslint app/adl/page.tsx app/whitepaper/page.tsx components/NavBar.tsx lib/adl/demo-use-cases.ts lib/__tests__/adl-demo-use-cases.test.ts e2e/adl.spec.ts e2e/navigation.spec.ts`
- `npm run build`
- `git diff --check`
- Playwright `/adl` smoke when local browser cache is healthy.
