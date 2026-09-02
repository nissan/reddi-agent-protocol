# @reddi/rap-mcp-bridge

Dry-run MCP bridge for RAP Assurance specialist discovery, synthetic quotes, receipt verification, and disclosure ledgers.

> Payments prove transfer; RAP Assurance proves paid work.

## First PR boundary

This package is **dry-run only**. It is not a payment tool, marketplace operator, custody path, hosted runtime, or production settlement surface.

Exposed tools:

- `reddi.discover_specialists`
- `reddi.request_quote`
- `reddi.verify_receipt`
- `reddi.export_disclosure_ledger`

Not exposed in the first PR:

- payment tools
- invoke tools
- file access
- arbitrary URL fetch
- private payload forwarding

## What this does not prove

- No payment settlement is proven.
- Synthetic quotes are not commercially binding.
- Specialist endpoints are not invoked.
- Devnet/mainnet settlement is not claimed.

## Claude / Cursor config

```json
{
  "mcpServers": {
    "reddi-rap": {
      "command": "node",
      "args": ["/absolute/path/to/packages/rap-mcp-bridge/dist/src/server.js"],
      "env": {
        "REDDI_RAP_BASE_URL": "http://localhost:3000",
        "REDDI_MCP_POLICY_MODE": "dry_run",
        "REDDI_MCP_HOST_FRAMEWORK": "claude"
      }
    }
  }
}
```

## Smoke test

```bash
npm --prefix packages/rap-mcp-bridge run smoke:stdio
```

This starts the built stdio MCP server with a temporary store, verifies the exact four-tool list, creates a synthetic quote, and verifies that dry-run receipt checking does not claim payment settlement.

## Backend URL policy

First PR accepts only local RAP backend URLs: `localhost`, `127.0.0.1`, or `::1` over HTTP(S). External hosts, link-local metadata IPs, `file:` URLs, and arbitrary remote URLs fail closed.

## Threat model

- A malicious MCP client may try to prompt-inject the bridge into spending. First PR has no payment/invoke tools.
- A malicious specialist endpoint may be returned by a backend. First PR does not fetch specialist URLs.
- A replayed quote id or idempotency key should return deterministic local quote state.
- Backend spoofing/localhost confusion is reduced by localhost-only backend URL validation and surfaced through backend URL output plus structured backend-reachable errors.
- Private payloads are rejected by schema; only summaries/hashes are used.
