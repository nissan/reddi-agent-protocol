# Payment and RAP Assurance Architecture

Status: current public-claim boundary. This document replaces older “we handle settlement + escrow” framing with the narrower RAP Assurance message.

> Payments prove transfer; RAP Assurance proves paid work.

## Current framing

Reddi Agent Protocol should not be presented as a payment facilitator, custody provider, escrow provider, broad marketplace, or generic runtime. Payment rails and adapters can prove payment intent or transfer. RAP Assurance records the paid-work context around those rails: terms, buyer policy, payment-proof references, evidence references, attestation outcomes, replay metadata, and bounded reputation inputs.

## Integration-first flow

```text
Agent A (buyer/consumer)
    |
    | 1) Discover specialist metadata from local fixtures, MCP/AI catalog,
    |    registry/search adapters, or a future hosted catalog.
    v
Quote / 402 challenge / payment plan
    |
    | 2) Evaluate buyer budget, authority, rail support, evidence requirements,
    |    allowlists, expiry, and operator-approval gates.
    v
Payment rail or fixture
    |
    | 3) Rail-specific verifier proves payment intent/transfer, or the route
    |    stays dry-run/no-spend. RAP stores only the proof reference.
    v
Specialist work + evidence
    |
    | 4) Request/response hashes, evidence refs, disclosure ledgers, and replay
    |    labels bind the work to the agreed terms.
    v
RAP Assurance receipt
    |
    | 5) Attestation/replay/conformance decide which reputation or dispute inputs
    |    are justified. Payment alone is never work-quality proof.
```

## Current supported claims

- Local/offline receipt, policy, evidence-binding, replay, and conformance helpers.
- x402 challenge parsing, budget preflight, nonce/replay checks, and explicit proof-reference handling.
- Read-only SVM SPL `TransferChecked` observation for parsed transaction evidence; no wallet, signer, RPC fetch, or live submission is added by that verifier.
- AUDD as payment-plan/proof metadata unless a separate audited live rail is approved.
- Recorded or local/devnet evidence only where a page, script, or artifact explicitly labels the boundary.

## Explicit non-claims

- No production settlement-finality claim.
- No mainnet readiness claim.
- No custody or escrow-provider claim.
- No default live payment, wallet, RPC, or paid-provider call.
- No hosted marketplace/facilitator readiness claim.
- No collected on-chain protocol treasury fee; 0.05% / 5 bps remains fixture/planned economics only.

## Reference Solana surfaces

The repository still contains Solana reference code and demos. The legacy Anchor program is historical/reference evidence. The recorded Quasar devnet deployment is blocked by `config/quasar/deployments.json` and refused outside the local Surfpool lane before instruction building, signer access, or RPC. Future custody or settlement work must land behind separate approval, audit, deployment, and public-claim gates.
