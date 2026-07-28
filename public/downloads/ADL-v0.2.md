# Agent Definition Language v0.2

_Anchor issues: #310, #311._

## Goal

ADL v0.2 keeps ReddiAgent's canonical document shape aligned across prose,
JSON Schema, and checked examples. The v0.2 canonical instruction shape is an
object with either `inline` text or a `path` reference. A bare string path is not
valid ADL v0.2. Permission policies are structured capability declarations so
compatibility checks can fail closed before execution.

## Requirement Keywords

The key words "must", "must not", "should", "should not", and "may" in this
document are to be interpreted as described in RFC 2119 and RFC 8174. This
specification uses the lowercase forms with the same normative meaning; the
keywords carry requirement force regardless of capitalization.

## Top-Level Shape

```yaml
apiVersion: reddiagent.dev/v0.2
kind: Agent
metadata:
  name: research-assistant
  description: Answers questions using approved sources.
model:
  capability: chat
  providers:
    preferred: openai
    fallbacks: [anthropic, gemini, ollama]
  requirements:
    toolCalling: true
    structuredOutput: true
harness:
  instructions:
    path: ./prompts/system.md
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
  recovery: {}
extensions: {}
```

## Field Contract

The field contract below is intentionally machine checked against
`specs/ADL-v0.2.schema.json`.

```json
{
  "topLevel": {
    "required": ["apiVersion", "kind", "metadata", "model", "harness"],
    "optional": ["conformance", "extensions"]
  },
  "model": {
    "required": ["capability", "providers", "requirements"],
    "optional": ["cost"]
  },
  "harness": {
    "required": ["instructions", "runtime"],
    "optional": [
      "tools",
      "functions",
      "skills",
      "dataSources",
      "memory",
      "policies",
      "evalGates",
      "deployment",
      "observability",
      "recovery"
    ]
  }
}
```

## Supporting Spec Index

ADL v0.2 is the canonical document shape. Supporting specs own the deeper
semantics below, and validators should cite the owning spec when reporting
builder-facing diagnostics.

| ADL section | Supporting spec owner | Ownership boundary |
|---|---|---|
| `apiVersion`, `kind`, `metadata`, top-level shape | `specs/ADL-v0.2.md` and `specs/ADL-v0.2.schema.json` | Canonical syntax, required fields, and strict schema validation. |
| `model.capability`, `model.providers`, `model.requirements` | `specs/PROVIDER-MAPPING-v0.1.md` and `specs/PROVIDER-COMPATIBILITY-REPORT-v0.1.md` | Provider vocabulary, model capability requirements, report-only adapter diagnostics, and loss metadata. |
| `harness.instructions`, `harness.runtime`, `harness.recovery` | `specs/HARNESS-LIFECYCLE-v0.1.md` and `specs/RUNTIME-DEPLOYMENT-v0.1.md` | Runtime lifecycle, activation boundaries, rollback/disable semantics, and no-execution compatibility checks. |
| `harness.tools`, `harness.functions`, `harness.skills` | `specs/TOOL-REGISTRY-v0.1.md`, `specs/LOCAL-RUNNER-PLUGIN-INTERFACE-v0.1.md`, and `specs/SKILL-PACKAGE-CONTRACT-v0.1.md` | Tool identity, static contract metadata, policy linkage, plugin boundaries, and skill package handoff. |
| `harness.dataSources` | `specs/DATA-SOURCE-CONTRACT-v0.1.md` | Source type vocabulary, typed `sourceRef` binding, trust, citation, and source-check expectations. |
| `harness.memory` | `specs/MEMORY-CONTRACT-v0.1.md` | Session, persistent, and external memory declarations, retention, storage references, and privacy policy requirements. |
| `harness.policies` | `specs/SECURITY-PERMISSIONS-v0.1.md` | Capability policies, allow/deny effects, enforcement target/phase, approval, and limits. |
| `harness.evalGates` | `specs/EVAL-GATES-v0.1.md` | Required gate completion semantics, severity, retry behavior, failure handling, and evidence shape. |
| `harness.observability` | `specs/OBSERVABILITY-v0.1.md` and `specs/TRACE-EVENTS-v0.1.md` | Required trace events, summaries, destinations, redaction, retention, receipts, and export evidence. |
| `extensions.x402`, `extensions.receipts`, `extensions.reputation` | `specs/PAYMENT-REPUTATION-EXTENSION-v0.1.md`, `specs/X402-DRY-RUN-RECEIPT-v0.1.md`, and `specs/RAP-BRIDGE-v0.1.md` | Payment authority, dry-run rails, receipt binding, reputation signals, and bridge metadata. |
| `conformance` | `specs/CONFORMANCE-v0.1.md` | Requested/achieved conformance levels, required field sets, forbidden capability reporting, and evidence outputs. |

## Conformance Profile Matrix

ADL v0.2 validators must report both the requested and achieved conformance
level without activating runtimes, providers, MCP servers, payment rails, or
hosted deployments. An ADL may declare `conformance.requestedLevel`; validators
may also accept an operator-selected requested level. Higher levels include the
lower-level required field sets and fail closed when any required field or
required evidence output for levels `0..requestedLevel` is absent.

| Level | Profile | Required ADL fields | Optional fields | Forbidden or live-gated before this level | Required evidence outputs |
|---|---|---|---|---|---|
| 0 | schema-valid | `apiVersion`, `kind`, `metadata.name`, `metadata.description`, `model`, `harness` | `conformance`, `extensions` | none | JSON Schema validation diagnostics |
| 1 | local-python runnable | Level 0 plus `harness.instructions`, `harness.runtime.target`, `harness.evalGates`, and Level 1 observability events | `harness.memory`, `harness.tools`, `harness.dataSources` | payment/reputation extension; production deployment descriptor | local Level 1 trace; `completion.requiredGateStatus`; `trace.started`; `trace.completed`; `task.completed`; `task.failed` |
| 2 | provider-adapter compatible | Level 1 plus `model.capability`, `model.providers.preferred`, `model.requirements`, `harness.policies`, `harness.evalGates`, and Level 2 observability events | `harness.tools`, `harness.dataSources`, `harness.memory` | payment/reputation extension; production deployment descriptor | provider compatibility report; unsupported-execution boundary; `model.called`; `policy.checked`; `eval.checked` |
| 3 | payment/reputation extension compatible | Level 2 plus `extensions.x402.enabled=true`, spend/refund intents with authority, scope, receipt, audit, revocation, and policy refs, `extensions.receipts.required=true`, `extensions.receipts.refs`, `extensions.reputation.emitSignals`, and Level 3 observability events | `extensions.identity`; `x-*` or URI extension namespaces as strict metadata | production deployment descriptor; live payment rails before a separately reviewed lane | receipt evidence; reputation signal evidence; payment policy evidence; `payment.intent.created`; `receipt.emitted`; `reputation.signal.emitted` |
| 4 | production deployment compatible | Level 3 plus `harness.runtime.target` of `hosted-container`, `serverless`, `platform-native`, or `openclaw`, `harness.deployment.environment`, `harness.deployment.rollback`, `harness.observability.events`, `harness.recovery.disable`, and Level 4 observability events | `harness.deployment.healthCheck`, `harness.observability.destinations` | mainnet remains separately approval-gated | deployment readiness report; observability trace config; rollback/disable evidence; `deployment.health.checked`; `adapter.loss.reported` |

Conformance output must include:

- `requestedLevel`: the requested ADL v0.2 conformance level.
- `achievedLevel`: the highest contiguous level whose required fields and
  live-gated capability checks pass.
- `missingFieldsByLevel`: missing required fields grouped by level.
- `forbiddenCapabilitiesByLevel`: live-gated capability declarations that
  prevent the requested level from passing.

Schema-valid ADLs may still fail a requested higher conformance level. For
example, a Level 3 request without receipt/reputation fields remains valid ADL
syntax but must report missing Level 3 fields and a failed conformance status.

## Provider And Model Capability Contract

ADL v0.2 constrains model provider identifiers so adapters do not infer
provider-specific behavior from arbitrary strings. `model.providers.preferred`
and `model.providers.fallbacks` use the canonical provider-id vocabulary below:

| Provider id | Boundary |
|---|---|
| `openai` | Hosted provider; compatibility reports must list `OPENAI_API_KEY` before any approved runtime path may call it. |
| `anthropic` | Hosted provider; compatibility reports must list `ANTHROPIC_API_KEY` before any approved runtime path may call it. |
| `gemini` | Hosted provider; compatibility reports must list `GEMINI_API_KEY` before any approved runtime path may call it. |
| `ollama` | Local provider; compatibility reports must not probe, start, or call a local model runtime. |

The ordered provider list is deterministic: preferred provider first, then
fallbacks in declared order. Provider compatibility reports select the requested
target when it appears in that ordered list; otherwise they report the requested
target as `not-declared` without inventing a fallback. Reports must include the
ordered candidates, selected provider, selected role (`preferred`, `fallback`,
or `not-declared`), and whether the selected provider is hosted.

`model.requirements` is also closed. The vocabulary is:

- `toolCalling`: provider or reviewed harness can express callable tools.
- `structuredOutput`: provider or reviewed harness can enforce structured
  output.
- `streaming`: token or event streaming support.
- `jsonMode`: provider-native JSON-only output mode.
- `contextWindow`: minimum context window in tokens.
- `maxOutputTokens`: minimum requested output token budget.
- `modalities`: required input/output modality set. Supported values are
  `text`, `image`, `audio`, and `embedding`.

Compatibility reports must split requirement handling into:

- `supportedRequirements`: requirements the target can satisfy as static
  compatibility.
- `unsupportedRequirements`: hard unsupported requirements that make
  `supported=false` for that target.
- `degradedRequirements`: requirements that need a custom/reviewed harness or
  lose provider-native enforcement.
- `lossMetadata`: deterministic notes describing what semantic portability is
  lost or deferred.

All report-only targets must keep `runtimeExecutionAllowed=false`. A supported
static provider mapping means the ADL can be reviewed for that target; it does
not authorize provider calls, credential lookup, local endpoint probing, MCP
invocation, or runtime execution.

## Instruction Shape

`harness.instructions` must be an object. It must contain exactly one source:

- `inline`: non-empty instruction text embedded in the ADL document.
- `path`: non-empty path to an instruction file relative to the ADL document.

The following shape is canonical:

```yaml
harness:
  instructions:
    path: ./prompts/system.md
```

This legacy shape is invalid in v0.2:

```yaml
harness:
  instructions: ./prompts/system.md
```

## Permission Policy Shape

`harness.policies` entries must be machine-readable. ADL v0.2 does not accept
free-form permission prose as the policy contract. Each policy carries:

- `id`: stable policy identifier referenced by risky capabilities.
- `capability`: typed capability, one of `tool`, `network`, `filesystem`,
  `payment`, `messaging`, `shell`, `human-approval`, `data`, `memory`, or
  `runtime`.
- `subject`: actor the policy applies to, usually `agent` or `operator`.
- `resource`: resource or capability target, such as `tool:search_docs`,
  `./docs`, `https://docs.reddiagent.dev`, or `x402:intent:review-fee`.
- `action`: operation being allowed or denied, such as `invoke`, `fetch`,
  `read`, `spend`, `send`, or `approve`.
- `effect`: `allow` or `deny`.
- `scope`: bounded scope object with a required `type`.
- `limits`: optional structured limits such as call counts, allowed domains,
  read-only access, maximum spend, receipt requirements, or message counts.
- `approval`: optional approval object. Human approval policies must require
  approval.
- `enforcement`: enforcement target and phase. Supported targets are
  `static-validator`, `runtime-adapter`, `policy-engine`, and `human-review`.

Risky capabilities must reference matching policies where applicable. Tools and
functions use `policyRefs` and must bind to an allow policy whose capability,
resource, action, and enforcement target match the declared tool or function.
Plain tools default to `capability: tool`, `resource: tool:<id>`, and
`action: invoke`; tools that model another risky capability, such as external
messaging, declare that capability, resource, and action explicitly. Payment
intents use `policyRefs` under `extensions.x402.intents` and must bind to a
payment policy for the exact `x402:intent:<id>` resource, direction/action,
limits, receipt requirement, and before-execution policy-engine enforcement.
Unknown, mismatched, or unenforceable capability policy declarations fail
compatibility before execution.

## Extension And Payment Authority Contract

ADL v0.2 strict mode recognizes ReddiAgent-owned extension namespaces only when
they have a schema. The known namespaces are `x402`, `receipts`, `reputation`,
and `identity`. Experimental or third-party namespaces must be explicitly
prefixed with `x-` or use an `http://` or `https://` URI key; unprefixed
unknown namespaces fail schema validation so payment-like metadata cannot hide
behind a loose extension name.

`extensions.x402` is metadata only. A spend-capable or refund-capable intent
must declare:

- `extensions.x402.intents[*].policyRefs`;
- the actor authority: `principal`, `spender`, `maxAmount`, `currency`, and
  `rails`;
- bounded purpose and scope on both the intent and authority;
- an ISO-like UTC `expiresAt` timestamp;
- a revocation path with `operator`, `policy-engine`, or `human-review` mode;
- an audit path and evidence reference;
- `requireReceipt: true`, `receiptRef`, and `policyRefs`.

The matching receipt declaration lives in `extensions.receipts.refs` and binds
`intentRef`, receipt `evidenceRef`, and the policy references used by the
intent. Reputation declarations remain derived metadata: `emitSignals` must be
one of the known ReddiAgent signals and may list supporting basis/evidence refs.
Provider compatibility reports preserve this metadata but keep
`paymentAccess=false`; `x402-dry-run` is the only report-only compatible rail.
Rails such as `solana`, `base`, `stripe`, or `other-x402` are valid vocabulary
only so validators can report them deterministically as unsupported live payment
rails until a separately approved wallet/facilitator/settlement lane exists.

## Tool Contract Metadata

ADL v0.2 tool declarations may include static contract metadata so validators
and adapters can fail closed before invoking a tool:

- `permissions`: normalized capability tags requested by the tool. Supported
  values are `tool`, `network`, `payment`, `shell`, `filesystem`, `messaging`,
  `mcp`, and `mutation`.
- `sideEffects`: bounded effect metadata with required `mode`. Supported modes
  are `none`, `read`, `write`, `network`, `payment`, `messaging`, `shell`,
  `filesystem`, `mcp`, and `multiple`, with optional `mutatesState`,
  `external`, and `resources`.
- `timeout`: execution budget with required `seconds` and optional
  `behavior` of `fail-closed`, `cancel`, or `retry`.
- `retryPolicy`: retry contract with required `maxAttempts`, optional
  `backoff`, and optional `retryOn` error labels.
- `auditLevel`: one of `none`, `metadata`, `event`, `payload-redacted`, or
  `full`.

Safe fixture tools may declare `permissions: [tool]`, `sideEffects.mode: none`,
and no `policyRefs`. Mutating, network, payment, shell, filesystem, messaging,
and MCP tools must declare explicit `policyRefs`; a nearby policy is not enough.
Tool IDs must be unique across `harness.tools` and `harness.functions` so the
harness cannot bind a policy reference to the wrong implementation.

Canonical allow example:

```yaml
harness:
  tools:
    - id: search_docs
      type: function
      description: Search reviewed project documents.
      permissions:
        - network
      sideEffects:
        mode: network
        external: true
        resources:
          - https://docs.reddiagent.dev
      timeout:
        seconds: 10
        behavior: fail-closed
      retryPolicy:
        maxAttempts: 1
        backoff: none
      auditLevel: payload-redacted
      policyRefs:
        - allow-reviewed-tool
  policies:
    - id: allow-reviewed-tool
      capability: tool
      subject: agent
      resource: tool:search_docs
      action: invoke
      effect: allow
      scope:
        type: task
      limits:
        maxCalls: 5
      approval:
        required: false
        mode: none
      enforcement:
        target: runtime-adapter
        phase: before-execution
```

## Data Source Boundary Contract

ADL v0.2 uses one canonical `harness.dataSources[*].type` vocabulary:

- `file`: local or packaged file/document content. Legacy `document` aliases
  must be rewritten to `file`.
- `url`: citable web URL content. Legacy `web` aliases must be rewritten to
  `url`.
- `api`: reviewed API endpoint metadata.
- `database`: reviewed database connection metadata.
- `vector-index`: reviewed retrieval index metadata.
- `mcp`: MCP-shaped output metadata. This is a static source boundary and does
  not permit live MCP invocation.

The legacy `knowledge-base` alias is not valid in ADL v0.2. Builders must
choose the concrete backing type (`file`, `url`, `api`, `database`,
`vector-index`, or `mcp`) so adapters do not invent source semantics.

Every data source carries a source-boundary declaration:

- `sourceRef`: stable typed reference using the same prefix as `type`, such as
  `file:path/to/source.md`, `url:https://docs.example.test/page`,
  `api:catalog`, `database:readonly-warehouse`, `vector-index:docs`, or
  `mcp:approved-docs-search`.
- `trust`: `approved`, `untrusted`, or `unknown`.
- `citationRequired`: whether output may complete without a citation to this
  source.
- `sourceCheck`: fail-closed source-check expectation with `required`,
  `expectation`, and optional `gateRef`.

Each source type has exactly one shape field:

- `file` requires `path`.
- `url` requires `url`.
- `api` requires `api.endpoint` and `api.method`.
- `database` requires `database.engine` and `database.connectionRef`.
- `vector-index` requires `vectorIndex.indexRef`.
- `mcp` requires `mcp.serverRef` and `mcp.outputShape`.

Source shape fields are mutually exclusive. A `file` source with `url`, an
`api` source with `path`, or a `sourceRef` prefix that does not match `type`
fails validation before compatibility reporting. `untrusted` and `unknown`
sources must still require citation and source-check evidence; they remain
review-visible and cannot silently become trusted completion evidence.
Approved sources must set `citationRequired: true`,
`sourceCheck.required: true`, and
`sourceCheck.expectation: approved-source`.
Untrusted and unknown sources must use `manual-review` or `not-citable`; they
must not claim the approved-source expectation.

Canonical data source examples:

```yaml
harness:
  dataSources:
    - id: project_docs
      type: file
      description: Reviewed local project documentation.
      sourceRef: file:specs/ADL-v0.2.md
      path: specs/ADL-v0.2.md
      trust: approved
      citationRequired: true
      sourceCheck:
        required: true
        expectation: approved-source
        gateRef: approved-source-output
    - id: public_docs
      type: url
      description: Reviewed public documentation URL.
      sourceRef: url:https://docs.reddiagent.dev/adl
      url: https://docs.reddiagent.dev/adl
      trust: approved
      citationRequired: true
      sourceCheck:
        required: true
        expectation: approved-source
    - id: catalog_api
      type: api
      description: Reviewed read-only catalog API.
      sourceRef: api:catalog
      api:
        endpoint: https://api.example.test/catalog
        method: GET
      trust: approved
      citationRequired: true
      sourceCheck:
        required: true
        expectation: approved-source
    - id: local_index
      type: vector-index
      description: Reviewed local documentation index.
      sourceRef: vector-index:docs
      vectorIndex:
        indexRef: indexes/docs
        embeddingModel: text-embedding-metadata-only
      trust: approved
      citationRequired: true
      sourceCheck:
        required: true
        expectation: approved-source
    - id: docs_mcp_output
      type: mcp
      description: MCP-shaped docs output inspected without live invocation.
      sourceRef: mcp:approved-docs-search
      mcp:
        serverRef: approved-docs-search
        toolName: search
        outputShape: source-citable-output
      trust: approved
      citationRequired: true
      sourceCheck:
        required: true
        expectation: approved-source
```

## Eval Gate Completion Contract

ADL v0.2 eval gates define the task completion contract before a runtime,
adapter, or exporter treats work as complete. Each `harness.evalGates` entry
carries:

- `id`: stable gate identifier used by traces, receipts, and conformance
  reports.
- `type`: one of `output-check`, `source-check`, `tool-check`,
  `budget-check`, `receipt-check`, or `human-review`.
- `rule`: human-readable rule summary.
- `required`: whether this gate must pass before task completion.
- `severity`: `error` or `critical` for required gates; `info` or `warning`
  for non-blocking gates.
- `appliesTo`: scoped target for the gate, with `scope` set to `task`,
  `output`, `tool`, `source`, `budget`, `receipt`, or `human-review`, and an
  optional `targetRef`.
- `evidence`: required evidence reference and JSON Schema for the gate
  result.
- `retryable`: whether the harness may retry after this gate fails.
- `onFailure`: completion behavior. Required gates must use
  `completion: block` and `defaultStatus: fail`; warning gates must use
  `completion: warn`.

Completion is computed from gate results, not from dry-run transport success.
If any required gate is missing, `fail`, or otherwise not `pass`, the task
completion status is `fail`.
Missing evidence for a required gate uses the fail-closed default status.
Required gate results must include the declared evidence reference; missing or
mismatched evidence references do not satisfy completion.
Non-required gates remain visible in traces and receipts but cannot block completion.
Existing local dry-run semantics remain:
`completion.transportStatus = pass` only means deterministic validation and reporting completed;
`completion.requiredGateStatus` and `completion.status` carry the task
completion result.

Canonical required gate example:

```yaml
harness:
  evalGates:
    - id: approved-source-output
      type: source-check
      rule: "Outputs must cite an approved source before completion."
      required: true
      severity: error
      appliesTo:
        scope: source
        targetRef: tool:search_docs
      evidence:
        ref: trace:source.checked
        schema:
          type: object
          required: [status]
          properties:
            status:
              enum: [pass, fail]
      retryable: false
      onFailure:
        completion: block
        defaultStatus: fail
        visibility: trace-and-receipt
```

Canonical warning gate example:

```yaml
harness:
  evalGates:
    - id: preferred-summary-style
      type: output-check
      rule: "Output should include a concise summary."
      required: false
      severity: warning
      appliesTo:
        scope: output
      evidence:
        ref: trace:output.style_checked
        schema:
          type: object
          required: [status]
          properties:
            status:
              enum: [pass, warn, fail]
      retryable: true
      onFailure:
        completion: warn
        defaultStatus: warn
        visibility: trace
```

## Runtime And Deployment Descriptor

ADL v0.2 normalizes runtime and deployment constraints into typed harness
sections so adapters can reject unsupported behavior before execution. These
fields are declarations, not permission to activate a runtime, read secrets,
open a network connection, start a scheduler, publish a deployment, or mutate a
platform.

`harness.runtime` is required and carries:

- `target`: one of `local-python`, `hosted-container`, `serverless`,
  `platform-native`, or `openclaw`.
- `network`: typed network access declaration with `access` set to `none`,
  `egress`, `ingress`, or `egress-and-ingress`; external access must include
  an allowlist and `denyByDefault: true`.
- `secretRefs`: references only. Each entry uses `name`, `provider`, optional
  `ref`, `scope`, and `required`; embedded values are invalid. Obvious raw
  credential prefixes in `ref` are invalid too.
- `storage`: `none`, `ephemeral`, `persistent`, or `external`; persistent and
  external storage require refs and retention.
- `scheduler`: `manual`, `cron`, `event`, `webhook`, or `queue`; cron requires
  schedule and timezone, event-like triggers require an event ref.
- `activation`: `blocked`, `approval-required`, or `approved-bounded`;
  approved bounded declarations require approval and expiry references but
  still do not execute under compatibility reports.
- `constraints`: target-specific limits such as runtime version, image,
  region, max duration, or max concurrency.

`harness.deployment` mirrors the same boundary in deployment terms:
`target`, `environment`, `region`, `resources`, `secretRefs`, `networkPolicy`,
`storage`, `scheduler`, `observability`, `rollback`, `healthCheck`, and
`constraints`. Production environment declarations remain Level 4-gated and
mainnet remains separately approval-gated.

Compatibility checks must inspect both `harness.runtime` and mirrored
`harness.deployment` fields. Deployment-only egress or ingress, persistent or
external storage, and non-manual schedulers are unsupported before execution in
the same way as runtime-side declarations.

## Observability Trace And Export Contract

`harness.observability` declares how static validators, adapters, and future
runtimes preserve trace evidence. It is configuration and evidence metadata; it
does not authorize a provider call, live trace export, webhook push, hosted
collector write, or runtime execution.

The structured shape carries:

- `events`: typed event declarations. Each event has `name`, `type`,
  `required`, `evidenceRef`, and optional scope plus receipt/export refs.
- `summaries`: run, trace, adapter-loss, or deployment-readiness summaries that
  bind event names to a destination.
- `destinations`: trace output destinations with `id`, `type`, `mode`, `ref`,
  and destination redaction. `mode: local-only` means local file/stdout output
  only; `adapter-managed` and `external-reviewed` remain report-only until a
  reviewed adapter owns them.
- `evidenceRefs`: additional trace/evidence/receipt/export references.
- `traceRef`: stable trace identifier for reports and exports.
- `retention`: ephemeral, time-bound, or externally managed retention.
- `redaction`: document-level redaction mode and optional redacted fields.
- `receipts` and `exports`: relationships that state which events and evidence
  refs must be included in receipts or static export reports.

Minimum event sets are cumulative by conformance level:

| Level | Required observability events |
|---|---|
| 1 | `trace.started`, `trace.completed`, `task.completed`, `task.failed` |
| 2 | Level 1 plus `model.called`, `policy.checked`, `eval.checked` |
| 3 | Level 2 plus `payment.intent.created`, `receipt.emitted`, `reputation.signal.emitted` |
| 4 | Level 3 plus `deployment.health.checked`, `adapter.loss.reported` |

Missing required event names are conformance failures even when the ADL remains
schema-valid. Adapter and strict export reports must surface
`adapter.loss.reported` before lossy export or runtime mapping can be considered
reviewable.

Canonical local-only trace output:

```yaml
harness:
  observability:
    events:
      - name: trace.started
        type: trace
        required: true
        evidenceRef: trace:trace.started
      - name: trace.completed
        type: trace
        required: true
        evidenceRef: trace:trace.completed
      - name: task.completed
        type: task
        required: true
        evidenceRef: trace:task.completed
      - name: task.failed
        type: task
        required: true
        evidenceRef: trace:task.failed
    summaries:
      - id: local_run_summary
        type: run-summary
        destinationRef: local_trace_file
        eventRefs: [trace.started, trace.completed, task.completed, task.failed]
        humanReadable: true
    destinations:
      - id: local_trace_file
        type: file
        mode: local-only
        ref: file://./traces/agent.jsonl
        redaction:
          mode: payload-redacted
    retention:
      mode: ephemeral
      purgeOnCompletion: true
    redaction:
      mode: payload-redacted
    receipts:
      include: false
      eventRefs: []
    exports:
      include: true
      eventRefs: [trace.started, trace.completed]
```

Canonical adapter-loss reporting:

```yaml
harness:
  observability:
    events:
      - name: adapter.loss.reported
        type: adapter
        required: true
        evidenceRef: export:adapter-loss
        scope: export
    summaries:
      - id: adapter_loss_summary
        type: adapter-loss-summary
        destinationRef: reviewed_trace
        eventRefs: [adapter.loss.reported]
        humanReadable: true
    destinations:
      - id: reviewed_trace
        type: openclaw-trace
        mode: adapter-managed
        ref: trace://reviewed-adapter
        redaction:
          mode: payload-redacted
    retention:
      mode: time-bound
      maxAge: "7d"
      storageRef: trace://reviewed-adapter
    redaction:
      mode: payload-redacted
    exports:
      include: true
      eventRefs: [adapter.loss.reported]
      requiredEvidenceRefs: [export:adapter-loss]
```

Schema-valid but conformance-invalid missing-observability cases should point to
the missing event names, for example
`harness.observability.events.adapter.loss.reported`, rather than silently
passing a generic `harness.observability.events` field check.

`harness.recovery` declares disable and restart controls. Rollback uses the
typed `rollback.mode` vocabulary: `none`, `dry-run-disable`,
`previous-version`, or `operator-reviewed`.

Compatibility reports must include a runtime/deployment descriptor summary with
target, network/storage/scheduler modes, secret reference names, deployment
environment, rollback/recovery modes, observability events, and unsupported
feature diagnostics. Unsupported declarations such as hosted-container targets
under local-only checks, external network access without an approved adapter,
non-manual schedulers, external storage, or approved-bounded activation must
produce compatibility errors before execution while preserving
`runtimeExecutionAllowed=false`.

Canonical local-python descriptor:

```yaml
harness:
  runtime:
    target: local-python
    network:
      access: none
      allowlist: []
      denyByDefault: true
    storage:
      mode: ephemeral
    scheduler:
      trigger: manual
    activation:
      mode: blocked
    constraints:
      runtimeVersion: "python3.14"
      maxDurationSeconds: 60
  deployment:
    target: local
    environment: local
    rollback:
      mode: none
  observability:
    events:
      - name: trace.started
        type: trace
        required: true
        evidenceRef: trace:trace.started
        scope: task
      - name: trace.completed
        type: trace
        required: true
        evidenceRef: trace:trace.completed
        scope: task
      - name: task.completed
        type: task
        required: true
        evidenceRef: trace:task.completed
        scope: task
      - name: task.failed
        type: task
        required: true
        evidenceRef: trace:task.failed
        scope: task
    summaries:
      - id: local_run_summary
        type: run-summary
        destinationRef: local_trace_file
        eventRefs:
          - trace.started
          - trace.completed
          - task.completed
          - task.failed
        humanReadable: true
    destinations:
      - id: local_trace_file
        type: file
        mode: local-only
        ref: file://./traces/local-python.jsonl
        redaction:
          mode: payload-redacted
          fields:
            - prompt
            - output
    evidenceRefs:
      - trace:trace.started
      - trace:trace.completed
      - trace:task.completed
      - trace:task.failed
    traceRef: trace:local-python
    retention:
      mode: ephemeral
      purgeOnCompletion: true
    redaction:
      mode: payload-redacted
      fields:
        - prompt
        - output
    receipts:
      include: false
      eventRefs: []
    exports:
      include: true
      eventRefs:
        - trace.started
        - trace.completed
        - task.completed
        - task.failed
      requiredEvidenceRefs:
        - trace:trace.started
        - trace:trace.completed
  recovery:
    disable:
      mode: manual
```

Canonical hosted-container descriptor:

```yaml
harness:
  runtime:
    target: hosted-container
    network:
      access: egress
      allowlist:
        - https://api.example.test
      denyByDefault: true
    secretRefs:
      - name: EXAMPLE_API_KEY
        provider: vault
        ref: vault://example/api-key
        scope: runtime
        required: true
    storage:
      mode: persistent
      refs:
        - volume://agent-cache
      retention: "7d"
    scheduler:
      trigger: manual
    activation:
      mode: approval-required
    constraints:
      image: ghcr.io/reddiagent/example-agent:sha256-demo
      region: syd1
  deployment:
    target: container
    environment: preview
    networkPolicy:
      access: egress
      allowlist:
        - https://api.example.test
      denyByDefault: true
    rollback:
      mode: previous-version
      ref: deployment:previous
      requiresApproval: true
  observability:
    events:
      - name: trace.started
        type: trace
        required: true
        evidenceRef: trace:trace.started
        scope: deployment
      - name: trace.completed
        type: trace
        required: true
        evidenceRef: trace:trace.completed
        scope: deployment
      - name: task.completed
        type: task
        required: true
        evidenceRef: trace:task.completed
        scope: task
      - name: task.failed
        type: task
        required: true
        evidenceRef: trace:task.failed
        scope: task
      - name: deployment.health.checked
        type: deployment
        required: true
        evidenceRef: trace:deployment.health.checked
        scope: deployment
      - name: adapter.loss.reported
        type: adapter
        required: true
        evidenceRef: export:adapter-loss
        scope: export
    summaries:
      - id: deployment_readiness_summary
        type: deployment-readiness-summary
        destinationRef: preview_trace
        eventRefs:
          - trace.started
          - deployment.health.checked
          - adapter.loss.reported
        humanReadable: true
      - id: adapter_loss_summary
        type: adapter-loss-summary
        destinationRef: preview_trace
        eventRefs:
          - adapter.loss.reported
        humanReadable: true
    destinations:
      - type: openclaw-trace
        id: preview_trace
        mode: adapter-managed
        ref: trace://runtime-preview
        redaction:
          mode: payload-redacted
          fields:
            - prompt
            - secretRefs
    evidenceRefs:
      - trace:trace.started
      - trace:deployment.health.checked
      - export:adapter-loss
    traceRef: trace:runtime-preview
    retention:
      mode: time-bound
      maxAge: "7d"
      storageRef: trace://runtime-preview
    redaction:
      mode: payload-redacted
      fields:
        - prompt
        - secretRefs
  recovery:
    disable:
      mode: operator-reviewed
      ref: runbook://disable-preview
      requiresApproval: true
```

Canonical serverless/platform-native descriptor:

```yaml
harness:
  runtime:
    target: serverless
    network:
      access: egress
      allowlist:
        - https://api.example.test
      denyByDefault: true
    secretRefs:
      - name: PLATFORM_TOKEN
        provider: cloud-secret-manager
        ref: secret://platform/token
        scope: provider
        required: true
    storage:
      mode: none
    scheduler:
      trigger: event
      eventRef: event://agent.requested
    activation:
      mode: approval-required
    constraints:
      region: us-east1
      maxDurationSeconds: 30
      maxConcurrency: 1
  deployment:
    target: serverless
    environment: staging
    healthCheck:
      type: trace-event
      ref: trace:deployment.health.checked
    rollback:
      mode: operator-reviewed
      requiresApproval: true
  observability:
    events:
      - name: trace.started
        type: trace
        required: true
        evidenceRef: trace:trace.started
      - name: trace.completed
        type: trace
        required: true
        evidenceRef: trace:trace.completed
      - name: task.completed
        type: task
        required: true
        evidenceRef: trace:task.completed
      - name: task.failed
        type: task
        required: true
        evidenceRef: trace:task.failed
      - name: deployment.health.checked
        type: deployment
        required: true
        evidenceRef: trace:deployment.health.checked
      - name: adapter.loss.reported
        type: adapter
        required: true
        evidenceRef: export:adapter-loss
    summaries:
      - id: serverless_readiness_summary
        type: deployment-readiness-summary
        destinationRef: serverless_trace
        eventRefs: [trace.started, deployment.health.checked, adapter.loss.reported]
    destinations:
      - id: serverless_trace
        type: openclaw-trace
        mode: adapter-managed
        ref: trace://runtime-serverless
        redaction:
          mode: payload-redacted
    retention:
      mode: time-bound
      maxAge: "7d"
      storageRef: trace://runtime-serverless
    redaction:
      mode: payload-redacted
  recovery:
    disable:
      mode: operator-reviewed
```

## Validation Principles

- Missing required top-level, model, or harness fields fail validation.
- Prose examples must validate against the v0.2 JSON Schema.
- Checked examples must use the same object-shaped `harness.instructions`
  contract.
- Shape-divergence fixtures must fail with a clear `harness.instructions`
  validation error.
- Permission policies must use structured capability fields rather than
  free-form prose rules.
- Risky tool, payment, messaging, network, filesystem, and human approval
  declarations must be explicitly bounded by matching enforceable policy, not
  merely any existing policy id with a nearby capability type.
- Unknown capability names and unsupported enforcement targets fail
  compatibility before any execution path.
- Required eval gates fail closed when evidence is missing or failing; warning
  gates remain visible and non-blocking.
- Data source aliases fail validation in ADL v0.2; adapters and reports must
  use only the canonical `file`, `url`, `api`, `database`, `vector-index`, and
  `mcp` vocabulary.
- Source boundary declarations must match their source type, trust state,
  citation requirement, and source-check expectation before compatibility or
  export surfaces can treat a source as usable.
- Requested conformance levels fail closed when their required ADL field set or
  evidence outputs are missing, even if the document is otherwise schema-valid.
- Payment/reputation declarations are Level 3-gated, strict known extension
  schemas fail closed, and production deployment descriptors are Level 4-gated;
  mainnet remains separately approval-gated.
- Runtime/deployment descriptors must be typed, secret-reference-only, and
  report-only until an explicit runtime activation gate approves a bounded
  execution lane.
