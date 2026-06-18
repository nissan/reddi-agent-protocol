# Hosted Self-Funding Offer Boundary

Issue: [#354](https://github.com/nissan/reddi-agent-protocol/issues/354)

Reddi Agent Protocol should be self-funding through hosted convenience, reliability, compliance, and support services around the protocol. It should not fund itself by making the open protocol hard to run, taxing self-hosted usage, or turning conformance into a hosted-only service.

## Principle

The OSS core is the adoption engine. The hosted product is the convenience and trust-operations layer for teams that do not want to run every piece themselves.

Self-hosted builders should always be able to:

- Read and implement the protocol spec.
- Use the TypeScript SDKs, middleware, and fixtures.
- Run receipt and policy validation locally.
- Run conformance checks without hosted Reddi infrastructure.
- Keep their own evidence archive and specialist registry.
- Build and operate paid specialist endpoints without a Redditech account.

Hosted offerings can charge for reliability, operations, retention, support, and marketplace distribution, not for permission to use RAP.

## OSS And Self-Hosted Core

These surfaces remain free, open, and self-hostable:

- Protocol specs for receipt envelopes, policy decisions, challenges, evidence references, attestations, and reputation signals.
- TypeScript SDK/package surfaces such as `@reddi/agent-protocol`, `@reddi/x402-solana`, and the MCP bridge.
- Buyer client and seller middleware primitives.
- Local buyer budget policy evaluator and dry-run policy decisions.
- Receipt schema and validation helpers.
- Conformance suite, deterministic fixtures, and example paid specialist endpoints.
- Local evidence archive format and evidence-reference helpers.
- Local/devnet/sandbox examples that do not require hosted Reddi services, paid providers, live payment, or mainnet spend.

## Paid Hosted Offers

### Hosted Facilitator Or Relay

Scope:

- Run reliable relay/facilitator infrastructure for teams that do not want to operate it.
- Provide uptime monitoring, request tracing, health checks, and incident visibility.
- Offer managed previews and sandbox endpoints for demos and partner pilots.

Claim boundary:

- Convenience layer only. Self-hosted relay/facilitator paths remain valid.
- No claim that hosted relay is required for protocol correctness.

### Managed Specialist Marketplace Listings

Scope:

- Publish, enrich, and monitor specialist listings.
- Provide listing quality checks, metadata hygiene, uptime checks, and discovery filters.
- Offer paid placement or verified listing tiers only if clearly labelled.

Claim boundary:

- Hosted marketplace data is not the only source of truth.
- Public registry/conformance paths remain usable without hosted listing approval.

### Reputation And Attestation Hosting

Scope:

- Store and serve reputation, attestation, and evidence-index metadata.
- Provide APIs for teams that need queryable history without running their own index.
- Offer retention, export, and audit support.

Claim boundary:

- Depends on #347 EvidenceArchive and #348 attestation/reputation loop.
- Hosted reputation is an index over protocol records, not the protocol authority.

### Audit Logs And Team Policy Dashboards

Scope:

- Hosted policy dashboards for teams: spend limits, approvals, source/specialist rules, audit notes, and exports.
- Long-term retention for receipts, policy decisions, evidence references, and operator approvals.
- Compliance-oriented exports and access controls.

Claim boundary:

- Depends on the local budget policy evaluator from #159 and future #342 buyer/seller surfaces.
- Team dashboards add governance; local policy evaluation remains available.

### Hosted Source And Trust Registry SLAs

Scope:

- Operate source/trust registry mirrors with uptime and response-time commitments.
- Serve signed registry snapshots and conformance metadata.
- Provide enterprise reliability for teams using RAP in operational workflows.

Claim boundary:

- SLA-backed registry hosting is optional.
- Community or self-hosted registries remain compatible if they pass conformance.

### Support And Private Integrations

Scope:

- Paid support, implementation help, onboarding, private adapter work, and enterprise integration.
- Security review support for teams exposing paid specialist endpoints.
- Custom settlement/source/evidence adapter implementation.

Claim boundary:

- Services accelerate adoption but do not create private protocol requirements.

### Optional Hosted Workflow Fees

Scope:

- A small fee may apply to workflows that use hosted Reddi relay, marketplace, reputation, audit, or dashboard services.
- Fees should be tied to hosted value delivered: workflow volume, retained evidence, team seats, SLA tier, or managed listing.

Claim boundary:

- No fee on self-hosted OSS protocol usage.
- No hidden fee required for local conformance, local receipts, or local evidence archives.

## Pricing Model Options

| Model | Best fit | Pros | Risks |
|---|---|---|---|
| Free OSS + paid support | Early developer adoption | Clear open-source trust; low friction | Revenue depends on high-touch services |
| Hosted team subscription | Teams running repeated workflows | Predictable revenue; maps to dashboards/audit logs | Needs clear team value before billing |
| Usage-based hosted workflow fee | Hosted relay/marketplace/reputation workflows | Scales with value delivered | Must avoid looking like a protocol tax |
| Managed listing fee | Specialist marketplace operators | Simple marketplace monetization | Paid placement can harm trust if not labelled |
| SLA registry tier | Enterprise/source-trust users | Strong fit for reliability buyers | Requires operational maturity and support process |
| Private integration package | Early partners | Funds roadmap while product matures | Can distract from OSS core if overused |

Near-term recommendation:

1. Start with free OSS core plus paid implementation/support and private integrations.
2. Add hosted team subscription once #342, #347, and #348 create enough retained operational value.
3. Add hosted workflow fees only for explicitly hosted workflows, after the local/self-hosted path is proven.

## Dependencies

- #159 local buyer budget policy evaluator: informs team policy dashboards and spend governance.
- #341 receipt/policy primitives: provides the public record hosted services index and retain.
- #342 buyer/seller middleware: creates the first developer workflow that hosted services can simplify.
- #347 EvidenceArchive v1: provides the local-first evidence boundary hosted retention can build on.
- #348 attestation/reputation loop: provides reputation records hosted indexes can serve.
- #350 hosted specialist marketplace readiness: turns managed listings and registry enrichment into a product surface.

## Non-Goals For This Task

- No billing integration.
- No payment collection.
- No subscription checkout.
- No paid provider calls.
- No live marketplace commitment.
- No external customer commitment.
- No change to protocol fees, settlement contracts, or payment adapter behavior.

## Follow-Up Issue Candidates

Open these only when the prerequisite product surface exists:

- Hosted team dashboard pricing and packaging after #342 plus #159 are integrated.
- Evidence retention tiers after #347 lands.
- Reputation/attestation API pricing after #348 lands.
- Managed specialist listing pilot after #350 lands.
- Hosted workflow fee design after a self-hosted local workflow demo proves the OSS path.
