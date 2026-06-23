# Pay.sh Live Activation Gates And Spend Policy

Issue: [#476](https://github.com/nissan/reddi-agent-protocol/issues/476)

This document defines the go/no-go policy for any future live Pay.sh use by Reddi Agent Protocol. It is a planning and security artifact only. It does not authorize Pay.sh setup, wallet setup, wallet top-up, RPC/Solana calls, provider calls, paid requests, catalog submission, hosted registry writes, trust upgrades, reputation mutation, mainnet, or live payment activation.

## Current State

RAP can safely show Pay.sh-related proof today in these bounded states:

- Static catalog and provider metadata can be reviewed as untrusted external input.
- Provider spec previews can be generated without submission.
- Historical Pay.sh sandbox evidence can be normalized into fixture receipts and proof-chain references.
- The Superteam Australia demo can verify no-spend proof, recorded devnet transaction checks, and an optional fresh devnet gate.
- The optional fresh devnet gate is not a standing spend policy. It is a per-run approval checkpoint that must match payer, recipient, endpoint, network, and cap before any smoke command is allowed.

RAP cannot safely claim these states yet:

- production Pay.sh activation;
- default USDC auto-pay for agents;
- production AUDD payment rail;
- custody or settlement-finality;
- mainnet settlement;
- live trust or reputation mutation.

## Activation States

Use these exact state labels in issues, docs, UI, and evidence summaries.

| State | Meaning | Allowed | Blocked |
| --- | --- | --- | --- |
| `catalog-only` | RAP has static Pay.sh catalog/provider metadata. | Source hash, diagnostics, review notes. | Payment proof, provider quality, RAP attestation. |
| `spec-preview` | RAP can produce a Pay.sh-compatible preview payload. | Local validation and operator review. | Pay.sh submission or listed-on-Pay.sh claim. |
| `sandbox-evidence` | Prior sandbox/localnet evidence exists and is stored as fixture proof. | Receipt normalization and proof-chain fixture references. | Re-running sandbox or live payment without approval. |
| `devnet-gated` | A specific devnet test has an explicit one-run gate artifact. | Exact approved command, cap, payer, recipient, endpoint, and network. | Reuse for a different endpoint, payer, recipient, network, cap, or session. |
| `live-gated` | A future live path is proposed but not approved. | Planning, risk review, non-live evidence collection. | Any payment, provider call, wallet/RPC, catalog submission, or hosted write. |
| `live-enabled` | Reserved for a future approved implementation. | Only the exact approved flow. | Any broader agent auto-pay, hidden retry, uncapped spend, or mainnet drift. |
| `suspended` | A live or proposed lane is halted. | Investigation, rollback, evidence retention. | New calls, retries, publication, or trust/reputation updates. |

## Required Approval Record

Before any command can move beyond `catalog-only`, `spec-preview`, or stored fixture evidence, there must be a written approval record in the active issue or linked artifact.

The approval record must include:

- approver and timestamp;
- environment: sandbox/localnet, Solana devnet, or mainnet;
- asset and network;
- exact payer or signer public key;
- exact recipient/payee;
- exact provider endpoint or catalog target;
- maximum spend cap for the single run and for the session;
- whether retries are allowed, and if so, the retry count;
- exact command or UI action approved;
- evidence output path;
- rollback/suspend owner;
- expiry time or statement that approval is single-use.

Missing, stale, or ambiguous approval means no-go.

## Spend Policy

Default policy:

- Live payment allowed: no.
- Mainnet allowed: no.
- Auto-pay allowed: no.
- Provider calls allowed: no.
- Wallet/RPC operations allowed: no.
- Hosted registry writes allowed: no.
- Trust or reputation mutation allowed: no.

Future non-mainnet single-run policy may be approved only when all of these are true:

1. The provider endpoint is exact and allowlisted.
2. The payer public key matches the local keypair-derived public key before payment.
3. The recipient/payee in the challenge matches the approved recipient.
4. The network is `solana-devnet` or approved sandbox/localnet.
5. The cap is in USDC-equivalent units and is lower than or equal to the approval record.
6. The command records receipt evidence and a summary artifact.
7. The verifier confirms transaction success, recipient destination, asset, network, and cap after the run.
8. A failed, mismatched, or partial verification blocks any trust, reputation, publication, or settlement-finality claim.

Mainnet policy is stricter:

- Mainnet requires a separate Nissan approval that says "mainnet" explicitly.
- Mainnet approval must include a maximum total loss amount and a kill switch.
- Mainnet approval must identify the funded wallet, custody owner, and fund source.
- Mainnet approval must pass security review before any command is run.

## Auto-Pay Policy

`auto_pay` is disabled for RAP-controlled automation.

It may only be considered in a future issue if all of these are true:

- bounded per-call and per-session caps are enforced in code;
- endpoint and recipient allowlists are enforced before each payment;
- provider pricing is re-read and checked before each payment;
- every paid call emits a receipt and audit row;
- retries are bounded and count against the same cap;
- operator can suspend the lane without code changes;
- the issue explicitly approves auto-pay by name.

Any Pay.sh, provider, MCP, or agent setting that implies unbounded auto-pay is a no-go.

## Wallet And RPC Policy

Wallet and RPC use are separate approval gates, not side effects of Pay.sh approval.

Before wallet/RPC use:

- use a dedicated test wallet, not a primary operator wallet;
- verify the local keypair-derived public key matches the approval record;
- record the funding source and maximum balance at risk;
- use the exact RPC endpoint from the approval record;
- disable hidden top-ups and background polling unless explicitly approved;
- keep private keys, mnemonics, seed phrases, auth headers, and provider tokens out of artifacts.

Receipt and evidence artifacts may contain public keys, signatures, endpoint hostnames, caps, and hashes. They must not contain private key material or provider credentials.

## Provider Trust Gate

Provider responses, payment challenges, headers, docs, OpenAPI specs, and catalog metadata are untrusted inputs.

Before a paid provider call:

- source metadata must be captured with URL and hash;
- pricing must be parsed and bounded;
- challenge payee must match approved recipient/payee;
- asset and network must match approved values;
- response data must be treated as untrusted until validated;
- unsupported, malformed, missing-price, missing-payee, wrong-network, wrong-asset, and over-cap cases must fail closed.

## Evidence Retention

Every approved run must retain:

- approval record URL or artifact path;
- gate artifact;
- command line with secrets redacted;
- payer, recipient, network, asset, endpoint, and cap;
- receipt or signature reference;
- verifier result;
- failure reason if blocked;
- safe and unsafe claim summary.

Evidence must be append-only from the operator perspective. Do not replace a failed or blocked run with a later passing run without preserving both.

## Rollback And Suspension

Suspend immediately if any of these happen:

- endpoint, payer, recipient/payee, network, asset, or cap drift;
- unexpected provider challenge shape;
- transaction fails or verifier cannot prove the recipient destination;
- receipt is missing, malformed, or over cap;
- artifact contains secrets;
- UI or docs imply production activation, settlement finality, custody, or trust/reputation mutation before approval;
- provider price changes after approval;
- repeated 402/payment loop behavior appears.

Suspension actions:

1. Stop all further calls and retries.
2. Preserve the gate, command, receipt, verifier output, and logs.
3. Comment on the active issue with the exact mismatch and artifact paths.
4. Mark downstream UI, publication, trust, and reputation claims blocked.
5. Require a new approval record before resuming.

## Go/No-Go Checklist

Go only if every answer is "yes":

- Is there a current approval record naming the exact action?
- Is the environment approved and non-mainnet unless mainnet is explicitly named?
- Is the payer key derived locally and equal to the approval record?
- Is the recipient/payee equal to the approval record?
- Is the endpoint exact and allowlisted?
- Is the asset/network supported by the verifier?
- Is the spend cap present and enforced before payment?
- Are retries disabled or explicitly capped?
- Will receipt evidence be written?
- Will the verifier run immediately after payment?
- Is there a rollback/suspend owner?
- Are unsafe claims blocked until verification passes?

No-go if any answer is "no", "unknown", or "not applicable".

## Current Verification Commands

No-spend and docs/process validation:

```bash
npm run check:superteam:devnet-demo
npm run check:economic-demo:live-payment-gate
npm run verify:economic-demo:devnet-usdc-receipt
npm run check:rap:naming
npm run test:bdd:index
git diff --check
```

The default `check:economic-demo:live-payment-gate` and `verify:economic-demo:devnet-usdc-receipt` modes are expected to fail closed or block without the explicit confirmation inputs. Passing those default blocked modes is safety evidence, not payment evidence.

## Related Documents

- [`docs/HOSTED-MARKETPLACE-OPERATIONS-READINESS-RUNBOOK.md`](HOSTED-MARKETPLACE-OPERATIONS-READINESS-RUNBOOK.md)
- [`docs/SUPERTEAM-AUSTRALIA-DEVNET-DEMO-RUNBOOK-2026-06-23.md`](SUPERTEAM-AUSTRALIA-DEVNET-DEMO-RUNBOOK-2026-06-23.md)
- [`docs/PAY-SH-DEVNET-SANDBOX-RESEARCH-2026-05-13.md`](PAY-SH-DEVNET-SANDBOX-RESEARCH-2026-05-13.md)
- [`docs/RAP-RECEIPT-POLICY-V1.md`](RAP-RECEIPT-POLICY-V1.md)
