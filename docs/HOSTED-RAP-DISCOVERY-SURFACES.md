# Hosted RAP Discovery Surfaces

Issue: [#369](https://github.com/nissan/reddi-agent-protocol/issues/369)

Hosted RAP discovery is a convenience and operations layer around reviewed marketplace listings. It must not become a requirement for running RAP, validating RAP records, or publishing self-hosted discovery metadata.

## Public Surfaces

Hosted RAP exposes two read-only discovery surfaces for managed listings:

- `/.well-known/ai-catalog.json` publishes AI Catalog metadata derived from the gated marketplace public export snapshot.
- `GET /api/hosted-rap/search` filters and ranks the same gated export snapshot for hosted search.

Both surfaces are downstream of marketplace readiness and approval gates. They do not publish raw imported drafts, activate payments, probe endpoints, call providers, assign reputation, or mutate registry state.

## Source Classes

Public listing metadata should distinguish where a specialist came from:

- `self-hosted`: a builder publishes their own RAP or AI Catalog metadata without hosted RAP infrastructure.
- `hosted-by-rap`: hosted RAP serves a managed listing after operator review and readiness gating.
- `externally-listed`: RAP ingests or references a third-party catalog/listing source as untrusted external metadata until local policy, trust, payment, receipt, evidence, attestation, and reputation gates say otherwise.

Search relevance is only a discovery signal. It is not trust, safety, payment approval, endpoint health, attestation, or reputation.

## Federation And Referral Posture

Federation/referral compatibility is future-safe for v0.1:

- Hosted RAP catalog/search responses should keep stable listing ids, source refs, and catalog refs so other registries can reference them later.
- Self-hosted catalogs can remain valid without appearing in hosted RAP search.
- Hosted RAP can later add referral or federation metadata as references around the same listing source of truth, not as a parallel authority.
- Federation should preserve the source class and avoid upgrading external or self-hosted listings into hosted trust claims.

No v0.1 client should require hosted RAP federation to discover or validate self-hosted RAP-compatible agents.

## Hosted Value Boundary

Paid hosted value comes from operations around discovery, not from protocol exclusivity:

- curated managed listings
- SLA-backed availability for hosted catalog/search APIs
- audit-log retention and export
- team policy and approval history
- reputation/trust hosting after receipt/evidence and attestation gates exist
- support for metadata hygiene and listing operations

Hosted fees must be tied to those services. They must not tax self-hosted RAP usage or local conformance.

## Non-Live Guardrails

The read-only catalog/search surfaces do not perform:

- live marketplace publication
- payment activation or live x402 retry
- wallet signing or SPL transfer
- RPC probing
- MCP/provider calls
- repository fetches or imported command execution
- trust upgrades
- reputation assignment

Publication claims that mention payment proof, receipt/evidence, trust, or reputation belong to later publication-gate work and depend on the receipt/evidence and attestation/reputation lanes.

If a future publication or reputation lane moves from read-only metadata into Quasar instructions, transaction assembly, wallet signing, RPC, or devnet proof, it must first pass the [Quasar Surfpool and devnet promotion checklist](./QUASAR-SURFPOOL-DEVNET-PROMOTION-CHECKLIST.md).
