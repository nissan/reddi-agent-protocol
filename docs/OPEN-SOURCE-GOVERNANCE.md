# Open Source Governance

Reddi Agent Protocol is governed as an open-source-first protocol and SDK project. The core must remain usable without Redditech-operated infrastructure, private credentials, or hosted services.

## Open-Core Boundary

### OSS Core

The open-source core is the part contributors and adopters can run, inspect, fork, and validate locally:

- Protocol schemas for quotes, policies, receipts, attestations, disclosure ledgers, settlement adapters, and reputation signals.
- SDKs, middleware, MCP bridge packages, and framework adapters that enforce local policy and receipt capture.
- Conformance suites, BDD scenarios, local fixtures, example specialists, and reference source/settlement adapters.
- Documentation for local setup, devnet/localnet operation, security boundaries, and contribution workflows.
- Safe public evidence formats that exclude secrets, private prompts, raw auth headers, and wallet key material.

The MIT license in the repository root applies to original Reddi Agent Protocol source and docs unless a file says otherwise. It does not override third-party rights for copied, vendored, generated, or externally sourced material. See `NOTICE.md` for carve-outs covering `ingests/`, `third_party/`, generated artifacts, public assets, and externally sourced docs.

### Optional Hosted Product

Redditech may later provide hosted services around the protocol, such as:

- Managed facilitator or relay infrastructure.
- Hosted marketplace listings, source/trust registries, or reputation/attestation indexes.
- Team policy dashboards, audit-log retention, compliance exports, or support/private integrations.
- Managed specialist hosting, uptime monitoring, SLA-backed registries, or workflow billing.

These services can improve convenience and fund ongoing work, but they must not become a requirement for using the OSS core. Public protocol behavior should remain specified, testable, and replaceable by community-run infrastructure.

## No Hosted-Service Requirement

Core PRs must preserve these guarantees:

- A developer can clone the repo, install dependencies, and run the relevant local/devnet path without a hosted Reddi account.
- Protocol, SDK, and conformance behavior can be tested with local fixtures, localnet, devnet, sandbox, or dry-run modes.
- Private Redditech URLs, Coolify/Vercel deployment state, paid-provider accounts, and production secrets are not required for OSS validation.
- Hosted endpoints used in examples are clearly labelled as examples or demos, not protocol requirements.
- Any managed-service integration has an adapter boundary and a documented local or third-party replacement path.

If a change appears to require hosted infrastructure, split the hosted convenience layer from the OSS protocol/API surface before merging.

## Roadmap Model

The public roadmap uses GitHub issues as the coordination source:

- Product epics describe large roadmap areas.
- Feature issues describe user-visible or developer-visible capabilities.
- Task issues describe bounded implementation, documentation, governance, validation, or release work.
- Process issues describe maintainer workflow. Issue #340 tracks post-PR roadmap review.

Current public epics:

- [#334 Product core: reddi-x402 policy, payment, and receipts](https://github.com/nissan/reddi-agent-protocol/issues/334)
- [#335 Product workflow UX: paid agent workflows and ledger](https://github.com/nissan/reddi-agent-protocol/issues/335)
- [#336 Source and trust integrations: adapters, conformance, auth](https://github.com/nissan/reddi-agent-protocol/issues/336)
- [#337 Evidence, attestation, and reputation loop](https://github.com/nissan/reddi-agent-protocol/issues/337)
- [#338 Payment rail neutrality and adapter strategy](https://github.com/nissan/reddi-agent-protocol/issues/338)
- [#339 Deployment, operations, and marketplace readiness](https://github.com/nissan/reddi-agent-protocol/issues/339)
- [#355 OSS developer release and conformance readiness](https://github.com/nissan/reddi-agent-protocol/issues/355)

Labels explain where an issue sits:

- `product-roadmap`: public standalone RAP roadmap work.
- `oss-core`: open protocol, SDK, docs, tests, or conformance work.
- `v0.1`: first public adoption milestone.
- `dependency-map`: issue includes dependency and reverse-dependency context.
- `epic`, `feature`, `task`: issue type.
- `status: blocked`, `status: in review`, `status: done`: maintainer state.

After each merged PR, maintainers review the linked issue and #340 for dependency changes, newly discovered blockers, stale acceptance criteria, and follow-up roadmap issues.

## Contribution Boundaries

Preferred contributions:

- Tighten protocol specifications, schemas, validation, and conformance behavior.
- Improve local developer setup, examples, fixture quality, or reproducible evidence.
- Add adapters with dry-run/sandbox/localnet defaults and clear live-spend gates.
- Improve security posture, secret handling, and disclosure hygiene.
- Clarify roadmap sequencing and dependency maps.

Out-of-scope for OSS core:

- Requiring proprietary hosted services for protocol correctness.
- Committing private operational URLs as mandatory defaults.
- Storing API keys, wallet private keys, auth headers, raw payment headers, or private prompts/logs.
- Treating hosted Reddi marketplace data as the only source of truth.
- Adding live spend, mainnet execution, or paid provider calls without explicit approval gates and safe defaults.

## Security Disclosure and Secret Handling

Use `SECURITY.md` for responsible disclosure. Security-sensitive details should be shared privately, not in public issues.

Secret-handling rules:

- Keep secrets in local environment variables or a secret manager, never in source.
- Use placeholders in examples.
- Redact generated artifacts before publishing or committing them.
- Do not persist raw prompts, outputs, x402 headers, auth headers, payment payloads, private keys, or paid-provider credentials unless a document explicitly defines a safe redacted format.
- Rotate any credential that is accidentally committed, even if it is later removed from git.

These rules apply to contributors, maintainers, examples, test fixtures, and generated evidence.
