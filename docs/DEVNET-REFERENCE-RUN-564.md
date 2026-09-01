# Devnet Reference Run Operator Runbook (#564)

Issue: [#564](https://github.com/nissan/reddi-agent-protocol/issues/564) — Ship one live-gated x402 reference paid workflow on Solana devnet with public proof data contract.
Parent gate: [`QUASAR-SURFPOOL-DEVNET-PROMOTION-CHECKLIST.md`](./QUASAR-SURFPOOL-DEVNET-PROMOTION-CHECKLIST.md) (#441).

> **REQUIRES OPERATOR (Nissan) — not executable by autonomous agents.**
> Every step in the "Live Devnet Run" and "Post-Run" sections spends devnet funds, signs transactions, or publishes evidence. Autonomous agents must stop at the rehearsal boundary. Nothing in this runbook authorizes mainnet, production wallets, custody, or settlement-finality claims.

## What Is Already Prepared (no approval needed)

These are static/dry-run lanes any contributor or agent can run:

```bash
npm run rehearse:x402-reference-workflow   # end-to-end no-live rehearsal; emits #417-shaped proof artifact
npx jest lib/__tests__/economic-demo-x402-reference-workflow-rehearsal.test.ts --runInBand
```

The rehearsal walks the full A2A loop — discover → quote → policy preflight → x402 payment plan (dry-run proof ref only) → receipt → evidence → #417 public proof page data contract emission — and writes `artifacts/economic-demo-x402-reference-rehearsal/<timestamp>/{rehearsal.json,SUMMARY.md}` (gitignored). Real-vs-test metering fields are present with the real side hard-zeroed and `meteringMode: "test"`. The script fails closed if any live-gated boundary flag is not `false`.

## Live Run Overview

The live lane is the already-merged, env-gated `runEconomicDemoLivePaidDevnet` path (`lib/economic-demo/live-paid-devnet-run.ts`), reached via `POST /api/economic-demo/live-run` with `mode: "live_paid_devnet"`. It:

- pays exact x402 USDC challenges on **solana-devnet only** for the four allowlisted hosted specialists: `planning-agent`, `content-creation-agent`, `code-generation-agent`, `verification-validation-agent`;
- enforces a hard call cap (4) and hard spend cap (default **0.2 USDC**, not raisable above the default via env);
- fails closed on any challenge that does not match the exact allowlisted endpoint, wallet, network, or currency;
- refuses before loading the signer, building a transaction, or touching an RPC whenever the resolved network profile is not submission-ready, returning a `status: "blocked"` envelope with a `profile_not_submission_ready` timeline step (see [`NETWORK-PROFILES.md`](./NETWORK-PROFILES.md)) — so arm this lane from a build whose profile resolves to devnet with its registered program set intact;
- never returns raw signer material.

No Quasar or Anchor program state is mutated by this run: payments are SPL USDC transfers to specialist wallets plus hosted x402 endpoint calls. Devnet program ids in `config/quasar/deployments.json` are unaffected.

## Preconditions — REQUIRES OPERATOR (Nissan)

All of the following must be true before arming:

1. **Rehearsal green at HEAD.** `npm run rehearse:x402-reference-workflow` and the Jest suite above pass on the commit being run.
2. **Checklist lane.** Per #441 this run is `devnet_eligible`: it uses an existing merged instruction path (SPL transfer via `@solana/web3.js` + `@solana/spl-token`), so no new Surfpool lane is required; note any skipped lane in the run log.
3. **Wallet funding.** The orchestrator devnet keypair holds:
   - ≥ 0.05 devnet SOL for transaction fees (airdrop: `solana airdrop 1 <ORCHESTRATOR_PUBKEY> --url https://api.devnet.solana.com`);
   - ≥ 0.2 devnet USDC of mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` in its associated token account (Circle devnet faucet, or an operator-held funded devnet wallet).
4. **Endpoints reachable.** The four hosted specialist endpoints (see `lib/economic-demo/openrouter-endpoints.ts`) answer with an HTTP 402 x402 challenge to an unpaid request. Spot check: `npm run smoke:economic-demo:live-x402-readiness` (probe-only, 402 observation, no payment).
5. **Environment variables** (operator shell only; never committed, never pasted into issues):
   - `ECONOMIC_DEMO_LIVE_PAID_DEVNET=1` — arms the lane
   - `ECONOMIC_DEMO_LIVE_PAID_DEVNET_CONFIRM=RUN_ECONOMIC_DEMO_LIVE_PAID_DEVNET` — explicit confirm token
   - `ECONOMIC_DEMO_ORCHESTRATOR_DEVNET_KEYPAIR_JSON='[...]'` — orchestrator signer as a JSON byte array (devnet-only key; never a production wallet)
   - `SOLANA_RPC_URL=https://api.devnet.solana.com` (or another devnet RPC)
   - `X402_USDC_DEVNET_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (default)
   - `ECONOMIC_DEMO_LIVE_PAID_DEVNET_MAX_USDC=0.2` (optional; values above 0.2 are ignored)

## Devnet Approval Gate (per #441)

- **Issue:** #564. Board epic: reddinft/openclaw-workspace#205.
- **Exact command block:** see "Live Devnet Run" below.
- **Wallet / source of funds:** operator-held devnet orchestrator keypair (env-injected). Mainnet and production wallets are **out of scope**.
- **Cluster / RPC:** solana-devnet, `https://api.devnet.solana.com` unless overridden.
- **Expected program ids / accounts:** SPL Token program + associated token accounts of the four allowlisted specialist wallets; no Quasar/Anchor program mutation.
- **Max spend:** ≤ 0.2 devnet USDC total + devnet SOL fees. Fee-only beyond the USDC challenges.
- **Expected transaction count:** ≤ 8 (up to 4 USDC challenge payments; ATA-create-idempotent instructions are bundled with them) plus optional airdrop.
- **Rollback / cleanup:** none required on-chain (devnet transfers are terminal); on abort, disarm env vars and record partial timeline. Optional wallet cleanup per [`DEVNET-AGENT-CLEANUP-RUNBOOK.md`](./DEVNET-AGENT-CLEANUP-RUNBOOK.md).
- **Artifact directory:** `artifacts/economic-demo-x402-reference-live/<timestamp>/`.

Do not run any command below until this gate is explicitly approved by Nissan on #564.

## Live Devnet Run — REQUIRES OPERATOR (Nissan)

```bash
# 1. Start the app locally with the armed environment (do NOT arm a hosted deployment)
ECONOMIC_DEMO_LIVE_PAID_DEVNET=1 \
ECONOMIC_DEMO_LIVE_PAID_DEVNET_CONFIRM=RUN_ECONOMIC_DEMO_LIVE_PAID_DEVNET \
ECONOMIC_DEMO_ORCHESTRATOR_DEVNET_KEYPAIR_JSON="$(cat /path/to/devnet-orchestrator-keypair.json)" \
SOLANA_RPC_URL=https://api.devnet.solana.com \
npm run dev

# 2. In a second shell: trigger the reference run and capture the envelope
mkdir -p artifacts/economic-demo-x402-reference-live/$(date -u +%Y%m%dT%H%M%SZ)
curl -sS -X POST http://localhost:3000/api/economic-demo/live-run \
  -H 'content-type: application/json' \
  -d '{"mode":"live_paid_devnet","scenarioId":"webpage"}' \
  | tee artifacts/economic-demo-x402-reference-live/<timestamp>/live-run-envelope.json

# 3. Disarm immediately after the run
unset ECONOMIC_DEMO_LIVE_PAID_DEVNET ECONOMIC_DEMO_LIVE_PAID_DEVNET_CONFIRM ECONOMIC_DEMO_ORCHESTRATOR_DEVNET_KEYPAIR_JSON
```

### Expected output

`livePaidDevnetRun` envelope with schema `reddi.economic-demo.live-paid-devnet-run.v1` and:

- `status: "complete"`, `network: "solana-devnet"`, `spentUsdc` ≤ 0.2;
- a timeline of `challenge_observed` → `payment_submitted` (with `txSignature`) → `completion_returned` for each of the four allowlisted profiles;
- guardrails echoing `devnetOnly`, `exactAllowlistedEndpointsOnly`, call/spend caps, `noMainnet`.

### Receipt verification — REQUIRES OPERATOR (Nissan)

For each `txSignature`, verify the on-chain USDC transfer:

```bash
ECONOMIC_DEMO_LIVE_PAYMENT_CONFIRM=RUN_ECONOMIC_DEMO_LIVE_PAYMENT_RECEIPT_LANE \
ECONOMIC_DEMO_LIVE_PAYMENT_SIGNATURE=<txSignature> \
ECONOMIC_DEMO_LIVE_PAYMENT_ASSET=USDC \
ECONOMIC_DEMO_LIVE_PAYMENT_NETWORK=solana-devnet \
ECONOMIC_DEMO_LIVE_PAYMENT_MAX_USDC=0.2 \
ECONOMIC_DEMO_LIVE_PAYMENT_PAYER=<orchestrator pubkey> \
ECONOMIC_DEMO_LIVE_PAYMENT_RECIPIENT=<specialist wallet> \
npm run verify:economic-demo:devnet-usdc-receipt
```

Cross-check one signature on a public devnet explorer (e.g. `https://explorer.solana.com/tx/<sig>?cluster=devnet`).

## Abort Criteria — stop immediately, do not retry

Abort (disarm env vars, keep partial artifacts, post findings to #564) if **any** of:

- envelope `status: "blocked"` or any timeline step `status: "blocked"`;
- a challenge mismatches the allowlist (`challenge_did_not_match_exact_allowlist`) or is not solana-devnet/USDC;
- `hard_spend_cap_exceeded`, `insufficient_devnet_usdc`, or signer parse failures;
- any prompt for mainnet, a non-allowlisted endpoint, or a spend above 0.2 USDC;
- RPC instability causing unconfirmed payment state — verify the last signature before deciding anything;
- anything unexpected relative to this runbook. Per #441: if the result differs from the plan, stop and update the issue plan before another transaction.

There is no automatic retry anywhere in the lane; a second attempt is a new operator decision.

## Post-Run — REQUIRES OPERATOR (Nissan)

1. Save the envelope, receipt verifications, and explorer links under `artifacts/economic-demo-x402-reference-live/<timestamp>/` and attach the (secret-free) summary to #564.
2. Publish proof data: promote the run's receipt/evidence refs into the #417 public proof page data lane so the public demo renders `devnet_proof_metadata` from real refs — real metering fields flip from zeros with `meteringMode: "test"` to actual counts in a follow-up PR (code change, normal review).
3. Rerun the no-live validation suite (`npm run rehearse:x402-reference-workflow` + the Jest suite) to confirm the dry-run lane still passes and still reports zero real spend for rehearsals.
4. Add a `STATUS.md` rolling-log entry and a retrospective note under #461; update roadmap under #340 (per #441 post-run evidence rules).
5. Close #564 with: rehearsal artifact, live envelope, receipt verification artifacts, and explorer links as evidence.

## Standing Boundaries

- Devnet only. Mainnet, production wallets, custody, escrow-settlement, and settlement-finality claims are out of scope.
- The confirm token and keypair env vars exist so this lane can never run by accident; never bake them into plists, CI, `.env` files, or hosted deployments.
- Autonomous agents may prepare, rehearse, test, and document — they must never set `ECONOMIC_DEMO_LIVE_PAID_DEVNET*` variables or hold the keypair.
