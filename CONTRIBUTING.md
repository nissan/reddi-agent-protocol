# Contributing to Reddi Agent Protocol

Reddi Agent Protocol is open-source-first protocol infrastructure for RAP Assurance: payments prove transfer; RAP Assurance proves paid work. Contributions should improve the local protocol, SDKs, conformance checks, adapters, documentation, or governance without making the OSS core depend on a hosted Reddi service or making unproven payment, custody, marketplace, runtime, production, or mainnet claims.

## Project Boundary

The OSS core includes:

- Protocol schemas for quote, policy, receipt, attestation, disclosure, settlement, and reputation flows.
- Local SDKs, middleware, MCP bridge packages, and framework adapters.
- Conformance tests, BDD scenarios, example specialists, and local evidence archives.
- Solana/devnet/localnet reference implementations and optional payment/source adapters with explicit live-spend gates.
- Documentation needed to run, test, inspect, and extend the core locally.

Optional hosted Redditech services may exist later for convenience, operations, or monetization. They are not required to use the OSS core and should be described as future/optional unless an approved release says otherwise. Do not add a core dependency on private dashboards, hosted registries, managed relays, proprietary marketplaces, private deployment URLs, or paid provider credentials.

## How to Contribute

1. Open or pick a GitHub issue before making a material change.
2. Keep PRs scoped to one issue or one coherent slice.
3. Include acceptance criteria in the PR description and link the issue it closes or advances.
4. Add or update tests/docs that match the risk of the change.
5. Run the narrowest meaningful validation locally and list the exact commands/results in the PR.
6. After merge, maintainers review roadmap/dependency follow-ups through issue #340.

Docs-only changes normally need `git diff --check`. Code, package, protocol, or BDD changes need the relevant package scripts listed in `package.json`.

## Roadmap and Labels

Public roadmap issues are organized as epics, features, tasks, and process items:

- Epics: broad product areas such as protocol core, SDK/middleware, trust primitives, reputation, and adoption.
- Features: user- or developer-visible capabilities that may span multiple PRs.
- Tasks: bounded implementation, documentation, validation, or governance work.
- Process: maintainer workflow and roadmap hygiene, including the post-merge review loop in #340.

Current epic anchors:

- [#334 Product core: reddi-x402 policy, payment, and receipts](https://github.com/nissan/reddi-agent-protocol/issues/334)
- [#335 Product workflow UX: paid agent workflows and ledger](https://github.com/nissan/reddi-agent-protocol/issues/335)
- [#336 Source and trust integrations: adapters, conformance, auth](https://github.com/nissan/reddi-agent-protocol/issues/336)
- [#337 Evidence, attestation, and reputation loop](https://github.com/nissan/reddi-agent-protocol/issues/337)
- [#338 Payment rail neutrality and adapter strategy](https://github.com/nissan/reddi-agent-protocol/issues/338)
- [#339 Deployment, operations, and marketplace readiness](https://github.com/nissan/reddi-agent-protocol/issues/339)
- [#355 OSS developer release and conformance readiness](https://github.com/nissan/reddi-agent-protocol/issues/355)

Common labels:

- `product-roadmap`: part of the standalone Reddi Agent Protocol roadmap.
- `oss-core`: belongs in the open protocol, SDK, docs, tests, or conformance surface.
- `v0.1`: targeted for the first public adoption milestone.
- `dependency-map`: issue declares dependencies, blockers, or reverse dependencies.
- `task`, `feature`, `epic`: issue type.
- `status: blocked`, `status: in review`, `status: done`: maintainer state.

When a PR changes dependencies, sequence, or scope, update the issue thread so #340 can drive a roadmap review after merge.

## Security and Secrets

Never commit private keys, API keys, paid-provider credentials, production wallet material, unredacted auth headers, raw payment headers, or private prompts/logs. Use `.env.example` placeholders and local environment variables for configuration. Generated evidence should be safe to publish by default; redact secrets and private payloads before adding artifacts to a PR.

Security reports should follow `SECURITY.md`. Do not file public issues for exploitable vulnerabilities.

## License

Unless a file says otherwise, original contributions are accepted under the MIT License in `LICENSE`.

The repository may also contain copied, vendored, generated, or externally sourced material under `ingests/`, `third_party/`, `artifacts/`, public assets, and research/evidence folders. Those materials keep their original ownership and license terms unless explicitly relicensed. See `NOTICE.md` before adding or reusing third-party material.
