# Surfpool Acceptance Gate

## Purpose
Provide a repeatable acceptance gate for the local Surfpool-based proof lanes before demo/release checkpoints.

## Lanes
- `npm run test:surfpool:critical`
- `npm run test:surfpool:quasar-critical`
- `npm run test:surfpool:onboarding`
- `npm run test:surfpool:onboarding-wrapper`
- `npm run test:surfpool:jupiter-invoke`

The two critical lanes run on the SDK-managed local Surfnet lifecycle (dynamic
loopback ports, per-run state, PASS-only evidence receipts); that contract is owned by
[`SURFPOOL-QUASAR-CRITICAL-SDK-LANE.md`](./SURFPOOL-QUASAR-CRITICAL-SDK-LANE.md), along
with the regression suites `npm run test:surfpool:lane-regressions` runs.

## Artifacts
Each lane writes per-run artifacts under:
- `artifacts/surfpool-smoke/<run-id>/`
- `artifacts/surfpool-quasar-smoke/<run-id>/`
- `artifacts/surfpool-onboarding/<timestamp>/`
- `artifacts/surfpool-onboarding-wrapper/<timestamp>/`
- `artifacts/surfpool-jupiter-invoke/<timestamp>/`

Primary evidence file per run: `SUMMARY.md`. For the critical lanes, cite the run named
by the `accepted-evidence.json` receipt rather than the newest directory — the receipt is
written only on PASS and is validated against target, freshness, source fingerprint, and
artifact hashes.

## Manual CI Trigger
Workflow: `.github/workflows/surfpool-acceptance-manual.yml`
- Trigger via `workflow_dispatch`
- Select lane input (`critical`, `quasar-critical`, `onboarding`, `onboarding-wrapper`, `jupiter-invoke`)
- Uploads surfpool artifacts for retention.

## Release Gate Recommendation
For checkpoint PRs that touch settlement/onboarding/security paths:
1. Run at least `critical` + one role-specific lane.
2. Attach `SUMMARY.md` paths in PR description.
3. Block merge on unresolved acceptance regressions.

## Quasar And Devnet Promotion

For Quasar instruction-builder, program, or deploy-path PRs, use the dedicated promotion checklist before any devnet-funded wallet is used:

- [`QUASAR-SURFPOOL-DEVNET-PROMOTION-CHECKLIST.md`](./QUASAR-SURFPOOL-DEVNET-PROMOTION-CHECKLIST.md)

Package/read-model, docs, fixture, and disabled-UI work does not need Surfpool or devnet unless it starts building instructions, signing, probing RPC, mutating program state, or making live payment/publication/reputation claims.
