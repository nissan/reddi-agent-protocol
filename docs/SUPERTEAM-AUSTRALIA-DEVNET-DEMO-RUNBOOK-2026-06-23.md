# Superteam Australia Devnet Verification Demo

_Date: 2026-06-23 AEST_

## Purpose

Give Solana Superteam Australia a short, reproducible path to verify what Reddi Agent Protocol has completed on devnet and in deterministic no-spend proof mode.

This is not a production payment activation runbook. It separates:

- deterministic no-spend protocol proof;
- public devnet transaction verification;
- public proof UI inspection;
- optional fresh bounded devnet checks that require explicit operator approval.

## What Reviewers Can Verify Today

1. Public product routes load and state devnet/mainnet boundaries.
2. The public proof route renders quote, budget ledger, receipt, EvidenceArchive, attestation preview, reputation preview, and fail-closed payment states.
3. The package-level ARD no-spend example emits receipt/evidence binding refs, AUDD dry-run preflight, rail-neutral proof-chain refs, and blocked/fail-closed cases.
4. Historical devnet transaction signatures for x402 specialist payments and agent registration exist and are independently readable on Solana devnet.
5. Fresh devnet spend remains gated by explicit caps, allowlists, and confirmation tokens.

## Reviewer Prerequisites

- Node.js 20 or later.
- Git.
- Internet access to:
  - `https://agent-protocol.reddi.tech`
  - `https://api.devnet.solana.com`
  - Solana Explorer or Solscan devnet.
- Optional for fresh devnet signing only:
  - a devnet wallet/keypair;
  - devnet SOL for fees;
  - devnet USDC if running the x402 specialist payment smoke.

## Route Walkthrough

Open these routes:

```text
https://agent-protocol.reddi.tech/
https://agent-protocol.reddi.tech/economic-demo
https://agent-protocol.reddi.tech/economic-demo/public-proof
https://agent-protocol.reddi.tech/api/economic-demo/public-proof-page-data
https://agent-protocol.reddi.tech/judge-replication
```

Expected proof points:

- `/economic-demo/public-proof` shows a no-network/no-spend Pay.sh sandbox happy path as refs and hashes only.
- It shows Tempo unsupported network, unsupported asset/network, malformed receipt, policy-denied, and live-path overclaim cases as blocked/fail-closed.
- It shows hard boundary flags as false for wallet signing, RPC calls, paid requests, hosted registry writes, marketplace publication, trust/reputation mutation, custody, settlement-finality proof, and live payment.
- The public API returns `reddi.economic-demo.public-proof-page-data.v1`.

## Local Deterministic Verification

Clone and install:

```bash
git clone https://github.com/nissan/reddi-agent-protocol
cd reddi-agent-protocol
npm ci
```

Run the no-spend protocol proof:

```bash
npm --prefix packages/agent-protocol run example:ard:no-spend
```

Expected output includes:

- `reddi.ard.no-spend-demo.v1`;
- AUDD payment-plan/preflight as dry-run;
- receipt and EvidenceArchive refs;
- receipt/evidence binding refs;
- rail-neutral proof-chain refs;
- explicit false boundary flags for hosted service, paid provider request, signing, wallet mutation, RPC, SPL transfer, custody, settlement-finality proof, trust/reputation mutation, marketplace publication, and live payment.

Run the Superteam readiness checker:

```bash
npm run check:superteam:devnet-demo
```

Expected result:

```text
[superteam-devnet-demo-check] OK
```

## Public Devnet Replication Check

Run:

```bash
node scripts/judge-replication-check.mjs
```

Expected checks:

- public website routes return HTTP 2xx/3xx;
- recorded devnet x402 payment transactions exist and have no transaction error;
- recorded devnet agent registration transaction exists;
- recorded agent PDA exists under the Quasar Registry program.

The canonical transaction list is maintained in `docs/JUDGE-REPLICATION-GUIDE.md`.

## Optional Fresh Bounded Devnet Payment Demo

Do not run this section unless the operator explicitly approves a fresh devnet spend for the current demo.

Allowed scope if approved:

- Solana devnet only.
- One allowlisted specialist endpoint.
- Cap: `60000` micro-USDC unless Nissan sets a different cap in writing.
- No mainnet.
- No broad endpoint allowlist.
- No automatic retry loop.
- No production Pay.sh activation.
- No custody or settlement-finality claim.

First run the safe gate:

```bash
ECONOMIC_DEMO_LIVE_PAYMENT_CONFIRM=RUN_ECONOMIC_DEMO_LIVE_PAYMENT_RECEIPT_LANE \
ECONOMIC_DEMO_LIVE_PAYMENT_ASSET=USDC \
ECONOMIC_DEMO_LIVE_PAYMENT_NETWORK=solana-devnet \
ECONOMIC_DEMO_LIVE_PAYMENT_MAX_USDC=0.06 \
ECONOMIC_DEMO_LIVE_PAYMENT_PAYER=<devnet-payer-public-key-or-secure-ref> \
ECONOMIC_DEMO_LIVE_PAYMENT_RECIPIENT=<devnet-recipient-public-key> \
npm run check:economic-demo:live-payment-gate
```

If the gate is ready and a fresh x402 specialist smoke is approved:

```bash
RAP_MCP_LIVE_X402_SPECIALIST_SMOKE=1 \
RAP_MCP_DEVNET_WALLET_KEYPAIR=<secure-local-devnet-keypair-path> \
RAP_MCP_DEVNET_RPC_URL=https://api.devnet.solana.com \
RAP_MCP_DEVNET_USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU \
RAP_MCP_DEVNET_MAX_USDC_MICRO_UNITS=60000 \
npm --prefix packages/rap-mcp-bridge run smoke:live-x402-specialist
```

If a devnet USDC signature already exists and the reviewer only needs verification:

```bash
ECONOMIC_DEMO_LIVE_PAYMENT_CONFIRM=RUN_ECONOMIC_DEMO_LIVE_PAYMENT_RECEIPT_LANE \
ECONOMIC_DEMO_LIVE_PAYMENT_ASSET=USDC \
ECONOMIC_DEMO_LIVE_PAYMENT_NETWORK=solana-devnet \
ECONOMIC_DEMO_LIVE_PAYMENT_MAX_USDC=0.06 \
ECONOMIC_DEMO_LIVE_PAYMENT_PAYER=<payer-public-key-or-reference> \
ECONOMIC_DEMO_LIVE_PAYMENT_RECIPIENT=<recipient-public-key> \
ECONOMIC_DEMO_LIVE_PAYMENT_SIGNATURE=<devnet-signature> \
npm run verify:economic-demo:devnet-usdc-receipt
```

The verifier does not sign or submit transactions. It only checks an existing devnet transaction against the declared recipient and cap.

## Demo Script For Superteam

1. Start with `/economic-demo`: show the current economic workflow and the no-wallet default path.
2. Open `/economic-demo/public-proof`: show quote -> ledger -> receipt -> EvidenceArchive -> attestation/reputation previews.
3. Call out the blocked cases: unsupported network, unsupported asset/network, malformed receipt, policy denial, and live-path overclaim.
4. Run `npm --prefix packages/agent-protocol run example:ard:no-spend`.
5. Run `node scripts/judge-replication-check.mjs`.
6. If explicit approval exists, run the fresh bounded devnet x402 specialist smoke. Otherwise show the recorded devnet txs from `docs/JUDGE-REPLICATION-GUIDE.md`.

## Safe Claims

Safe to say:

- Reddi Agent Protocol has a devnet-verifiable demo trail.
- x402 specialist payment evidence exists on Solana devnet for recorded runs.
- The protocol package emits deterministic no-spend receipt, EvidenceArchive, AUDD dry-run preflight, and rail-neutral proof-chain evidence.
- The public proof page renders the paid workflow ledger and fail-closed cases without executing spend.
- Fresh devnet spend is gated by explicit confirmation, cap, allowlist, and receipt verification.

Not safe to say yet:

- AUDD is live as a production payment rail.
- USDC auto-pay is enabled by default for marketplace agents.
- Pay.sh live activation or production spend policy is enabled.
- Quasar custody or settlement-finality is proven for the public proof page.
- Reputation/trust mutation is live.
- Mainnet settlement is available.

## Review Pass Criteria

The demo passes if a reviewer can independently verify:

- public routes load;
- no-spend package proof emits the expected schema and boundaries;
- public proof route and API expose the expected proof state;
- recorded devnet transaction signatures are present and successful on Solana devnet;
- any fresh devnet payment was explicitly approved, capped, allowlisted, verified, and documented.

