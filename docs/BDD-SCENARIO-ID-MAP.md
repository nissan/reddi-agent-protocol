# BDD Scenario ID Map (A-H)

_Last updated: 2026-04-19 AEST_

Purpose: single source-of-truth mapping from BDD scenario ID -> implementation evidence -> test evidence -> lane.

Lanes:
- `route-unit` = Jest route/unit contracts (`lib/__tests__/*`)
- `e2e-ui` = Playwright UI flow (`e2e/*.spec.ts`)
- `integration` = infra-backed Playwright integration lane (`e2e/integration.spec.ts`)
- `manual` = currently documented/manual verification only

---

## Bucket A — Specialist Onboarding

| ID | Scenario | Status | Evidence | Lane |
|---|---|---|---|---|
| A1.1 | Consent denied blocks endpoint exposure + registration | ✅ | `app/onboarding/page.tsx`, `e2e/onboarding.spec.ts` | e2e-ui |
| A1.2 | Runtime bootstrap succeeds | ✅ | `lib/__tests__/onboarding-routes-support.test.ts` | route-unit |
| A1.3 | Token-gated proxy + tunnel setup succeeds | ✅ | `lib/__tests__/onboarding-routes-support.test.ts` | route-unit |
| A1.4 | Wallet existing path completes | ✅ | `lib/__tests__/onboarding-routes-core.test.ts` | route-unit |
| A1.5 | Wallet bootstrap path enforces encrypted key + backup | ✅ | `lib/__tests__/onboarding-routes-core.test.ts` | route-unit |
| A1.6 | Sponsorship cap enforced | ✅ | `lib/__tests__/onboarding-routes-core.test.ts` | route-unit |
| A1.7 | Register tx preflight shown before signing | ✅ | `app/onboarding/page.tsx` | e2e-ui/manual |
| A1.8 | Register tx succeeds on-chain | ✅ | `app/onboarding/page.tsx` | integration/manual |
| A2.1 | Healthcheck fail blocks attestation | ✅ | `lib/__tests__/onboarding-routes-core.test.ts` | route-unit |
| A2.2 | Healthcheck pass includes runtime/public probe | ✅ | `lib/__tests__/onboarding-routes-core.test.ts` | route-unit |
| A2.3 | On-chain `attest_quality` succeeds | ✅ | `lib/__tests__/onboarding-routes-core.test.ts` (+ integration/manual) | route-unit/integration |
| A2.4 | Audit trail persisted | ✅ | `lib/__tests__/onboarding-routes-support.test.ts` | route-unit |
| A2.5 | Missing operator signer fails explicitly | ✅ | `lib/__tests__/operator-key-rotation.test.ts` | route-unit |
| A2.6 | Confirm/dispute flow completes | ✅ | onboarding Step 7 + planner settlement + `onboarding-routes-wrappers.test.ts` | e2e-ui/route-unit |

## Bucket B — Discovery + Capability Index

| ID | Scenario | Status | Evidence | Lane |
|---|---|---|---|---|
| B1.1 | Capability schema validates | ✅ | `app/api/onboarding/capabilities/route.ts` | route-unit |
| B1.2 | Specialist profile linked to on-chain identity | ✅ | `lib/registry/bridge.ts` | route-unit/manual |
| B1.3 | Invalid schema rejected with actionable errors | ✅ | capabilities route validation | route-unit |
| B2.1 | Filter by capability tags | ✅ | `lib/__tests__/registry-route.test.ts` (`tag`, `tags` csv) | route-unit |
| B2.2 | Filter by attestation + health | ✅ | `lib/__tests__/registry-route.test.ts` | route-unit |
| B2.3 | Sort by fit/reputation/cost/latency | ✅ | `registry-route.test.ts` + ranking tie-break policy (freshness then cost-latency proxy) | route-unit |
| B3.1 | Ranked candidates carry a typed explainability block (#344) | ✅ | `packages/agent-protocol/tests/ranking-explainability.test.ts` (`reddi.ranking-explainability.v1`) | read-model |
| B3.2 | High-relevance candidates still fail closed on Decide gates (#344) | ✅ | `packages/agent-protocol/tests/ranking-explainability.test.ts` + `lib/__tests__/manager-ard-candidate-diagnostics.test.ts` | read-model |
| B3.3 | ARD candidate diagnostics separate relevance from every decision lane (#344) | ✅ | `lib/__tests__/manager-ard-candidate-diagnostics.test.ts` (`reddi.ard-candidate-diagnostics.v1`) | read-model |
| B3.4 | Supervisor diagnostics: run linkage, child state, failure reason, settlement/audit (#344) | ✅ | `lib/__tests__/manager-supervisor-run-diagnostics.test.ts` (`reddi.supervisor-run-diagnostics.v1`) | read-model |
| B3.5 | No source silently bypasses settlement/attestation constraints (#344) | ✅ | structural tests in both suites above | read-model |

## Bucket C — Planner-Native Specialist Consumption

| ID | Scenario | Status | Evidence | Lane |
|---|---|---|---|---|
| C1.1 | Planner policy includes budget/min-rep/privacy | ✅ | planner policy + resolve route | route-unit |
| C1.2 | Discovery returns candidate set | ✅ | `planner-resolve-route.test.ts` | route-unit |
| C1.3 | Deterministic candidate selection + reasons | ✅ | `app/api/planner/tools/resolve/route.ts` | route-unit |
| C2.1 | x402 challenge/retry/payment succeeds | ✅ | x402 settlement + package tests | route-unit/integration |
| C2.2 | Escrow/payment fallback handles private rail failure | ✅ | x402 settlement fallback logic | route-unit |
| C2.3 | Receipt + trace captured | ✅ | planner run records | route-unit |
| C3.1 | Feedback captured and linked to call | ✅ | `planner-signal-route.test.ts` | route-unit |
| C3.2 | Feedback contributes to routing/reputation | ✅ | planner signal + registry feedback | route-unit |
| C4.1 | REPUTATION_EVENT mint emitted | ✅ | `reputation-signal.ts` | route-unit |
| C4.2 | REPUTATION_EVENT reveal emitted | ✅ | reveal route/tests | route-unit |
| C4.3 | Log includes job_id/wallet/score/tx | ✅ | reputation event payload tests | route-unit |

## Bucket D — x402 + Endpoint Security Compatibility

| ID | Scenario | Status | Evidence | Lane |
|---|---|---|---|---|
| D1.1 | `/v1/*`,`/x402/*`,`/healthz` bypass token gate | ✅ | `endpoint-security-compat.test.ts` | route-unit |
| D1.2 | Non-public/control paths require token | ✅ | `endpoint-security-compat.test.ts` | route-unit |
| D1.3 | Misconfigured global gate detected by healthcheck | ✅ | healthcheck + compat tests | route-unit |

## Bucket E — Operational Reliability

| ID | Scenario | Status | Evidence | Lane |
|---|---|---|---|---|
| E1.1 | Tunnel/proxy failure marks specialist offline | ✅ | `lib/__tests__/endpoint-manager-reliability.test.ts` | route-unit |
| E1.2 | Quick-fix commands surfaced in UI | ✅ | `lib/__tests__/endpoint-manager-reliability.test.ts` (remediation notes) | route-unit/manual |
| E1.3 | Heartbeat restore flips online | ✅ | `lib/__tests__/endpoint-manager-reliability.test.ts` | route-unit |
| E2.1 | Missing operator env gives recovery guidance | ✅ | operator key status checks | route-unit |
| E2.2 | Operator rotation procedure documented/tested | ✅ | runbook + `operator-key-rotation.test.ts` | route-unit |
| E3.1 | RPC env override respected | ✅ | `program-rpc-config.test.ts` | route-unit |
| E3.2 | Devnet fallback when unset | ✅ | `program-rpc-config.test.ts` | route-unit |
| E3.3 | RPC endpoint usage consistency | ✅ | `program-rpc-config.test.ts` | route-unit |

## Bucket F — Cross-Token Settlement (Jupiter)

| ID | Scenario | Status | Evidence | Lane |
|---|---|---|---|---|
| F1.1 | Auto-swap needed on token mismatch | ✅ | payment tests | route-unit |
| F1.2 | sendPayment executes Jupiter swap | ✅ | payment tests | route-unit |
| F1.3 | Fails fast without swap client | ✅ | payment tests | route-unit |
| F1.4 | Swap receipt included in payment receipt | ✅ | payment tests | route-unit |
| F1.5 | getJupiterClient null without API key | ✅ | jupiter-client tests | route-unit |
| F1.6 | getJupiterClient singleton with key | ✅ | jupiter-client tests | route-unit |
| F1.7 | Planner invoke passes swap client | ✅ | planner invoke tests | route-unit |

## Bucket G — Torque Retention

| ID | Scenario | Status | Evidence | Lane |
|---|---|---|---|---|
| G1.1-G1.5 | Torque client enablement/no-op/failure behavior | ✅ | `torque-client.test.ts` | route-unit |
| G1.6 | SPECIALIST_JOB_COMPLETED emitted after release | ✅ | x402 settlement integration | route-unit |
| G1.7 | CONSUMER_QUERY_RUN emitted after planner invoke | ✅ | onboarding/planner event wiring | route-unit |
| G1.8 | RATING_SUBMITTED emitted after commit | ✅ | reputation signal path | route-unit |
| G2.1-G2.2 | leaderboard empty/failure behavior | ✅ | leaderboard route tests | route-unit |
| G2.3-G2.6 | leaderboard UI + attribution/no token leak | ✅ | `e2e/leaderboard.spec.ts` | e2e-ui |

## Bucket H — Consumer Orchestrator Lifecycle

| ID | Scenario | Status | Evidence | Lane |
|---|---|---|---|---|
| H1.1-H1.3 | register_consumer valid/idempotent/invalid | ✅ | `planner-register-consumer-route.test.ts` | route-unit |
| H1.4 | tools manifest includes consumer tools | ✅ | `planner-tools-manifest-route.test.ts` | route-unit |
| H2.1 | resolve_specialist deterministic candidate | ✅ | `planner-resolve-route.test.ts` | route-unit |
| H2.2-H2.3 | resolve_attestor + no-candidate path | ✅ | `planner-resolve-attestor-route.test.ts` | route-unit |
| H3.1-H3.5 | invoke + settlement lifecycle + guards | ✅ | invoke/release route tests | route-unit |
| H4.1-H4.2 | quality signal persisted + commit trigger | ✅ | signal route tests | route-unit |
| H4.3 | settlement + rating independently auditable | ✅ | `planner-auditability.test.ts` | route-unit |

---

## Current Gaps (from map)
1. Integration lane is telemetry-backed (including probe-vs-selected model mismatch), but infra availability remains environment-dependent (expected for runtime-backed lane).
2. Scenario map promotion to executable Gherkin now spans all active buckets (`docs/bdd/features/bucket-a-onboarding.feature`, `docs/bdd/features/bucket-b-discovery.feature`, `docs/bdd/features/bucket-c-planner-consumption.feature`, `docs/bdd/features/bucket-d-e-reliability.feature`, `docs/bdd/features/bucket-f-jupiter-settlement.feature`, `docs/bdd/features/bucket-g-torque-retention.feature`, `docs/bdd/features/bucket-h-consumer-orchestrator.feature`).
3. Operational verification index is now available at `docs/bdd/FEATURE-INDEX.md`.
4. Index drift guard command is available: `npm run test:bdd:index`.
5. PR-time CI enforcement for drift guard is wired: `.github/workflows/bdd-index-guard.yml`.
6. One-command representative bucket confidence sweep is available: `npm run test:bdd:sweep`.
7. CI/manual-dispatch confidence lane is wired: `.github/workflows/bdd-bucket-sweep-confidence.yml`.
8. Sweep lane now produces structured artifacts per run (`artifacts/bdd-sweep/<timestamp>/SUMMARY.md`, log, steps table).
9. Latest sweep quick-status command is available: `npm run test:bdd:status`.
10. Sweep CI workflow now prints quick status in logs after each run (`bdd-bucket-sweep-confidence.yml`).
11. E1 deterministic reliability contracts are now directly covered (`endpoint-manager-reliability.test.ts`).
12. Sweep CI reporting polish is complete: workflow now writes `$GITHUB_STEP_SUMMARY` with quick status + summary artifact path.
13. Closure snapshot published: `docs/BDD-GAP-CLOSURE-SNAPSHOT-2026-04-19.md` (includes residual-risk register + maintain-mode recommendation).
14. Post-closure scope delivered (without changing one-agent-per-wallet): authenticated devnet banner + owner dashboards (`/dashboard`, `/specialist`, `/attestation`, `/consumer`) backed by onboarding stats routes.
