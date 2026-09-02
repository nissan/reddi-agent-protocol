# Reddi Agent Protocol

**RAP Assurance: open receipts for paid MCP/API and agent work.**

> Payments prove transfer; RAP Assurance proves paid work.

Reddi Agent Protocol (RAP) is an open, local-first assurance layer for paid agent workflows. It does not try to be a payment rail, marketplace operator, generic hosted runtime, custody provider, or wallet/action toolkit. Instead, RAP Assurance binds work terms, buyer policy, payment-proof references, evidence references, attestation outcomes, replay metadata, and reputation inputs so builders can verify what happened around a paid MCP/API or agent-to-agent job.

Current shipped behavior is local/offline and devnet-bounded unless a page or command explicitly says otherwise. The recorded Quasar devnet deployment is blocked (`submissionReady: false` in `config/quasar/deployments.json`), mainnet/live-funds paths are not ready, and no deployed on-chain release path collects a protocol treasury fee.

- 🌐 **Web app:** https://agent-protocol.reddi.tech (public demo site; not a mainnet deployment claim)
- 🐦 **X:** https://x.com/reddiagent
- 📦 **Protocol repo:** https://github.com/nissan/reddi-agent-protocol
- 🧪 **Judge replication guide:** [`docs/JUDGE-REPLICATION-GUIDE.md`](docs/JUDGE-REPLICATION-GUIDE.md)
- 📦 **OSS v0.1 package plan:** [`docs/OSS-V0.1-PACKAGE-PLAN.md`](docs/OSS-V0.1-PACKAGE-PLAN.md)
- 💸 **Hosted self-funding boundary:** [`docs/HOSTED-SELF-FUNDING-OFFER.md`](docs/HOSTED-SELF-FUNDING-OFFER.md)
- 📘 **Whitepaper docs:** `docs/whitepaper/` + `/whitepaper` web route
- 🧠 **Public claim boundary:** [`docs/PUBLIC-CLAIM-BOUNDARY.md`](docs/PUBLIC-CLAIM-BOUNDARY.md)
- 🤝 **Contributing:** [`CONTRIBUTING.md`](CONTRIBUTING.md)
- 🏛️ **Open-source governance:** [`docs/OPEN-SOURCE-GOVERNANCE.md`](docs/OPEN-SOURCE-GOVERNANCE.md)
- 🔐 **Security:** [`SECURITY.md`](SECURITY.md)
- 📄 **License scope:** [`NOTICE.md`](NOTICE.md)
- 🧰 **Pinned Solana workstation baseline:** [`docs/SOLANA-TOOLCHAIN-BASELINE.md`](docs/SOLANA-TOOLCHAIN-BASELINE.md)

---

## What it is

RAP Assurance is a proof and conformance layer where:

- **Buyers and agent operators** can evaluate quotes, budget policy, payment-proof references, receipts, evidence, and replay metadata before trusting a paid result.
- **Specialist builders** can expose capabilities and x402-style payment challenges while keeping payment settlement in external rails or explicitly gated devnet fixtures.
- **Attestors/judges** can inspect outputs and evidence references to produce bounded quality signals for routing, dispute, and reputation previews.
- **Conformance suites** exercise receipt shape, policy decisions, proof-chain fixtures, evidence binding, no-spend workflows, and package artifact boundaries from a clean checkout.

RAP is intentionally complementary to adjacent standards and products: x402 and MPP/Stripe-style systems can prove transfer; AP2 can describe authority; MCP Registry, A2A, and AGNTCY/OASF can expose discovery/capability metadata; Pay.sh/PayAI and Solana/AUDD adapters can provide payment-specific rails. RAP Assurance records the paid-work lifecycle above and around those systems.

## What it is not yet

- Not a broad production agent marketplace or app store.
- Not a payment facilitator, custody service, escrow provider, wallet SDK, or generic hosted agent runtime.
- Not mainnet-ready and not a live-funds production deployment.
- Not a security-audited release; `SECURITY.md` is a threat-model and disclosure boundary.
- Not proof that AUDD/Solana custody or settlement is supported beyond the explicitly labelled proof/payment-plan/read-only observation paths.
- Not an implemented transaction take-rate: 0.05% / 5 bps examples are planned/product-fixture economics only.

## Open-source core and hosted boundary

Reddi Agent Protocol is open-source-first. The core protocol, SDKs, middleware, MCP bridge, conformance tests, local/devnet examples, and documentation should remain usable without a hosted Reddi account, private deployment URL, paid-provider credential, or Redditech-operated service.

Optional hosted Redditech services may later provide convenience layers such as managed relays, evidence retention, receipt search, audit export, conformance certification, support, or managed Arena/community operations. Those services must stay replaceable adapters around the OSS core, not prerequisites for running or validating the protocol.

See [`docs/OPEN-SOURCE-GOVERNANCE.md`](docs/OPEN-SOURCE-GOVERNANCE.md) and [`docs/PUBLIC-CLAIM-BOUNDARY.md`](docs/PUBLIC-CLAIM-BOUNDARY.md) for the open-core and public-claim boundaries.

---

## Architecture

```text
┌──────────────── OFF-CHAIN / LOCAL-FIRST ASSURANCE ───────────────┐
│                                                                  │
│  Buyer / Consumer Agent                                          │
│  ├── discover candidates from local, MCP, registry, or adapter data│
│  ├── evaluate quote + budget + authority policy before payment    │
│  └── retain receipt, evidence refs, replay metadata, and outcome  │
│                                                                  │
│  Specialist Agent / API                                           │
│  ├── exposes capability and pricing metadata                      │
│  ├── may issue x402-style 402 challenges                          │
│  └── returns work output only through caller-owned integration     │
│                                                                  │
│  Attestor / Judge                                                 │
│  ├── evaluates output and evidence against agreed criteria         │
│  └── produces bounded attestation/reputation inputs               │
│                                                                  │
│  RAP Assurance packages                                           │
│  ├── receipts, policies, proof refs, evidence binding, replay      │
│  ├── local MCP bridge and no-spend conformance fixtures           │
│  └── x402/Solana/AUDD adapter helpers where explicitly gated       │
└──────────────────────────────────────────────────────────────────┘

┌──────────── OPTIONAL / BOUNDED ON-CHAIN REFERENCE SURFACES ───────┐
│  Legacy Anchor reference program: historical comparison only       │
│  Quasar programs: local Surfpool lane only for current sources     │
│  Recorded Quasar devnet ids: blocked, not a current demo target    │
│  Mainnet: no audited deployment registered                         │
└──────────────────────────────────────────────────────────────────┘
```

**Payment/assurance boundary:**

```text
Payment rail proves transfer or payment intent
        ↓
RAP Assurance records work terms + policy + payment-proof ref + evidence ref
        ↓
Attestation/replay/conformance decide what the paid work evidence supports
```

---

## Getting started — local no-spend proof

The fastest externally supportable path is the local `@reddi/agent-protocol` conformance workflow. It does not require a wallet, RPC endpoint, hosted Reddi service, provider key, paid API call, or live payment.

```bash
git clone https://github.com/nissan/reddi-agent-protocol
cd reddi-agent-protocol
npm install
npm run check:conformance:public
```

For the package-level quickstart:

```bash
cd packages/agent-protocol
npm ci
npm run example:ard:no-spend
npm run conformance
```

See [`docs/RAP-V0.1-DEVELOPER-QUICKSTART-AND-CONFORMANCE.md`](docs/RAP-V0.1-DEVELOPER-QUICKSTART-AND-CONFORMANCE.md) for the current developer entry point.

## Verify recorded demo evidence

The hackathon-era videos are backed by a public replication guide and verifier script. Treat the results as recorded devnet/local evidence, not as production or mainnet readiness.

```bash
git clone https://github.com/nissan/reddi-agent-protocol
cd reddi-agent-protocol
npm install
node scripts/judge-replication-check.mjs
```

The verifier checks public product routes, recorded Solana devnet transactions, and the Loop 51 registered agent PDA. Full step-by-step instructions are in [`docs/JUDGE-REPLICATION-GUIDE.md`](docs/JUDGE-REPLICATION-GUIDE.md).

## Protocol economics boundary

| Topic | Current repository behavior |
|---|---|
| Protocol fee | No deployed on-chain release path collects a protocol treasury fee. |
| 0.05% / 5 bps | Planned/product-fixture semantics only; zero fee is modeled on failed examples. |
| Registration fee | The legacy registry burn constant is a devnet-era anti-sybil fixture, not protocol revenue. |
| Custody | Current shipped public package flows are no-spend/proof-reference/read-only observation helpers. |
| AUDD/Solana | AUDD is payment-plan/proof metadata and read-only SPL observation unless a separate approved live rail lands. |

## Reputation and attestation boundary

RAP receipts and attestation records can bind evidence and make reputation inputs inspectable. They do not by themselves prove final settlement, mainnet execution, provider quality, legal/compliance approval, or live reputation mutation. Current Quasar readiness still has unresolved gates; do not treat the on-chain reputation system as mainnet-ready until those are closed and re-reviewed.

---

## Running protocol/reference checks locally

### Prerequisites

- Pinned user-scoped Solana/Anchor toolchain from [`docs/SOLANA-TOOLCHAIN-BASELINE.md`](docs/SOLANA-TOOLCHAIN-BASELINE.md) (Anchor 1.1.2; Agave/Solana CLI 4.2.2; Rust 1.98.0; repo-local Node 24.20.0)
- Node dependencies installed with `npm install`
- [Ollama](https://ollama.ai) with at least one model for local demo simulations that invoke a local model

### Common safe checks

```bash
npm test -- --ci --maxWorkers=2
npm run lint
npm run build
npm run check:conformance:public
npm run check:oss-release-smoke
npm run check:claims:public
```

Legacy Anchor reference checks (no live deployment):

```bash
cargo build-sbf --manifest-path programs/escrow/Cargo.toml --sbf-out-dir target/deploy
cargo test -p escrow
anchor idl build -p escrow --skip-lint -o .tmp/escrow-idl.json -t .tmp/escrow-idl.ts
```

Inspect scripts before running anything with `devnet`, `live`, `surfpool`, or `evidence` in the name; some scripts use wallets, fixed ports, RPC endpoints, generated artifacts, or live-spend gates.

## Web app pages

| Page | URL | Purpose |
|---|---|---|
| Landing | `/` | RAP Assurance overview and claim boundary |
| Directory | `/agents` | Browse specialists and discovery candidates with trust/payment boundaries |
| Setup | `/setup` | Local endpoint setup helper |
| Demo | `/demo` and `/economic-demo` | Labelled local/devnet proof walkthroughs |
| Register | `/register` | Devnet/local specialist registration UI with readiness gates |
| Planner | `/planner` | Buyer policy and receipt inspection flow |
| Dashboard | `/dashboard` | Local/demo role dashboards |
| Whitepaper | `/whitepaper` | Candidate documentation with explicit current-state boundaries |

## Solana programs

The four **Quasar** program ids recorded for devnet live in [`config/quasar/deployments.json`](config/quasar/deployments.json), which is the single source of truth for their status. That deployment is currently **blocked** (`submissionReady: false`): the binaries predate the job-binding rework and no longer match the in-repo client, so the Quasar target is refused on devnet before any instruction is built, any signer is touched, or any RPC call is made. No redeploy is claimed or performed.

Quasar is therefore experimental, and the only retained Quasar evidence is the local Surfpool lane described in [`docs/SURFPOOL-QUASAR-CRITICAL-SDK-LANE.md`](docs/SURFPOOL-QUASAR-CRITICAL-SDK-LANE.md), which builds current sources and runs them against a loopback local validator.

The legacy Anchor deployment (`794nTFNyJknzDrR13ApSfVyNCRvcvnCN3BVDfic8dcZD`) is historical/reference only. Deployment guidance is in [`DEPLOY.md`](DEPLOY.md).

## Stack

- **Assurance packages:** `@reddi/agent-protocol`, `@reddi/x402-solana`, `@reddi/rap-mcp-bridge`
- **Conformance:** deterministic Jest, Node, and package dry-run checks
- **Reference Solana code:** legacy Anchor program plus experimental Quasar sources/lane
- **MCP bridge:** repo-local bridge for discovery, synthetic quotes, dry-run verification, and disclosure ledgers
- **Framework adapters:** experimental/deferred repo-local integrations, not public v0.1 package claims
- **Web app:** Next.js 16 (App Router) + React 19 + Tailwind v4 + shadcn/ui + Solana wallet adapter

---

Built for the Reddi Agent Economy Hackathon evidence track and now narrowed around RAP Assurance.
