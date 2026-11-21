# Claude Code MCP x402 — PR Readiness

_Date: 2026-05-09 AEST_

## Scope

This slice turns the RAP MCP bridge from safe dry-run/demo scaffolding into a gated devnet x402 specialist-call path for recording Claude Code using a paid specialist.

## Code/package changes

### `@redditech/x402-solana`

- Adds consumer-side devnet USDC payer helper in `src/client.ts`.
- Exports:
  - `createSolanaDevnetUsdcPaymentClient(connection)`
  - `prepareDevnetUsdcPayment(...)`
  - `executeDevnetUsdcPayment(...)`
  - `challengeFromX402RequestHeader(...)`
- Enforces:
  - no mainnet RPC URL
  - `network === solana-devnet`
  - `currency === USDC`
  - valid payee and mint public keys
  - exact endpoint allowlist
  - max micro-USDC cap
  - explicit wallet keypair path
  - approval phrase for execution

### `@redditech/rap-mcp-bridge`

- Adds gated x402 specialist MCP tools:
  - `reddi.prepare_x402_specialist_call`
  - `reddi.execute_x402_specialist_call`
  - `reddi.verify_x402_specialist_receipt`
- Adds x402 receipt storage and disclosure-ledger export by `x402ReceiptIds`.
- Adds smoke scripts:
  - `smoke:x402-tool-list`
  - `smoke:x402-surfpool-local`
  - `smoke:live-x402-specialist`

## Documentation changes

- `docs/CLAUDE-CODE-MCP-X402-LIVE-INVOKE-SPEC-2026-05-09.md`
- `docs/CLAUDE-CODE-MCP-X402-PEEKABOO-DEMO-PLAN-2026-05-09.md`
- `docs/CLAUDE-CODE-MCP-X402-RECORDING-RUNBOOK-2026-05-09.md`
- `docs/RAP-MCP-BRIDGE-HOST-INTEGRATIONS-2026-05-08.md` — naming corrected to “Reddi Agent Protocol MCP bridge”.
- `docs/RAP-MCP-BRIDGE-PACKAGE-PLAN-2026-05-08.md` — naming corrected to “Reddi Agent Protocol MCP bridge”.

## Product naming guard

- Product name: **Reddi Agent Protocol**.
- Short form: **RAP**.
- Do not call the product standalone “Reddi”. Literal URLs/package IDs may contain `reddi`.
- Recording script visible line: `Starting Claude Code with Reddi Agent Protocol MCP tools...`.

## Proof artifacts

- Surfpool/local E2E:
  - `artifacts/rap-mcp-bridge-x402-surfpool-local/20260508T214434Z/SUMMARY.md`
- Devnet funding preflight:
  - `artifacts/claude-code-mcp-x402-peekaboo-demo/20260508T214759Z-devnet-funding-preflight/SUMMARY.md`
- Live hosted specialist smoke:
  - `artifacts/claude-code-mcp-x402-peekaboo-demo/20260508T214912Z-live-x402-specialist-smoke/SUMMARY.md`
- Canonical strict-naming true-live Claude Code capture:
  - Bundle: `artifacts/claude-code-mcp-x402-peekaboo-demo/final-bundle-20260508T231415Z-strict-naming-live.zip`
  - SHA256: `b293e26fdbe8d30c5791a8e263541393b9302131961e83414ef8f164049584b0`
  - Full video: `artifacts/claude-code-mcp-x402-peekaboo-demo/final-bundle-20260508T231415Z-strict-naming-live/claude-code-mcp-x402-strict-naming-live-full.mp4`
  - Preview: `artifacts/claude-code-mcp-x402-peekaboo-demo/final-bundle-20260508T231415Z-strict-naming-live/claude-code-mcp-x402-strict-naming-live-preview.mp4`
  - Claude output: `artifacts/claude-code-mcp-x402-peekaboo-demo/final-bundle-20260508T231415Z-strict-naming-live/claude-output.txt`

Live smoke receipt:

- Receipt: `x402_specialist_e12428767c48f25a1e5ae5c3`
- Devnet tx: `1g3B6EBdBcAVWQaGU3EWGLuSGYBnuFCU4MN7Vbn8SUZtEDczF5eSxRxjgZR3rUhsna5WxQjWPzbWAW6VbzfwKj9`
- Payer USDC: `0.87 → 0.82`

Canonical recording receipt:

- Receipt: `x402_specialist_0460d1e4214ab0f0ddb7d667`
- Devnet tx: `3oVM9kKqMME6J4sufvWRT5s6F1N9HcLnUGTDeLbxXQNyuAEkC7Nt4JxKs9aoxun7FVTCvzeS4Pwt2PqPMwF1oGGV`
- Amount: `0.05 USDC` under `60000` micro-USDC cap.
- Video: `154.9s`, `1440x810`, `1549` frames.

## Validation

Passed:

```bash
npm run build --prefix packages/x402-solana
npm test --prefix packages/x402-solana -- --runInBand
npm run build --prefix packages/rap-mcp-bridge
npm test --prefix packages/rap-mcp-bridge
npm --prefix packages/rap-mcp-bridge run smoke:x402-tool-list
npm run check:product:naming -- docs/CLAUDE-CODE-MCP-X402-RECORDING-RUNBOOK-2026-05-09.md docs/CLAUDE-CODE-MCP-X402-PEEKABOO-DEMO-PLAN-2026-05-09.md
bash -n scripts/run-claude-code-mcp-x402-recording-demo.sh
unzip -t artifacts/claude-code-mcp-x402-peekaboo-demo/final-bundle-20260508T231415Z-strict-naming-live.zip
```

Live smoke passed separately with explicit gate:

```bash
RAP_MCP_LIVE_X402_SPECIALIST_SMOKE=1 \
RAP_MCP_DEVNET_WALLET_KEYPAIR=/Users/loki/.config/solana/id.json \
RAP_MCP_DEVNET_RPC_URL=https://api.devnet.solana.com \
RAP_MCP_DEVNET_USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU \
RAP_MCP_DEVNET_MAX_USDC_MICRO_UNITS=60000 \
npm --prefix packages/rap-mcp-bridge run smoke:live-x402-specialist
```

## Safety checklist

- [x] Default bridge remains dry-run only.
- [x] x402 specialist tools are hidden unless devnet mode + proof approval + invoke gate are configured.
- [x] Execute requires exact approval phrase `EXECUTE_DEVNET_X402_SPECIALIST_CALL`.
- [x] Mainnet RPC URLs are rejected.
- [x] Specialist endpoint must exactly match allowlist.
- [x] Per-call cap is enforced in micro-USDC.
- [x] No private key material returned in tool outputs or artifacts.
- [x] Surfpool local validator proof was run before devnet spend.
- [x] Live smoke is devnet-only and recorded as such.
- [x] Canonical recording uses “Reddi Agent Protocol” / “RAP” naming only.
- [x] Earlier locked-screen/replay/pre-strict-naming captures are superseded; use the strict-naming true-live bundle for review/submission.

## Known limitations / follow-up

- Current recording path uses the default devnet CLI keypair as demo payer; next improvement is a dedicated low-balance demo-only keypair or wallet-router session.
- `verify_x402_specialist_receipt` currently verifies the stored MCP completion boundary; the hosted specialist verifies the actual receipt during paid retry. A future improvement can add an explicit bridge-side chain reverify tool against stored challenge terms.
- The hosted specialist endpoint is exact-allowlisted for recording stability; arbitrary marketplace endpoint execution remains intentionally out of scope.

## Recommended PR title

`feat: add gated devnet x402 specialist calls to RAP MCP bridge`

## Recommended PR summary

Adds a gated devnet x402 specialist invocation path for Claude Code MCP demos, including a consumer-side devnet USDC payer helper, MCP prepare/execute/verify tools, x402 disclosure-ledger entries, Surfpool/local E2E smoke, live hosted specialist smoke, strict Reddi Agent Protocol/RAP naming guards, and a canonical true-live Claude Code recording bundle.
