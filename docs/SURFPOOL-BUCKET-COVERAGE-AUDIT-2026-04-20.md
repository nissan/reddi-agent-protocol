# Surfpool Coverage Audit — Buckets A-H

Date: 2026-04-20
Scope: verify whether Surfpool-driven tests are leveraged across active BDD buckets/use-cases, identify missing coverage, and add executable critical-path lane.

## Executive summary
- Before this audit, the repo had strong Jest/Playwright/LiteSVM coverage but no explicit Surfpool-driven automated lane.
- Added new executable lane: `npm run test:surfpool:critical`.
- This lane now validates localnet settlement-critical scenarios with real program deploy + demo flow execution.

## Existing non-Surfpool coverage baseline
- Bucket suite/index guard: `npm run test:bdd:index`, `npm run test:bdd:sweep`
- Rust on-chain simulation: LiteSVM tests under `archive/anchor-escrow/tests/*.rs`
- PER client routing/fallback tests: `packages/per-client/tests/per-client.test.ts`
- UI/integration lanes: Playwright e2e + integration scripts

## Bucket-by-bucket Surfpool leverage status

| Bucket | Critical use-case | Surfpool-driven test before audit | Surfpool-driven test after audit | Status |
|---|---|---|---|---|
| A Onboarding | Operator/runtime/wallet gates | No | Improved (`test:surfpool:onboarding` + `test:surfpool:onboarding-wrapper`) | Improved |
| B Discovery | Filter/ranking deterministic contracts | No | No | Gap |
| C Planner consumption | Payment/settlement lifecycle | No | Yes (`test:surfpool:critical` public + fallback path) | Improved |
| D Security | Endpoint gating compatibility | No | No | Gap |
| E Reliability | Endpoint/proxy/operator robustness | No | Partial (PER endpoint unreachable fallback) | Partial |
| F Jupiter settlement | Swap path, token mismatch handling | No | Improved (`test:surfpool:jupiter-invoke` verifies invoke+x402+swap trace) | Improved |
| G Torque retention | Event/leaderboard paths | No | No | Gap |
| H Consumer lifecycle | Resolve/invoke/release lifecycle | No | Yes (release path via `test:surfpool:critical`, attestation touchpoints via `test:surfpool:onboarding` + `test:surfpool:onboarding-wrapper`) | Improved |

## What was added in this audit
1. `scripts/run-surfpool-critical-smoke.sh`
   - Starts Surfpool localnet
   - Builds + deploys escrow program
   - Runs demo-agents scenario A: public settlement happy path
   - Runs demo-agents scenario B: PER requested + unreachable PER endpoint + confirmed L1 fallback
   - Produces artifacts in `artifacts/surfpool-smoke/<timestamp>/`
2. `package.json`
   - Added script: `test:surfpool:critical`
3. `packages/demo-agents/src/config.ts`
   - Added env overrides for simulation lanes:
     - `DEMO_DEVNET_RPC`
     - `DEMO_PER_RPC`
4. `docs/bdd/FEATURE-INDEX.md`
   - Added Surfpool critical-scenario lane section and run guidance

## Missing tests identified (next fill list)
1. **G torque event retention surfpool lane**
   - Event emission + leaderboard update validation under localnet transaction flow.
2. **Live TEE PER CI/manual gate**
   - Keep local surfpool for deterministic fallback testing, but add separate devnet TEE periodic gate for `release_escrow_per` real endpoint behavior.

## Validation run (completed)
- Command: `npm run test:surfpool:critical`
- Latest artifact: `artifacts/surfpool-smoke/20260421-000132/SUMMARY.md`
- Result: ✅ pass
  - localnet public settlement happy path passed
  - PER-requested path with unreachable PER endpoint correctly fell back to L1 and passed

- Command: `npm run test:surfpool:onboarding`
- Latest artifact: `artifacts/surfpool-onboarding/20260421-001853/SUMMARY.md`
- Result: ✅ pass
  - localnet on-chain onboarding attestation (`attest_quality`) submitted and attestation PDA creation verified

- Command: `npm run test:surfpool:onboarding-wrapper`
- Latest artifact: `artifacts/surfpool-onboarding-wrapper/20260421-064103/SUMMARY.md`
- Result: ✅ pass
  - runtime -> endpoint -> wallet -> healthcheck -> attestation wrapper route chain exercised against Surfpool-backed attestation submission

- Command: `npm run test:surfpool:jupiter-invoke`
- Latest artifact: `artifacts/surfpool-jupiter-invoke/20260421-065322/SUMMARY.md`
- Result: ✅ pass
  - planner invoke route exercised through x402 402->retry cycle with SOL->USDC Jupiter auto-swap, including trace-level swap proof (`x402:swap_used`)

## Acceptance criteria for this audit
- [x] Surfpool lane exists and is runnable via npm
- [x] Critical settlement scenarios run end-to-end with artifacts
- [x] Bucket map includes explicit Surfpool gaps and priorities
