# Discover / Decide / Prove — Boundaries Across OSS, Hosted, and Quasar Lanes

Issue: [#452](https://github.com/nissan/reddi-agent-protocol/issues/452)
(parent epics [#355](https://github.com/nissan/reddi-agent-protocol/issues/355) /
[#363](https://github.com/nissan/reddi-agent-protocol/issues/363) /
[#388](https://github.com/nissan/reddi-agent-protocol/issues/388))

This is the one-page developer model for how Reddi Agent Protocol (RAP) splits responsibility
between discovery metadata, local decision gates, and proof artifacts — and which of the three
delivery lanes (OSS/local, hosted, Quasar/on-chain) owns which behavior. If a claim in another doc
or listing seems to conflict with this page, the fail-closed reading here wins.

## 1. The model: Discover -> Decide -> Prove

Every RAP workflow — from the local no-spend quickstart to a reviewed hosted listing — moves
through the same three stages, in order, with no stage able to skip or overrule the one after it:

| Stage | Question it answers | What it is allowed to produce | What it can never do |
| --- | --- | --- | --- |
| **Discover** | "What specialists/capabilities exist, and where did this metadata come from?" | Catalog/search results, listing metadata, source refs, relevance ranking | Grant trust, approve payment, invoke anything, publish anything, mutate reputation |
| **Decide** | "Is this buyer allowed to use this source, under which policy, budget, and rail?" | Policy decisions, trust states, payment plans/preflights, operator-approval requirements, rejection reasons | Treat catalog claims as verified truth, widen buyer authority, bypass a failed gate because relevance was high |
| **Prove** | "What actually happened, and can it be verified later?" | Receipts, EvidenceArchive records, receipt/evidence bindings, attestation drafts, reputation previews | Claim custody, settlement finality, or live publication; mutate reputation without evidence |

The ordering is load-bearing: discovery relevance is **only** a discovery signal. It is never
trust, safety, budget, payment, invocation, or publication approval
([#344](https://github.com/nissan/reddi-agent-protocol/issues/344)). A high-relevance candidate
still fails closed when any Decide gate fails, and nothing in Prove is emitted for a workflow that
Decide rejected.

## 2. Component mapping

| Component | Stage | Role |
| --- | --- | --- |
| **ARD / AI Catalog** | Discover | Discovery and capability metadata only. `/.well-known/ai-catalog.json` documents, catalog/search results, and listing profiles enter RAP as **untrusted source metadata** ([#343](https://github.com/nissan/reddi-agent-protocol/issues/343)). Catalog or trust-manifest claims are never treated as verified truth and never elevate policy, payment, or invocation approval by themselves. |
| **RAP core (OSS)** | Decide + Prove | Owns policy, payment, and evidence: provider trust states, buyer-authority policy, payment-plan/preflight gates, receipts, EvidenceArchive, receipt/evidence binding, attestation drafts, and reputation previews. All gates fail closed. |
| **Quasar** | Optional projection | An **optional** compatibility/on-chain projection lane on Solana. RAP workflows complete — including proof — entirely off-chain; Quasar adds an on-chain registry/attestation surface for the subset of jobs that qualify, per [#390](https://github.com/nissan/reddi-agent-protocol/issues/390)/[#394](https://github.com/nissan/reddi-agent-protocol/issues/394). |

## 3. Lane boundaries

### 3.1 OSS / local lane — always sufficient

A developer can Discover, Decide, and Prove entirely locally, with no hosted infrastructure, no
network, no wallet/RPC, and no spend. This is the posture the
[#507](https://github.com/nissan/reddi-agent-protocol/issues/507) readiness audit confirmed:
**hosted services remain optional for OSS/local RAP developer success** — a local or self-hosted
deployment uses the same evidence contracts, review states, and dry-run export shapes without
depending on a Reddi-hosted registry.

The reference path is the deterministic ARD no-spend quickstart
([`packages/agent-protocol/README.md`, "ARD No-Spend Quickstart"](../packages/agent-protocol/README.md#ard-no-spend-quickstart)):

```bash
cd packages/agent-protocol
npm ci
npm run example:ard:no-spend
```

It walks the full Discover -> Decide -> Prove loop from a static AI Catalog fixture: validate the
catalog, build a discovery candidate, run source-aware diagnostics, evaluate local policy/trust/
payment gates, execute a bounded dry-run function, and emit receipt, EvidenceArchive record,
attestation draft, reputation update, and AUDD dry-run payment-plan/preflight — all labeled
fixture-only and no-spend.

Self-hosted ARD/RAP discovery (publishing your own `/.well-known/ai-catalog.json`) requires no
hosted RAP infrastructure and stays valid without appearing in hosted search.

### 3.2 Hosted lane ([#369](https://github.com/nissan/reddi-agent-protocol/issues/369)) — read-only and optional

Hosted RAP discovery surfaces (`/.well-known/ai-catalog.json` for managed listings and
`GET /api/hosted-rap/search`) are **read-only projections of the gated marketplace public-export
snapshot, and they are optional**. They do not publish raw imported drafts, activate payments,
probe endpoints, call providers, assign trust or reputation, or mutate registry state. Paid hosted
value is operations around discovery — curation, SLA, audit logs, team policy, managed listings —
never protocol exclusivity, and hosted fees must not tax self-hosted usage.

Listing metadata distinguishes `self-hosted`, `hosted-by-rap`, and `externally-listed` sources, and
`externally-listed` metadata stays untrusted until local Decide gates say otherwise. Details:
[`docs/HOSTED-RAP-DISCOVERY-SURFACES.md`](HOSTED-RAP-DISCOVERY-SURFACES.md) and the
[hosted marketplace operations runbook](HOSTED-MARKETPLACE-OPERATIONS-READINESS-RUNBOOK.md).

### 3.3 Quasar lane ([#390](https://github.com/nissan/reddi-agent-protocol/issues/390)) — metadata/read-model only

The landed Quasar registry compatibility surface
(`packages/agent-protocol/src/quasar-registry-compatibility.ts`,
`reddi.quasar-registry-compatibility.v1`) defines which listing/profile fields map to compact
on-chain Quasar agent-account fields (owner, agent type, model, rate, minimum reputation, active
state, counters, reputation/attestation aggregates) versus off-chain listing metadata (description,
endpoint, ARD URL, auth requirements, AUDD terms, evidence refs, trust badges, capabilities, tags,
health, rich copy). Rich metadata is never forced on-chain; profile fixtures round-trip without
on-chain writes.

**This compatibility layer is metadata and read-model only.** It does not build, sign, or submit
Quasar instructions, and no RAP surface may derive on-chain write behavior from it unless a later
issue explicitly builds instruction flows — e.g.
[#394](https://github.com/nissan/reddi-agent-protocol/issues/394)'s mapping of eligible jobs to
Quasar commit/reveal and attestation confirm/dispute instructions, which is scoped to happen only
on top of the #390 definition and only after its own gates. Until such an issue lands, treat any
"Quasar-backed" claim outside decode/read-model scope as out of bounds.

### 3.4 Publication ([#395](https://github.com/nissan/reddi-agent-protocol/issues/395)) — the single owner of live publication

**[#395](https://github.com/nissan/reddi-agent-protocol/issues/395) owns live publication
behavior.** No discovery surface, compatibility layer, export helper, runbook, or UI evidence
elsewhere in the repo authorizes publishing a live listing. Under #395, a listing cannot publish
until profile, safety, payment-plan, dry-run receipt/evidence, attestation/reputation readiness,
and operator-approval gates all pass; hosted RAP marketplace payloads and ARD-compatible
catalog/search output are generated from the same reviewed source of truth; and approve / reject /
request-changes / suspend / unpublish paths are auditable. Publication claims touching payment
proof, receipt/evidence, trust, or reputation must come from
[#393](https://github.com/nissan/reddi-agent-protocol/issues/393)/[#394](https://github.com/nissan/reddi-agent-protocol/issues/394)
outputs, never from raw imported metadata. Everything currently in-tree is dry-run/fixture
evidence feeding that gate.

## 4. Stage detail: what lands where

**Discover** — AI Catalog validation and discovery candidates; `auth.md` discovery snapshots and
the provider trust registry lane ([#343](https://github.com/nissan/reddi-agent-protocol/issues/343):
trusted / listed-untrusted / claimed / unverified / failed-verification / blocked /
needs-human-review, with anonymous write scopes and malformed metadata failing closed);
source-aware ranking explainability and supervisor diagnostics
([#344](https://github.com/nissan/reddi-agent-protocol/issues/344)), which separate relevance from
publisher identity, trust evidence, policy decision, budget/payment fit, and reputation state.

**Decide** — buyer-authority policy (`reddi.buyer-authority-policy.v1`: spend caps, allowlists,
expiry, operator approval — external mandates and rail metadata can only narrow it, never widen
it); payment-plan/preflight gates (AUDD/x402 dry-run planning); and the rail-neutral receipt
support states, under which probe-only rails (e.g. webhook-derived card-rail fixtures) are capped
at `probe_only` and can never become binding receipts or settlement claims.

**Prove** — `reddi.receipt.v1` receipts, EvidenceArchive records, and the
[#393](https://github.com/nissan/reddi-agent-protocol/issues/393) receipt/evidence binding, which
ties source catalog/fixture refs, listing ids, policy decisions, payment-proof metadata,
request/response hashes, evidence refs, attestation status, and reputation-event drafts into one
record (hashes and refs preferred over raw prompt/output). On top of that,
[#394](https://github.com/nissan/reddi-agent-protocol/issues/394) provides off-chain reputation
preview from receipts and evidence, marks unverifiable or insufficient-evidence listings, and
requires every reputation claim to state whether it is off-chain preview, Quasar-backed, or hosted
attestation-backed. No reputation mutation happens on failed policy, missing evidence, failed
attestation, or unverified payment proof.

## 5. Quickstart and conformance expectations

- **Quickstart ([#357](https://github.com/nissan/reddi-agent-protocol/issues/357), closed):** the
  under-five-minute local path is the
  [ARD No-Spend Quickstart](../packages/agent-protocol/README.md#ard-no-spend-quickstart) above. It
  labels dry-run/simulated/devnet-proof metadata explicitly and makes no hosted-service, paid
  provider, wallet/RPC/SPL, Quasar-custody, or live-settlement claims.
- **Conformance:** the quickstart's deterministic check is
  `npm test -- --test-name-pattern "ARD no-spend demo"` in `packages/agent-protocol`. Broader
  fixture-backed conformance surfaces live under
  [`docs/conformance/`](conformance/framework-template-comparison.md) (framework templates,
  [static agent-stack fixtures](conformance/static-agent-stack/README.md)), and repo-wide checks
  include `npm run check:rap:naming`.
- **Public developer conformance suite ([#353](https://github.com/nissan/reddi-agent-protocol/issues/353), open):**
  the consolidated public quickstart + conformance packaging (receipt shape, policy-decision shape,
  source metadata, challenge handling, evidence binding, no-secret leakage, and the standard
  failure-state fixture set) is tracked there; this boundary doc feeds it and should be linked from
  it when it lands.

## 6. What this doc does not authorize

Nothing here enables or implies live behavior. Specifically: no live marketplace publication
(that is [#395](https://github.com/nissan/reddi-agent-protocol/issues/395)'s gated scope), no
Quasar instruction building or on-chain writes (post-[#390](https://github.com/nissan/reddi-agent-protocol/issues/390)
issue scope only), no custody, no settlement-finality claims, no live payments, no trust upgrades,
and no reputation mutation. Every lane above is currently proven with local fixtures, dry-run
records, and gated dry-run export snapshots.
