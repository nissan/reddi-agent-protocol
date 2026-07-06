# OKF/OpenKB Static Fixture Corpus & Conformance Diagnostics

Issues: [#503](https://github.com/nissan/reddi-agent-protocol/issues/503) (fixture corpus), [#504](https://github.com/nissan/reddi-agent-protocol/issues/504) (conformance diagnostics)

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

## Conformance Diagnostics (#504)

`packages/agent-protocol/src/okf-conformance.ts` (`reddi.okf-conformance.v1`, exported as `@reddi/agent-protocol/okf-conformance`) provides deterministic, pure static-analysis conformance diagnostics over OKF/OpenKB-style knowledge bundles. It builds directly on the #511 adapter spike (`okf-adapter.ts`) and this corpus — same document roles, trust classifications, and reason-code vocabulary.

Run `runOkfConformanceDiagnostics(input, options)` over an in-memory bundle (raw markdown `source` per document, or the adapter's pre-split input shape). `conformanceInputFromOkfOpenKbFixture(fixture)` bridges a #503 corpus fixture into the input shape read-only, preserving `contentSha256` behavior.

### What the diagnostics cover

- Parseable YAML frontmatter (conservative subset: scalars, comments, flat lists); unparseable content is skipped fail-closed and reported as `malformed_frontmatter`.
- Non-empty `type` for concept documents (`concept_type_missing`).
- Standard markdown links vs Obsidian/OpenKB wikilinks (`unsupported_link_syntax`): deterministic wikilinks are reported as adaptable (info); embeds/heading/block refs are unadaptable warnings.
- `index.md`/`log.md` semantics where applicable (`index_semantics_normalized`, `log_semantics_normalized`; `index_missing`/`log_missing` when expected).
- Unknown-frontmatter preservation (`unknown_frontmatter_preserved`, info) — preserved verbatim as untrusted review metadata, never policy/runtime configuration.
- Source/provenance completeness (`missing_provenance`; escalates to blocked with `requireProvenance`).
- Explicit unsafe/generated-instruction classes for producer-toolchain artifacts — `AGENTS.md`, `SKILL.md`, prompts, scripts, skills, tools, agent definitions — via `artifactClass` (`agent_definition`, `skill_definition`, `prompt`, `script`, `tool`, `generated_instruction_other`), all `generated_instruction_untrusted` at blocked severity; scripts/tools additionally `execution_not_allowed`.

### Severity and status vocabulary

Diagnostic severities are `info` / `warning` / `blocked`, aligned with the repo's static-analysis severity vocabulary (`agent-stack-fixtures.ts`, `okf-adapter.ts`). Per-document statuses use the #504 vocabulary: `valid`, `warning`, `blocked`, `untrusted_generated_instruction`, `unsupported_link_syntax`, `missing_provenance`, `malformed_frontmatter`, `execution_not_allowed`. The bundle verdict is `valid` / `warning` / `blocked`. Corpus `expectedDiagnostics` codes map via `OKF_FIXTURE_DIAGNOSTIC_CODE_MAP` (e.g. `unsupported_wikilink_syntax` → `unsupported_link_syntax`, `script_execution_not_allowed` → `execution_not_allowed`).

### Review-only boundary

**Passing conformance permits review/analysis ONLY.** A `valid` verdict never permits skill installation, agent registration/onboarding, marketplace publication, hosted writes, LLM/provider calls, or execution of any bundle content. Every report carries an identical `reviewBoundary` (permitted: static review/analysis, operator review payloads, conformance reporting; denied: installation, registration, publication, hosted writes, provider calls, execution, URL ingestion, payment activation, trust/reputation mutation) plus hard-false guardrails. The module itself is pure: no network, no filesystem, no async, fail-closed on malformed input and on any execute/install/ingest/LLM/skill-generation request.

Verify with `cd packages/agent-protocol && npm test -- --test-name-pattern "OKF/OpenKB conformance diagnostics"`.

## Downstream Use

Allowed downstream use is limited to static review, deterministic OKF-shaped adapter fixtures, operator review payload fixtures, and conformance diagnostics.

This corpus does not claim OKF/OpenKB support in RAP v0.1. That decision remains a product decision after the #503/#504/#505 evidence and adapter spike work are reviewed.
