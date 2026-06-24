# OKF/OpenKB Static Fixture Corpus

Issue: [#503](https://github.com/nissan/reddi-agent-protocol/issues/503)

This corpus gives RAP a static, no-network fixture lane for reviewing Google OKF-shaped and OpenKB-style knowledge bundles. It is an evidence input for future diagnostics and adapter work, not a runtime ingestion path.

The fixture corpus is stored at `data/okf-openkb-fixtures/okf-openkb-fixture-corpus.v1.json` and is checked by `npm run check:okf-openkb:fixtures`.
Each fixture carries a `contentSha256` digest over its static file path, role, content class, trust boundary, and preview text. The checker recomputes those digests so fixture review inputs cannot drift silently.

## Boundaries

OKF is treated as a markdown/frontmatter interchange shape. OpenKB is treated as a possible producer of bundle-shaped output. Neither one is trusted as runtime policy by import.

The corpus must not:

- Install OpenKB or any generated skill.
- Fetch arbitrary URLs or ingest live repositories.
- Invoke LLM/provider APIs, MCP tools, wallets, RPC providers, or paid endpoints.
- Execute imported scripts, hooks, prompts, tools, or agent definitions.
- Write hosted registries, publish marketplace listings, onboard agents, activate payments, or mutate trust/reputation state.

Generated `AGENTS.md`, `SKILL.md`, prompts, scripts, tools, and agent definitions are review artifacts only. They may be preserved as static text so reviewers and future checkers can report diagnostics, but they cannot become trusted instructions by import.

## Fixtures

### `okf-minimal-concept-bundle`

Models a small OKF-shaped markdown/frontmatter bundle with `index.md`, a concept note, and `log.md`. It proves RAP can carry source provenance, file roles, and untrusted imported-context boundaries without relying on live fetches.

### `openkb-style-generated-agent-bundle`

Models an OpenKB-style producer output that includes wikilinks plus generated agent instructions, generated skill text, and a generated script. It intentionally expects blocking diagnostics for generated instructions and execution-not-allowed artifacts.

## Downstream Use

Allowed downstream use is limited to static review, deterministic OKF-shaped adapter fixtures, operator review payload fixtures, and conformance diagnostics.

This corpus does not claim OKF/OpenKB support in RAP v0.1. That decision remains a product decision after the #503/#504/#505 evidence and adapter spike work are reviewed.
