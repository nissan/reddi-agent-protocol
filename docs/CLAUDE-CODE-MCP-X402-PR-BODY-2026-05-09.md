## Summary

Adds a gated devnet x402 specialist invocation path for Claude Code MCP demos.

This includes:

- consumer-side devnet USDC x402 payer helper in `@redditech/x402-solana`
- gated Reddi Agent Protocol MCP tools for prepare/execute/verify specialist calls
- x402 receipt storage and disclosure-ledger export support
- Surfpool/local x402 end-to-end smoke
- gated live devnet specialist smoke
- Claude Code recording script/runbooks
- strict Reddi Agent Protocol/RAP naming guards
- canonical true-live Claude Code demo bundle

## Product naming

Product name is **Reddi Agent Protocol**. Short form is **RAP**. Avoid standalone “Reddi” as the product name except inside literal URLs/package identifiers.

The canonical recording start line is:

> Starting Claude Code with Reddi Agent Protocol MCP tools...

## Canonical demo artifact

Use this bundle for review:

`artifacts/claude-code-mcp-x402-peekaboo-demo/final-bundle-20260508T231415Z-strict-naming-live.zip`

SHA256:

`b293e26fdbe8d30c5791a8e263541393b9302131961e83414ef8f164049584b0`

Supersedes older locked-screen, replay, and pre-strict-naming captures.

## Canonical recording proof

- Receipt: `x402_specialist_0460d1e4214ab0f0ddb7d667`
- Devnet tx: `3oVM9kKqMME6J4sufvWRT5s6F1N9HcLnUGTDeLbxXQNyuAEkC7Nt4JxKs9aoxun7FVTCvzeS4Pwt2PqPMwF1oGGV`
- Amount: `0.05 USDC`
- Cap: `60000` micro-USDC
- Boundary: `solana-devnet-only-no-mainnet`
- Video: `154.9s`, `1440x810`, `1549` frames

## Safety

- Default bridge remains dry-run only.
- x402 specialist tools are hidden unless devnet mode + proof approval + invoke gate are configured.
- Execute requires exact approval phrase `EXECUTE_DEVNET_X402_SPECIALIST_CALL`.
- Mainnet RPC URLs are rejected.
- Specialist endpoint must exactly match allowlist.
- Per-call cap is enforced in micro-USDC.
- No private key material is returned in tool outputs or artifacts.
- Surfpool local validator proof was run before devnet spend.
- Live smoke and canonical recording are devnet-only.

## Validation

Passed locally in Loop 43:

```bash
npm run build --prefix packages/x402-solana
npm test --prefix packages/x402-solana -- --runInBand
npm run build --prefix packages/rap-mcp-bridge
npm test --prefix packages/rap-mcp-bridge
npm --prefix packages/rap-mcp-bridge run smoke:x402-tool-list
bash -n scripts/run-claude-code-mcp-x402-recording-demo.sh
unzip -t artifacts/claude-code-mcp-x402-peekaboo-demo/final-bundle-20260508T231415Z-strict-naming-live.zip
```

Results:

- x402-solana tests: 34/34 pass
- RAP MCP bridge tests: 26/26 pass
- x402 tool-list smoke: pass
- forbidden shorthand naming scan: pass

## Notes for reviewer

This PR intentionally does not enable arbitrary paid marketplace endpoint execution. The demo path is exact-allowlisted, devnet-only, explicitly gated, capped, and receipt/disclosure-ledger backed.

The final local branch currently has these commits over `main`:

1. `6045db55 feat: add gated devnet x402 MCP specialist demo`
2. `8b5b75e7 docs: enforce Reddi Agent Protocol naming in MCP demo`
3. `95db7b14 docs: point PR readiness at strict naming capture`
4. `09775348 test: harden x402 secret leakage assertion`
