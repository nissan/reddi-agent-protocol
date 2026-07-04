# Framework Template Comparison

Issue: #547

This document compares the four landed RAP framework templates — **generic**, **LangGraph**, **ADK/A2A**, and **Strands** — across the full RAP lifecycle. All four are **no-live / dry-run / fixture-only**: none of them installs a framework package, calls a wallet/RPC/provider, executes a payment, claims custody, or claims settlement finality. Every template consumes the shared #552 contract (`framework-template-contract.ts`) and passes the shared #553 no-live conformance checker (`framework-template-conformance.ts`) without redefining any RAP semantics.

## Source surfaces

| Template | Source module | Shape | State factory | Validator |
|---|---|---|---|---|
| Generic | `framework-template-contract.ts` | Lifecycle contract fixtures (`frameworkTemplateFixtures`) | `listFrameworkTemplateFixtures()` | `validateFrameworkTemplateContract()` |
| LangGraph (#544) | `langgraph-rap-template.ts` | Graph with typed **nodes** + middleware | `createLangGraphRapTemplateFixture()` | `validateLangGraphRapTemplate()` |
| ADK / A2A (#546) | `adk-rap-template.ts` | **A2A Agent Card** with `skills[]` + `rapExtension` | `createAdkRapTemplateFixture()` | `validateAdkRapTemplate()` |
| Strands (#545) | `strands-rap-template.ts` | Tool-plugin with ordered **steps** + hooks | `createStrandsRapTemplateFixture()` | `validateStrandsRapTemplate()` |

The cross-framework uniformity fixtures live in `framework-template-conformance-fixtures.ts`
(`listLandedFrameworkTemplateConformanceFixtures()`, `runUniformFrameworkTemplateConformance()`).

## What differs vs. what stays shared

Only the **framework-idiomatic wrapper shape** differs across templates. Everything that touches money, authority, or safety is inherited unchanged from the shared #552 contract:

- **Differs:** how each framework names and orders its lifecycle surface — LangGraph uses graph *nodes*, ADK uses Agent-Card *skills*, Strands uses tool *steps*, generic uses raw contract fixtures.
- **Shared (identical across all four):** the `FrameworkTemplateContract` lifecycle fixtures, the buyer-authority matrix (#550), the seller-wrapper routes (#551), receipt/evidence binding, failure/refund semantics, support-state metadata, and the four no-live boundary booleans.

Because each framework template embeds byte-identical clones of the shared lifecycle contracts, feeding any template's own contracts into the #553 checker yields the same result — the basis for the uniform-conformance assertion below.

## Lifecycle comparison

Each stage below maps the shared RAP step to the framework-idiomatic surface. In every column the stage is **fixture-only**: refs are `local-fixture:*` strings, no external call is made.

### discover

| Framework | Surface |
|---|---|
| Generic | `discovery` lifecycle contract (`executionResult.status = 'not-run'`) |
| LangGraph | `discover` node; `graphState.discoveryRef` |
| ADK | `rap.discover` skill; Agent-Card `rapExtension.discoveryRoute` |
| Strands | `discover` step; `toolState.discoveryRef` |

### quote

| Framework | Surface |
|---|---|
| Generic | `quote` lifecycle contract (`status = 'not-run'`) |
| LangGraph | `quote` node; `graphState.quoteRef` |
| ADK | `rap.quote` skill; `rapExtension.quoteRoute` |
| Strands | `quote` step; `toolState.quoteRef` |

### policy-preflight

| Framework | Surface |
|---|---|
| Generic | `preflight` contract evaluated against the shared #550 buyer-authority matrix |
| LangGraph | `buyerPolicyPreflight` node + `middleware.buyerPolicy` |
| ADK | `rap.buyer-policy-preflight` skill + `middleware.buyerPolicy`; `rapExtension.policyPreflightRoute` |
| Strands | `buyerPolicyPreflight` step + `hooks.buyerPolicy` |

All four reuse `buyerAuthorityCases` from the shared contract; none re-implements the matrix.

### approval (operator-approval)

| Framework | Surface |
|---|---|
| Generic | `operator-approval` contract (`status = 'denied'` until approved) |
| LangGraph | `operatorApproval` node; `graphState.operatorApprovalRef` |
| ADK | `rap.operator-approval` skill; `cardState.operatorApprovalRef` |
| Strands | `operatorApproval` step; `toolState.operatorApprovalRef` |

Each validator fails closed (`missing_operator_approval`) if a paid invocation would proceed without the approval ref, or if a policy-denial case leaks an approval/invocation/receipt/evidence ref.

### invoke

| Framework | Surface |
|---|---|
| Generic | `invocation` contract (`status = 'allowed'`, `invocationId = local-fixture:*`) |
| LangGraph | `invokePaidAgent` node; `graphState.invocationRef` |
| ADK | `rap.invoke-paid-agent` skill; `cardState.invocationRef` |
| Strands | `invokePaidAgent` step; `toolState.invocationRef` |

The "paid agent" is the mock seller-wrapper endpoint. No framework performs a real invocation, network call, or payment.

### receipt-evidence

| Framework | Surface |
|---|---|
| Generic | `receipt-evidence` contract with `receiptRef` + `evidenceRef` required for allowed runs |
| LangGraph | `bindReceiptEvidence` node + `middleware.receiptEvidence` |
| ADK | `rap.bind-receipt-evidence` skill + `middleware.receiptEvidence` |
| Strands | `bindReceiptEvidence` step + `hooks.receiptEvidence` |

Allowed no-live invocations require both receipt and evidence refs (`missing_receipt_evidence_refs` otherwise).

### seller-wrapper endpoint

| Framework | Surface |
|---|---|
| Generic | `sellerProfile` on the contract (quote/preflight/invocation routes + receipt/evidence hooks) |
| LangGraph | `sellerWrapperEndpoint` node + `sellerWrapperEndpointHelper` + `middleware.sellerWrapper` |
| ADK | `rap.seller-wrapper-endpoint` skill + `sellerWrapperEndpointHelper`; Agent-Card `rapExtension` routes |
| Strands | `sellerWrapperEndpoint` step + `sellerWrapperEndpointHelper` + `hooks.sellerWrapper` |

All routes come from the shared #551 seller-wrapper config; none is a live URL.

### denial and failure/refund

Every template carries dedicated `denial` and `failure` lifecycle contracts. Denials preserve machine-readable buyer-authority reason codes; failures use `no_charge_on_failure` + `manual_review` semantics. No framework redefines these.

## No-live boundary (identical across all four)

Every landed template keeps the four support-state booleans explicitly `false`:

| Boundary | Value |
|---|---|
| `livePaymentApproved` | `false` |
| `walletRpcProviderCalls` | `false` |
| `custodySupported` | `false` |
| `settlementFinalityClaimed` | `false` |

Each validator additionally text-scans its fixture for wallet/RPC/provider URLs, transfer/broadcast/sign instructions, custody claims, and settlement-finality claims, and rejects credential-shaped material — failing closed rather than open.

## Uniform conformance guarantee

`runUniformFrameworkTemplateConformance()` (in `framework-template-conformance-fixtures.ts`) builds one fixture per landed framework from that framework's own embedded lifecycle contracts, runs the shared #553 checker against each, and asserts that all four produce:

- the same conformance reason codes (`['framework_template_conformance_valid']`), and
- the same all-false no-live boundary (`liveBoundary.allFalse === true`).

Test coverage is in `tests/framework-template-conformance-fixtures.test.ts`. This proves the frameworks are interchangeable RAP surfaces over one shared, no-live contract — the framework you pick changes the wrapper shape, never the payment, authority, or safety semantics.

## Boundaries

This document and its fixtures authorize static package fixtures, checkers, tests, and docs only. They do **not** authorize framework package installation/scaffolding, cloud/API calls, hosted registry writes, wallet/RPC/provider calls, live or devnet payment execution, custody, SPL transfers, or settlement-finality claims.
