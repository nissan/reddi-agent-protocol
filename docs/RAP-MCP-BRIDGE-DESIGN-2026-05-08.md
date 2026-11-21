# RAP MCP Bridge Design — OpenSwarm / OpenClaw / Cursor / Claude Agents

_Date: 2026-05-08 AEST_

## Goal

Expose Reddi Agent Protocol as an MCP-compatible bridge that lets any agent runtime discover, quote, pay, invoke, and verify paid specialist agents without embedding Reddi-specific wallet/payment logic into every orchestrator.

Target consumers:

- OpenSwarm / Agency Swarm orchestrators
- OpenClaw agents and skills
- Cursor and Claude Desktop/Code MCP clients
- OpenAI Agents SDK / custom tool-calling agents

## Product framing

**Reddi Agent Protocol is the economic layer for agent swarms.**

OpenSwarm-like runtimes can coordinate work. RAP lets those runtimes hire external specialists with:

1. capability discovery
2. priced quotes
3. budget policy enforcement
4. x402 payment challenge/settlement
5. specialist invocation
6. receipt verification
7. disclosure ledger export
8. reputation / attestation follow-up

## MVP promise

> “Give any MCP-capable agent a wallet and a budget. It can discover specialist agents, get a quote, pay via x402, receive an output, and verify the receipt/evidence before using the result.”

## Architecture

```text
MCP Client / Agent Runtime
  OpenSwarm | OpenClaw | Cursor | Claude | Codex
        |
        | MCP tools/resources/prompts over stdio or HTTP/SSE
        v
RAP MCP Bridge
  - policy + budget guard
  - registry query adapter
  - quote negotiation adapter
  - x402 payment adapter
  - invocation adapter
  - receipt/evidence verifier
  - disclosure ledger writer/exporter
        |
        +--> RAP Registry / app/api/registry
        +--> Specialist endpoints / OpenRouter wrappers / hosted agents
        +--> x402 / reddi-x402 / pay.sh / Solana adapters
        +--> Attestation + reputation contracts / evidence artifacts
```

## Core user flows

### 1. Discover

The runtime asks: “Who can do task X under budget Y with privacy/attestation requirements Z?”

Bridge returns ranked candidates with capability, health, price, reputation, privacy modes, endpoint, and selection reasons.

### 2. Quote

The runtime asks for a binding quote before spending.

Bridge returns:

- quote id
- specialist id/wallet
- endpoint
- capability contract
- price/currency/network
- TTL
- max output size / SLA if known
- attestation and disclosure requirements
- payment challenge status

### 3. Pay

The runtime either:

- delegates signing to a local wallet adapter, or
- requests a human approval if policy requires it, or
- uses a pre-approved budget/session allowance.

Bridge produces a payment proof / x402 header / settlement intent, never silently overspending beyond policy.

### 4. Invoke

Bridge calls the specialist endpoint with the paid request and returns normalized output plus a run receipt.

### 5. Verify

Bridge verifies:

- quote still matched invocation terms
- payment receipt/challenge is satisfied
- specialist identity matches registry entry
- response has required disclosure metadata
- attestation/reputation hooks are available or completed

### 6. Record and export evidence

Bridge emits a `reddi.downstream-disclosure-ledger.v1` entry so the parent orchestrator can disclose which downstream agents were used, what was paid, and what evidence supports the output.

## MCP surface

### Tools

#### `reddi.discover_specialists`

Find eligible specialists.

Input:

```json
{
  "task": "Write a market research summary for decentralized agent payments",
  "taskTypeHint": "research",
  "requiredCapabilities": ["web_search", "citations"],
  "policy": {
    "maxPerCallUsd": 2.5,
    "requireAttestation": true,
    "preferredPrivacyMode": "public",
    "minReputation": 3.5
  },
  "limit": 5
}
```

Output:

```json
{
  "ok": true,
  "candidates": [
    {
      "specialistId": "agent_research_001",
      "walletAddress": "...",
      "endpointUrl": "https://...",
      "capabilities": ["research", "citations"],
      "price": { "amountUsd": 1.25, "currency": "USDC", "network": "solana-devnet" },
      "reputationScore": 4.6,
      "attested": true,
      "healthStatus": "pass",
      "selectionReasons": ["capability match", "under budget", "attested"]
    }
  ]
}
```

#### `reddi.request_quote`

Ask one or more candidates for a binding quote.

Input:

```json
{
  "specialistId": "agent_research_001",
  "task": "...",
  "inputSummary": "Non-sensitive summary of task payload",
  "constraints": {
    "maxLatencyMs": 120000,
    "requiredEvidence": ["sources", "reasoning_summary"],
    "privacyMode": "public"
  },
  "budget": { "maxUsd": 2.5 }
}
```

Output:

```json
{
  "ok": true,
  "quoteId": "quote_abc123",
  "expiresAt": "2026-05-08T01:15:00+10:00",
  "specialist": { "id": "agent_research_001", "walletAddress": "..." },
  "price": { "amount": "1.25", "currency": "USDC", "network": "solana-devnet" },
  "x402": {
    "required": true,
    "challengeUrl": "https://.../x402/challenge",
    "payee": "...",
    "nonce": "..."
  },
  "termsHash": "sha256:...",
  "disclosureRequired": true
}
```

#### `reddi.pay_quote`

Satisfy a quote using configured wallet/payment policy.

Input:

```json
{
  "quoteId": "quote_abc123",
  "payerWallet": "...",
  "approvalMode": "preapproved_budget",
  "idempotencyKey": "run-123-payment"
}
```

Output:

```json
{
  "ok": true,
  "paymentId": "pay_789",
  "x402TxSignature": "...",
  "x402Header": "...",
  "receipt": {
    "schemaVersion": "reddi.x402.payment_receipt.v1",
    "quoteId": "quote_abc123",
    "termsHash": "sha256:...",
    "amount": "1.25",
    "currency": "USDC",
    "network": "solana-devnet"
  }
}
```

#### `reddi.invoke_paid_specialist`

Call a paid specialist. Can optionally auto-discover/quote/pay if policy allows.

Input:

```json
{
  "prompt": "...",
  "quoteId": "quote_abc123",
  "paymentId": "pay_789",
  "x402Header": "...",
  "requiredOutputSchema": "optional-json-schema-or-name",
  "idempotencyKey": "run-123-invoke"
}
```

Output:

```json
{
  "ok": true,
  "runId": "run_456",
  "specialistId": "agent_research_001",
  "output": "...",
  "receipt": {
    "schemaVersion": "reddi.specialist_run_receipt.v1",
    "runId": "run_456",
    "quoteId": "quote_abc123",
    "paymentId": "pay_789",
    "specialistWallet": "...",
    "durationMs": 48321,
    "outputHash": "sha256:..."
  }
}
```

#### `reddi.verify_receipt`

Verify payment + invocation + terms + evidence.

Input:

```json
{
  "runId": "run_456",
  "receipt": { "...": "..." },
  "checks": ["payment", "terms", "identity", "output_hash", "disclosure", "attestation"]
}
```

Output:

```json
{
  "ok": true,
  "verified": true,
  "checks": {
    "payment": "pass",
    "terms": "pass",
    "identity": "pass",
    "output_hash": "pass",
    "disclosure": "pass",
    "attestation": "pending"
  },
  "evidence": [
    { "type": "tx", "value": "..." },
    { "type": "termsHash", "value": "sha256:..." }
  ]
}
```

#### `reddi.export_disclosure_ledger`

Return a disclosure ledger entry for parent-agent evidence packs.

Input:

```json
{
  "runIds": ["run_456"],
  "format": "json"
}
```

Output:

```json
{
  "schemaVersion": "reddi.downstream-disclosure-ledger.v1",
  "parentRunId": "optional-parent-run",
  "entries": [
    {
      "runId": "run_456",
      "specialistWallet": "...",
      "capability": "research",
      "payloadClass": "user_prompt_summary",
      "amount": "1.25",
      "currency": "USDC",
      "paymentReceiptHash": "sha256:...",
      "outputHash": "sha256:...",
      "verificationStatus": "verified"
    }
  ]
}
```

#### `reddi.submit_quality_signal`

Post-run score and optional release/dispute decision.

Input:

```json
{
  "runId": "run_456",
  "score": 8,
  "notes": "Good citations; minor formatting edits needed.",
  "decision": "release"
}
```

### Resources

- `reddi://registry/specialists` — cached registry snapshot
- `reddi://registry/capabilities` — taxonomy and examples
- `reddi://runs/{runId}/receipt` — run receipt
- `reddi://runs/{runId}/disclosure-ledger` — evidence ledger
- `reddi://policy/current` — active budget / approval policy

### Prompts

- `reddi_hire_specialist_prompt` — teaches an orchestrator when/how to call the bridge
- `reddi_verify_before_use_prompt` — tells agents not to trust outputs until `verify_receipt` passes
- `reddi_budget_guard_prompt` — spending policy language for host agents

## Policy and safety model

### Spending modes

1. `dry_run` — discover/quote only; no payment.
2. `manual_approval` — every payment requires host/user approval.
3. `session_budget` — auto-pay until a capped session budget is exhausted.
4. `per_capability_budget` — different caps by task type.
5. `trusted_specialist_allowlist` — auto-pay only known wallets.

### Default guardrails

- Default to `dry_run` unless explicitly configured.
- Never spend if quote exceeds policy cap.
- Require idempotency keys for payment and invocation.
- Refuse unpaid specialist output if x402 was required.
- Verify specialist registry identity before invocation.
- Hash payload/output/terms for evidence without leaking private data.
- Do not send raw secrets or private workspace files to specialists by default.
- For OpenClaw/Telegram group use, require explicit approval for live payments.

## Implementation plan

### Phase 0 — Spec alignment

- Confirm tool names and schemas.
- Decide MVP payment mode: likely `dry_run` + controlled devnet x402 first.
- Map existing `lib/mcp/tools.ts` into the new surface.

### Phase 1 — MCP stdio server wrapper

Build `packages/rap-mcp-bridge`:

- TypeScript MCP server using `@modelcontextprotocol/sdk`
- stdio transport for Claude Desktop / Cursor
- optional HTTP/SSE transport for OpenSwarm/OpenClaw
- wraps existing REST/planner tools where available

MVP tools:

- `reddi.discover_specialists`
- `reddi.request_quote` (can synthesize quote from registry price + x402 challenge if no quote endpoint yet)
- `reddi.verify_receipt` (fixture/devnet evidence first)
- `reddi.export_disclosure_ledger`

### Phase 2 — Payment + invocation

Add:

- `reddi.pay_quote`
- `reddi.invoke_paid_specialist`
- policy enforcement
- idempotent run store
- x402 receipt normalization

### Phase 3 — Host integrations

Adapters/examples:

- Claude Desktop / Cursor MCP config snippet
- OpenClaw skill: `reddi-paid-specialist/SKILL.md`
- OpenSwarm `AGENTS.md` + orchestrator tool instructions patch
- OpenAI Agents SDK sample

### Phase 4 — Verification and evidence hardening

Add:

- on-chain/devnet receipt verifier where applicable
- terms hash validation
- specialist identity signature check
- disclosure ledger schema tests
- quality-signal/reputation follow-up

### Phase 5 — Demo

End-to-end demo:

1. OpenSwarm receives: “Make a market brief.”
2. OpenSwarm discovers a Reddi research specialist via MCP.
3. RAP bridge quotes and requires approval.
4. Bridge pays x402 within capped budget.
5. Specialist returns result.
6. Bridge verifies receipt and emits disclosure ledger.
7. OpenSwarm uses result in final deliverable and includes evidence appendix.

## Repo impact estimate

Likely files:

```text
packages/rap-mcp-bridge/
  package.json
  src/server.ts
  src/tools/discover.ts
  src/tools/quote.ts
  src/tools/pay.ts
  src/tools/invoke.ts
  src/tools/verify.ts
  src/tools/disclosure.ts
  src/policy.ts
  src/client.ts
  src/schemas.ts
  README.md

docs/RAP-MCP-BRIDGE-DESIGN-2026-05-08.md
docs/RAP-MCP-BRIDGE-OPEN-SWARM-INTEGRATION.md
.openclaw/skills/reddi-paid-specialist/SKILL.md   # optional repo-local skill
```

## Acceptance criteria

MVP is ready when:

- Cursor/Claude can list RAP tools through MCP.
- `discover_specialists` returns real registry candidates.
- `request_quote` returns deterministic quote objects with TTL and terms hash.
- `verify_receipt` can verify at least fixture/devnet x402 evidence.
- `export_disclosure_ledger` emits `reddi.downstream-disclosure-ledger.v1`.
- All payment paths are dry-run/manual by default.
- No live spending occurs without explicit policy + approval.

Production-ish readiness adds:

- real x402 payment header generation
- idempotent payment/invoke store
- replay protection
- live specialist invocation smoke
- on-chain/devnet receipt verifier
- privacy redaction tests
- host integration examples

## Open questions

1. Should the bridge live inside `reddi-agent-protocol-code` or as a standalone `@redditech/rap-mcp-bridge` package published separately?
2. Which payment lane is the first demo target: pay.sh x402, existing `reddi-x402`, or devnet Solana adapter?
3. What wallet UX do we want first: manual CLI approval, env keypair, browser wallet, or OpenClaw native approval?
4. Do we require quote before invoke always, or support one-shot `hire_specialist` for agent ergonomics?
5. Should OpenSwarm integration be a PR to VRSEN/OpenSwarm or just a local fork demo first?

## Recommendation

Build the bridge as a **small package inside RAP first**, with a standalone package boundary from day one. Keep MVP dry-run/manual-payment by default, then add controlled devnet x402. The demo should show OpenSwarm or Claude using RAP as the paid-specialist marketplace layer, not replacing their orchestration.

---

# Loop 1 Review / Retrospective — repo-grounded adjustment

## What inspection found

The repo already has an HTTP-tool surface that is close to MCP, but not a true MCP server yet:

- `lib/mcp/tools.ts` defines existing planner tool schemas:
  - `register_consumer`
  - `resolve_specialist`
  - `resolve_attestor`
  - `invoke_specialist`
  - `submit_quality_signal`
  - `decide_settlement`
- `app/api/planner/tools/*` exposes REST endpoints for those schemas.
- `app/api/planner/tools/resolve/route.ts` already does ranked discovery from the merged registry bridge.
- `lib/registry/bridge.ts` already merges on-chain registry state, off-chain capability index, health, attestation, and routing signals.
- `app/api/planner/tools/invoke/route.ts` already wraps `executePlannerSpecialistCall`.
- `lib/onboarding/planner-execution.ts` already enforces an important safety invariant: if a specialist returns a completion without an x402 challenge, the planner refuses the unpaid response.
- `packages/x402-solana/src/payment.ts` has x402 challenge/header parsing and demo receipt verification, but real Solana receipt verification is explicitly not implemented in that package yet.
- Existing ledger/economic-demo code clearly separates controlled demo receipts, surfpool transfer semantics, and unimplemented real devnet verifier claims.

## Plan adjustment

The MCP bridge should **not** start by inventing a parallel marketplace API.

Instead:

1. Build an MCP compatibility wrapper around the existing REST/planner tools.
2. Add quote and verification as the first missing product primitives.
3. Keep `invoke_specialist` behind explicit policy because it can currently attempt live endpoint calls and controlled/demo x402 negotiation.
4. Treat real receipt verification as a phase boundary, not an MVP claim.

## Revised MVP tool map

| MCP tool | Backing today | MVP status |
|---|---|---|
| `reddi.discover_specialists` | `/api/planner/tools/resolve` + `fetchSpecialistListings()` | implement wrapper first |
| `reddi.register_consumer` | `/api/planner/tools/register-consumer` | wrapper |
| `reddi.invoke_specialist` | `/api/planner/tools/invoke` | expose only if policy allows live calls |
| `reddi.submit_quality_signal` | `/api/planner/tools/signal` | wrapper |
| `reddi.decide_settlement` | `/api/planner/tools/release` | wrapper |
| `reddi.request_quote` | partially derivable from resolve result + endpoint x402 challenge | new primitive |
| `reddi.verify_receipt` | demo verifier + run record reconciliation | new primitive; MVP = demo/devnet-evidence verifier only |
| `reddi.export_disclosure_ledger` | economic-demo disclosure types + planner run records | new primitive |

## New implementation order

### Loop 2 should design the package boundary

Create a concrete package plan for `packages/rap-mcp-bridge` that supports:

- stdio MCP for Claude Desktop / Cursor
- HTTP/SSE mode later for OpenSwarm/OpenClaw
- local REST backend URL config, defaulting to `http://localhost:3000`
- strict policy mode defaulting to `dry_run`

### Loop 3 should define missing quote/receipt schemas

Add durable schema docs/types for:

- `ReddiQuote`
- `ReddiPaymentIntent`
- `ReddiPaymentReceipt`
- `ReddiSpecialistRunReceipt`
- `ReddiReceiptVerificationResult`
- `ReddiDisclosureLedgerEntry`

### Loop 4 should create a safe MVP issue/spec chain

Because this is payment/auth/tooling surface, implementation should follow OAD:

- GitHub issue
- spec/update plan
- implementation PR
- Oli review gate
- no auto-merge unless explicitly approved

## Risk notes

- The existing `invoke_specialist` endpoint is not merely dry-run. It can call live specialist endpoints and negotiate controlled/demo payment receipts. MCP must gate it.
- `packages/x402-solana` real Solana receipt verification is not implemented yet. Do not market `verify_receipt` as production settlement proof until that exists.
- The current REST schemas use snake_case in some fields and camelCase in others. MCP wrapper should normalize external names while preserving backward compatibility.
- Existing planner run storage is file-backed JSON under `data/onboarding/planner-runs.json`; acceptable for MVP evidence, not enough for multi-user production.

## Updated recommendation after Loop 1

Build **MCP adapter first, payment engine second**.

The bridge can deliver immediate integration value by making existing RAP discovery/routing/tooling usable from Claude/Cursor/OpenSwarm, while quote/verification hardening happens behind clear guardrails.
