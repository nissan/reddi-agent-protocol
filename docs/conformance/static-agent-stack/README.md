# Static Agent Stack Conformance Flow

Issue: [#407](https://github.com/nissan/reddi-agent-protocol/issues/407)

This document defines the docs-level conformance flow for the "Bring your agent stack" and "Start from a recipe" onboarding surfaces. The flow is for static ingestion of public agent-stack repositories and recipe fixtures. It turns repository evidence into an operator-reviewed RAP marketplace candidate without executing the imported stack.

RAP is not a generic agent builder. Static ingestion helps operators understand, classify, wrap, and review an existing stack before marketplace publication. It does not install plugins, start MCP servers, run hooks, execute imported code, create wallets, call RPC, transfer SPL tokens, or activate payments.

## Flow

1. Public repo fixture
   - Input is a public repository URL, pinned commit, archive fixture, or curated recipe fixture.
   - The fixture should include source identity, commit/ref, license signals, and public-safe provenance notes.
   - Private repos, local secrets, API keys, wallet material, and live credentials are out of scope for the static fixture lane.

2. Static inventory
   - Read repository metadata, manifests, package files, documented MCP config, scripts, README claims, environment-variable names, and deployment notes as text.
   - Classify visible components into the marketplace disclosure model: LLM layer, control loop, tools, memory, goals, claims, payment posture, and safety gates.
   - Emit an inventory that names discovered files and signals. The inventory is evidence for review, not proof that the stack works.

3. Connector diagnostics
   - Validate parseable files and report precise diagnostics for malformed or partial inputs.
   - Continue partial ingestion when safe files remain readable, while marking affected connectors as blocked or incomplete.
   - Diagnostics must be actionable: file path, parser or schema phase, severity, and review note.

4. Draft recipe/profile
   - Generate a draft RAP recipe and marketplace profile candidate from static signals.
   - Default trust state is `externally_listed_unattested` or `static_inventory_unreviewed`.
   - Capability claims are conservative and must distinguish "declared by source" from "verified by RAP".

5. Operator review payload
   - Bundle the static inventory, diagnostics, draft recipe/profile, risk summary, missing evidence, and publication blockers.
   - The payload is the handoff point for human review, attestor planning, and future wrapper decisions.
   - No marketplace publication happens from the draft alone.

6. Optional wrapper/runtime
   - A wrapper may be proposed after review to adapt the source into RAP specialist, attestor, or consumer roles.
   - Wrapper work is a separate runtime integration step. It must use explicit allowlists, sandbox credentials, and test fixtures.
   - Static ingestion must not execute the imported stack to "prove" wrapper compatibility.

7. Payment/readiness gate
   - Payment readiness is evaluated after review, not during ingestion.
   - Static risks feed readiness categories such as signer scope, wallet custody claims, RPC/network dependency, SPL-token transfer capability, deployment/admin authority, MCP side effects, secrets posture, and receipt/evidence coverage.
   - A static finding does not imply a wallet was connected, an RPC request was sent, an SPL transfer happened, live payment was enabled, or Quasar/AUDD custody was used.

8. Reviewed marketplace listing
   - Publication requires explicit review gates: source provenance, license posture, disclosure completeness, risk disposition, attestation plan, payment readiness, and operator approval.
   - The listing must label unverified claims and imported-source boundaries until RAP evidence and attestation exist.

## Static-only guardrails

The static ingestion lane must fail closed on side effects:

- No plugin install.
- No package install triggered by the imported repository.
- No command execution from imported scripts, hooks, Makefiles, task runners, or CI files.
- No MCP server calls or tool invocations.
- No network calls to imported endpoints, wallets, RPC providers, model providers, or deployment platforms.
- No reading or storing secrets, private keys, seed phrases, bearer tokens, cookies, raw auth headers, or provider credentials.
- No wallet creation, wallet import, signing, simulation, airdrop, faucet, SPL-token transfer, or custody operation.
- No live payment activation, x402 retry, AUDD/Quasar escrow action, or payment proof creation.
- No marketplace publication without review gates.

Static ingestion may record the existence of risky code paths or configuration names. It must describe them as static evidence only.

## Acceptance Example: Anthropic `.mcp.json`

Use a malformed Anthropic-style MCP configuration fixture to prove precise diagnostics and partial ingestion:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    }
  }
}
```

Expected behavior:

- Report a JSON parse diagnostic for `.mcp.json` with line/column and a message equivalent to "trailing comma before closing array/object".
- Do not run `npx`, install the MCP server, or call any MCP tool.
- Continue inventory for safe repository files such as `README.md`, `package.json`, lockfiles, and docs.
- Mark the MCP connector section as `blocked_by_malformed_config`.
- Draft recipe/profile may include a review note that an MCP filesystem connector is declared but not ingestible until the config is corrected.
- Operator review payload must include the original file path, diagnostic, partial-ingestion status, and publication blocker.

This fixture exists to test diagnostic precision. It is not permission to auto-repair, install, or execute the imported MCP server.

## Acceptance Example: Solana AI Kit

Use Solana AI Kit as a hook-heavy, MCP-heavy, wallet/RPC/deploy-capable static ingestion fixture. The goal is to capture Solana-specific readiness risks without performing Solana actions.

Static signals to inventory:

- Solana dependencies such as `@solana/web3.js`, `@solana/spl-token`, wallet adapters, Anchor, deployment CLIs, or AI-kit packages.
- Scripts or docs that mention deploy, airdrop, transfer, mint, swap, stake, token account creation, program upgrade, or RPC configuration.
- MCP server definitions or tool descriptions that could reach wallets, RPC endpoints, filesystem, shell, browser automation, package managers, or deployment platforms.
- Environment variables such as wallet paths, private keys, seed phrases, RPC URLs, program ids, token mint addresses, API keys, or payer accounts.
- Hooks that run during install, build, dev, postinstall, prepare, prepublish, or CI.

Expected behavior:

- Do not run hooks, package scripts, MCP tools, wallet code, RPC probes, deployment commands, or token-transfer code.
- Classify wallet/RPC/deploy/SPL-transfer capability as static risk, not observed behavior.
- Draft recipe/profile must preserve the distinction between "declared Solana-capable" and "reviewed RAP-ready".
- Operator review payload must block publication until a human resolves signer scope, RPC/network policy, spend caps, receipt/evidence requirements, deployment authority, and attestation plan.
- Payment/readiness gate must remain `blocked_pending_operator_review` or equivalent until explicit readiness evidence exists.

Solana risks can feed #377/#386 readiness categories as warnings and blockers. They must not imply live payment, wallet custody, Quasar custody, AUDD custody, RPC access, SPL transfer execution, or settlement proof.

## Later Integration Points

These capabilities enter after static ingestion and review:

- ARD discovery consumes reviewed recipes and profiles after operator approval. It should not surface raw static drafts as discoverable marketplace supply.
- RAP receipts/evidence attach to reviewed wrapper runs, dry-run route previews, attestations, or paid invocations. A static inventory can be evidence for review, but it is not a payment receipt or execution receipt.
- AUDD/Solana payment readiness evaluates reviewed candidates against network, asset, spend-cap, signer, custody, receipt, and attestation requirements. It remains disabled by default for static imports.
- Marketplace publication gates run after provenance, diagnostics, disclosure, risk, payment readiness, and attestation review are satisfied.

## Review Payload Shape

A static ingestion review payload should include:

```json
{
  "schemaVersion": "reddi.static-agent-stack-review.v1",
  "source": {
    "type": "public_repo_fixture",
    "url": "https://github.com/example/agent-stack",
    "ref": "commit-or-tag",
    "retrievedAt": "2026-06-20T00:00:00.000Z"
  },
  "inventoryRef": "artifacts/static-agent-stack/<fixture>/inventory.json",
  "diagnostics": [
    {
      "path": ".mcp.json",
      "phase": "json_parse",
      "severity": "blocking",
      "code": "malformed_mcp_config",
      "message": "Trailing comma before closing array/object"
    }
  ],
  "draftProfile": {
    "trustState": "static_inventory_unreviewed",
    "capabilityClaims": ["declared_by_source"],
    "publicationState": "blocked_pending_operator_review"
  },
  "readiness": {
    "payment": "disabled_static_import",
    "solana": "blocked_pending_operator_review",
    "marketplace": "not_publishable"
  },
  "guardrails": {
    "executedImportedCode": false,
    "calledMcpTools": false,
    "activatedPayment": false,
    "publishedMarketplaceListing": false
  }
}
```

The exact artifact paths may change as implementation lands, but the review payload must keep the side-effect booleans and publication/readiness states explicit.
