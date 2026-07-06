Feature: Bucket S Source Adapter Onboarding
  As a protocol operator
  I want source ecosystems to onboard through a shared contract and conformance harness
  So that supervisor, attestor, and consumer roles remain settlement-safe and auditable

  Background:
    Given source-adapter manifests are validated before runtime integration

  @S1.1 @source-adapter @registration-safety
  Scenario: Source adapter manifest must validate before probe succeeds
    When a source submits an invalid sourceAdapter manifest
    Then `/api/register/probe` rejects with `invalid_source_adapter`
    And the response includes actionable mismatch reasons

  @S1.2 @source-adapter @registration-safety
  Scenario: Hosted unsafe target protections remain active with source adapters
    When a source probe targets localhost or private-network endpoints
    Then probe is rejected with `invalid_url`

  @S2.1 @supervisor @orchestration
  Scenario: OpenClaw supervisor orchestration resolves then invokes deterministically
    When the supervisor wrapper executes a task
    Then it calls resolve before invoke
    And returns phase metadata for auditability

  @S3.1 @attestor @schema-integrity
  Scenario: OpenClaw attestor manifest includes strict attestation schema
    When an attestor manifest is built from OpenClaw source profile defaults
    Then `attestationSchema` is pinned to `reddi.attestation.v1`
    And schema validation succeeds

  @S4.1 @consumer @settlement-safety
  Scenario: Connector surfaces invoke errors explicitly
    When invoke endpoint returns a non-OK status
    Then the connector throws a deterministic error
    And no implicit success path is returned

  @S5.1 @conformance @cross-source-parity
  Scenario: Source conformance harness emits reusable artifact summaries
    When conformance script runs in smoke mode
    Then summary artifacts are written under `artifacts/source-conformance/...`
    And step pass/fail counts are captured for retrospective updates

  @S3.2 @attestor @schema-integrity @hermes
  Scenario: Hermes attestor formatter enforces rubric shape and score bounds
    When a Hermes attestor payload contains drifted rubric values
    Then formatter rejects deterministically with mismatch error
    And no implicit attestation payload is returned

  @S5.2 @conformance @cross-source-parity @hermes
  Scenario: Hermes source profile resolves from registry
    When source profile lookup is called for `hermes`
    Then profile metadata is returned with supported roles and runtimes

  @S3.3 @extension-bundle @pi @schema-integrity
  Scenario: pi source extension bundle must include canonical required extensions
    When a pi extension bundle omits a required extension
    Then compatibility validation fails with deterministic missing-extension output

  @S5.3 @conformance @cross-source-parity @pi
  Scenario: Cross-source conformance matrix emits openclaw/hermes/pi smoke status in one report
    When the matrix runner executes source conformance for all supported sources
    Then matrix summary includes rows for openclaw hermes and pi
    And each row contains pass fail and artifact summary path fields

  @S2.2 @supervisor @routing-policy
  Scenario: Source-aware routing applies preferred source defaults with strict guardrails
    When resolve policy includes preferredSource and strictSourceMatch options
    Then source-matching specialists receive deterministic routing preference
    And strict mode rejects non-matching source candidates

  @S5.4 @conformance @ci-gating
  Scenario: CI matrix lane uploads source conformance artifacts for regressions
    When source-conformance-matrix workflow runs on source adapter changes
    Then matrix execution must pass before merge
    And source and matrix artifact directories are uploaded for inspection

  @S5.5 @conformance @circle-x402 @cross-source-parity
  Scenario: Circle x402 Discovery resources import as unattested specialist candidates
    When a Circle x402 Discovery resource is converted into a RAP candidate
    Then the candidate includes a valid source-adapter specialist manifest
    And the candidate is marked externally listed and not RAP-attested
    And payment options preserve rail network amount and payee fields
    And support states and diagnostics do not upgrade trust, publication, or reputation readiness

  @S5.6 @conformance @circle-x402 @settlement-safety
  Scenario: Circle x402 quote preview remains dry-run until explicit approval
    When a Circle x402 candidate is selected for route preview
    Then Reddi returns source-aware route policy metadata
    And live payment is disabled in the preview policy
    And required approval attestation and receipt gates are listed before any paid invocation

  @S5.7 @conformance @pay-sh @cross-source-parity
  Scenario: Pay.sh catalog providers import as Solana-first unattested specialist candidates
    When a Pay.sh catalog provider is converted into a RAP candidate
    Then the candidate includes a valid source-adapter specialist manifest
    And the candidate is marked externally listed and not RAP-attested
    And pricing preserves Solana USDC minimum maximum metering and free-tier fields

  @S5.8 @conformance @pay-sh @settlement-safety
  Scenario: Pay.sh quote preview remains dry-run until explicit wallet and spend approval
    When a Pay.sh candidate is selected for route preview
    Then Reddi returns Solana-first source-aware route policy metadata
    And live payment is disabled in the preview policy
    And required top-up spend-cap receipt and attestation gates are listed before any paid invocation

  @S5.9 @conformance @pay-sh @mcp-sandbox
  Scenario: Pay.sh MCP server card is inspected without enabling paid tools
    When the Pay.sh MCP server card is inspected for RAP planning
    Then Reddi classifies read-only provider discovery tools as dry-run safe
    And paid invocation balance and provider-authoring tools are blocked in dry-run mode
    And the policy forbids wallet setup top-up paid invocation and secret storage

  @S5.10 @conformance @pay-sh @settlement-safety
  Scenario: Pay.sh paid-call policy plan remains dry-run before execution
    When a Pay.sh candidate endpoint is planned for a future allowlisted paid call
    Then Reddi requires explicit user approval endpoint allowlisting tiny spend cap receipt capture and attestation
    And live payment remains disabled in the policy plan
    And non-curl MCP tools are blocked from future paid invocation

  @S5.11 @conformance @pay-sh @environment-capabilities
  Scenario: Pay.sh environment capabilities separate sandbox devnet and mainnet
    When a Pay.sh catalog provider is converted into a RAP candidate
    Then sandbox localnet is represented as the primary no-real-funds pre-go-live environment
    And devnet support is unknown unless provider metadata or payment challenge evidence declares it
    And mainnet remains explicitly gated with live payment disabled by default

  @S5.12 @conformance @pay-sh @environment-capabilities @settlement-safety
  Scenario: Pay.sh policy plans reject endpoint and environment mismatches
    When a Pay.sh endpoint is planned for sandbox devnet or mainnet execution
    Then sandbox plans prefer provider sandbox service URLs when declared
    And devnet plans require declared or challenge-detected devnet support
    And mainnet plans require candidate service URL compatibility plus explicit allowlisting

  @S5.13 @conformance @static-agent-stack @mcp-sandbox
  Scenario: Static agent-stack ingestion reports malformed MCP config without execution
    When a public agent-stack fixture contains a malformed Anthropic `.mcp.json`
    Then static inventory continues for safe repository files
    And connector diagnostics identify the malformed MCP config precisely
    And no plugin install command execution MCP call payment activation or marketplace publication occurs
    And the operator review payload blocks publication until the config and review gates are resolved

  @S5.14 @conformance @static-agent-stack @solana-readiness
  Scenario: Solana AI Kit static ingestion feeds readiness without live chain actions
    When a Solana AI Kit fixture declares hooks MCP tools wallet RPC SPL transfer or deploy capability
    Then static inventory records those signals as review risks
    And the draft recipe and profile distinguish declared Solana capability from reviewed RAP readiness
    And payment readiness remains disabled pending operator review
    And no wallet RPC SPL transfer live payment AUDD custody Quasar custody or marketplace publication is implied

  @S5.15 @conformance @okf-openkb @static-fixture
  Scenario: OKF and OpenKB-style knowledge bundles remain static review fixtures
    When an OKF-shaped or OpenKB-style knowledge bundle fixture is added for RAP review
    Then source provenance and imported-context trust boundaries are recorded
    And generated AGENTS SKILL prompt tool script and agent definition artifacts are marked untrusted
    And fixture validation rejects generated install execution hosted publication payment trust mutation and reputation mutation paths
    And no OpenKB install URL ingestion provider call MCP call wallet RPC paid call marketplace publication or agent onboarding occurs

  @S5.16 @conformance @okf-openkb @static-analysis
  Scenario: OKF and OpenKB knowledge-bundle conformance diagnostics stay deterministic and review-only
    When conformance diagnostics run over an OKF-shaped or OpenKB-style knowledge bundle fixture
    Then frontmatter parseability concept type link syntax index and log semantics unknown frontmatter preservation and provenance completeness are reported deterministically
    And generated AGENTS SKILL prompt script skill tool and agent definition artifacts are classified untrusted with explicit artifact classes and blocked severity
    And script and tool artifacts are additionally reported as execution not allowed
    And a passing verdict permits static review and analysis only with no skill installation agent registration marketplace publication hosted write provider call or execution
    And malformed bundles and any execute install ingest or provider request fail closed
