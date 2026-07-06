# OKF/OpenKB Static Fixture Corpus & Conformance Diagnostics

Issues: [#503](https://github.com/nissan/reddi-agent-protocol/issues/503) (fixture corpus), [#504](https://github.com/nissan/reddi-agent-protocol/issues/504) (conformance diagnostics), [#505](https://github.com/nissan/reddi-agent-protocol/issues/505) (generated instruction and skill safety review)

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

## Generated Instruction & Skill Safety Review (#505)

`packages/agent-protocol/src/okf-instruction-safety.ts` (`reddi.okf-instruction-safety.v1`, exported as `@reddi/agent-protocol/okf-instruction-safety`) layers a deterministic safety review lane on top of the #504 conformance diagnostics for OpenKB/OKF-derived generated instructions, skills, prompts, scripts, tools, and agent definitions. It reuses the #504 vocabulary (`artifactClass`, info/warning/blocked severities, the review-only boundary, hard-false guardrails) rather than inventing a parallel taxonomy.

Run `runOkfInstructionSafetyReview(input, options)` over the same in-memory bundle input shape as `runOkfConformanceDiagnostics`; the report embeds the full conformance report. `scanOkfSafetyChecklist(documentId, text, artifactClass)` runs the checklist standalone over any static text.

### Review model — untrusted by default

Every generated `AGENTS.md`, `SKILL.md`, prompt, script, tool, and agent-definition artifact is **untrusted by default**: its disposition is `blocked` even when zero checklist findings fire, and no review outcome can upgrade a generated instruction into a trusted one. Generated instructions **may be preserved as static evidence/context** for operators and future reviews, but they must **not** be installed, applied, registered, executed, or published without a **separate operator-approved issue**. Every report carries this gate machine-readably as `operatorGate` (`OKF_GENERATED_ARTIFACT_OPERATOR_GATE`: preserved-as-evidence only; installed/applied/registered/executed/published all hard-false; `requiresSeparateOperatorApprovedIssue: true`).

### Safety checklist

Ten deterministic categories, each a fixed set of static regular expressions over document text — **no LLM/provider calls, no network, no execution**:

- `prompt_injection` — override/escape attempts ("ignore previous instructions", role hijacks)
- `credential_request` — requests to paste/share/export keys, seeds, passwords, `.env`/SSH material
- `tool_expansion` — adding tools/MCP servers, expanding permissions, bypassing allowlists/sandboxes
- `external_call` — URLs, curl/wget, webhooks, "send request to" directives
- `hidden_instruction` — imperative HTML comments, zero-width characters, "do not tell the operator"
- `auto_install_or_apply` — self-install/auto-apply claims, "no approval needed"
- `destructive_command` — `rm -rf`, hard resets, `DROP TABLE`, disk-wipe patterns
- `paid_call_instruction` — instructions to spend/purchase/invoke paid or billed endpoints
- `wallet_rpc_mainnet_instruction` — wallet/keypair handling, RPC endpoints, transaction signing, mainnet
- `marketplace_publication_claim` — claims or instructions that content is/should be published or listed

`always_blocked` categories (prompt injection, credential requests, hidden instructions, auto-install/apply, destructive commands) block wherever they appear. `contextual` categories block inside generated artifacts and downgrade to warnings (needs human review) inside plain documentation, where descriptive mention can be legitimate. Matched `evidence` snippets are sanitized (zero-width/control characters escaped, truncated) and are DATA for the operator — never instructions to follow.

### Dispositions

Per document: `safe_documentation` (plain documentation, zero findings — still review-only), `needs_human_review` (documentation with contextual findings an operator must judge), `blocked` (any generated artifact, or any always-blocked finding). The bundle verdict is the worst document disposition, fail-closed to `blocked` on malformed bundles and on any execute/install/ingest/LLM/skill-generation request. In-module fixtures (`okfInstructionSafetyFixtures`) demonstrate safe documentation, blocked generated skill/instruction content, blocked script/tool content, needs-human-review cases, and a benign-content generated artifact that stays blocked; the #503 corpus fixtures are consumed read-only with `contentSha256` digests proven preserved.

Verify with `cd packages/agent-protocol && npm test -- --test-name-pattern "OKF/OpenKB generated instruction safety review"`.

### Links

- Epic [#468](https://github.com/nissan/reddi-agent-protocol/issues/468) — OKF/OpenKB evidence programme (this lane is its safety-review evidence blocker).
- [#503](https://github.com/nissan/reddi-agent-protocol/issues/503) fixture corpus, [#504](https://github.com/nissan/reddi-agent-protocol/issues/504) conformance diagnostics, [#511](https://github.com/nissan/reddi-agent-protocol/issues/511) adapter spike — the vocabulary this module builds on.
- [#513](https://github.com/nissan/reddi-agent-protocol/issues/513) — the OKF/OpenKB scope decision that consumes this evidence.
- [#370](https://github.com/nissan/reddi-agent-protocol/issues/370) — downstream onboarding assistant safety posture, if knowledge-bundle inputs become supported later; this review lane gates any future issue that proposes importing, publishing, applying, or using OpenKB/OKF-derived generated instructions in RAP onboarding or marketplace review.

## Downstream Use

Allowed downstream use is limited to static review, deterministic OKF-shaped adapter fixtures, operator review payload fixtures, and conformance diagnostics.

This corpus does not claim OKF/OpenKB support in RAP v0.1. That decision remains a product decision after the #503/#504/#505 evidence and adapter spike work are reviewed.
