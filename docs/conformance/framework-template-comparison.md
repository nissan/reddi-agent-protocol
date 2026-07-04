# Framework Template Comparison & Selection Guide

Issue: #547

This is the decision, setup, and validation guide for the four landed RAP framework templates —
**generic**, **LangGraph** (LangGraph/LangChain, #544), **AWS Strands** (#545), and **Google ADK / A2A** (#546).
Its job is to answer three questions:

1. **Which template do I pick?** — see [Choosing a framework](#1-choosing-a-framework).
2. **How do I wire it for buyer-enabled / seller-enabled / dual-mode?** — see [Per-framework setup](#2-per-framework-setup-by-mode).
3. **How do I validate it, and what does that produce?** — see [Validation commands & artifacts](#3-validation-commands--artifacts).

The lifecycle-uniformity comparison that used to be the headline is preserved below as
[one section](#4-lifecycle-uniformity-one-shared-contract).

> **All four are no-live / fixture-only.** No template installs a framework package, calls a
> wallet/RPC/provider, executes a payment, claims custody, or claims settlement finality. Every
> template consumes the shared #552 contract (`framework-template-contract.ts`) and passes the shared
> #553 no-live conformance checker (`framework-template-conformance.ts`) without redefining any RAP
> money/authority/safety semantics. These are *reference templates and conformance fixtures*, not
> runnable framework scaffolds.

## Source surfaces

| Template | Source module (`packages/agent-protocol/src/`) | Idiomatic shape | State factory | Validator | Schema-version export |
|---|---|---|---|---|---|
| Generic | `framework-template-contract.ts` | Lifecycle contract fixtures | `listFrameworkTemplateFixtures()` / `frameworkTemplateFixtures` | `validateFrameworkTemplateContract()` | `FRAMEWORK_TEMPLATE_CONTRACT_SCHEMA_VERSION` |
| LangGraph (#544) | `langgraph-rap-template.ts` | Graph with typed **nodes** + `middleware` + `graphState` | `createLangGraphRapTemplateFixture()` | `validateLangGraphRapTemplate()` | `LANGGRAPH_RAP_TEMPLATE_SCHEMA_VERSION` |
| Strands (#545) | `strands-rap-template.ts` | Tool-plugin with ordered **steps** + `hooks` + `toolState` | `createStrandsRapTemplateFixture()` | `validateStrandsRapTemplate()` | `STRANDS_RAP_TEMPLATE_SCHEMA_VERSION` |
| ADK / A2A (#546) | `adk-rap-template.ts` | **A2A Agent Card** with `skills[]` + `rapExtension` | `createAdkRapTemplateFixture()` / `createAdkFrameworkTemplateContract()` | `validateAdkRapTemplate()` | `ADK_RAP_TEMPLATE_SCHEMA_VERSION`, `ADK_RAP_TEMPLATE_FRAMEWORK` |

Shared support surfaces:

- Contract types + fixtures + validator: `framework-template-contract.ts`
- No-live conformance checker: `framework-template-conformance.ts`
  (`runFrameworkTemplateNoLiveConformanceCheck()`, `listFrameworkTemplateConformanceCases()`)
- Cross-framework uniformity fixtures: `framework-template-conformance-fixtures.ts`
  (`listLandedFrameworkTemplateConformanceFixtures()`, `runUniformFrameworkTemplateConformance()`)

Each module is a published subpath export (see `packages/agent-protocol/package.json` `exports`), e.g.
`@reddi/agent-protocol/langgraph-rap-template`, `.../adk-rap-template`, `.../strands-rap-template`,
`.../framework-template-contract`, `.../framework-template-conformance`.

---

## 1. Choosing a framework

Every template exposes the **same RAP lifecycle** (discover → quote → buyer-policy preflight →
operator approval → invoke → receipt/evidence, plus denial and failure/refund). They differ only in
the *idiomatic wrapper shape* that surface takes — which is what you should match to how your agent
runtime is already structured.

| If your agent runtime is… | Pick | Because the template models RAP as… | Trade-off |
|---|---|---|---|
| A custom/other orchestrator, or you want the smallest possible embed | **generic** | Raw `FrameworkTemplateContract` lifecycle fixtures — no framework assumption | You wire the lifecycle ordering yourself; no nodes/steps/skills scaffolding is provided |
| A **stateful graph / state machine** (LangGraph, LangChain graphs) | **langgraph** | Typed graph **nodes** (`discover`, `quote`, `buyerPolicyPreflight`, `operatorApproval`, `invokePaidAgent`, `bindReceiptEvidence`, `sellerWrapperEndpoint`) guarded by `middleware` (`buyerPolicy` / `receiptEvidence` / `sellerWrapper`), with refs held in `graphState` | Assumes an explicit node/edge execution model; overkill for a linear tool call |
| A **tool / step pipeline with lifecycle hooks** (AWS Strands) | **strands** | Ordered tool **steps** (same seven names) driven by `hooks` (`buyerPolicy` / `receiptEvidence` / `sellerWrapper`), with refs in `toolState` | Ordering is expressed as a step list, not a graph — less explicit branching than LangGraph |
| An agent that **publishes an A2A Agent Card** (Google ADK / A2A interop) | **adk** | An `AdkA2aAgentCard` whose `skills[]` (`rap.discover` … `rap.seller-wrapper-endpoint`) and `rapExtension` carry the discovery/quote/policy/invocation/receipt/evidence routes; `preferredTransport: 'a2a-agent-card'` | Heaviest wrapper (full agent-card schema + `rapExtension`); only worth it if you actually speak A2A |

Decision shortcuts:

- **"I just need the contract, not a framework."** → generic. The other three embed byte-identical
  clones of the generic lifecycle contracts, so nothing is lost by starting generic and adding a
  wrapper later.
- **"My orchestration is graph-shaped."** → langgraph.
- **"My orchestration is a tool/step chain."** → strands.
- **"I need A2A agent-card discovery/interop."** → adk.

Invocation-mode fit (from `contract.invocationModes` / ADK `preferredTransport`): generic, langgraph,
and strands advertise `['http-openapi', 'mcp', 'local-fixture']`; adk additionally models the
`a2a-agent-card` transport via its Agent Card. The `FrameworkTemplateInvocationMode` union
(`framework-template-contract.ts`) enumerates `http-openapi | mcp | a2a-agent-card | local-fixture`.

Because the money/authority/safety semantics are identical across all four (see §4), the choice is
**purely ergonomic** — pick the shape that matches your runtime; you never trade away any RAP
guarantee by switching.

---

## 2. Per-framework setup by mode

RAP roles are expressed by `agentIdentity.templateMode` on the shared contract
(`FrameworkTemplateMode = 'buyer-enabled' | 'seller-enabled' | 'dual-mode'`). The framework wrapper
(nodes / steps / Agent Card) is **mode-agnostic** — the same factory produces the wrapper, and the
*mode lives on the embedded contract*. The validator/conformance rules that make each mode meaningful
are in `framework-template-contract.ts` and `framework-template-conformance.ts`:

| Mode | Requires (enforced by `requiredFieldsForMode` + `validateFrameworkTemplateContract`) | May omit |
|---|---|---|
| `buyer-enabled` | `buyerAuthorityPolicy` present and matching #551 metadata (`buyerAuthorityPolicyMatches`) | `sellerProfile` (can be `undefined`) |
| `seller-enabled` | `sellerProfile` present | `buyerAuthorityPolicy` (if present, must still match #551) |
| `dual-mode` | **both** `buyerAuthorityPolicy` **and** `sellerProfile` | — |

The canonical way to construct each mode is exactly what the #553 checker does in
`framework-template-conformance.ts` → `modeCase(mode)`: start from a lifecycle contract, set
`agentIdentity.templateMode`, and clear the field that mode omits.

```ts
import { frameworkTemplateFixtures, validateFrameworkTemplateContract }
  from '@reddi/agent-protocol/framework-template-contract';

function contractForMode(mode) {
  const contract = structuredClone(frameworkTemplateFixtures.invocation.contract);
  contract.agentIdentity.templateMode = mode;
  if (mode === 'buyer-enabled') contract.sellerProfile = undefined;        // seller side off
  if (mode === 'seller-enabled') contract.buyerAuthorityPolicy = undefined; // buyer side off
  // dual-mode keeps both (this is the default of every landed fixture)
  return contract;
}
validateFrameworkTemplateContract(contractForMode('dual-mode')); // { valid: true, ... }
```

The three landed framework wrappers (`createLangGraphRapTemplateFixture`,
`createStrandsRapTemplateFixture`, `createAdkRapTemplateFixture`) embed the **dual-mode** invocation
contract by default (their `contracts` map is cloned from `frameworkTemplateFixtures`). To run a
framework wrapper as buyer- or seller-only, build the mode-specific contract as above and use it as
that wrapper's `selectedContract`, then re-validate with the framework's validator.

### 2a. Generic

```ts
import { listFrameworkTemplateFixtures, validateFrameworkTemplateContract }
  from '@reddi/agent-protocol/framework-template-contract';

for (const fx of listFrameworkTemplateFixtures()) {
  // fx.contract.agentIdentity.templateMode === 'dual-mode' by default
  console.log(fx.kind, validateFrameworkTemplateContract(fx.contract).valid);
}
```

- **dual-mode:** use the fixtures as-is (`templateMode: 'dual-mode'`, both `buyerAuthorityPolicy` and `sellerProfile` present).
- **buyer-enabled / seller-enabled:** apply `contractForMode(...)` above before validating.

### 2b. LangGraph (`langgraph-rap-template.ts`)

```ts
import { createLangGraphRapTemplateFixture, validateLangGraphRapTemplate }
  from '@reddi/agent-protocol/langgraph-rap-template';

const graph = createLangGraphRapTemplateFixture({ scenario: 'allowed-no-live-invocation' });
validateLangGraphRapTemplate(graph); // { valid: true, reasonCodes: ['langgraph_rap_template_valid'] }
```

- Wrapper shape: `graph.nodes` (seven `LangGraphRapGraphNode`s), `graph.middleware`
  (`buyerPolicy` / `receiptEvidence` / `sellerWrapper`, all `true`), `graph.graphState` (refs), and
  `graph.sellerWrapperEndpointHelper` (seller routes below).
- **Role wiring:** `graph.selectedContract.agentIdentity.templateMode` carries the mode. It defaults
  to `dual-mode`; set it via `contractForMode(...)` for buyer-/seller-only, then re-run
  `validateLangGraphRapTemplate`.
- `createLangGraphRapTemplateFixture({ scenario })` accepts the six `LangGraphRapTemplateScenario`s
  (see §3d) to exercise allow/deny/failure paths.

### 2c. Strands (`strands-rap-template.ts`)

```ts
import { createStrandsRapTemplateFixture, validateStrandsRapTemplate }
  from '@reddi/agent-protocol/strands-rap-template';

const plugin = createStrandsRapTemplateFixture({ scenario: 'allowed-no-live-invocation' });
validateStrandsRapTemplate(plugin); // { valid: true, reasonCodes: ['strands_rap_template_valid'] }
```

- Wrapper shape: `plugin.steps` (seven ordered `StrandsRapToolStep`s), `plugin.hooks`
  (`buyerPolicy` / `receiptEvidence` / `sellerWrapper`), `plugin.toolState` (refs), and
  `plugin.sellerWrapperEndpointHelper`.
- **Role wiring:** identical model to LangGraph — mode is on `plugin.selectedContract`
  (`agentIdentity.templateMode`, default `dual-mode`).

### 2d. ADK / A2A (`adk-rap-template.ts`)

```ts
import {
  createAdkRapTemplateFixture,
  createAdkFrameworkTemplateContract,
  validateAdkRapTemplate,
} from '@reddi/agent-protocol/adk-rap-template';

const card = createAdkRapTemplateFixture({ scenario: 'allowed-no-live-invocation' });
validateAdkRapTemplate(card); // { valid: true, reasonCodes: ['adk_rap_template_valid'] }

// Just the contract, re-framed for framework kind 'adk':
const adkContract = createAdkFrameworkTemplateContract();
```

- Wrapper shape: `card.agentCard` is an `AdkA2aAgentCard` — `skills[]` (seven `AdkRapAgentSkillId`s,
  `rap.discover` … `rap.seller-wrapper-endpoint`), `rapExtension` (routes below +
  `supportState: 'proof-metadata-only'`, `livePaymentApproved: false`), plus `card.middleware`,
  `card.cardState`, and `card.sellerWrapperEndpointHelper`. `preferredTransport` is `'a2a-agent-card'`.
- `createAdkFrameworkTemplateContract()` returns a clone of the shared invocation contract with
  `agentIdentity.framework = 'adk'` — use it when you only need the contract, not the Agent Card.
- **Role wiring:** mode is on `card.selectedContract` / the contract from
  `createAdkFrameworkTemplateContract()` (default `dual-mode`).

### Seller-wrapper routes (shared, from #551)

Every seller-enabled/dual-mode template exposes the same **local** routes (paths, never live URLs),
derived from the #551 seller-wrapper config endpoint `seller-wrapper:listing-writer:http`
(`sellerId: seller:listing-writer`):

| Field | Value |
|---|---|
| `quoteRoute` | `/seller-wrapper/listing-writer-http/quote` |
| `policyPreflightRoute` | `/seller-wrapper/listing-writer-http/policy-preflight` |
| `invocationRoute` | `/seller-wrapper/listing-writer-http/invoke-mock` |
| `receiptHook` | `/seller-wrapper/listing-writer-http/receipt` |
| `evidenceHook` | `/seller-wrapper/listing-writer-http/evidence` |
| `discoveryRoute` (ADK `rapExtension` only) | `/seller-wrapper/listing-writer-http/discovery` |

These appear identically on each template's `sellerWrapperEndpointHelper` (and on the ADK
`rapExtension`). None is a live endpoint — `invoke-mock` is the mock invocation path.

---

## 3. Validation commands & artifacts

Run everything from `packages/agent-protocol/`. Commands come from that package's `package.json`
`scripts`.

### 3a. Full test + conformance gate

```bash
npm install        # once
npm run build      # tsc -p tsconfig.json  → emits dist/*.js + dist/*.d.ts
npm test           # build → tsc -p tsconfig.test.json → node --test dist-tests/*.test.js
```

- **`npm test`** compiles the test project to `dist-tests/` and runs every `node:test` suite,
  including the framework-template suites: `framework-template-contract.test.ts`,
  `framework-template-conformance.test.ts`, `framework-template-conformance-fixtures.test.ts`, and the
  three wrapper tests (`langgraph-rap-template.test.ts`, `adk-rap-template.test.ts`,
  `strands-rap-template.test.ts`). Current status: **248 tests, 0 failures**.
- **Artifacts:** `dist/` (compiled package) and `dist-tests/` (compiled tests). `dist/` is committed
  and published; `dist-tests/` is build-only and must **not** be committed.
- **The #553 no-live conformance checker** (`runFrameworkTemplateNoLiveConformanceCheck()`) and the
  cross-framework **uniform check** (`runUniformFrameworkTemplateConformance()`) are *not* standalone
  CLIs — they are exercised by the conformance test suites above. Import and call them directly if you
  want a programmatic gate; both return `{ valid: true, reasonCodes: ['..._valid'] }` on success.

### 3b. Buyer→seller dry-run example

```bash
npm run example:buyer-seller:dry-run   # build → node examples/buyer-seller-dry-run.mjs
```

Prints a no-spend JSON envelope to **stdout** (writes no files):

```json
{ "ok": true, "status": 200, "receiptId": "job:example-001",
  "evidenceId": "evidence:example-001", "paymentProofRef": "dry-run:example-001" }
```

`ok: true` / `status: 200` confirms the buyer preflight passed and a receipt+evidence pair was bound
under `mode: 'dry-run'` — no wallet, RPC, or payment.

### 3c. ARD no-spend example

```bash
npm run example:ard:no-spend   # build → node examples/ard-no-spend-demo.mjs
```

Reads the input fixture `examples/ard-no-spend-ai-catalog.json` and prints a large no-spend JSON
envelope to **stdout** (writes no files). The envelope includes `"ok": true`, `"mode": "no-spend"`, a
validated `catalog` block, request/receipt `hashes`, and a `boundaries` block with every live flag
`false` (`hostedService`, `paidProvider`, `walletAccess`, `rpcCall`, `splTransfer`, `quasarCustody`,
`settlementFinalityProof`, `livePayment`, …). Non-zero `process.exitCode` signals a broken invariant.

### 3d. Scenario coverage (per-framework)

Each wrapper factory takes a `scenario`; validators return `{ valid, reasonCodes[], auditNotes[] }`.
The six scenarios (identical union across LangGraph/Strands/ADK) are:

| Scenario | Expected | Representative reason code on denial |
|---|---|---|
| `allowed-no-live-invocation` | valid (allowed) | — (`*_rap_template_valid`) |
| `policy-denial` | invalid | `missing_operator_approval` (must stop before approval/invocation/receipt/evidence) |
| `missing-approval` | invalid | `missing_operator_approval` |
| `malformed-quote-payment-plan` | invalid | `malformed_quote_payment_plan` |
| `credential-shaped-output` | invalid | `template_contains_credentials` |
| `unsafe-live-custody-provider-claim` | invalid | `unsafe_live_custody_provider_claim` |

These are asserted in the three wrapper test files and are the recommended way to prove a template
fails closed.

### 3e. Package-exports guard

```bash
npm run check:exports        # node scripts/check-package-exports.mjs
```

Verifies every `main` / `types` / subpath target in `package.json` `exports` resolves to a file on
disk after build (currently **69 targets OK**), so a newly added module (e.g. a framework template)
can't ship with a dangling export. This runs in CI via `.github/workflows/rap-package-guard.yml` and
is also covered by `tests/package-exports.test.ts`. `npm run release:dry-run`
(`clean → build → test → check:exports → npm pack --dry-run`) chains the whole gate.

---

## 4. Lifecycle uniformity (one shared contract)

Only the **framework-idiomatic wrapper shape** differs across templates. Everything that touches
money, authority, or safety is inherited unchanged from the shared #552 contract: the
`FrameworkTemplateContract` lifecycle fixtures, the buyer-authority matrix (#550), the seller-wrapper
routes (#551), receipt/evidence binding, failure/refund semantics, support-state metadata, and the
four no-live boundary booleans. Because each framework template embeds byte-identical clones of the
shared lifecycle contracts, feeding any template's own contracts into the #553 checker yields the same
result.

Lifecycle stage → idiomatic surface (every stage is fixture-only; refs are `local-fixture:*` strings):

| Stage | Generic | LangGraph | Strands | ADK / A2A |
|---|---|---|---|---|
| discover | `discovery` contract (`status: not-run`) | `discover` node; `graphState.discoveryRef` | `discover` step; `toolState.discoveryRef` | `rap.discover` skill; `rapExtension.discoveryRoute` |
| quote | `quote` contract (`status: not-run`) | `quote` node; `graphState.quoteRef` | `quote` step; `toolState.quoteRef` | `rap.quote` skill; `rapExtension.quoteRoute` |
| policy-preflight | `preflight` vs #550 matrix | `buyerPolicyPreflight` node + `middleware.buyerPolicy` | `buyerPolicyPreflight` step + `hooks.buyerPolicy` | `rap.buyer-policy-preflight` skill + `middleware.buyerPolicy` |
| approval | `operator-approval` contract (`status: denied` until approved) | `operatorApproval` node; `graphState.operatorApprovalRef` | `operatorApproval` step; `toolState.operatorApprovalRef` | `rap.operator-approval` skill; `cardState.operatorApprovalRef` |
| invoke | `invocation` contract (`status: allowed`, `local-fixture:*`) | `invokePaidAgent` node; `graphState.invocationRef` | `invokePaidAgent` step; `toolState.invocationRef` | `rap.invoke-paid-agent` skill; `cardState.invocationRef` |
| receipt-evidence | `receipt-evidence` contract (`receiptRef`+`evidenceRef` required) | `bindReceiptEvidence` node + `middleware.receiptEvidence` | `bindReceiptEvidence` step + `hooks.receiptEvidence` | `rap.bind-receipt-evidence` skill + `middleware.receiptEvidence` |
| seller-wrapper | `sellerProfile` routes/hooks | `sellerWrapperEndpoint` node + helper + `middleware.sellerWrapper` | `sellerWrapperEndpoint` step + helper + `hooks.sellerWrapper` | `rap.seller-wrapper-endpoint` skill + helper; `rapExtension` routes |

All four reuse `buyerAuthorityCases` (the #550 matrix: `allow`, `deny`, `expired`, `approvalRequired`,
`unsupportedRail`, `unsupportedCurrency`, `sellerNotAllowlisted`, `missingReceiptRequirement`,
`missingEvidenceRequirement`, `refundFailurePolicyMismatch`, `spendCapExceeded`); none re-implements
it. Denials preserve machine-readable buyer-authority reason codes; failures use
`no_charge_on_failure` + `manual_review` semantics.

### No-live boundary (identical across all four)

Every landed template keeps the four support-state booleans explicitly `false` and additionally
text-scans its fixture for wallet/RPC/provider URLs, transfer/broadcast/sign instructions, custody
claims, settlement-finality claims, and credential-shaped material — failing **closed**:

| Boundary | Value |
|---|---|
| `livePaymentApproved` | `false` |
| `walletRpcProviderCalls` | `false` |
| `custodySupported` | `false` |
| `settlementFinalityClaimed` | `false` |

### Uniform conformance guarantee

`runUniformFrameworkTemplateConformance()` (in `framework-template-conformance-fixtures.ts`) builds one
fixture per landed framework from that framework's own embedded lifecycle contracts, runs the shared
#553 checker against each, and asserts all four produce the same conformance reason codes
(`['framework_template_conformance_valid']`) and the same all-false no-live boundary
(`liveBoundary.allFalse === true`). Coverage: `tests/framework-template-conformance-fixtures.test.ts`.
This proves the frameworks are interchangeable RAP surfaces over one shared, no-live contract — the
framework you pick changes the wrapper shape, never the payment, authority, or safety semantics.

## Boundaries

This document and its fixtures authorize static package fixtures, checkers, tests, and docs only. They
do **not** authorize framework package installation/scaffolding, cloud/API calls, hosted registry
writes, wallet/RPC/provider calls, live or devnet payment execution, custody, SPL transfers, or
settlement-finality claims.
