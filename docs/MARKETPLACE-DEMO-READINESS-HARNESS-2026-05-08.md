# Marketplace Demo Readiness Harness — 2026-05-08

> **Historical harness plan.** This file predates current RAP Assurance claim remediation. Treat “marketplace” and devnet proof language as archived test framing, not current production, custody, settlement, or mainnet claims.

## Purpose

Provide one local-first gate before creating onboarding or hackathon demo collateral for the Reddi Agent Protocol RAP Assurance funnel.

The harness proves:

1. BDD conversion flows still work.
2. A Playwright recording journey can be captured.
3. MCP bridge payment semantics pass on Surfpool.
4. Economic demo payment/reputation semantics pass on Surfpool.
5. Onboarding registration + attestation semantics pass on Surfpool.
6. Bounded devnet proof is skipped unless explicitly requested.

## Command

```bash
npm run demo:marketplace:readiness
```

Outputs go to:

```text
artifacts/marketplace-demo-readiness/<timestamp>/
```

The harness writes:

- `summary.json`
- `SUMMARY.md`
- per-step logs
- copied Playwright recording video as `marketplace-recording.webm` when available

Recording pace can be tuned with:

```bash
MARKETPLACE_RECORDING_PACE_MS=1500 npm run demo:marketplace:readiness -- --skip-surfpool
```

## Fast mode

Use this while iterating on UI/recording choreography:

```bash
npm run demo:marketplace:readiness -- --skip-surfpool
```

This runs conversion BDD and recording only.

## Plan-only mode

Use this to inspect intended gates without running them:

```bash
npm run demo:marketplace:readiness -- --plan-only
```

## Bounded devnet mode

Only after local Surfpool gates pass and the operator intentionally wants a bounded devnet proof:

```bash
npm run demo:marketplace:readiness -- --include-devnet
```

Devnet mode still does not imply mainnet readiness.

## Recording journey

The Playwright recording route follows:

1. Homepage hero.
2. MCP bridge for existing agent systems.
3. Planner policy-before-payment path.
4. Specialist `/register` monetization path with `reddi-x402`.
5. Attestor verification path.
6. Economic demo proof/evidence page.

The narration script should be based on the captured video and readiness artifacts, not aspirational copy. A draft storyboard/script lives in `docs/MARKETPLACE-DEMO-STORYBOARD-2026-05-08.md`.

## Guardrails

- No mainnet execution.
- Devnet proof is opt-in.
- Surfpool local validator gates must pass before bounded devnet recording.
- Keep Jupiter devnet execution framed as unreliable unless separately proven.
- Keep wallet delegation bounded by spend cap, expiry, network, allowed specialists/programs, and receipt logging.

## Live product recording requirement

The final hackathon demo video should be recorded against the published live product link:

```text
https://agent-protocol.reddi.tech
```

Use localhost only for rehearsal/debugging. The submitted 3-minute demo should show the live product, compressing low-value waiting with fast-forward where needed.

After the live-product recording is captured, generate narration from the actual footage, then use Jarvis voice in chunked Chatterbox runs to avoid memory pressure.

## Live product recording command

For the final public product capture, point Playwright at the deployed app and use slower pacing:

```bash
PLAYWRIGHT_BASE_URL=https://agent-protocol.reddi.tech \
MARKETPLACE_RECORDING_PACE_MS=2500 \
npm run demo:marketplace:readiness -- --skip-surfpool
```

This skips local Surfpool because the purpose is the live user-flow capture. Keep the Surfpool proof packet from the local-first harness beside the final video packet for evidence.
