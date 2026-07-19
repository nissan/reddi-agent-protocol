# Agent Definition Language Whitepaper v0.1

_Status: technical review draft. Published for implementation feedback and public review._

## Abstract

Agent Definition Language (ADL) is the canonical source-of-truth format for describing an agent before that agent is exported, reviewed, executed, paid, or trusted. In Reddi Agent Protocol (RAP), ADL gives every agent a portable contract for model requirements, harness behavior, tool access, data access, memory, policy boundaries, payment intent, receipts, evaluation gates, runtime posture, observability, recovery, and reputation signals.

ADL exists because autonomous agent commerce needs more than a marketplace listing and more than a model prompt. A buyer agent needs to know what a seller agent is allowed to do. A seller agent needs to know which work is in scope, which rail can be used, and what proof must be returned. An attestor needs to evaluate the work, receipt, trace, and policy together. An export adapter needs to know what semantics would be lost when an ADL document is mapped to an external agent manifest.

ADL is not a runtime. It is the definition layer that makes runtimes, marketplaces, payment wrappers, validators, and export targets speak about the same agent.

## Design Goals

ADL v0.1 is designed around six goals:

1. Portability: describe one agent in a format that can map to Open Agent Specification, Agent Cards, MCP declarations, provider manifests, framework templates, and RAP-specific runtime packages.
2. Explicit authority: make model, tool, data, memory, payment, and deployment permissions reviewable before execution.
3. Loss-aware export: allow external formats, but require adapters to report unsupported ADL semantics rather than silently dropping them.
4. Payment safety: bind spend authority, challenge, receipt, work product, and attestation into one reviewable contract.
5. Evidence-first reputation: allow reputation signals only when they are tied to receipts, eval gates, trace events, or human review.
6. Incremental adoption: support minimal read-only agents, tool-enabled agents, paid specialist agents, attested marketplace agents, and future live runtimes without changing the top-level shape.

## Document Model

An ADL document is a YAML or JSON object with a stable top-level hierarchy:

```yaml
apiVersion: reddiagent.dev/v0.1
kind: Agent
metadata: {}
model: {}
harness: {}
extensions: {}
```

The required top-level sections are `apiVersion`, `kind`, `metadata`, `model`, and `harness`. The `extensions` object is optional in simple agents but recommended for any agent that participates in payments, reputation, identity, provider mapping, or protocol bridging.

The hierarchy is intentionally split by responsibility:

- `apiVersion` tells validators which ADL schema version to use.
- `kind` tells tools which resource type is being described.
- `metadata` identifies the agent and the document itself.
- `model` describes inference requirements and provider constraints.
- `harness` describes the operating envelope around the model.
- `extensions` carries namespaced protocol-specific semantics.

This split keeps ADL from becoming a prompt file. The prompt is only one input to the harness. The harness also defines tools, policies, memory, eval gates, runtime, observability, recovery, and the conditions under which the agent can transact.

## Lifecycle

ADL documents move through a predictable lifecycle:

1. Author: a builder writes or generates an ADL document.
2. Validate: a schema validator checks required fields, supported enum values, and unsafe embedded data.
3. Review: humans or policy agents inspect model requirements, tools, data, payment, and deployment intent.
4. Export: adapters project the ADL into a target format and report semantic loss.
5. Execute: a runtime consumes the ADL, or a generated runtime package uses it as the control plane.
6. Observe: trace events, receipts, eval results, and reputation signals are attached back to the ADL identity.
7. Revise: feedback from review, incidents, export loss, or payment disputes creates the next ADL version.

The lifecycle matters because an ADL file is both a builder artifact and an audit artifact. A marketplace can show the readable summary, a validator can check the contract, and an operator can decide whether the agent is safe to run.

## Top-Level Parameters

### `apiVersion`

Intent: binds the document to a specific ADL schema and validator behavior.

Expected v0.1 value:

```yaml
apiVersion: reddiagent.dev/v0.1
```

Validators should fail when `apiVersion` is missing. Unknown future versions should be handled explicitly rather than interpreted as v0.1.

### `kind`

Intent: declares the resource described by the document.

Expected v0.1 value:

```yaml
kind: Agent
```

Future kinds can describe collections, templates, tool packs, or evaluation suites, but v0.1 is focused on one agent.

### `metadata`

Intent: names and identifies the agent independently from any runtime, provider, or marketplace listing.

Common fields:

- `name`: stable machine-readable name.
- `description`: short human-readable description.
- `version`: semantic or project version for the ADL document.
- `owner`: person, organization, wallet, DID, or registry identity responsible for the agent.
- `tags`: searchable categories.
- `sourceRef`: repository path, package ref, or content hash.
- `license`: usage or redistribution license when relevant.

Example:

```yaml
metadata:
  name: paid-specialist-researcher
  description: Performs bounded paid research and emits receipt metadata.
  version: 0.1.0
  owner: redditech-labs
  tags:
    - research
    - paid-agent
    - attestation
  sourceRef: github:nissan/reddi-agent-protocol/examples/paid-specialist-researcher
```

Parameter intention: metadata should make the document traceable. It should not contain private keys, API tokens, or secrets. Secret material should be referenced by safe names in runtime configuration, never embedded in ADL.

## Model Section

The `model` section describes what the agent needs from an inference provider. It does not force a single provider unless the agent truly requires one.

```yaml
model:
  capability: chat
  providers:
    preferred: openai
    fallbacks:
      - anthropic
      - gemini
      - ollama
  requirements:
    toolCalling: true
    structuredOutput: true
    contextWindow: 128000
    modalities:
      - text
  cost:
    latencyBudget: 20s
    maxUsdPerTask: "0.05"
```

### `model.capability`

Intent: describes the primary model capability expected by the harness.

Common values:

- `chat`: conversational or instruction-following work.
- `completion`: single-shot text generation.
- `embedding`: vectorization or retrieval support.
- `vision`: image understanding.
- `audio`: speech input or output.
- `multimodal`: mixed modalities.

### `model.providers.preferred`

Intent: declares the best known provider for this agent.

This is not an unlimited permission to call that provider. Runtime execution still depends on operator configuration, credentials, policies, and budget gates.

### `model.providers.fallbacks`

Intent: lists acceptable substitute providers if the preferred provider is unavailable.

Fallbacks are useful for portability, but adapters must verify that fallback providers support required features. For example, an agent that requires structured tool calls should not silently fall back to a model that cannot provide them.

### `model.requirements.toolCalling`

Intent: tells validators and exporters whether the agent depends on tool invocation.

If `true`, `harness.tools` or `harness.functions` should explain the callable surface. If the target export format cannot represent tool requirements, the export should report loss.

### `model.requirements.structuredOutput`

Intent: declares whether the model must return machine-readable output.

Payment, receipt, attestation, and eval workflows usually require structured output because downstream agents need deterministic fields, not only prose.

### `model.requirements.contextWindow`

Intent: sets the minimum context size the agent expects.

This helps exporters and runtimes avoid moving a long-document review agent to a small-context model where truncation would change behavior.

### `model.requirements.modalities`

Intent: declares expected input and output modalities.

Examples include `text`, `image`, `audio`, `video`, and `file`. A text-only export target should report loss if the ADL requires vision or audio.

### `model.cost`

Intent: makes cost assumptions explicit before execution.

Recommended fields:

- `latencyBudget`: maximum expected response time for one task or step.
- `maxUsdPerTask`: budget ceiling for model/provider spend.
- `maxTokens`: optional token cap.
- `requiresApprovalAbove`: optional human approval threshold.

Cost fields are policy inputs. They do not by themselves spend money.

## Harness Section

The `harness` section is the core of ADL. It describes how the model is allowed to operate.

```yaml
harness:
  instructions:
    inline: Complete the task within budget, use approved tools only, and emit receipt metadata.
  tools: []
  functions: []
  skills: []
  dataSources: []
  memory:
    mode: session
  policies: []
  evalGates: []
  runtime:
    target: local-python
  deployment: {}
  observability: {}
  recovery: {}
```

### `harness.instructions`

Intent: defines the system or harness instruction source.

Supported shapes:

```yaml
harness:
  instructions:
    inline: Use approved sources only. Cite receipt ids in final answers.
```

```yaml
harness:
  instructions:
    path: ./prompts/system.md
```

Inline instructions are easy to review. Path-based instructions are better for larger projects, but validators should hash or pin the referenced file before execution or export.

### `harness.tools`

Intent: declares tools the harness may expose to the model.

Example:

```yaml
harness:
  tools:
    - id: search_docs
      type: function
      description: Search approved documentation sources.
      inputSchema:
        type: object
        properties:
          query:
            type: string
        required:
          - query
      outputSchema:
        type: object
        properties:
          title:
            type: string
          url:
            type: string
          snippet:
            type: string
```

Parameter intention:

- `id` gives the tool a stable contract name.
- `type` describes the calling mechanism, such as `function`, `mcp`, `http`, `local-command`, or `provider-tool`.
- `description` tells reviewers and models what the tool is for.
- `inputSchema` and `outputSchema` make the contract testable.
- Additional policy fields can restrict network, filesystem, credential, or payment access.

### `harness.functions`

Intent: declares local or generated function bindings separate from broader tools.

Functions are best for strongly typed operations where the harness owns the implementation. Tools are broader and can include external MCP servers, HTTP APIs, or provider-native capabilities.

### `harness.skills`

Intent: declares reusable capability bundles that can be loaded into the harness.

Example:

```yaml
harness:
  skills:
    - id: receipt-review
      sourceRef: skill:reddi/receipt-review@0.1.0
      purpose: Verify receipt and response hash linkage.
```

Skills must be treated as supply-chain inputs. A runtime should know where a skill came from, what version is pinned, and whether it can alter tools, policies, memory, or output.

### `harness.dataSources`

Intent: declares reviewed sources the harness may use or cite.

Required fields:

- `id`
- `type`
- `description`

Supported v0.1 `type` values:

- `document`
- `file`
- `web`
- `api`
- `database`
- `vector-index`
- `mcp`
- `knowledge-base`

Common optional fields:

- `sourceRef`: external registry or repository reference.
- `path`: local or package path.
- `url`: web or API endpoint.
- `trust`: `approved`, `untrusted`, or `unknown`.

Example:

```yaml
harness:
  dataSources:
    - id: adl-spec
      type: document
      description: Canonical ADL v0.1 specification.
      path: specs/ADL-v0.1.md
      trust: approved
    - id: external-market-scan
      type: web
      description: Public web search results for market validation.
      trust: untrusted
```

Trust matters. An agent can read untrusted content, but the harness should treat it differently from approved sources, especially before payment, export, or reputation updates.

### `harness.memory`

Intent: declares whether the agent can remember anything beyond the current turn.

Supported `mode` values:

- `none`: no memory.
- `session`: memory lasts for one session.
- `persistent`: memory persists across sessions.
- `external`: memory lives in an external service or database.

Recommended fields:

- `mode`
- `retention`
- `scope`: `task`, `session`, `project`, `user`, `workspace`, or `external`
- `storageRef`
- `privacyPolicy`

Example:

```yaml
harness:
  memory:
    mode: session
    scope: task
    retention: until-task-complete
    privacyPolicy: Do not store secrets, payment credentials, private keys, or raw customer data.
```

Persistent or external memory should declare both `retention` and `privacyPolicy` before runtime execution is considered safe.

### `harness.policies`

Intent: makes authority constraints machine-readable.

Policies answer the question: what is the agent allowed to do?

Example:

```yaml
harness:
  policies:
    - id: task-budget
      type: budget
      rule: Total task spend must be less than or equal to 0.25 USDC.
    - id: human-approval
      type: approval
      rule: Ask for approval before any payment above 1.00 USDC.
    - id: approved-sources-only
      type: data-access
      rule: Use only approved sources for final claims.
```

Common policy types:

- `budget`: spend or token caps.
- `approval`: when human approval is required.
- `data-access`: allowed sources and citation rules.
- `tool-access`: allowed tools and forbidden commands.
- `credential-access`: named secret access, if any.
- `payment-authority`: who may spend, how much, for what purpose, and when.
- `deployment`: allowed target environments.

Payment authority must be explicit. A payment-capable ADL should describe maximum amount, asset, rail, purpose, expiry, revocation path, and evidence requirements.

### `harness.evalGates`

Intent: defines checks that must pass before the result is accepted.

Example:

```yaml
harness:
  evalGates:
    - id: receipt-required
      type: receipt-check
      rule: A task receipt must be emitted before completion.
    - id: source-coverage
      type: output-check
      rule: Final answer must cite at least two approved sources.
    - id: no-mainnet-claim
      type: policy-check
      rule: Output must not claim live mainnet settlement unless a signed operator gate exists.
```

Eval gates connect agent output to acceptance criteria. In ADL, "agent said it completed the task" is not enough. The gate determines whether the work can be reused, paid, released, or turned into reputation.

### `harness.runtime`

Intent: declares where and how the agent is expected to run.

Example:

```yaml
harness:
  runtime:
    target: local-python
    isolation: process
    networkAccess: restricted
```

Common targets:

- `local-python`
- `local-node`
- `hosted-container`
- `serverless`
- `mcp-server`
- `provider-agent`
- `manual-review`

Runtime fields are not activation approval. They are intent. A separate operator gate can still be required before live runtime activation.

### `harness.deployment`

Intent: captures deployment posture without requiring a deployment.

Example:

```yaml
harness:
  deployment:
    environment: staging
    publicIngress: false
    secretRefs:
      - AGENT_API_KEY
    rollback: Disable route and revoke endpoint key.
```

Deployment should reference secrets by name only. It must not embed secret values.

### `harness.observability`

Intent: defines the trace events and logs needed to audit behavior.

Example:

```yaml
harness:
  observability:
    traceEvents:
      - quote.created
      - policy.approved
      - payment.receipt.captured
      - work.completed
      - eval.accepted
    logRedaction: secrets-and-pii
    receiptRetention: receipt-hash-only
```

For payment flows, observability should prove sequence. A receipt without the quote, request hash, response hash, and eval verdict is incomplete.

### `harness.recovery`

Intent: declares what happens when something fails.

Example:

```yaml
harness:
  recovery:
    onPaymentFailure: do-not-deliver-work
    onEvalFailure: hold-reputation-preview
    onDispute: preserve-receipt-chain-and-request-human-review
    rollback: revoke temporary endpoint access and mark receipt disputed
```

Recovery fields are essential for paid agents because failure paths are part of the contract. Refund, rollback, dispute, and revocation should be explicit before live payment is enabled.

## Extensions

The `extensions` object holds namespaced semantics that are not part of the minimal portable core. Unknown namespaces should warn by default and fail only in strict mode.

Recommended v0.1 namespaces:

- `x402`: payment challenge and proof semantics.
- `receipts`: receipt requirements and included evidence.
- `reputation`: reputation signals and mutation rules.
- `identity`: identities, wallets, DIDs, or registry references.
- `rap`: RAP-specific settlement, attestation, or marketplace semantics.
- `agentSpec`: export compatibility metadata.
- `mcp`: MCP server and tool projection metadata.

### `extensions.x402`

Intent: declares payment intent without binding ADL to one settlement implementation.

Example:

```yaml
extensions:
  x402:
    enabled: true
    intents:
      - id: pay-specialist
        direction: spend
        maxAmount: "0.25"
        currency: USDC
        rails:
          - solana
          - base
          - stripe
        requireReceipt: true
    policy:
      budgetPerTask: "0.25"
      requireHumanApprovalAbove: "1.00"
```

Parameter intention:

- `enabled` tells adapters the agent participates in x402-style payment flows.
- `intents` declares allowed payment behavior.
- `direction` is usually `spend`, `receive`, or `both`.
- `maxAmount` caps the amount for one intent.
- `currency` names the asset or unit.
- `rails` lists acceptable settlement rails.
- `requireReceipt` requires proof before completion.
- `policy` adds task-level budget and approval constraints.

### `extensions.receipts`

Intent: specifies what proof must be included when work is paid, verified, or disputed.

Example:

```yaml
extensions:
  receipts:
    required: true
    include:
      - requestHash
      - responseHash
      - toolCalls
      - settlementReference
      - evalGateStatus
```

Receipts are not only payment confirmations. In ADL, a useful receipt links the buyer request, seller response, tool behavior, settlement reference, and evaluation result.

### `extensions.reputation`

Intent: controls which signals can affect trust.

Example:

```yaml
extensions:
  reputation:
    emitSignals:
      - taskCompleted
      - receiptVerified
      - evalPassed
    mutationRule: attestor-signed-receipt-chain-required
    previewOnlyUntil: human-or-attestor-approval
```

Reputation should attach to agent identity plus harness behavior. Raw model output is not enough. The strongest signals include completed work with receipt, eval gate pass, budget compliance, permission compliance, dispute outcome, refund outcome, and human review.

## Worked Example 1: Minimal Read-Only Agent

This is the smallest useful ADL. It has no payment, no persistent memory, and no external runtime activation.

```yaml
apiVersion: reddiagent.dev/v0.1
kind: Agent
metadata:
  name: simple-doc-helper
  description: Answers questions from one approved document.
model:
  capability: chat
  providers:
    preferred: openai
    fallbacks:
      - anthropic
  requirements:
    toolCalling: false
    structuredOutput: false
harness:
  instructions:
    inline: Answer only from the approved document. Say when the document does not contain the answer.
  dataSources:
    - id: project-readme
      type: document
      description: Approved project README.
      path: README.md
      trust: approved
  memory:
    mode: none
  policies:
    - id: approved-document-only
      type: data-access
      rule: Use only project-readme for final answers.
  evalGates:
    - id: no-unsourced-claims
      type: output-check
      rule: Final answer must not invent facts outside the approved document.
  runtime:
    target: manual-review
extensions: {}
```

Why each parameter exists:

- `memory.mode: none` prevents hidden carryover.
- `dataSources.trust: approved` gives the agent one safe source.
- `runtime.target: manual-review` makes it clear this is a reviewable definition, not a live service.
- Empty `extensions` means no payment or reputation semantics are claimed.

## Worked Example 2: Tool-Enabled Source Checker

This agent can call one approved search function and must cite source titles.

```yaml
apiVersion: reddiagent.dev/v0.1
kind: Agent
metadata:
  name: source-checker
  description: Answers questions using one approved search tool and cites the source title.
model:
  capability: chat
  providers:
    preferred: anthropic
    fallbacks:
      - openai
      - gemini
  requirements:
    toolCalling: true
    structuredOutput: true
harness:
  instructions:
    inline: Use the search_docs tool before answering factual questions. Cite source titles.
  tools:
    - id: search_docs
      type: function
      description: Search approved documentation sources.
      inputSchema:
        type: object
        properties:
          query:
            type: string
        required:
          - query
      outputSchema:
        type: object
        properties:
          title:
            type: string
          url:
            type: string
          snippet:
            type: string
  toolFixtures:
    - toolId: search_docs
      args:
        query: tool registry
  policies:
    - id: approved-sources-only
      type: data-access
      rule: Tool may only search configured approved documentation sources.
  evalGates:
    - id: cite-source
      type: output-check
      rule: Answer must include at least one source title.
  runtime:
    target: local-python
extensions: {}
```

Key design point: the model requirement says tool calling is needed, the tool schema defines the call surface, the policy restricts its use, and the eval gate checks the answer. Those four pieces together are the harness contract.

## Worked Example 3: Paid Specialist Researcher

This agent demonstrates the autonomous payment flow without implying mainnet settlement.

```yaml
apiVersion: reddiagent.dev/v0.1
kind: Agent
metadata:
  name: paid-specialist-researcher
  description: Performs a bounded paid research task and emits a receipt.
model:
  capability: chat
  providers:
    preferred: openai
    fallbacks:
      - anthropic
  requirements:
    toolCalling: true
    structuredOutput: true
harness:
  instructions:
    inline: Complete the task within budget, use approved tools only, and emit receipt metadata.
  tools:
    - id: fetch_approved_url
      type: function
      description: Fetch one approved URL.
  policies:
    - id: task-budget
      type: budget
      rule: Total task spend must be less than or equal to 0.25 USDC.
    - id: human-approval
      type: approval
      rule: Ask for approval before any payment above 1.00 USDC.
  evalGates:
    - id: receipt-required
      type: receipt-check
      rule: A task receipt must be emitted before completion.
  runtime:
    target: hosted-container
extensions:
  x402:
    enabled: true
    intents:
      - id: pay-specialist
        direction: spend
        maxAmount: "0.25"
        currency: USDC
        rails:
          - solana
          - base
          - stripe
        requireReceipt: true
  receipts:
    required: true
  reputation:
    emitSignals:
      - taskCompleted
      - evalPassed
      - receiptVerified
```

Payment flow:

1. Buyer reads the seller ADL and confirms `model`, `tools`, `policies`, and `extensions.x402`.
2. Seller returns a payment challenge for one bounded research task.
3. Buyer policy checks `task-budget` and `human-approval`.
4. Payment rail returns receipt metadata.
5. Seller returns work plus receipt references.
6. Eval gate `receipt-required` passes or blocks completion.
7. Reputation signals can be emitted only if the receipt and eval gate both pass.

Safety boundary: this example describes payment semantics. A real wallet, facilitator, provider endpoint, or mainnet transaction remains outside scope unless a separate operator-gated issue enables it.

## Worked Example 4: Attested Code Review Specialist

This example adds attestation and release gating.

```yaml
apiVersion: reddiagent.dev/v0.1
kind: Agent
metadata:
  name: adl-code-review-specialist
  description: Reviews generated agent packages for command, credential, and receipt safety.
model:
  capability: chat
  providers:
    preferred: openai
  requirements:
    toolCalling: true
    structuredOutput: true
    contextWindow: 128000
harness:
  instructions:
    inline: Review only the pinned artifact. Return findings, required tests, and release verdict.
  dataSources:
    - id: source-artifact
      type: file
      description: Pinned generated package under review.
      sourceRef: sha256:example-artifact-hash
      trust: approved
  policies:
    - id: no-runtime-execution
      type: tool-access
      rule: Do not execute generated commands during review.
    - id: no-secret-output
      type: credential-access
      rule: Do not print or persist credential values.
  evalGates:
    - id: unsafe-command-scan
      type: policy-check
      rule: Block release if shell, Docker, wallet, or network commands are unsafe or unpinned.
    - id: receipt-leakage-scan
      type: output-check
      rule: Block release if receipt payloads include secrets or private identifiers.
    - id: attestor-verdict
      type: attestation-check
      rule: Release requires attestor PASS for the exact artifact hash.
  runtime:
    target: manual-review
  observability:
    traceEvents:
      - review.started
      - artifact.bound
      - findings.emitted
      - attestor.verdict
  recovery:
    onEvalFailure: hold-release
extensions:
  receipts:
    required: true
    include:
      - requestHash
      - responseHash
      - evalGateStatus
  reputation:
    emitSignals:
      - reviewCompleted
      - evalPassed
    mutationRule: attestor-pass-required
```

This ADL prevents a common failure: a code review agent saying "looks good" without binding the verdict to an artifact hash, safety checks, and attestor result.

## Worked Example 5: Export-Oriented Agent

This example shows how ADL can be the source of truth while another format is a target view.

```yaml
apiVersion: reddiagent.dev/v0.1
kind: Agent
metadata:
  name: portable-marketplace-agent
  description: Agent intended for RAP, Agent Spec, and MCP publication.
model:
  capability: chat
  providers:
    preferred: openai
    fallbacks:
      - anthropic
  requirements:
    toolCalling: true
    structuredOutput: true
harness:
  instructions:
    inline: Accept marketplace tasks only when policy, payment, and receipt requirements are satisfied.
  tools:
    - id: quote_task
      type: function
      description: Produce a bounded quote for one task.
    - id: deliver_result
      type: function
      description: Return receipt-bound work product.
  policies:
    - id: task-scope
      type: approval
      rule: Reject requests outside declared marketplace capability.
  evalGates:
    - id: export-loss-check
      type: compatibility-check
      rule: Export must fail or warn if payment, receipt, or reputation semantics are not preserved.
  runtime:
    target: mcp-server
extensions:
  agentSpec:
    export:
      required: true
      failOnLoss:
        - payment.intent
        - receipts.required
        - reputation.mutationRule
  mcp:
    server:
      tools:
        - quote_task
        - deliver_result
  x402:
    enabled: true
    intents:
      - id: marketplace-paid-task
        direction: receive
        maxAmount: "0.10"
        currency: USDC
        rails:
          - solana
          - base
        requireReceipt: true
```

The important parameter is `failOnLoss`. If Agent Spec or MCP cannot represent a payment or reputation rule, ADL requires the export process to say so.

## Agent-To-Agent Payment Sequence

ADL payment semantics are policy-first:

1. Discover: buyer reads seller metadata, capability, policies, and extensions.
2. Quote: seller issues a challenge with amount, asset, rail, expiry, and receipt requirements.
3. Decide: buyer checks budget, authority, source, and approval policies.
4. Pay: payment rail produces receipt metadata.
5. Work: seller returns the result and binds it to request and receipt hashes.
6. Evaluate: eval gates check result quality, safety, source coverage, and receipt linkage.
7. Attest: an attestor or human reviewer signs the verdict when required.
8. Update: reputation changes only when the ADL allows the signal and evidence exists.

This sequence separates payment from trust. Payment proves that a rail accepted value transfer or payment proof. It does not prove the work was correct. ADL requires the receipt, work product, and evaluation chain to be considered together.

## Validation Rules

ADL v0.1 validators should enforce these rules:

- Missing required top-level fields fail validation.
- `apiVersion` and `kind` must be explicit.
- Secrets must be referenced by name, not embedded.
- `model.requirements.toolCalling: true` should be backed by tool or function declarations.
- Persistent or external memory must declare retention and privacy policy.
- Payment-capable agents must declare spend limits, receipt requirements, and approval thresholds.
- Runtime-specific unsupported fields produce compatibility errors.
- Unknown extension namespaces warn by default and fail in strict mode.
- Export adapters must preserve Reddi-specific payment, receipt, policy, source-boundary, MCP, and reputation semantics or report loss.
- Production payment, credential, wallet, hosted runtime, devnet, and mainnet activation require separate operator gates.

## Review And Improvement Loop

ADL should remain open to review because agent payment semantics will evolve. Public review should focus on:

- missing fields needed by real agent systems;
- ambiguous payment authority or receipt semantics;
- export loss to existing agent manifests;
- payment-rail assumptions;
- memory and privacy boundaries;
- tool and credential permission modeling;
- places where mock demos could imply live settlement;
- fields needed by attestors, marketplace operators, and dispute workflows.

The public website exposes the ADL whitepaper, structured GitHub review links, example use cases with mock responses, and a live endpoint mode that sends a browser-side request to the user's own agent API address. The site does not need to store API addresses, private keys, credentials, review text, wallet secrets, or payment credentials.

## Current Status

ADL v0.1 is a reviewable specification and interoperability contract. It is stable enough to explain, validate, export, and demonstrate. It is not yet a blanket approval for live runtime activation, production payment rails, wallet operations, or mainnet actions.

The next improvements should come from implementer feedback: agent runtimes, payment wrappers, attestors, marketplace builders, export adapters, and operators trying to map real systems into ADL without losing safety or payment semantics.
