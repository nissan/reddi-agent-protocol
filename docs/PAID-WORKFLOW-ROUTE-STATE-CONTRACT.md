# Paid Workflow Route State Contract

_Issue: #497 | Status: v0.1 contract | Scope: no-spend route state and copy boundaries_

## Intent

The buyer paid-workflow route must reuse the existing public proof chain instead of inventing a second proof shape. This contract defines the route states, source contracts, and copy boundaries for the broader #349 product UI before #498/#499 render the route and ledger/timeline.

The route is a product-facing walkthrough of quote -> budget ledger -> execution timeline -> result -> receipt/evidence -> attestation preview -> reputation preview. It is not a live-payment approval, hosted publication path, custody claim, settlement-finality proof, or reputation mutation.

## Source Contracts

The paid-workflow route consumes these completed surfaces:

- `reddi.economic-demo.public-proof-page-data.v1` from `lib/economic-demo/public-proof-page-data.ts`.
- `reddi.economic-demo.paid-workflow-proof-ui-fixture-pack.v1` from `lib/economic-demo/paid-workflow-proof-ui-fixtures.ts`.
- `reddi.rail-neutral-proof-chain-fixture.v1` from `@reddi/agent-protocol/rail-neutral-proof-chain-fixture`.
- The no-spend package example in `packages/agent-protocol/examples/ard-no-spend-demo.mjs`.
- The public proof route `/economic-demo/public-proof`.
- The Superteam Australia runbook in `docs/SUPERTEAM-AUSTRALIA-DEVNET-DEMO-RUNBOOK-2026-06-23.md`.
- The live activation policy in `docs/PAY-SH-LIVE-ACTIVATION-GATES-AND-SPEND-POLICY.md`.

Downstream UI work must adapt these contracts. It must not call Pay.sh, RPC, wallets, provider endpoints, hosted registry writes, or marketplace publication paths to derive route state.

## Route State Model

| State | Meaning | Required surface | Route behavior |
| --- | --- | --- | --- |
| `quote_ready` | Buyer can inspect the deterministic quote. | `quote` from public proof page data. | Show total, downstream fees, attestor fees, orchestrator markup, rail fee, and swap allowance. |
| `budget_ledger_ready` | Budget rows can be rendered without live spend. | paid-workflow UI fixture sections. | Show buyer budget, specialist cost, attestor/proof cost, fee/margin, remaining/refund state, and unspent/blocked rows. |
| `execution_timeline_ready` | Workflow milestones can be shown as proof states. | public proof page state labels and rail-neutral cases. | Show request, quote, policy decision, planned execution, result, receipt, evidence, attestation preview, and reputation preview. |
| `result_ready` | Fixture result can be shown. | paid-workflow UI fixture result section. | Show no-network/no-spend result summary and source refs. |
| `receipt_binding_ready` | Receipt/evidence refs and hashes are binding-ready. | Pay.sh sandbox single-charge proof-chain case. | Render refs/hashes only; never imply settlement or custody. |
| `evidence_refs_ready` | EvidenceArchive refs can be shown. | public proof `evidenceArchive` and fixture refs. | Show evidence refs, request hash, response hash, and limitations. |
| `attestation_preview_only` | Attestation is a draft preview. | `attestationDraft.status === "draft_only"`. | Show draft state; no attestation submission or trust upgrade. |
| `reputation_preview_only` | Reputation is a draft preview. | `reputationDraft.mutationAllowed === false`. | Show commit/reveal unavailable; no mutation. |
| `blocked_fail_closed` | A proof case cannot be promoted. | `blockedBy` rail-neutral case data. | Render blocked reason and recovery note; keep spending/mutation flags false. |
| `live_gated_only` | Fresh devnet/live path exists only as policy. | #476 policy and Superteam optional gate docs. | Show approval-required label; do not expose run button or auto-pay path. |
| `production_disabled` | Production live payment/settlement is disabled. | boundary flags and state labels. | Show disabled state; prevent production/live copy claims. |

## Copy Boundary Matrix

| Mode | May say | Must not say |
| --- | --- | --- |
| `fixture_zero_spend` | Deterministic fixture data, no network, no spend. | Paid, settled, executed live, custody-backed, published, trusted. |
| `planned_dry_run` | Planned quote, policy, ledger, and proof refs. | Wallet signed, provider called, RPC verified, funds moved. |
| `simulated` | Simulated result or preview state. | Production result, verified live service response. |
| `devnet_proof_metadata` | Recorded devnet proof metadata or optional fresh-devnet gate exists. | Mainnet settlement, production activation, default USDC auto-pay. |
| `live_gated` | Fresh paid run needs explicit approval record, cap, endpoint, payer, payee, command, evidence path, rollback owner, and expiry. | Approval is already granted, auto-pay is enabled, any route can spend. |
| `production_live_disabled` | Production live payment is disabled by default. | Pay.sh production active, production AUDD rail active, hosted registry write ready. |

## Always-False Boundary Flags

The route must keep these false unless a future issue explicitly changes the contract with tests and approval:

- `walletSigning`
- `rpcCall`
- `providerCall`
- `paidRequest`
- `sandboxExecution`
- `hostedRegistryWrite`
- `marketplacePublication`
- `trustUpgrade`
- `reputationMutation`
- `custodyClaim`
- `settlementFinalityProof`
- `livePayment`
- `productionAuddRail`
- `defaultUsdcAutoPay`
- `mainnetSettlement`
- `payShProductionActivation`

## Blocked Cases

The route must render these cases as blocked/fail-closed states:

- Tempo unsupported network.
- Unsupported asset or network.
- Malformed receipt.
- Policy denied.
- Live-path overclaim.
- Missing evidence.
- Missing payment setup.
- Missing or expired approval record.
- Payer, recipient/payee, endpoint, network, asset, cap, receipt, or verifier mismatch.
- Any auto-pay or default-live ambiguity.

## UI Evidence Requirements

Any PR implementing this contract in UI must include:

- Mobile, tablet, and desktop screenshots.
- Video or Playwright trace for quote -> ledger -> result -> receipt/evidence flow.
- Screenshot or trace coverage for at least one blocked/fail-closed case.
- A short PR note describing changed UI, verified states, and unchanged no-live boundaries.

## Validation Expectations

For this contract slice:

- `npm run test:bdd:index`
- `npm run check:rap:naming`
- `git diff --check`

For downstream UI slices:

- Focused lint/typecheck for route/components.
- Focused unit tests for route state mapping if helpers are added.
- Playwright route coverage with visual artifacts.
