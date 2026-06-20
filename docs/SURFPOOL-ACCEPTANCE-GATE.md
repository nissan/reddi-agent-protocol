# Surfpool Acceptance Gate

## Purpose
Provide a repeatable acceptance gate for the local Surfpool-based proof lanes before demo/release checkpoints.

## Lanes
- `npm run test:surfpool:critical`
- `npm run test:surfpool:onboarding`
- `npm run test:surfpool:onboarding-wrapper`
- `npm run test:surfpool:jupiter-invoke`

## Artifacts
Each lane writes timestamped artifacts under:
- `artifacts/surfpool-smoke/<timestamp>/`
- `artifacts/surfpool-onboarding/<timestamp>/`
- `artifacts/surfpool-onboarding-wrapper/<timestamp>/`
- `artifacts/surfpool-jupiter-invoke/<timestamp>/`

Primary evidence file per run: `SUMMARY.md`.

## Manual CI Trigger
Workflow: `.github/workflows/surfpool-acceptance-manual.yml`
- Trigger via `workflow_dispatch`
- Select lane input (`critical`, `onboarding`, `onboarding-wrapper`, `jupiter-invoke`)
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
