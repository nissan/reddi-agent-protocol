# BDD Feature Index

_Last updated: 2026-06-22 AEST_

Purpose: single lookup from BDD feature file -> bucket -> executable verification command(s).

## Features and mapped verification commands

### Bucket A — Onboarding
- Feature: `docs/bdd/features/bucket-a-onboarding.feature`
- Verify:
  - `npx jest lib/__tests__/onboarding-routes-core.test.ts lib/__tests__/onboarding-routes-support.test.ts lib/__tests__/onboarding-routes-wrappers.test.ts lib/__tests__/operator-key-rotation.test.ts lib/__tests__/onboarding-operator-status-routes.test.ts lib/__tests__/specialist-callable-readiness.test.ts --runInBand`
  - `npx playwright test e2e/onboarding.spec.ts --grep "consent gates|next button advances|back button returns|step 2 runtime — next is disabled|run button disabled when prompt is empty"`

### Bucket B — Discovery + Capability Index
- Feature: `docs/bdd/features/bucket-b-discovery.feature`
- Verify:
  - `npx jest lib/__tests__/registry-route.test.ts lib/__tests__/registry-bridge-sort.test.ts lib/__tests__/planner-resolve-route.test.ts --runInBand`

### Bucket C — Planner-Native Consumption
- Feature: `docs/bdd/features/bucket-c-planner-consumption.feature`
- Verify:
  - `npx jest lib/__tests__/planner-resolve-route.test.ts lib/__tests__/planner-invoke-route.test.ts lib/__tests__/planner-execute-route-preferred-wallet.test.ts lib/__tests__/consumer-guided-paid-call.test.ts lib/__tests__/planner-signal-route.test.ts lib/__tests__/torque-event-route.test.ts lib/__tests__/torque-client.test.ts --runInBand`

### Bucket D/E — Security + Reliability
- Feature: `docs/bdd/features/bucket-d-e-reliability.feature`
- Verify:
  - `npx jest lib/__tests__/endpoint-security-compat.test.ts lib/__tests__/endpoint-manager-reliability.test.ts lib/__tests__/operator-key-rotation.test.ts lib/__tests__/onboarding-operator-status-routes.test.ts lib/__tests__/program-rpc-config.test.ts lib/__tests__/specialist-callable-readiness.test.ts --runInBand`
  - `npm run test:e2e:integration-lane`

### Bucket F — Jupiter Cross-Token Settlement
- Feature: `docs/bdd/features/bucket-f-jupiter-settlement.feature`
- Verify:
  - `npx jest lib/__tests__/jupiter-client.test.ts lib/__tests__/planner-invoke-route.test.ts --runInBand`
  - `cd packages/x402-solana && npm test -- --runInBand tests/payment.test.ts`
  - `cd packages/agent-protocol && npm test -- --test-name-pattern "mpp|rail-neutral"`

### Bucket G — Torque Retention
- Feature: `docs/bdd/features/bucket-g-torque-retention.feature`
- Verify:
  - `npx jest lib/__tests__/torque-client.test.ts lib/__tests__/torque-event-route.test.ts lib/__tests__/torque-leaderboard-route.test.ts lib/__tests__/torque-onboarding-event.test.ts --runInBand`
  - `npx playwright test e2e/leaderboard.spec.ts`

### Bucket H — Consumer Orchestrator Lifecycle
- Feature: `docs/bdd/features/bucket-h-consumer-orchestrator.feature`
- Verify:
  - `npx jest lib/__tests__/planner-register-consumer-route.test.ts lib/__tests__/planner-tools-manifest-route.test.ts lib/__tests__/planner-resolve-route.test.ts lib/__tests__/planner-resolve-attestor-route.test.ts lib/__tests__/attestor-role-readiness.test.ts lib/__tests__/planner-invoke-route.test.ts lib/__tests__/planner-release-route.test.ts lib/__tests__/planner-signal-route.test.ts lib/__tests__/planner-auditability.test.ts lib/__tests__/dogfood-testing-specialist-route.test.ts lib/__tests__/dogfood-testing-attestor-route.test.ts lib/__tests__/dogfood-consumer-run-route.test.ts --runInBand`
  - `npx playwright test e2e/dogfood.spec.ts`

### Bucket S — Source Adapter Onboarding
- Feature: `docs/bdd/features/bucket-s-source-adapters.feature`
- Static agent-stack conformance reference: `docs/conformance/static-agent-stack/README.md`
- OKF/OpenKB static fixture reference: `docs/conformance/okf-openkb/README.md`
- Verify:
  - `npm run check:rap:naming`
  - `npm run check:okf-openkb:fixtures`
  - `npx jest lib/__tests__/source-adapter-schema.test.ts lib/__tests__/register-probe-route.test.ts lib/__tests__/source-adapter-openclaw-profile.test.ts lib/__tests__/source-adapter-openclaw-connector.test.ts lib/__tests__/source-adapter-hermes-profile.test.ts lib/__tests__/source-adapter-hermes-attestor.test.ts lib/__tests__/source-adapter-pi-profile.test.ts lib/__tests__/source-adapter-pi-extension-bundle.test.ts lib/__tests__/source-adapter-circle-x402-profile.test.ts lib/__tests__/circle-x402-catalog-route.test.ts lib/__tests__/circle-x402-quote-preview-route.test.ts lib/__tests__/source-adapter-pay-sh-profile.test.ts lib/__tests__/pay-sh-catalog-route.test.ts lib/__tests__/pay-sh-quote-preview-route.test.ts lib/__tests__/pay-sh-mcp-inspection.test.ts lib/__tests__/pay-sh-policy-plan.test.ts lib/__tests__/pay-sh-policy-plan-route.test.ts lib/__tests__/source-adapter-routing-policy.test.ts lib/__tests__/planner-resolve-route.test.ts --runInBand`
  - `npm run test:source:conformance`
  - `./scripts/run-source-conformance.sh --source hermes --mode smoke`
  - `./scripts/run-source-conformance.sh --source pi --mode smoke`
  - `./scripts/run-source-conformance.sh --source circle-x402 --mode smoke`
  - `./scripts/run-source-conformance.sh --source pay-sh --mode smoke`
  - `npm run test:source:matrix`

### Bucket I — Agent Manager Operations
- Feature: `docs/bdd/features/bucket-i-agent-manager-operations.feature`
- Hosted marketplace operations runbook: `docs/HOSTED-MARKETPLACE-OPERATIONS-READINESS-RUNBOOK.md`
- Pay.sh live activation policy: `docs/PAY-SH-LIVE-ACTIVATION-GATES-AND-SPEND-POLICY.md`
- Verify:
  - `npx jest lib/__tests__/manager-readiness-route.test.ts lib/__tests__/manager-evidence-pack.test.ts lib/__tests__/manager-evidence-route.test.ts --runInBand`
  - Docs/process safety checks: `npm run check:economic-demo:live-payment-gate`, `npm run verify:economic-demo:devnet-usdc-receipt`
  - `npm run test:bdd:index`
  - Included in representative sweep: `npm run test:bdd:sweep`


### Bucket J — End-User Economic Demo
- Feature: `docs/bdd/features/bucket-j-end-user-economic-demo.feature`
- Paid workflow route state contract: `docs/PAID-WORKFLOW-ROUTE-STATE-CONTRACT.md`
- Pay.sh/devnet paid-run approval validator maps #502 to #476, #471, #338, and #334.
- Verify:
  - `npm run lint -- app/economic-demo/page.tsx lib/economic-demo/fixture.ts lib/economic-demo/image-adapter.ts app/api/economic-demo/image/route.ts`
  - `cd packages/agent-protocol && npm test -- --test-name-pattern "ARD no-spend demo"`
  - `npx jest lib/__tests__/economic-demo-dry-run.test.ts lib/__tests__/economic-demo-balances.test.ts lib/__tests__/economic-demo-payment-readiness.test.ts lib/__tests__/economic-demo-hosted-challenge-probe.test.ts lib/__tests__/economic-demo-live-run.test.ts lib/__tests__/economic-demo-live-paid-devnet-run.test.ts lib/__tests__/economic-demo-ledger-reconciliation.test.ts lib/__tests__/economic-demo-surfpool-rehearsal.test.ts lib/__tests__/economic-demo-webpage-live-workflow-evidence.test.ts lib/__tests__/economic-demo-public-proof-page-data.test.ts lib/__tests__/economic-demo-paid-workflow-proof-ui-fixtures.test.ts --runInBand`
  - `npx playwright test e2e/economic-demo.spec.ts e2e/economic-demo-public-proof.spec.ts e2e/judge-replication-onboarding.spec.ts`
  - `npm run smoke:economic-demo:surfpool`
  - `npm run check:economic-demo:submission-prep`
  - `npm run check:superteam:devnet-demo`
  - `npm run test:pay-sh:devnet-approval`
  - `npm run generate:economic-demo:submission-prep`
  - `npm run build`
  - Devnet cycle, when fresh devnet validation is explicitly approved: `npm run run:economic-demo:devnet-signed-action`, `npm run smoke:economic-demo:jupiter-quote`, `npm run check:economic-demo:live-payment-gate`, `npm run verify:economic-demo:devnet-usdc-receipt`, `npm run plan:economic-demo:devnet-usdc-sender`, `node scripts/judge-replication-check.mjs`

### Bucket M — Quasar-native MagicBlock PER Escrow
- Feature: `docs/bdd/features/bucket-m-magicblock-per.feature`
- Verify:
  - `npm run test:bdd:index`
  - `npm run test:quasar:boundary-guard`
  - `npm run check:quasar:boundary-guard`
  - `npx jest lib/__tests__/quasar-demo-program-config.test.ts lib/__tests__/quasar-demo-agent-guard.test.ts lib/__tests__/quasar-agent-account-decoder.test.ts lib/__tests__/quasar-instructions.test.ts --runInBand`
  - `cargo test --manifest-path experiments/quasar-escrow-per/Cargo.toml`
  - `npm run test:surfpool:quasar-critical`
  - Devnet cycle, when fresh devnet validation is explicitly approved: `npm run smoke:quasar:per-devnet`

## Drift guard
- Validate index coverage against feature files:
  - `npm run test:bdd:index`
  - (script: `scripts/check-bdd-feature-index.sh`)

## One-command representative sweep
- Run representative verification across all active buckets:
  - `npm run test:bdd:sweep`
  - (script: `scripts/run-bdd-bucket-sweep.sh`)
- Output artifacts per run:
  - `artifacts/bdd-sweep/<timestamp>/SUMMARY.md`
  - `artifacts/bdd-sweep/<timestamp>/bdd-sweep.log`
- One-line latest status helper:
  - `npm run test:bdd:status`
  - (script: `scripts/bdd-sweep-latest-status.sh`)

## Suggested cadence
- Per iteration: run only affected bucket commands.
- End-of-day confidence sweep: run representative command per bucket.
- Nightly: rely on CI integration-lane workflow artifact uploads.
