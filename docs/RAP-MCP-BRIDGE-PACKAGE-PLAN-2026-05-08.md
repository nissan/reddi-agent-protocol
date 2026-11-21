# RAP MCP Bridge Package Plan — Loop 2

_Date: 2026-05-08 AEST_

## Loop 2 objective

Turn the product design into a concrete package boundary that can be implemented safely in the RAP repo.

## Package name

Local package first:

```text
packages/rap-mcp-bridge
```

NPM-ready name later:

```text
@redditech/rap-mcp-bridge
```

Reasoning: keep the implementation inside the RAP repo while APIs are still moving, but make the package boundary publishable from day one.

## Runtime model

### MVP transport: stdio MCP

Used by:

- Claude Desktop
- Cursor MCP
- local Claude/Codex wrappers that speak MCP

### Phase 2 transport: HTTP/SSE MCP

Used by:

- OpenSwarm server/orchestrator
- OpenClaw runtime bridges
- remote agent runtimes that cannot spawn stdio child processes

## Backend model

The MCP bridge is a **thin adapter** over the existing RAP Next app/planner endpoints, not a second marketplace backend.

Default backend URL:

```text
http://localhost:3000
```

Configurable via:

```text
REDDI_RAP_BASE_URL
REDDI_MCP_POLICY_MODE=dry_run|manual|session_budget|unsafe_live
REDDI_MCP_SESSION_BUDGET_USD
REDDI_MCP_ALLOW_INVOKE=false|true
REDDI_MCP_ALLOW_PAYMENT=false|true
REDDI_MCP_AGENT_NAME
REDDI_MCP_HOST_FRAMEWORK=claude|cursor|openclaw|openswarm|codex|custom
```

Default values must be safe:

```text
REDDI_MCP_POLICY_MODE=dry_run
REDDI_MCP_ALLOW_INVOKE=false
REDDI_MCP_ALLOW_PAYMENT=false
```

## Proposed files

```text
packages/rap-mcp-bridge/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts
    server.ts
    config.ts
    policy.ts
    rap-client.ts
    schemas.ts
    errors.ts
    tools/
      discover-specialists.ts
      register-consumer.ts
      request-quote.ts
      pay-quote.ts
      invoke-paid-specialist.ts
      verify-receipt.ts
      export-disclosure-ledger.ts
      submit-quality-signal.ts
    resources/
      registry.ts
      policy.ts
      run-receipt.ts
    prompts/
      hire-specialist.ts
      verify-before-use.ts
      budget-guard.ts
  tests/
    policy.test.ts
    schemas.test.ts
    discover-specialists.test.ts
    request-quote.test.ts
    verify-receipt.test.ts
```

## Dependencies

Minimum:

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.x",
    "zod": "^3.x"
  },
  "devDependencies": {
    "@types/node": "^20",
    "typescript": "^5"
  }
}
```

Avoid coupling directly to Next aliases (`@/...`) in the MCP package. The package should call HTTP endpoints through `rap-client.ts`. This keeps it runnable outside the Next process and easier to publish.

## Tool implementation plan

### `reddi.discover_specialists`

Backend:

```text
POST /api/planner/tools/resolve
```

Bridge behavior:

- normalize camelCase MCP input into existing REST schema where needed
- call backend
- map `candidate` + `alternatives` into `ReddiSpecialistCandidate[]`
- preserve diagnostics as `debug` field when requested

MVP status: implement first.

### `reddi.register_consumer`

Backend:

```text
POST /api/planner/tools/register-consumer
```

Bridge behavior:

- attach `REDDI_MCP_AGENT_NAME` and `REDDI_MCP_HOST_FRAMEWORK`
- dry-run mode may return a local registration preview if backend unavailable

MVP status: simple wrapper.

### `reddi.request_quote`

Backend today: missing.

MVP implementation:

1. call discover/resolve for target if needed
2. synthesize a quote from registry candidate price and endpoint details
3. compute `taskHash` and `termsHash`
4. mark `quoteStatus=active`
5. store local quote in bridge memory/file store for the session
6. do **not** claim specialist-signed binding quote until backend supports it

Future backend endpoint:

```text
POST /api/planner/tools/quote
```

MVP status: new bridge primitive, synthetic quote with explicit boundary.

### `reddi.pay_quote`

Backend today: payment is embedded in invoke via x402 challenge handling.

MVP behavior:

- if policy mode is `dry_run`, return `not_paid` receipt preview
- if `REDDI_MCP_ALLOW_PAYMENT=false`, block
- if `manual`/`session_budget` and payment is approved, call future payment endpoint or later integrated payment client

Future backend endpoint:

```text
POST /api/planner/tools/pay
```

MVP status: stub/blocked unless explicitly enabled. Do not implement live payment first.

### `reddi.invoke_paid_specialist`

Backend:

```text
POST /api/planner/tools/invoke
```

Bridge behavior:

- block unless `REDDI_MCP_ALLOW_INVOKE=true`
- require quote id unless one-shot mode is explicitly allowed
- pass `targetWallet` and policy cap
- normalize `PlannerRunRecord` into `ReddiSpecialistRunReceipt`

MVP status: gated wrapper.

### `reddi.verify_receipt`

Backend today: partial evidence exists in run records and package demo verifier.

MVP behavior:

- verify local quote/terms hash when quote is bridge-generated
- verify run record fields when run id exists
- mark payment boundary accurately:
  - `dry_run`
  - `controlled_demo`
  - `devnet` only when backed by explicit devnet verifier artifact
  - `mainnet` not supported yet
- return warnings for anything not proven

MVP status: new primitive, honest boundary-first verifier.

### `reddi.export_disclosure_ledger`

Backend today: disclosure ledger direction exists in economic-demo and specialist runtime code, but no generic endpoint.

MVP behavior:

- build ledger entries from bridge quote/payment/run records
- include safe public evidence only
- hash payload/output where possible
- expose as MCP tool and `reddi://runs/{runId}/disclosure-ledger` resource

MVP status: new primitive.

### `reddi.submit_quality_signal`

Backend:

```text
POST /api/planner/tools/signal
```

Bridge behavior:

- wrapper with normalized naming
- optionally chain `decide_settlement` when `decision` is present

MVP status: wrapper.

## Local persistence

For MVP, use a local JSON store inside the package cache directory:

```text
~/.reddi/rap-mcp-bridge/
  quotes.json
  payment-intents.json
  receipts.json
  disclosure-ledgers.json
```

Rationale:

- works from Claude/Cursor without writing into repo
- idempotency survives one client restart
- avoids mutating RAP repo data from the MCP client

Production later:

- backend-backed quote/payment/run store
- signed quote records
- multi-user tenant isolation

## Policy model

```ts
type BridgePolicy = {
  mode: "dry_run" | "manual" | "session_budget" | "unsafe_live";
  allowInvoke: boolean;
  allowPayment: boolean;
  maxPerCallUsd: number;
  sessionBudgetUsd: number;
  spentThisSessionUsd: number;
  requireQuoteBeforeInvoke: boolean;
  requireVerifyBeforeReturn: boolean;
  allowMainnet: boolean;
  allowPrivatePayloads: boolean;
  trustedSpecialistWallets: string[];
};
```

Default:

```ts
{
  mode: "dry_run",
  allowInvoke: false,
  allowPayment: false,
  maxPerCallUsd: 0,
  sessionBudgetUsd: 0,
  spentThisSessionUsd: 0,
  requireQuoteBeforeInvoke: true,
  requireVerifyBeforeReturn: true,
  allowMainnet: false,
  allowPrivatePayloads: false,
  trustedSpecialistWallets: []
}
```

## Claude Desktop / Cursor config shape

Example after package build:

```json
{
  "mcpServers": {
    "reddi-rap": {
      "command": "node",
      "args": ["/path/to/reddi-agent-protocol-code/packages/rap-mcp-bridge/dist/server.js"],
      "env": {
        "REDDI_RAP_BASE_URL": "http://localhost:3000",
        "REDDI_MCP_POLICY_MODE": "dry_run",
        "REDDI_MCP_ALLOW_INVOKE": "false",
        "REDDI_MCP_ALLOW_PAYMENT": "false",
        "REDDI_MCP_HOST_FRAMEWORK": "claude"
      }
    }
  }
}
```

## OpenSwarm integration shape

Add to OpenSwarm agent instructions:

```md
When you need external specialist work that may require payment, call the Reddi Agent Protocol MCP bridge first:

1. `reddi.discover_specialists`
2. `reddi.request_quote`
3. ask human approval if payment is required
4. `reddi.invoke_paid_specialist` only after approval/policy permits
5. `reddi.verify_receipt`
6. include `reddi.export_disclosure_ledger` in final deliverable evidence

Never use a paid specialist result unless verification passes or you disclose the verification boundary.
```

## Tests / validation gates

MVP package must pass:

```text
npm --prefix packages/rap-mcp-bridge run build
npm --prefix packages/rap-mcp-bridge test
node packages/rap-mcp-bridge/dist/server.js --help
```

Bridge-level smoke:

```text
# with local RAP app running
reddi-mcp-smoke discover
reddi-mcp-smoke quote --dry-run
reddi-mcp-smoke verify --fixture
```

No live-payment test should run by default.

## Loop 2 retrospective

### Decision retained

Build inside the RAP repo first, publish later.

### Decision changed/refined

The bridge should avoid importing RAP Next internals directly. Earlier plan allowed wrapping existing libraries; after inspecting package/tsconfig boundaries, HTTP wrapping is safer because root `tsconfig` excludes `packages`, and Next path aliases should not leak into a standalone MCP package.

### New risk

Because the package will call a local Next backend, developer onboarding must make backend availability obvious. The MCP server should expose a `reddi://policy/current` or health resource that says whether RAP backend is reachable.

### Next loop

Draft the OAD issue/spec content and implementation slice boundaries, including acceptance criteria for a first PR that is safe and reviewable.

---

# Loop 5 Package Plan Adjustment — safety-first first PR

## Policy mode revision

First PR package config accepts only:

```text
REDDI_MCP_POLICY_MODE=dry_run
```

The earlier package-plan enum included `manual`, `session_budget`, and `unsafe_live`. That is now superseded for first implementation.

Rules:

- `manual` and `session_budget` are later-PR modes only.
- `unsafe_live` is removed as a mode name.
- Any unknown or live-capable policy mode fails closed with `unsupported_policy_mode`.

## First PR exported tools

Exactly:

- `reddi.discover_specialists`
- `reddi.request_quote`
- `reddi.verify_receipt`
- `reddi.export_disclosure_ledger`

No payment or invoke tools/stubs in first PR.

## Input limits

First PR schema validators enforce:

```text
task max 8,000 chars
taskSummary/inputSummary max 2,000 chars
evidenceRefs max 32 refs, 512 chars each
trace max 100 entries, 256 chars each
ledger export max 100 entries
agentName/framework max 128 chars sanitized
```

## No arbitrary IO

First PR must not:

- fetch arbitrary URLs
- invoke specialist endpoint URLs
- read local file paths supplied by MCP clients
- accept raw private payloads
- persist raw prompt/output/secrets/x402 headers

## Store hardening

If local JSON store is used:

- path: `~/.reddi/rap-mcp-bridge`
- restrictive directory/file permissions where supported
- no secrets persisted
- duplicate idempotency key returns existing object

## Backend trust

Default backend is local RAP app, but backend URL must be explicit in tool/resource output.

If backend unavailable:

- return backend-unreachable
- no silent cached authoritative fallback
- any later cache mode must mark `authoritative=false`

## README additions required

- threat model
- what this does not prove
- dry-run only first PR warning
- host prompt snippets that forbid spending/invoke by default
