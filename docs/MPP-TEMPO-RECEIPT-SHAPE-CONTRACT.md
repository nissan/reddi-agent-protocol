# MPP / Tempo Receipt Shape Contract

_Issue:_ #455  
_Package export:_ `@reddi/agent-protocol/mpp-tempo-receipt-shapes`

## Purpose

This contract captures fixture-backed MPP / Tempo challenge and receipt shapes before RAP implements a rail-neutral receipt normalizer. It is a source-shape and evidence-binding contract only.

## Source Notes

- Stripe MPP docs describe MPP as an HTTP 402 payment flow where a client authorizes payment, retries the request, and receives access plus a receipt.
- Tempo docs describe Tempo as a payments-oriented chain with wallet, payment, and agentic-payment docs.
- Parallel's MPP integration docs describe Tempo stablecoin payment options for MPP with pathUSD / USDC.
- Existing RAP Pay.sh evidence shows MPP 402 challenges for single-charge, session-cap, and split-payment shapes, with only simple sandbox charge currently proven through the Pay.sh sandbox path.

## Support States

`binding_candidate`

- A fixture has a coherent MPP challenge and receipt shape.
- The receipt binds protocol, method, network, asset, amount, and nonce back to the challenge.
- RAP may map this into a future rail-neutral receipt binding candidate.
- This is not settlement verification.

`probe_only`

- A fixture has useful MPP challenge metadata, such as session cap or split recipients.
- It does not include a receipt success claim.
- RAP may use it for compatibility planning and parser tests only.

`unsupported_live_rail`

- Live Tempo receipts are rejected in this fixture corpus.
- A future live lane must define wallet custody, spend limits, verifier behavior, operator approval, replay handling, evidence retention, and rollback expectations before accepting live settlement claims.

## Guardrails

The fixture contract is fail-closed:

- no wallet signing
- no RPC call
- no provider call
- no live payment
- no Pay.sh setup or activation
- no hosted registry write
- no trust upgrade
- no reputation mutation

Fixtures reject imported claim text that contains secret markers or live-path markers such as private keys, RPC URLs, completed provider calls, hosted registry writes, trust upgrades, or reputation mutations.

## Validation

Run:

```sh
cd packages/agent-protocol && npm test -- --test-name-pattern mpp
```

For full package confidence:

```sh
cd packages/agent-protocol && npm test
```
