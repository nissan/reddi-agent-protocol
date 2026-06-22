# Circle x402 Source Adapter Spec

_Date: 2026-05-13 AEST_  
_Status: Iteration 1 implementation target_

## Intent

Use Circle for Agents / Circle x402 Discovery as a Reddi Agent Protocol source ecosystem, without confusing Circle's payment rails with RAP's trust layer.

Circle supplies wallet/payment/catalog primitives. RAP wraps those primitives with specialist manifests, capability routing, attestation state, receipts/evidence, and reputation policy.

## Non-goals

- No live paid Circle calls in this slice.
- No Circle CLI login, wallet creation, funding, terms acceptance, or private-key handling.
- No claim that Circle Gateway Nanopayments support Solana. Current Circle docs list Solana Gateway support but Nanopayments = No.
- No claim that Circle-listed resources are RAP-attested before RAP attestors have run.

## Source identity

- Source id: `circle-x402`
- Roles: `specialist`, `consumer`
- Runtimes: `http`, `circle-gateway`, `vanilla-x402`
- Default payment policy: `x402_required`
- Default attestation state: `externally_listed_unattested`

## Input

Circle Discovery API resource shape, minimally:

```json
{
  "resource": "https://api.example.com/path",
  "type": "http",
  "x402Version": 1,
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:8453",
      "maxAmountRequired": "5000",
      "asset": "0x...",
      "payTo": "0x..."
    }
  ],
  "metadata": {
    "provider": {
      "name": "Provider",
      "description": "Provider description",
      "category": "WEB_SEARCH_RESEARCH",
      "tags": ["research"]
    },
    "description": "Endpoint description",
    "supportsCircleGateway": true,
    "supportsVanillax402": true
  }
}
```

## RAP candidate mapping

Each Circle resource becomes a RAP specialist candidate:

- `candidateId`: stable `circle-x402:<host>:<path>` slug
- `source`: `circle-x402`
- `providerName`: `metadata.provider.name`
- `resource`: Circle resource URL
- `category`: Circle provider category
- `taskTypes`: mapped RAP capability taxonomy
- `sourceAdapter`: valid `source-adapter.v1` specialist manifest
- `payment`: accepted payment options normalized to price/network/rail fields
- `attestationState`: `externally_listed_unattested`
- `trustNotes`: explicit boundary that listing is external until RAP attestation runs

## Category mapping

| Circle category | RAP task types |
|---|---|
| `FINANCIAL_ANALYSIS` | `financial-analysis`, `market-data` |
| `SOCIAL_INTELLIGENCE` | `social-intelligence`, `profile-analysis` |
| `WEB_SEARCH_RESEARCH` | `research`, `web-search` |
| `PREDICTION_MARKETS` | `prediction-market-analysis`, `forecasting` |
| `CREATIVE` | `creative-generation` |
| `INFRASTRUCTURE` | `infrastructure`, `developer-tooling` |
| unknown | `external-api` |

## Payment rail mapping

- `supportsCircleGateway=true` + Gateway-compatible payment option → `circle_gateway`
- otherwise x402-compatible payment option → `vanilla_x402`
- preserve original network CAIP id and atomic amount
- convert USDC subunits to decimal price when `maxAmountRequired` is numeric

## Safety gates

- Import is metadata-only by default.
- Live pay/invoke remains behind explicit approval and tiny caps.
- Wrong payee/amount/network/resource must fail closed in future paid client work.
- Circle resources imported from Discovery API must display as `externally listed, not RAP-attested yet` until RAP attestation evidence exists.

## Acceptance criteria for Iteration 1

- `circle-x402` source profile resolves from source registry.
- Circle category mapping is deterministic and tested.
- Circle discovery resource converts into a valid `source-adapter.v1` specialist candidate.
- Candidate keeps external-listing/unattested boundary metadata.
- Source conformance harness accepts `circle-x402` and runs Circle-specific tests.

## Iteration 2 — dry-run route / quote preview

Implemented a product-visible dry-run route preview on top of the metadata catalog:

- API: `POST /api/source-adapters/circle-x402/quote-preview`
- UI: `/circle-x402` candidate cards expose `Preview RAP route`
- Helper: `lib/integrations/source-adapter/circle-x402-quote-preview.ts`

The preview returns:

- `mode: dry-run-quote-preview`
- source-aware route policy with `preferredSource: circle-x402`, `strictSourceMatch: true`
- `livePaymentAllowed: false`
- rail/network/estimated USDC amount from Circle Discovery metadata
- explicit support states: `discovery_visible`, `externally_listed_unattested`, `x402_required`, `dry_run_quote_preview`, `live_payment_disabled`
- diagnostics for missing payment requirements, missing numeric price, missing payee, unsupported network, and malformed resource URL
- required gates before paid invocation: explicit user approval, tiny spend cap, runtime-only Circle credentials, receipt capture, and RAP attestor verification

This is still not a payment or invocation path. It creates no x402 payment headers and makes no external service request.
Diagnostics do not upgrade trust, settlement, reputation, publication readiness, or custody claims.
