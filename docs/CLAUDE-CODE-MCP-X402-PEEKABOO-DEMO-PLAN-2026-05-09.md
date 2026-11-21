# Claude Code MCP + reddi-x402 Peekaboo Demo Plan

_Date: 2026-05-09 AEST_

## Goal

Record a Peekaboo screen demo where Claude Code CLI is equipped with Reddi Agent Protocol via MCP, then uses the marketplace to discover a specialist agent and produce a prompt response that incorporates that specialist's paid output.

Desired visible story:

1. Register the RAP MCP server with Claude Code CLI.
2. Start Claude Code with the RAP MCP server available.
3. Ask Claude Code for an answer that should benefit from a specialist agent.
4. Claude Code discovers marketplace specialists.
5. Claude Code selects one specialist, requests quote/payment terms, and executes the x402-paid call.
6. Payment uses a bounded Solana devnet wallet with devnet SOL + devnet USDC.
7. Claude Code verifies the receipt / evidence and formulates the final response with a disclosure ledger.

## Evidence-safe boundary

This must be recorded as **devnet-only**.

Do not claim:

- mainnet settlement
- unlimited wallet delegation
- arbitrary specialist invocation
- arbitrary-wallet/private MagicBlock settlement
- Jupiter devnet swap success
- that every marketplace specialist was live-paid

Do claim only after validation:

- Claude Code can register/use the RAP MCP bridge.
- The bridge can discover/quote marketplace specialists.
- A bounded devnet wallet can pay a selected x402 specialist call.
- The final response includes specialist disclosure and receipt evidence.

## Current repo reality / gap analysis

Existing support:

- `packages/rap-mcp-bridge` exists and builds.
- Claude/Cursor config shape already documented.
- Claude Code CLI is installed locally and supports `claude mcp add`.
- RAP MCP bridge currently exposes dry-run tools by default:
  - `reddi.discover_specialists`
  - `reddi.request_quote`
  - `reddi.verify_receipt`
  - `reddi.export_disclosure_ledger`
- In devnet mode, the bridge also exposes:
  - `reddi.prepare_devnet_payment`
  - `reddi.execute_devnet_payment`
  - `reddi.verify_devnet_receipt`
- Devnet MCP payment tools are explicitly bounded and opt-in.

Important gap:

- The current devnet MCP payment implementation is synthetic SOL-lamport payment semantics and explicitly says `no-specialist-http-invocation`.
- The requested demo needs an actual marketplace specialist invocation plus x402 payment using `reddi-x402` / Solana devnet USDC.
- Therefore this demo needs one additional implementation slice before recording: **Claude MCP live x402 specialist invocation**.

## Proposed implementation slice: MCP live x402 specialist invocation

Add an explicitly gated tool, name TBD:

- `reddi.invoke_marketplace_specialist`
  - or `reddi.execute_x402_specialist_call`

### Required gates

Expose the tool only when all are true:

```bash
REDDI_RAP_MCP_MODE=devnet
RAP_MCP_DEVNET_PROOF_APPROVED=1
RAP_MCP_ALLOW_SPECIALIST_INVOKE=1
RAP_MCP_DEVNET_WALLET_KEYPAIR=/path/to/devnet-consumer-keypair.json
RAP_MCP_DEVNET_RPC_URL=https://api.devnet.solana.com
RAP_MCP_DEVNET_MAX_USDC_MICRO_UNITS=150000   # example: 0.150000 USDC
REDDI_MCP_HOST_FRAMEWORK=claude
```

Optional later route instead of local keypair:

```bash
RAP_MCP_WALLET_AUTHORITY_MODE=wallet-router
RAP_MCP_WALLET_ROUTER_URL=http://127.0.0.1:<port>
RAP_MCP_WALLET_ROUTER_SESSION=<opaque-session-id>
```

Recommendation for first recording: use a local devnet keypair path with tiny funded balances, not a wallet-router. It is easier to validate and less likely to fail during recording.

### Wallet safety rules

- Never print the keypair secret.
- Never open the keypair JSON on screen.
- Show only the public wallet address, devnet balances, spend cap, and transaction signatures.
- Wallet must be a dedicated demo devnet wallet, not a personal/operator wallet.
- Wallet must hold only the minimum required devnet SOL and devnet USDC.
- Tool must enforce max per-call and max total spend caps.
- Tool must reject mainnet RPC URLs.
- Tool must reject non-allowlisted specialist endpoints.
- Tool must write receipt + disclosure ledger to local artifact store.

### Functional flow

1. `reddi.discover_specialists`
   - Finds marketplace specialists from local RAP backend.
2. `reddi.request_quote`
   - Returns quote with endpoint, wallet, amount, token/network, terms hash.
3. `reddi.prepare_x402_payment`
   - Non-mutating readiness check.
   - Verifies wallet public key, SOL balance, USDC balance/token account, quote amount, spend cap, and allowlist.
4. `reddi.execute_x402_specialist_call`
   - Requires exact approval phrase, e.g. `EXECUTE_DEVNET_X402_SPECIALIST_CALL`.
   - Creates/sends devnet USDC payment using `reddi-x402` compatible header/receipt flow.
   - Calls the selected specialist endpoint with the x402 payment header.
   - Captures HTTP 402 challenge, payment transaction, HTTP 200 completion, output preview/hash.
5. `reddi.verify_x402_receipt`
   - Verifies devnet tx, recipient, mint, amount, quote id/terms hash where possible.
6. `reddi.export_disclosure_ledger`
   - Includes specialist id, capability, quote, payment tx, verification status, output hash, and boundary.

## Claude Code CLI registration command for recording

Build first:

```bash
npm --prefix packages/rap-mcp-bridge run build
```

Register the MCP server in Claude Code CLI:

```bash
claude mcp add reddi-rap-devnet \
  -e REDDI_RAP_BASE_URL=http://localhost:3000 \
  -e REDDI_RAP_MCP_MODE=devnet \
  -e REDDI_MCP_HOST_FRAMEWORK=claude \
  -e REDDI_MCP_AGENT_NAME=claude-code-demo \
  -e RAP_MCP_DEVNET_PROOF_APPROVED=1 \
  -e RAP_MCP_ALLOW_SPECIALIST_INVOKE=1 \
  -e RAP_MCP_DEVNET_WALLET_KEYPAIR=/path/to/demo-devnet-wallet.json \
  -e RAP_MCP_DEVNET_RPC_URL=https://api.devnet.solana.com \
  -e RAP_MCP_DEVNET_MAX_USDC_MICRO_UNITS=150000 \
  -- node /Users/loki/.openclaw/workspace/projects/reddi-agent-protocol-code/packages/rap-mcp-bridge/dist/src/server.js
```

For recording, hide or avoid showing the full keypair path if it includes sensitive directory names. It is safe to show public wallet address and balances.

## Claude prompt for the demo

Use a prompt that naturally needs a specialist, but does not require private data:

```text
Use Reddi Agent Protocol to find a specialist agent that can help produce a concise launch-market positioning answer for machine-payable specialist agents.

Requirements:
- Discover marketplace specialists first.
- Pick one specialist with a quote under 0.05 devnet USDC.
- If payment is required, use the configured devnet x402 wallet only if the tool reports the spend cap is respected.
- Verify the receipt before relying on the specialist output.
- Final answer must include: the chosen specialist, what it contributed, the payment/receipt boundary, and a disclosure ledger summary.
```

## Peekaboo recording storyboard

Target length: 60–100 seconds.

1. Terminal: show repo and build success.
2. Terminal: run `claude mcp add ...` and `claude mcp list` / `claude mcp get reddi-rap-devnet`.
3. Terminal: show dedicated devnet wallet public address and balances only.
4. Terminal: start Claude Code prompt.
5. Claude output: discovery tool call / specialist candidates.
6. Claude output: quote + spend cap respected.
7. Claude output: x402 payment execution / tx signature / HTTP 200 specialist result.
8. Claude output: receipt verification + disclosure ledger.
9. Claude final answer: response visibly incorporates specialist contribution.
10. Optional terminal: show saved evidence artifact path.

## Validation gates before recording

Do not record until all pass:

```bash
npm --prefix packages/rap-mcp-bridge run test
npm --prefix packages/rap-mcp-bridge run smoke:stdio
RAP_MCP_DEVNET_PROOF_APPROVED=1 \
RAP_MCP_DEVNET_WALLET_KEYPAIR=/path/to/demo-devnet-wallet.json \
RAP_MCP_ALLOW_SPECIALIST_INVOKE=1 \
npm --prefix packages/rap-mcp-bridge run smoke:devnet-x402-specialist
```

If the live x402 specialist smoke does not exist yet, implement it before recording.

## Recording command sketch

```bash
mkdir -p artifacts/claude-code-mcp-x402-peekaboo-demo/$(date -u +%Y%m%dT%H%M%SZ)
peekaboo record --screen --output artifacts/claude-code-mcp-x402-peekaboo-demo/<timestamp>/claude-code-mcp-x402-demo.mp4
```

Use the actual Peekaboo command variant already validated on this machine if syntax differs.

## Retrospective rule for this loop

If the first implementation attempt reveals that `reddi-x402` is currently specialist-side middleware only and not a consumer wallet client, split the work:

1. Add a consumer-side x402 payment client/helper to `reddi-x402` or a sibling package.
2. Then wire the MCP bridge invocation tool to that helper.
3. Only record after the end-to-end smoke proves `402 challenge -> devnet USDC payment -> 200 specialist response`.

Do not fake the payment or use the older synthetic SOL-only MCP receipt as if it were this requested flow.

## Implementation update — 2026-05-09 Loop 24

Local no-spend implementation now exists for the Claude Code MCP x402 specialist path:

- `@redditech/x402-solana` has a devnet USDC payer helper and Solana SPL-token adapter boundary.
- `@redditech/rap-mcp-bridge` now gates and exposes:
  - `reddi.prepare_x402_specialist_call`
  - `reddi.execute_x402_specialist_call`
  - `reddi.verify_x402_specialist_receipt`
- Disclosure ledger export accepts `x402ReceiptIds` for verified specialist-call evidence.
- Tests prove prepare/execute/verify/ledger with fake fetch + fake transfer adapter only.

Validation passed:

```bash
npm test --prefix packages/rap-mcp-bridge
npm test --prefix packages/x402-solana -- --runInBand
npm run build --prefix packages/rap-mcp-bridge
npm run build --prefix packages/x402-solana
```

## Implementation update — 2026-05-09 Loops 27–30

The proof ladder is now complete and recording instructions are packaged in `docs/CLAUDE-CODE-MCP-X402-RECORDING-RUNBOOK-2026-05-09.md`.

Completed evidence:

- Surfpool/local validator x402 E2E proof: `artifacts/rap-mcp-bridge-x402-surfpool-local/20260508T214434Z/SUMMARY.md`
- Devnet funding preflight: `artifacts/claude-code-mcp-x402-peekaboo-demo/20260508T214759Z-devnet-funding-preflight/SUMMARY.md`
- Live devnet x402 specialist smoke: `artifacts/claude-code-mcp-x402-peekaboo-demo/20260508T214912Z-live-x402-specialist-smoke/SUMMARY.md`

Live smoke result:

- Receipt: `x402_specialist_e12428767c48f25a1e5ae5c3`
- Devnet tx: `1g3B6EBdBcAVWQaGU3EWGLuSGYBnuFCU4MN7Vbn8SUZtEDczF5eSxRxjgZR3rUhsna5WxQjWPzbWAW6VbzfwKj9`
- Payer USDC: `0.87 → 0.82`
- Ledger entries: `1`

Recording boundary remains devnet-only, exact endpoint allowlist, `60000` micro-USDC cap, no mainnet claims, and no private key material on screen or in artifacts.

