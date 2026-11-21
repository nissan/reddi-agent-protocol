# Claude Code MCP Live x402 Specialist Invocation Spec

_Date: 2026-05-09 AEST_

## Purpose

Turn the Peekaboo recording plan into an implementation-ready slice: Claude Code CLI registers the RAP MCP bridge, discovers a marketplace specialist, pays the selected specialist through a bounded devnet x402 flow, verifies the receipt, and uses the paid specialist response in the final Claude answer.

This spec is intentionally narrow. It is not a mainnet payment path and it must not expose keypair material.

## Evidence found in repo

### RAP MCP bridge

`packages/rap-mcp-bridge/src/server.ts` currently registers:

- `reddi.discover_specialists`
- `reddi.request_quote`
- `reddi.verify_receipt`
- `reddi.export_disclosure_ledger`

When devnet gates are enabled it also registers:

- `reddi.prepare_devnet_payment`
- `reddi.execute_devnet_payment`
- `reddi.verify_devnet_receipt`

Current limitation: `packages/rap-mcp-bridge/src/tools/devnet-payment.ts` is bounded Solana devnet SOL-transfer semantics for bridge-generated synthetic quotes and its receipt boundary says `solana-devnet-only-no-mainnet-no-specialist-http-invocation`.

### x402 package

`packages/x402-solana/src/payment.ts` already includes:

- `buildX402Challenge()`
- `parseX402PaymentHeader()`
- `DemoPaymentVerifier`
- `SolanaReceiptVerifier`

Important limitation: `sendPayment()` is currently documented as a test stub and returns mock signatures; it does **not** submit funding transactions. The specialist-side real verifier can inspect parsed devnet transactions when `ALLOW_REAL_X402_PAYMENT=true`, but a consumer-side devnet USDC payer helper is missing.

### Hosted OpenRouter specialists

`packages/openrouter-specialists/src/runtime.ts` supports x402 challenges and specialist-side receipt verification:

- unpaid calls return HTTP 402 with `x402-request`
- paid calls accept `x402-payment`
- demo receipts are gated by `ALLOW_DEMO_X402_PAYMENT`
- real receipt verification is gated by `ALLOW_REAL_X402_PAYMENT`
- real verification uses `SolanaReceiptVerifier`, RPC URL, and devnet USDC mint

Therefore the missing demo-critical piece is not Claude registration; it is the consumer-side MCP tool that can answer a 402 challenge with a real bounded devnet USDC payment receipt and retry the specialist endpoint.

## Proposed PR slice

Add a **consumer-side devnet x402 payer** plus MCP tools around it.

### New package helper

Add to `packages/x402-solana`:

- `src/client.ts` or `src/payer.ts`

Export functions:

```ts
prepareDevnetUsdcPayment(input): Promise<DevnetUsdcPaymentReadiness>
executeDevnetUsdcPayment(input): Promise<X402PaymentReceipt>
```

Minimum behaviour:

1. Load a Solana keypair from an explicit path.
2. Reject mainnet RPC URLs and non-devnet network challenges.
3. Parse/validate x402 challenge:
   - `network === "solana-devnet"`
   - `currency === "USDC"`
   - valid `payTo`
   - positive amount
   - nonce present
   - endpoint allowlisted
4. Check payer SOL balance for fees.
5. Check payer devnet USDC associated token account balance.
6. Compute or create destination associated token account for payee/mint.
7. Enforce max micro-USDC spend cap.
8. Submit SPL token transfer / transferChecked.
9. Return `X402PaymentReceipt`:

```json
{
  "network": "solana-devnet",
  "payTo": "<specialist-wallet>",
  "amount": "0.05",
  "currency": "USDC",
  "nonce": "<challenge-nonce>",
  "signature": "<devnet-tx>",
  "payer": "<demo-wallet-pubkey>",
  "mint": "<devnet-usdc-mint>",
  "destinationTokenAccount": "<payee-ata>"
}
```

No secrets in return values, logs, artifacts, or thrown messages.

### New MCP schemas

Add to `packages/rap-mcp-bridge/src/schemas.ts`:

- `prepareX402SpecialistCallInputSchema`
- `executeX402SpecialistCallInputSchema`
- `verifyX402SpecialistReceiptInputSchema`

Suggested inputs:

```ts
{
  quoteId: z.string().max(160),
  endpoint: z.string().url(),
  method: z.literal("POST").default("POST"),
  body: z.record(z.unknown()),
  maxUsdcMicroUnits: z.number().int().positive().max(1_000_000),
}
```

Execute adds:

```ts
{
  idempotencyKey: z.string().min(1).max(128),
  approvalPhrase: z.literal("EXECUTE_DEVNET_X402_SPECIALIST_CALL")
}
```

### New MCP tools

Register only when the following gates are enabled:

```bash
REDDI_RAP_MCP_MODE=devnet
RAP_MCP_DEVNET_PROOF_APPROVED=1
RAP_MCP_ALLOW_SPECIALIST_INVOKE=1
RAP_MCP_DEVNET_WALLET_KEYPAIR=/path/to/demo-devnet-wallet.json
RAP_MCP_DEVNET_RPC_URL=https://api.devnet.solana.com
RAP_MCP_DEVNET_USDC_MINT=<devnet-usdc-mint>
RAP_MCP_DEVNET_MAX_USDC_MICRO_UNITS=150000
RAP_MCP_SPECIALIST_ENDPOINT_ALLOWLIST=https://reddi-code-generation.preview.reddi.tech/v1/chat/completions,...
```

Tools:

1. `reddi.prepare_x402_specialist_call`
   - non-mutating readiness check
   - performs unpaid request or accepts provided x402 challenge
   - checks endpoint allowlist, challenge terms, wallet public key, SOL/USDC balances, destination ATA, spend cap
   - returns `ready: true|false`, no secret material

2. `reddi.execute_x402_specialist_call`
   - requires `EXECUTE_DEVNET_X402_SPECIALIST_CALL`
   - idempotent by `idempotencyKey`
   - performs unpaid request to capture HTTP 402 challenge
   - executes devnet USDC transfer with `@redditech/x402-solana`
   - retries endpoint with `x402-payment` receipt header
   - requires HTTP 200 before marking complete
   - stores receipt + response hash + bounded output preview

3. `reddi.verify_x402_specialist_receipt`
   - reuses `SolanaReceiptVerifier`
   - verifies tx, payee, mint, amount, nonce, endpoint terms where possible
   - returns `verified: true|false`, boundary, and receipt refs

4. Extend `reddi.export_disclosure_ledger`
   - include live x402 specialist receipt entries:
     - quote id
     - specialist endpoint id/profile id where known
     - capability
     - request/task hash
     - payment signature
     - verifier status
     - output hash
     - `mainnetSettlement: not_applicable`

## Endpoint and quote selection for the recording

Use one exact allowlisted hosted specialist first, ideally the code-generation specialist because prior readiness artifacts show canonical x402 challenge behaviour:

- endpoint: `https://reddi-code-generation.preview.reddi.tech/v1/chat/completions`
- network: `solana-devnet`
- currency: `USDC`
- amount observed previously: `0.05`

Claude can still call `reddi.discover_specialists` first. For recording stability, the prompt should instruct it to choose an allowlisted specialist under the cap.

## Smoke test script

Add:

```bash
packages/rap-mcp-bridge/scripts/smoke-live-x402-specialist.mjs
```

Script gates:

- exits blocked unless `RAP_MCP_LIVE_X402_SPECIALIST_SMOKE=1`
- requires explicit wallet keypair path
- prints public wallet address only
- writes git-ignored artifact under:
  - `artifacts/claude-code-mcp-x402-peekaboo-demo/<timestamp>/smoke-summary.json`

Pass criteria:

1. Bridge tool list contains `reddi.prepare_x402_specialist_call` and `reddi.execute_x402_specialist_call`.
2. Unpaid specialist request returns HTTP 402 with valid x402 challenge.
3. Readiness says spend cap respected.
4. Devnet USDC tx confirmed.
5. Paid retry returns HTTP 200.
6. Receipt verifies.
7. Disclosure ledger exports one live x402 entry.

## Test plan

Unit tests:

- config rejects mainnet RPC
- config rejects missing wallet keypair
- config rejects missing USDC mint
- config rejects non-allowlisted endpoint
- prepare is non-mutating
- execute requires approval phrase
- execute enforces idempotency
- execute enforces max spend cap
- receipt verification rejects wrong payee/mint/amount/nonce
- no returned object includes private key material

Package gates:

```bash
npm test --prefix packages/x402-solana
npm test --prefix packages/rap-mcp-bridge
npm run build --prefix packages/x402-solana
npm run build --prefix packages/rap-mcp-bridge
```

Live smoke gate only after wallet funding is confirmed and Nissan-approved:

```bash
RAP_MCP_LIVE_X402_SPECIALIST_SMOKE=1 \
RAP_MCP_DEVNET_PROOF_APPROVED=1 \
RAP_MCP_ALLOW_SPECIALIST_INVOKE=1 \
RAP_MCP_DEVNET_WALLET_KEYPAIR=/path/to/demo-devnet-wallet.json \
RAP_MCP_DEVNET_RPC_URL=https://api.devnet.solana.com \
RAP_MCP_DEVNET_USDC_MINT=<devnet-usdc-mint> \
RAP_MCP_DEVNET_MAX_USDC_MICRO_UNITS=150000 \
npm --prefix packages/rap-mcp-bridge run smoke:live-x402-specialist
```

## Claude Code registration after implementation

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
  -e RAP_MCP_DEVNET_USDC_MINT=<devnet-usdc-mint> \
  -e RAP_MCP_DEVNET_MAX_USDC_MICRO_UNITS=150000 \
  -e RAP_MCP_SPECIALIST_ENDPOINT_ALLOWLIST=https://reddi-code-generation.preview.reddi.tech/v1/chat/completions \
  -- node /Users/loki/.openclaw/workspace/projects/reddi-agent-protocol-code/packages/rap-mcp-bridge/dist/src/server.js
```

## Recording readiness checklist

Before Peekaboo:

- [ ] Demo devnet wallet is dedicated and funded only with small SOL/USDC amounts.
- [ ] Hosted specialist has `ALLOW_REAL_X402_PAYMENT=true` and correct devnet USDC mint configured.
- [ ] MCP live x402 specialist smoke passes.
- [ ] Claude Code MCP registration verified with `claude mcp get reddi-rap-devnet`.
- [ ] No keypair JSON or secret env values visible on screen.
- [ ] Output artifact path created.
- [ ] Claim boundary displayed or narrated: devnet-only, bounded, no mainnet.

## Retrospective

The retry clarified the exact missing layer. The repo already has specialist-side x402 challenge/verification and MCP registration support, but `@redditech/x402-solana` is not yet a consumer payer. So the next implementation loop should start in `packages/x402-solana` with a devnet USDC payer helper, then wire MCP tools around it. Starting directly in Claude would produce a nice-looking but false demo; starting with the payer helper gives us a recording that can survive judge scrutiny.

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

Remaining blocker before recording a live clip: explicit funded demo devnet wallet approval and a live smoke against an allowlisted specialist endpoint. Until that approval, the implemented path remains no-spend/local-test evidence only.

