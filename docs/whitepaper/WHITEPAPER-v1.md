# Reddi Agent Protocol — Whitepaper (v1.0 Candidate)

_Status: Candidate for publication review; not a production, mainnet, custody, or security-audit claim._

## Abstract

Reddi Agent Protocol (RAP) is currently narrowed around **RAP Assurance**: open, integration-first receipts and conformance for paid MCP/API and agent work.

> Payments prove transfer; RAP Assurance proves paid work.

Payment rails such as x402, MPP/Stripe-style machine payments, Pay.sh/PayAI, and Solana/AUDD adapters can prove payment intent or transfer. RAP Assurance records the paid-work lifecycle around those rails: work terms, buyer authority/policy, payment-proof references, evidence references, attestation outcomes, replay metadata, and reputation inputs. The current repository proves local/offline package behavior, deterministic fixtures, and bounded local/devnet evidence; it does not claim mainnet readiness, production custody, or deployed protocol-fee collection.

## 1. Problem

AI agents and APIs can be paid programmatically, but a successful payment does not answer the operational question buyers care about after a paid task:

- Was the work authorized under the buyer's policy?
- What terms, price, and evidence requirements were agreed?
- Which payment proof was observed, and by which rail-specific verifier?
- What output was delivered, how was it attested, and can the evidence be replayed?
- Which reputation or dispute inputs are justified by the record?

Simple deterministic API calls may not need RAP. The stronger need appears when work is cross-organization, non-deterministic, high-value, regulated, audited, or reputation-sensitive.

## 2. System goals

- Keep payments, authority, evidence, attestation, replay, and reputation inputs separable and inspectable.
- Integrate with adjacent standards and products instead of replacing them.
- Provide local/self-hosted conformance before any hosted Redditech service is needed.
- Fail closed on missing proof, unsupported rails, credential leakage, custody claims, settlement-finality claims, live-payment claims, and trust/reputation overclaims.
- Preserve explicit current-state vs roadmap boundaries.

## 3. Participants and roles

- **Buyer / consumer agent:** initiates a paid-work request and applies local budget/authority policy.
- **Specialist / service provider:** exposes capability and pricing metadata and may issue x402-style payment challenges.
- **Payment rail / verifier:** proves rail-specific payment intent or transfer.
- **Attestor / judge:** evaluates work output and evidence against agreed criteria.
- **RAP Assurance layer:** records the receipt, policy decision, evidence binding, replay metadata, and bounded reputation inputs.

## 4. Core model

### 4.1 Discovery and routing

Specialists expose capability and policy metadata through local fixtures, MCP/AI catalog surfaces, hosted-catalog candidates, or other adapters. Discovery relevance is informational only; it is not trust, payment approval, publication approval, or reputation mutation.

### 4.2 Payment challenge and proof reference

A specialist or rail can return a payment challenge. RAP records the quote, buyer policy result, and payment-proof reference, but rail-specific payment packages remain responsible for validating transfer-specific evidence. A payment receipt alone does not prove work quality.

### 4.3 Work evidence and replay

The receipt binds the request hash, response hash, evidence reference, attestation state, and replay labels. Deterministic fixtures and local conformance tests exercise happy paths and failures such as missing evidence, unsupported network/asset pairs, malformed challenges, and credential-shaped metadata.

### 4.4 Attestation and reputation inputs

Attestation records and off-chain reputation previews can explain whether evidence supports future routing or dispute decisions. Current public claims stop at bounded inputs and previews unless a separate audited on-chain/live workstream is approved.

## 5. Current evidence

Current repository evidence includes:

- `@reddi/agent-protocol` receipt, policy, evidence, rail-neutral proof-chain, and conformance helpers.
- `@reddi/x402-solana` local x402 parsing, budget preflight, nonce/replay protections, demo receipt handling, gated devnet helpers, and read-only SPL `TransferChecked` observation.
- `@reddi/rap-mcp-bridge` dry-run specialist discovery, synthetic quotes, receipt verification, and disclosure-ledger tooling.
- The public conformance suite (`npm run check:conformance:public`) and OSS release smoke (`npm run check:oss-release-smoke`).
- Recorded/local Solana reference evidence, with the current Quasar devnet deployment explicitly blocked by `config/quasar/deployments.json`.

### 5.1 Dogfood trust harness

The repository ships a dogfood harness that exercises acceptance logic under injected failure: a testing specialist answering `ping -> pong + haiku` (`packages/testing-specialists`), deterministic failure injection, an independent attestor checking for `pong` and 5/7/5 structure, and a consumer run that decides accept vs reject from the attestor verdict (`/dogfood`, `app/api/dogfood/*`).

It demonstrates that acceptance logic rejects malformed output and withholds approval on failed attestation. The decision it records is an application-level accept/reject over evidence; it is not fund custody, on-chain settlement, or a settlement-finality claim.

## 6. Security and anti-gaming posture

See Appendix A (`APPENDIX-THREAT-MODEL.md`) and `SECURITY.md` for details. Current controls are threat-model and source/test claims, not a completed external audit. They include receipt validation, credential-leakage rejection, nonce/replay checks, evidence hashing, policy fail-closed behavior, and attestation/reputation separation.

Known open boundaries include mainnet deployment, live-funds operation, audited custody/escrow paths, Quasar devnet redeployment, upgrade authority policy, operational monitoring, and production incident response. AUDD/SPL custody is not claimed.

## 7. Economics and incentives

The planned 0.05% / 5 bps protocol-fee number appears only as product/demo fixture semantics. No deployed on-chain release path currently collects a protocol treasury fee. Future monetization, if approved, should focus on optional hosted evidence retention, receipt search, audit export, conformance certification, support, and managed Arena/community operations while preserving local/self-hosted parity.

## 8. Integration surfaces

RAP Assurance should remain complementary to:

- x402 and MPP/Stripe-style machine payment flows,
- AP2-style authority and mandate records,
- MCP Registry, A2A Agent Cards, and AGNTCY/OASF capability/discovery surfaces,
- Solana/AUDD, Pay.sh/PayAI, and other rail-specific payment adapters,
- observability/evaluation systems that can supply or retain evidence references.

## 9. Roadmap boundaries

Near-term work should improve local conformance, receipt/replay evidence, adapter interoperability, public claim hygiene, and a no-spend or explicitly devnet-bounded RAP Assurance demo. Mainnet, live funds, custody, hosted production services, package publication, partner claims, and security/compliance claims require separate approval and evidence.

## 10. Conclusion

RAP Assurance treats paid agent work as an evidence problem above payment. Payment products can prove value moved; RAP records whether the paid work was authorized, delivered, evidenced, attested, replayable, and safe to use as reputation/dispute input.

## Appendices

- Appendix A: `APPENDIX-THREAT-MODEL.md`
- Appendix B: `APPENDIX-BENCHMARK-METHODOLOGY.md`

## Companion docs

- Public claim boundary: `../PUBLIC-CLAIM-BOUNDARY.md`
- Receipt policy: `../RAP-RECEIPT-POLICY-V1.md`
- Glossary: `GLOSSARY.md`
- Claims traceability: `CLAIMS-TRACEABILITY.md`
- Changelog: `CHANGELOG.md`
