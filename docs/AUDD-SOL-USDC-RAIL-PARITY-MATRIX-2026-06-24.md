# AUDD / SOL / USDC Rail-Parity Matrix

Date: 2026-06-24

Issue: #525

Parent gate: #524

## Decision

AUDD is a first-class Reddi Agent Protocol payment rail beside SOL and USDC for
roadmap, quote, buyer-policy, receipt, evidence, and future UI/API copy
purposes.

For v0.1, AUDD support is payment-plan and proof-metadata support. It is not
AUDD custody, SPL-token escrow, live payment activation, mainnet readiness, or
settlement-finality proof. This matches the #392 AUDD / Quasar escrow decision:
do not change Quasar, Anchor, or SPL custody programs for the first AUDD
rollout.

## Rail State Definitions

- `fixture`: static or unit-test data only.
- `dry-run`: local preflight or no-spend flow can allow or deny the rail.
- `proof-metadata-only`: receipt/evidence can bind a payment proof reference,
  but RAP does not execute or custody the payment.
- `devnet-gated`: possible future proof requires explicit devnet approval,
  wallet/RPC scope, transaction count, spend cap, and artifact path.
- `live-gated`: live path requires explicit operator approval and separate
  readiness evidence.
- `custody-supported`: RAP program custody supports the rail.
- `unsupported`: the rail/state pair is not currently supported.

## Current Matrix

| Rail | Current v0.1 state | Quote / plan | Buyer policy | Receipt / evidence | Contract custody |
| --- | --- | --- | --- | --- | --- |
| SOL | `dry-run`, `devnet-gated`, `custody-supported` for selected SOL escrow surfaces | Generic payment challenge can quote SOL on allowed Solana networks | Generic buyer preflight can allow SOL through `allowedRails` and budget policy | Receipt v1 allowlist includes SOL on devnet, testnet, and mainnet-beta fixtures | SOL lamports are the only current custody rail in Anchor reference and Quasar escrow/PER surfaces |
| USDC | `dry-run`, `proof-metadata-only`, `live-gated` | Generic payment challenge and x402/Solana helper surfaces can express USDC | Generic buyer preflight can allow USDC through `allowedRails` and budget policy | Receipt v1 allowlist includes USDC on devnet, testnet, and mainnet-beta fixtures | No current Quasar/Anchor SPL-token custody |
| AUDD | `dry-run`, `proof-metadata-only`, `live-gated` | `reddi.audd-payment-plan.v1` expresses AUDD quote/payment-plan metadata | AUDD preflight validates network, mint, payee, settlement account, amount, expiry, evidence, approval, and budget policy | Receipt v1 allowlist includes AUDD on solana-devnet fixtures; receipt/evidence binding tests cover AUDD proof metadata | No current Quasar/Anchor SPL-token custody |

## Quote And Payment-Plan Acceptance

SOL and USDC:

- use the generic `reddi.payment-challenge.v1` shape;
- must include amount, asset, network, source, specialist, payee, nonce, endpoint,
  and mode;
- remain no-spend until buyer policy and payment execution gates approve them.

AUDD:

- uses `reddi.audd-payment-plan.v1`;
- must include asset `AUDD`, network, mint, payee, settlement account, amount,
  quote expiry, failure policy, refund policy, evidence requirement, and payment
  mode;
- must be embedded in payment challenge policy metadata when using
  `createAuddPaymentChallenge`;
- must fail closed for malformed plan data, unsupported rail, expired quote,
  missing evidence when required, missing operator approval, live payment without
  approval, max amount breach, budget denial, credential leakage, or circular
  metadata.

## Buyer Policy Acceptance

All three rails must pass the same buyer-side principles:

- explicit network and asset allowlist;
- positive integer amount in smallest units;
- optional local budget policy;
- explicit live-payment approval before live mode can proceed;
- payment proof reference before seller success response;
- audit notes that explain allow/deny decisions.

AUDD-specific buyer policy must additionally check:

- allowed mint list;
- allowed payee list;
- allowed settlement account list;
- quote/payment-plan match;
- quote expiry;
- evidence requirement;
- operator approval state.

## Receipt And Evidence Binding Acceptance

Receipt v1 currently accepts these fixture rail pairs:

- `solana-devnet:AUDD`
- `solana-devnet:USDC`
- `solana-devnet:SOL`
- `solana-testnet:USDC`
- `solana-testnet:SOL`
- `solana-mainnet-beta:USDC`
- `solana-mainnet-beta:SOL`

This is a fixture and proof-binding allowlist, not a statement that RAP has
executed or settled all listed rails.

Receipt/evidence acceptance requires:

- payment proof reference is present;
- receipt payment network, asset, and amount are valid;
- policy decision matches the quote context;
- evidence reference and evidence hash bind the work output;
- credential-bearing metadata is rejected;
- guardrails preserve `livePaymentExecuted=false`, `walletSigning=false`,
  `rpcCall=false`, `hostedRegistryRequired=false`, and
  `reputationMutated=false` for no-spend lanes.

AUDD proof metadata may be recorded in receipt/evidence bindings only when it is
clearly labeled as proof/payment-plan metadata. It must not be described as
escrowed AUDD, settled AUDD, mainnet AUDD, or audited AUDD custody.

## Seller Wrapper And Onboarding Expectations

Seller wrapper and onboarding surfaces should expose rail state consistently:

- show SOL, USDC, and AUDD as named rails, not AUDD as a side note;
- label each rail with state: fixture, dry-run, proof-metadata-only,
  devnet-gated, live-gated, custody-supported, or unsupported;
- require AUDD mint, payee, settlement account, evidence, expiry, refund policy,
  and failure policy in generated AUDD configs;
- prevent generated configs from implying wallet/RPC calls, custody, settlement
  finality, or mainnet readiness;
- keep any future UI rail selector honest about disabled/gated states.

If a future PR changes UI or interaction copy for these rail states, it must
include screenshots and/or video recordings with descriptions.

## API Copy Requirements

Allowed wording:

- "AUDD payment-plan support"
- "AUDD proof metadata"
- "AUDD dry-run preflight"
- "AUDD live payment requires approval"
- "AUDD custody is out of scope for v0.1"

Forbidden without later audited custody evidence:

- "AUDD escrow is live"
- "AUDD custody supported"
- "AUDD settlement finality proven"
- "AUDD mainnet ready"
- "AUDD payment executed by RAP"
- "AUDD wallet/RPC transfer helper"

The same claim-boundary discipline applies to SOL and USDC. SOL has current
program custody surfaces, but deployment, devnet, mainnet, and production wallet
claims still require the #441 promotion gate and explicit approval. USDC remains
proof/helper support unless a later SPL custody issue is approved.

## Dependencies And Reverse Dependencies

Depends on:

- #524 grant-obligation roadmap gate;
- #338 rail-neutral payment strategy;
- #334 product core receipts/policy;
- #375 seller wrapper and AUDD/Solana payment-plan configuration;
- #391 AUDD payment-plan adapter;
- #392 AUDD no-custody Quasar boundary decision;
- #512/#523 OSS release smoke and claim-boundary checks.

Blocks:

- AUDD grant-facing integration-readiness statement;
- #375 publish-ready seller wrapper states;
- future paid-workflow UI rail selector/copy;
- future audited AUDD custody expansion.

## Validation Expectations

For docs-only rail matrix changes:

- `npm run check:rap:naming`
- `git diff --check`

For package changes touching payment-plan, buyer policy, receipt, or evidence
fixtures:

- `npm --prefix packages/agent-protocol test -- --runInBand`
- targeted package tests for AUDD payment plans, buyer/seller preflight,
  receipts, and receipt/evidence binding;
- `npm run check:rap:naming`
- `git diff --check`

For UI changes:

- relevant Playwright or component validation;
- desktop/mobile screenshots and/or video recordings with descriptions;
- copy must use the rail state labels in this document.

## Boundary

This matrix does not authorize:

- live/devnet payment;
- wallet, RPC, provider, or Pay.sh activation;
- Surfpool/devnet start;
- program deploy or migration;
- hosted marketplace publication;
- trust/reputation mutation;
- mainnet path;
- SOL/USDC/AUDD custody expansion;
- settlement-finality claim.

## Current Conclusion

The grant-facing roadmap should say: RAP treats AUDD, SOL, and USDC as named
payment rails, with AUDD included in quote, buyer-policy, receipt, and evidence
acceptance. The truthful v0.1 boundary is:

- SOL has current program-custody surfaces, still promotion-gated;
- USDC has proof/helper support, not RAP custody;
- AUDD has payment-plan/proof-metadata support, not RAP custody.

Future AUDD custody must be a separate audited Solana/SPL workstream.
