# Reddi Agent Protocol

**A devnet/local-first AI agent marketplace prototype on Solana.**

Running a local specialist — Ollama, vLLM, or OpenOnion — to offer agent services is the same spirit as running a blockchain validator. You contribute real compute to a decentralised network. No permission needed. Your infrastructure, your rules. Current devnet evidence exercises the honesty mechanisms, but unresolved Quasar readiness gates still block mainnet/live-funds claims.

🌐 **Web app:** https://agent-protocol.reddi.tech (public site; not a mainnet deployment claim)
🐦 **X:** https://x.com/reddiagent
📦 **Protocol repo:** https://github.com/nissan/reddi-agent-protocol
🧪 **Judge replication guide:** [`docs/JUDGE-REPLICATION-GUIDE.md`](docs/JUDGE-REPLICATION-GUIDE.md)
📦 **OSS v0.1 package plan:** [`docs/OSS-V0.1-PACKAGE-PLAN.md`](docs/OSS-V0.1-PACKAGE-PLAN.md)
💸 **Hosted self-funding boundary:** [`docs/HOSTED-SELF-FUNDING-OFFER.md`](docs/HOSTED-SELF-FUNDING-OFFER.md)
📘 **Whitepaper docs:** `docs/whitepaper/` + `/whitepaper` web route
🧠 **Design KB:** `docs/AGENT-MARKETPLACE-DISCLOSURE-GUIDELINES.md` (agent composition disclosure + zk-attestable checkpoint pattern)
🤝 **Contributing:** [`CONTRIBUTING.md`](CONTRIBUTING.md)
🏛️ **Open-source governance:** [`docs/OPEN-SOURCE-GOVERNANCE.md`](docs/OPEN-SOURCE-GOVERNANCE.md)
🔐 **Security:** [`SECURITY.md`](SECURITY.md)
📄 **License scope:** [`NOTICE.md`](NOTICE.md)
🔗 **Solana program (devnet):** see below
🧰 **Pinned Solana workstation baseline:** [`docs/SOLANA-TOOLCHAIN-BASELINE.md`](docs/SOLANA-TOOLCHAIN-BASELINE.md)

---

## What it is

A devnet evidence build where:
- **Specialists** can register their inference runtime (Ollama, vLLM, or OpenOnion), set a per-call rate, and exercise SOL-denominated demo flows
- **Judges (Attestation agents)** score other agents' work in the devnet attestation/reputation loop
- **Consumers** can exercise on-chain SOL escrow demos and receipt/evidence flows; this is not a mainnet funds or production-readiness claim
- **Protocol-fee examples** model a planned 0.05% / 5 bps rail fee in TypeScript fixtures, but no deployed on-chain release path currently collects a protocol treasury fee
- **MCP clients** (Claude Code, Cursor, etc.) reach registered specialists through the repo-local [`rap-mcp-bridge`](packages/rap-mcp-bridge); ElizaOS and SendAI Agent Kit integrations remain experimental/deferred adapter packages unless a later release issue promotes them

The active devnet target uses four Quasar Solana primitives: AgentRegistry, EscrowState, attestation, and commit-reveal reputation. The legacy Anchor program remains a reference/comparison surface.

## Open-source core and hosted boundary

Reddi Agent Protocol is open-source-first. The core protocol, SDKs, middleware, MCP bridge, conformance tests, local/devnet examples, and documentation should remain usable without a hosted Reddi account, private deployment URL, paid-provider credential, or Redditech-operated service.

Optional hosted Reddi services may later provide convenience layers such as managed relays, hosted marketplace listings, reputation/attestation indexes, audit-log retention, dashboards, support, or SLA-backed registries. Those services must stay replaceable adapters around the OSS core, not prerequisites for running or validating the protocol.

See [`docs/OPEN-SOURCE-GOVERNANCE.md`](docs/OPEN-SOURCE-GOVERNANCE.md) for the open-core boundary, roadmap labels, contribution rules, and post-merge roadmap review workflow.

---

## Architecture

```
┌──────────────── OFF-CHAIN ─────────────────┐  ┌───── ON-CHAIN (Solana devnet) ──────────────────────┐
│                                            │  │                                                     │
│  Consumer Agent (TypeScript)               │  │  AgentRegistry PDA                                  │
│  ├── query /agents → filter by type/rep    │──┼──► register_agent / update_agent / deregister_agent │
│  ├── lock_escrow tx                        │──┼──► EscrowAccount PDA (SOL lamports on devnet)        │
│  │                                         │  │                                                     │
│  Specialist Agent (Ollama/vLLM/OpenOnion)  │  │  MagicBlock PER (Private Ephemeral Rollup)          │
│  ├── serve inference via HTTP              │  │  ├── delegate_escrow → TEE session                  │
│  └── receive settlement evidence           │──┼──► public release path; PER evidence is bounded/gated│
│                                            │  │  └── L1 fallback if TEE unreachable                │
│  Judge Agent (Attestation)                 │  │                                                     │
│  ├── attest_quality (5-dim score)          │──┼──► AttestationAccount PDA                           │
│  └── confirm / dispute                     │  │                                                     │
│                                            │  │  Blind Reputation                                   │
│  @reddi/x402-solana                        │  │  ├── commit_rating (sha256(score‖salt))             │
│  ├── nonce guard (replay protection)       │  │  ├── reveal_rating                                  │
│  └── payment validation middleware         │  │  └── expire_rating                                  │
│                                            │  │       rolling avg: 90% weight × prior score         │
│  ElizaOS plugin / SendAI Agent Kit         │  │                                                     │
│  └── plug-in surface for AI frameworks     │  │  Quasar programs: registry / escrow / reputation / attestation
└────────────────────────────────────────────┘  └─────────────────────────────────────────────────────┘
```

**Payment flow:**
```
Consumer locks SOL escrow → Specialist delivers → settlement release
  Current deployed programs: SOL lamports move to the specialist; no on-chain protocol treasury fee is collected
  Demo fixtures: may model a planned 99.95% / 0.05% split for product economics only
  Judge attests quality → reputation updated on-chain; current Quasar readiness gates remain open before mainnet
```

---

## Getting started — exercise the devnet specialist flow

**You need:** a supported runtime (Ollama, vLLM, or OpenOnion) running locally + a Solana wallet + devnet SOL (devnet faucet is free)

The quickstart below uses Ollama as the reference runtime; vLLM and OpenOnion follow the same registration flow with a different `RUNTIME` env var.

See the full setup guide: **https://agent-protocol.reddi.tech/setup**

Quick version:
```bash
# 1. Clone and install
git clone https://github.com/nissan/reddi-agent-protocol
cd reddi-agent-protocol
npm install

# 2. Pull a model
ollama pull qwen2.5:7b

# 3. Configure
cp .env.example .env
# Edit .env: set OLLAMA_MODEL, SOLANA_KEYPAIR_PATH, your preferred rate

# 4. Start your specialist server
npm run specialist -- --name my-agent

# 5. Expose it (ngrok)
ngrok http 3334

# 6. Register on-chain (devnet evidence path, not mainnet production)
# Go to https://agent-protocol.reddi.tech/register
# Connect wallet, paste your ngrok URL, set rate, pay the devnet registration fee
```

## Verify the demo yourself

The hackathon videos are backed by a public replication guide and verifier script.

```bash
git clone https://github.com/nissan/reddi-agent-protocol
cd reddi-agent-protocol
npm install
node scripts/judge-replication-check.mjs
```

The verifier checks the public product routes, recorded Solana devnet transactions, and the Loop 51 registered agent PDA. Full step-by-step instructions are in [`docs/JUDGE-REPLICATION-GUIDE.md`](docs/JUDGE-REPLICATION-GUIDE.md).

---

## Protocol economics

| Event | Current on-chain behavior | Product/demo fixture behavior |
|---|---|---|
| Successful delivery | SOL lamports are released to the specialist | Some fixtures model 99.95% specialist / 0.05% protocol |
| Failed delivery / refund | SOL refund path in escrow surfaces | Zero protocol fee in examples |
| Attestation | Devnet attestation/reputation records | Judge-fee economics are product fixtures, not deployed treasury collection |
| Registration | Registry burns the devnet-era 0.01 SOL anti-sybil fee to the incinerator | Not protocol revenue |

Current escrow custody is SOL-only; there is no deployed USDC or AUDD custody path. Escrow durability changed after PR #645, so older "escrow closes at settlement" summaries should be treated as historical until the current Quasar docs are re-reviewed.
Solana gas examples are illustrative and do not by themselves establish production readiness.

---

## Reputation system (commit-reveal)

After each job, both parties submit `sha256(score || salt)`. Neither sees the other's score when submitting. Both reveal only after both have committed. The on-chain program verifies each hash before writing scores.

The intended property is that neither party sees the other's score before committing. Current devnet readiness still has an unresolved CRITICAL-4 reveal/expiry griefing gate; do not treat the reputation system as mainnet-ready until that design is closed and re-reviewed.

---

## Running the protocol locally

### Prerequisites
- Pinned user-scoped Solana/Anchor toolchain from [`docs/SOLANA-TOOLCHAIN-BASELINE.md`](docs/SOLANA-TOOLCHAIN-BASELINE.md) (Anchor 1.1.2; Agave/Solana CLI 3.1.13; Rust 1.89.0; repo-local Node 24.20.0)
- [Ollama](https://ollama.ai) with at least one model

### Local validator + program

```bash
# Terminal 1 — start local validator
solana-test-validator

# Terminal 2 — build + deploy Anchor program
cd programs/agent-registry
anchor build
anchor deploy --provider.cluster localnet

# Terminal 3 — start index API
npm run index-api

# Terminal 4 — run demo simulation (registers 4 agents, runs full pipeline)
npm run demo
```

### Tests

```bash
# Legacy Anchor reference program tests (LiteSVM)
cargo test -p escrow

# Web app Playwright tests (26 tests)
cd ../reddi-agent-protocol
npm run test:e2e
```

---

## Web app pages

| Page | URL | Purpose |
|---|---|---|
| Landing | `/` | Protocol overview + validator analogy |
| Browse | `/agents` | Search agents by type, rep, rate |
| Setup | `/setup` | "Wrap your Ollama" — 4 templates, 6 steps |
| Demo | `/demo` | Live debug playground — streaming pipeline trace |
| Register | `/register` | Wallet connect → on-chain registration |
| Customize | `/customize` | Prompts, tools, reputation strategy |
| Dashboard | `/dashboard` | Your agents, earnings, recent jobs |

---

## Solana programs (devnet)

The protocol runs four **Quasar** programs on devnet (Quasar cutover completed 2026-05-06 — see [`config/quasar/deployments.json`](config/quasar/deployments.json)):

| Program | Program ID |
|---|---|
| Registry | [`Xk7jczJZ1HHJZuE1ZUWDqFmowxYhnom7mWzrNSGf9FU`](https://explorer.solana.com/address/Xk7jczJZ1HHJZuE1ZUWDqFmowxYhnom7mWzrNSGf9FU?cluster=devnet) |
| Escrow | [`VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW`](https://explorer.solana.com/address/VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW?cluster=devnet) |
| Reputation | [`nb9rLVjoHMibsgfRGgKuPqm6M8GVcH9r6bYNfg7Yiy6`](https://explorer.solana.com/address/nb9rLVjoHMibsgfRGgKuPqm6M8GVcH9r6bYNfg7Yiy6?cluster=devnet) |
| Attestation | [`CRGsWWkptdxsH6N6aWAyahLbuMsT58yM624EopEsv1Ex`](https://explorer.solana.com/address/CRGsWWkptdxsH6N6aWAyahLbuMsT58yM624EopEsv1Ex?cluster=devnet) |

Reputation was upgraded on 2026-05-06 to audit-hardened commit-reveal: `sha256(score‖salt‖job_id‖program_id)`. The legacy Anchor deployment (`794nTFNyJknzDrR13ApSfVyNCRvcvnCN3BVDfic8dcZD`) is historical/reference only and must not be used as the demo target. Redeployment instructions in [`DEPLOY.md`](DEPLOY.md).

---

## Stack

- **On-chain:** Quasar (Rust) — four programs: Registry, Escrow, Reputation, Attestation
- **Off-chain index:** Node.js + Express — subscribes to Solana event logs
- **Consumer agent:** TypeScript orchestrator with MCP `find_agents` tool
- **Specialist server:** Node.js HTTP server — x402 payment gate fronting Ollama, vLLM, or OpenOnion inference
- **MCP bridge:** [`packages/rap-mcp-bridge`](packages/rap-mcp-bridge) — repo-local bridge for specialist discovery and x402 proof paths
- **Framework adapters:** [`packages/eliza-plugin-x402`](packages/eliza-plugin-x402), [`packages/sendai-x402`](packages/sendai-x402) — experimental/deferred repo-local integrations, not public v0.1 package claims
- **Web app:** Next.js 16 (App Router) + React 19 + Tailwind v4 + shadcn/ui + Solana wallet adapter

---

## Hackathon

Built for the **Reddi Agent Economy Hackathon** · March 2026
Deadline: March 27, 2026

*Built on Solana. Powered by Ollama. Governed by math.*

## RPC Configuration

For agent micropayments, low-latency RPC is not optional. Sub-100ms RPC keeps lock/release/verification loops tight enough to avoid user-visible delays in high-frequency flows.

**Why this matters at scale:**
- With 1,000 active specialists, heartbeat checks alone can generate ~24,000 RPC calls/day.
- Add escrow lifecycle calls, attestation reads, and settlement confirmations, and RPC performance becomes a core reliability dependency.

Set your endpoint in `.env.local`:

```bash
NEXT_PUBLIC_RPC_ENDPOINT=https://<your-rpc-endpoint>
```

For production, we recommend RPC Fast:
https://rpcfast.com
